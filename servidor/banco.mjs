// Acesso ao banco SQLite da Área do gestor. TODO o SQL da API fica neste modulo:
// trocar node:sqlite por better-sqlite3 (ou o banco por PostgreSQL) mexe so aqui.
//
// O banco guarda SOMENTE totais das analises: nenhum nome, CPF, CNS ou prontuario.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { UNIDADES } from '../src/engine/unidades.js';

const PASTA_MIGRACOES = join(import.meta.dirname, 'migracoes');
const agora = () => new Date().toISOString();
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (caminho !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  migrar(db);
  semearUnidades(db);
  return criarRepositorio(db);
}

/** Aplica, em ordem, os arquivos migracoes/NNN_*.sql ainda nao aplicados. */
function migrar(db) {
  db.exec('CREATE TABLE IF NOT EXISTS migracao (nome TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL)');
  const aplicadas = new Set(db.prepare('SELECT nome FROM migracao').all().map((r) => r.nome));
  const arquivos = readdirSync(PASTA_MIGRACOES).filter((n) => /^\d{3}_.+\.sql$/.test(n)).sort();
  for (const nome of arquivos) {
    if (aplicadas.has(nome)) continue;
    transacao(db, () => {
      db.exec(readFileSync(join(PASTA_MIGRACOES, nome), 'utf8'));
      db.prepare('INSERT INTO migracao (nome, aplicada_em) VALUES (?, ?)').run(nome, agora());
    });
  }
}

function semearUnidades(db) {
  const st = db.prepare(`INSERT INTO unidade (sigla, nome, cnes, codigo_tasy) VALUES (?, ?, ?, ?)
    ON CONFLICT(sigla) DO UPDATE SET nome = excluded.nome, cnes = excluded.cnes, codigo_tasy = excluded.codigo_tasy`);
  transacao(db, () => {
    for (const u of UNIDADES) st.run(u.sigla, u.nome, u.cnes || null, u.codigo_tasy || null);
  });
}

function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function criarRepositorio(db) {
  const q = (sql) => db.prepare(sql);
  const unidadesDoUsuario = q('SELECT sigla FROM usuario_unidade WHERE usuario_id = ? ORDER BY sigla');

  const repo = {
    db,
    fechar: () => db.close(),
    transacao: (fn) => transacao(db, fn),

    // ------------------------------------------------------------------ unidades
    listarUnidades: () => q('SELECT sigla, nome, cnes FROM unidade ORDER BY sigla').all().map((r) => ({ ...r })),
    unidadeExiste: (sigla) => Boolean(q('SELECT 1 FROM unidade WHERE sigla = ?').get(sigla)),

    // ------------------------------------------------------------------ usuarios
    criarUsuario({ email, nome, senhaHash, perfil, unidades = [] }) {
      return transacao(db, () => {
        const { lastInsertRowid: id } = q('INSERT INTO usuario (email, nome, senha_hash, perfil) VALUES (?, ?, ?, ?)').run(email, nome, senhaHash, perfil);
        const st = q('INSERT INTO usuario_unidade (usuario_id, sigla) VALUES (?, ?)');
        for (const s of unidades) st.run(id, s);
        return Number(id);
      });
    },
    atualizarSenha: (id, senhaHash) => q('UPDATE usuario SET senha_hash = ? WHERE id = ?').run(senhaHash, id),
    definirAtivo: (id, ativo) => q('UPDATE usuario SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id),
    usuarioPorEmail(email) {
      const u = q('SELECT id, email, nome, senha_hash, perfil, ativo FROM usuario WHERE email = ?').get(email);
      return u ? { ...u, unidades: unidadesDoUsuario.all(u.id).map((r) => r.sigla) } : null;
    },
    listarUsuarios: () => q(`SELECT u.id, u.email, u.nome, u.perfil, u.ativo, group_concat(uu.sigla) AS unidades
      FROM usuario u LEFT JOIN usuario_unidade uu ON uu.usuario_id = u.id GROUP BY u.id ORDER BY u.email`).all().map((r) => ({ ...r })),

    // ------------------------------------------------------------------ sessoes
    criarSessao({ token, usuarioId, horas, ip }) {
      const criada = new Date();
      const expira = new Date(criada.getTime() + horas * 3600e3);
      q('INSERT INTO sessao (token_hash, usuario_id, criada_em, expira_em, ip) VALUES (?, ?, ?, ?, ?)').run(hashToken(token), usuarioId, criada.toISOString(), expira.toISOString(), ip || null);
      return expira;
    },
    usuarioDaSessao(token) {
      const u = q(`SELECT u.id, u.email, u.nome, u.perfil, s.expira_em FROM sessao s JOIN usuario u ON u.id = s.usuario_id
        WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1`).get(hashToken(token), agora());
      return u ? { ...u, unidades: unidadesDoUsuario.all(u.id).map((r) => r.sigla) } : null;
    },
    encerrarSessao: (token) => q('DELETE FROM sessao WHERE token_hash = ?').run(hashToken(token)),
    limparSessoesExpiradas: () => q('DELETE FROM sessao WHERE expira_em <= ?').run(agora()),

    // ------------------------------------------------------------------ auditoria
    auditar: (usuarioId, acao, detalhe = null, ip = null) =>
      q('INSERT INTO auditoria (usuario_id, acao, detalhe, ip) VALUES (?, ?, ?, ?)').run(usuarioId ?? null, acao, detalhe ? JSON.stringify(detalhe) : null, ip),
    ultimasAuditorias: (n = 50) => q('SELECT * FROM auditoria ORDER BY id DESC LIMIT ?').all(n).map((r) => ({ ...r })),

    // ------------------------------------------------------------------ processamentos
    /**
     * Grava o resumo de uma analise. O ultimo envio da mesma unidade/competencia/ferramenta
     * passa a ser o vigente. Reenvio do mesmo arquivo (mesmo SHA-256) nao duplica.
     */
    registrarProcessamento(r, usuarioId) {
      return transacao(db, () => {
        const atual = q(`SELECT id FROM processamento WHERE sigla = ? AND competencia = ? AND ferramenta = ? AND vigente = 1 AND arquivo_sha256 = ?`)
          .get(r.sigla, r.competencia, r.ferramenta, r.arquivo_sha256);
        if (atual) return { id: Number(atual.id), duplicado: true };
        q('UPDATE processamento SET vigente = 0 WHERE sigla = ? AND competencia = ? AND ferramenta = ? AND vigente = 1').run(r.sigla, r.competencia, r.ferramenta);
        const { lastInsertRowid } = q(`INSERT INTO processamento (ferramenta, sigla, competencia, usuario_id, arquivo_nome, arquivo_sha256, sigtap_competencia, versao_regras, criado_em)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.ferramenta, r.sigla, r.competencia, usuarioId ?? null, r.arquivo_nome || null, r.arquivo_sha256,
          r.sigtap_competencia || null, r.versao_regras || null, r.criado_em || agora());
        const id = Number(lastInsertRowid);
        const ind = q('INSERT INTO indicador (processamento_id, chave, valor) VALUES (?, ?, ?)');
        for (const [chave, valor] of Object.entries(r.indicadores || {})) ind.run(id, chave, valor);
        const al = q('INSERT INTO alerta_resumo (processamento_id, tipo, ocorrencias, contas) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET ocorrencias = ocorrencias + excluded.ocorrencias, contas = contas + excluded.contas');
        for (const a of r.alertas || []) al.run(id, a.tipo, a.ocorrencias, a.contas);
        const pr = q('INSERT INTO procedimento_resumo (processamento_id, codigo, descricao, quantidade) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET quantidade = quantidade + excluded.quantidade');
        for (const p of r.procedimentos || []) pr.run(id, p.codigo, p.descricao || null, p.quantidade);
        return { id, duplicado: false };
      });
    },

    competenciasDisponiveis(siglas) {
      if (!siglas.length) return [];
      const ph = siglas.map(() => '?').join(',');
      return q(`SELECT DISTINCT competencia FROM processamento WHERE vigente = 1 AND sigla IN (${ph}) ORDER BY competencia DESC`).all(...siglas).map((r) => r.competencia);
    },

    /**
     * Totais vigentes por unidade e competencia, no intervalo [de, ate] (AAAAMM).
     * Devolve linhas cruas; a montagem do painel fica em painel.mjs.
     */
    totaisPainel(siglas, de, ate) {
      if (!siglas.length) return { processamentos: [], indicadores: [], alertas: [], procedimentos: [] };
      const ph = siglas.map(() => '?').join(',');
      const filtro = `p.vigente = 1 AND p.sigla IN (${ph}) AND p.competencia BETWEEN ? AND ?`;
      const args = [...siglas, de, ate];
      return {
        processamentos: q(`SELECT p.id, p.ferramenta, p.sigla, p.competencia, p.criado_em, p.sigtap_competencia FROM processamento p WHERE ${filtro}`).all(...args).map((r) => ({ ...r })),
        indicadores: q(`SELECT i.processamento_id, i.chave, i.valor FROM indicador i JOIN processamento p ON p.id = i.processamento_id WHERE ${filtro}`).all(...args).map((r) => ({ ...r })),
        alertas: q(`SELECT a.processamento_id, a.tipo, a.ocorrencias, a.contas FROM alerta_resumo a JOIN processamento p ON p.id = a.processamento_id WHERE ${filtro}`).all(...args).map((r) => ({ ...r })),
        procedimentos: q(`SELECT r.processamento_id, r.codigo, r.descricao, r.quantidade FROM procedimento_resumo r JOIN processamento p ON p.id = r.processamento_id WHERE ${filtro}`).all(...args).map((r) => ({ ...r })),
      };
    },

    contarProcessamentos: () => Number(q('SELECT count(*) AS n FROM processamento').get().n),
  };
  return repo;
}
