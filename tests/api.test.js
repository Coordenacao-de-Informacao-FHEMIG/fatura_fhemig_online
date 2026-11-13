// Testes da API da Área do gestor: banco SQLite em memória, requisições via fastify.inject.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco } from '../servidor/banco.mjs';
import { construirApp } from '../servidor/app.mjs';
import { gerarHash } from '../servidor/senha.mjs';
import { gerarResumosFicticios } from '../src/gestao/ficticio.js';
import { chaveIndicador, montarResumoGestao } from '../src/gestao/resumo.js';

const SENHA = 'senhaForte123';
let banco;
let app;

const resumo = (extra = {}) => ({
  ferramenta: 'hospitalar', sigla: 'HJXXIII', competencia: '202610', arquivo_nome: 'SISAIH01.txt',
  arquivo_sha256: 'a'.repeat(64), sigtap_competencia: '202610', versao_regras: '14.3',
  indicadores: { aihs_distintas: 100, aihs_com_alerta: 12, diarias_de_perm_a_maior: 3 },
  alertas: [{ tipo: 'CBO incompatível', ocorrencias: 9, contas: 7 }],
  procedimentos: [{ codigo: '0303140151', descricao: 'Tratamento de pneumonias', quantidade: 40 }],
  ...extra,
});

async function login(email) {
  const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email, senha: SENHA } });
  expect(r.statusCode).toBe(200);
  const c = r.cookies.find((x) => x.name === 'fatura_sessao');
  return { cookie: `fatura_sessao=${c.value}`, bruto: c };
}

beforeEach(async () => {
  banco = abrirBanco(':memory:');
  const hash = await gerarHash(SENHA);
  banco.criarUsuario({ email: 'central@teste.gov', nome: 'Central', perfil: 'gestor_central', senhaHash: hash });
  banco.criarUsuario({ email: 'hj@teste.gov', nome: 'Gestor HJ', perfil: 'gestor_unidade', unidades: ['HJXXIII'], senhaHash: hash });
  banco.criarUsuario({ email: 'fat@teste.gov', nome: 'Faturista', perfil: 'faturista', unidades: ['HIJPII'], senhaHash: hash });
  app = construirApp({ banco, config: { cookieSeguro: true } });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  banco.fechar();
});

describe('sessão', () => {
  it('login cria cookie HttpOnly, SameSite=Strict e Secure; logout encerra', async () => {
    const { cookie, bruto } = await login('Central@Teste.gov');
    expect(bruto.httpOnly).toBe(true);
    expect(bruto.sameSite).toBe('Strict');
    expect(bruto.secure).toBe(true);
    expect(bruto.path).toBe('/api');
    const eu = await app.inject({ url: '/api/sessao', headers: { cookie } });
    expect(eu.json().usuario).toMatchObject({ email: 'central@teste.gov', perfil: 'gestor_central', unidades: 'todas' });
    await app.inject({ method: 'DELETE', url: '/api/sessao', headers: { cookie } });
    expect((await app.inject({ url: '/api/sessao', headers: { cookie } })).statusCode).toBe(401);
  });

  it('o token não é gravado no banco, só o hash', async () => {
    const { bruto } = await login('central@teste.gov');
    const linhas = banco.db.prepare('SELECT token_hash FROM sessao').all();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].token_hash).not.toBe(bruto.value);
  });

  it('senha errada dá 401 e bloqueia após 5 tentativas', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: 'hj@teste.gov', senha: 'errada' } });
      expect(r.statusCode).toBe(401);
    }
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: 'hj@teste.gov', senha: SENHA } });
    expect(r.statusCode).toBe(429);
    expect(banco.ultimasAuditorias().some((a) => a.acao === 'login_bloqueado')).toBe(true);
  });

  it('usuário desativado não entra', async () => {
    banco.definirAtivo(banco.usuarioPorEmail('hj@teste.gov').id, false);
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: 'hj@teste.gov', senha: SENHA } });
    expect(r.statusCode).toBe(401);
  });

  it('recusa escrita vinda de outra origem', async () => {
    const { cookie } = await login('central@teste.gov');
    const r = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie, origin: 'https://site-malicioso.example', host: 'localhost:5173' }, payload: resumo() });
    expect(r.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie, origin: 'http://localhost:5173', host: 'localhost:5173' }, payload: resumo() });
    expect(ok.statusCode).toBe(201);
  });
});

describe('envio de resumos', () => {
  it('exige login', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/processamentos', payload: resumo() });
    expect(r.statusCode).toBe(401);
  });

  it('aceita só totais: campo extra (ex.: nome de paciente) é recusado', async () => {
    const { cookie } = await login('central@teste.gov');
    const extra = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo({ pacientes: ['FULANO'] }) });
    expect(extra.statusCode).toBe(400);
    const alertaExtra = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo({ alertas: [{ tipo: 'X', ocorrencias: 1, contas: 1, aih: '123' }] }) });
    expect(alertaExtra.statusCode).toBe(400);
    const textoNoIndicador = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo({ indicadores: { aihs_distintas: 'JOSE' } }) });
    expect(textoNoIndicador.statusCode).toBe(400);
  });

  it('valida competência, hash e código de procedimento', async () => {
    const { cookie } = await login('central@teste.gov');
    for (const ruim of [{ competencia: '202613' }, { competencia: '209912' }, { arquivo_sha256: 'xyz' }, { procedimentos: [{ codigo: '123', quantidade: 1 }] }]) {
      const r = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo(ruim) });
      expect(r.statusCode, JSON.stringify(ruim)).toBe(400);
    }
  });

  it('faturista só envia da própria unidade', async () => {
    const { cookie } = await login('fat@teste.gov');
    const outra = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo() });
    expect(outra.statusCode).toBe(403);
    const propria = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo({ sigla: 'HIJPII' }) });
    expect(propria.statusCode).toBe(201);
  });

  it('reenvio do mesmo arquivo não duplica; novo arquivo substitui o vigente', async () => {
    const { cookie } = await login('central@teste.gov');
    const a = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo() });
    const b = await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo() });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().duplicado).toBe(true);
    await app.inject({ method: 'POST', url: '/api/processamentos', headers: { cookie }, payload: resumo({ arquivo_sha256: 'b'.repeat(64), indicadores: { aihs_distintas: 150, aihs_com_alerta: 5 } }) });
    expect(banco.db.prepare('SELECT count(*) n FROM processamento WHERE vigente = 1').get().n).toBe(1);
    const painel = (await app.inject({ url: '/api/painel', headers: { cookie } })).json();
    expect(painel.dados.HJXXIII.at(-1)).toMatchObject({ aihs: 150, comAlerta: 5 });
  });
});

describe('painel', () => {
  beforeEach(() => {
    for (const r of gerarResumosFicticios()) banco.registrarProcessamento(r, null);
  });

  it('faturista não vê o painel', async () => {
    const { cookie } = await login('fat@teste.gov');
    expect((await app.inject({ url: '/api/painel', headers: { cookie } })).statusCode).toBe(403);
  });

  it('gestor central vê todas as unidades com dados', async () => {
    const { cookie } = await login('central@teste.gov');
    const p = (await app.inject({ url: '/api/painel', headers: { cookie } })).json();
    expect(p.competencias).toEqual(['202605', '202606', '202607', '202608', '202609', '202610']);
    expect(Object.keys(p.dados)).toHaveLength(10);
    const hj = p.dados.HJXXIII.at(-1);
    expect(hj.aihs).toBeGreaterThan(1000);
    expect(hj.checa).toMatchObject({ naoCnes: expect.any(Number) });
    expect(hj.procs[0]).toHaveLength(3);
    expect(Object.keys(hj.alertas).some((t) => t.endsWith('(BPA)'))).toBe(true);
  });

  it('gestor de unidade vê só a própria', async () => {
    const { cookie } = await login('hj@teste.gov');
    const p = (await app.inject({ url: '/api/painel?ate=202608&meses=3', headers: { cookie } })).json();
    expect(Object.keys(p.dados)).toEqual(['HJXXIII']);
    expect(p.unidades.map((u) => u.sigla)).toEqual(['HJXXIII']);
    expect(p.competencias).toEqual(['202606', '202607', '202608']);
  });

  it('recusa parâmetros fora do formato', async () => {
    const { cookie } = await login('central@teste.gov');
    expect((await app.inject({ url: '/api/painel?ate=2026-10', headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/painel?x=1', headers: { cookie } })).statusCode).toBe(400);
  });
});

describe('resumo montado no navegador', () => {
  it('converte rótulos em chaves estáveis', () => {
    expect(chaveIndicador('AIHs distintas')).toBe('aihs_distintas');
    expect(chaveIndicador('Diárias de perm. a maior')).toBe('diarias_de_perm_a_maior');
    expect(chaveIndicador('% de linhas com alerta')).toBe('pct_de_linhas_com_alerta');
    expect(chaveIndicador('Não encontrados no CNES')).toBe('nao_encontrados_no_cnes');
  });

  it('não leva ocorrências, nomes nem linhas de paciente', () => {
    const r = montarResumoGestao({
      ferramenta: 'hospitalar', unidade: 'HJXXIII', competencia: '202609', sigtap: { competencia: '202609' },
      resumo: {
        kpis: [{ rotulo: 'AIHs distintas', valor: 14 }, { rotulo: 'AIHs com alerta', valor: 9 }],
        alertas: [{ rotulo: 'CBO incompatível', aihs: 2, procedimentos: 3 }, { rotulo: 'Sem alerta', aihs: 0, procedimentos: 0 }],
        top: [['0303140151 - TRATAMENTO DE PNEUMONIAS', 5], ['sem código', 2]],
        ocorrencias: [{ paciente: 'MARIA DA SILVA', aih: '3126100000001' }],
      },
    }, { arquivoNome: 'SISAIH01.txt', arquivoSha256: 'c'.repeat(64), versaoRegras: '14.3' });
    expect(JSON.stringify(r)).not.toMatch(/MARIA|3126100000001|ocorrencias"?:\s*\[\{"pac/);
    expect(r.alertas).toEqual([{ tipo: 'CBO incompatível', ocorrencias: 3, contas: 2 }]);
    expect(r.procedimentos).toEqual([{ codigo: '0303140151', descricao: 'TRATAMENTO DE PNEUMONIAS', quantidade: 5 }]);
  });
});
