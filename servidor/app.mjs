// API da Área do gestor (Fastify). Recebe SOMENTE totais das análises e serve o painel gerencial.
// Nada de arquivo de produção, nome, CPF, CNS ou prontuário passa por aqui.
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { randomBytes } from 'node:crypto';
import { conferirSenha, gerarHash, gerarSenhaTemporaria, senhaFraca } from './senha.mjs';
import { janelaCompetencias, montarPainel } from '../src/gestao/painel.js';
import { competenciaAtual, LIMITES } from '../src/gestao/resumo.js';

export const VERSAO_API = '1.1.0';
const COOKIE = 'fatura_sessao';
const PERFIS = ['faturista', 'gestor_unidade', 'gestor_central', 'admin'];
const PERFIS_PAINEL = ['gestor_unidade', 'gestor_central', 'admin'];
const VE_TODAS = ['gestor_central', 'admin'];
const FERRAMENTAS = ['hospitalar', 'ambulatorial', 'checa'];

const RE_COMPETENCIA = '^20\\d{2}(0[1-9]|1[0-2])$';
const RE_SIGLA = '^[A-Z0-9]{2,12}$';
const esquemaSenha = { type: 'string', minLength: 1, maxLength: 200 };
const esquemaUnidades = { type: 'array', maxItems: 60, uniqueItems: true, items: { type: 'string', pattern: RE_SIGLA } };
const esquemaNome = { type: 'string', minLength: 1, maxLength: 120 };
const parametroId = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[1-9]\\d{0,9}$' } } };
const inteiro = { type: 'integer', minimum: 0, maximum: 1e9 };
const texto = { type: 'string', maxLength: LIMITES.texto };

const ESQUEMA_PROCESSAMENTO = {
  type: 'object',
  additionalProperties: false,
  required: ['ferramenta', 'sigla', 'competencia', 'arquivo_sha256', 'indicadores', 'alertas', 'procedimentos'],
  properties: {
    ferramenta: { type: 'string', enum: ['hospitalar', 'ambulatorial', 'checa'] },
    sigla: { type: 'string', pattern: '^[A-Z0-9]{2,12}$' },
    competencia: { type: 'string', pattern: RE_COMPETENCIA },
    arquivo_nome: texto,
    arquivo_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    sigtap_competencia: { type: 'string', pattern: `(${RE_COMPETENCIA})|^$` },
    versao_regras: texto,
    indicadores: {
      type: 'object', maxProperties: LIMITES.indicadores,
      propertyNames: { pattern: '^[a-z0-9_]{1,40}$' },
      additionalProperties: { type: 'number', minimum: -1e12, maximum: 1e12 },
    },
    alertas: {
      type: 'array', maxItems: LIMITES.alertas,
      items: {
        type: 'object', additionalProperties: false, required: ['tipo', 'ocorrencias', 'contas'],
        properties: { tipo: { ...texto, minLength: 1 }, ocorrencias: inteiro, contas: inteiro },
      },
    },
    procedimentos: {
      type: 'array', maxItems: LIMITES.procedimentos,
      items: {
        type: 'object', additionalProperties: false, required: ['codigo', 'quantidade'],
        properties: { codigo: { type: 'string', pattern: '^\\d{10}$' }, descricao: texto, quantidade: inteiro },
      },
    },
  },
};

class ErroApi extends Error {
  /** codigo: identificador estavel para a tela reagir (ex.: 'trocar_senha'). */
  constructor(status, mensagem, codigo = null) {
    super(mensagem);
    this.statusCode = status;
    this.codigo = codigo;
  }
}

/** Limite de tentativas de login (memória do processo): por e-mail+IP e por IP. */
function criarLimitador({ maxPorConta = 5, maxPorIp = 30, janelaMs = 15 * 60e3 } = {}) {
  const falhas = new Map();
  const ativas = (chave) => {
    const agora = Date.now();
    const lista = (falhas.get(chave) || []).filter((t) => agora - t < janelaMs);
    if (lista.length) falhas.set(chave, lista);
    else falhas.delete(chave);
    return lista;
  };
  return {
    bloqueado: (ip, email) => ativas(`c:${ip}:${email}`).length >= maxPorConta || ativas(`i:${ip}`).length >= maxPorIp,
    falhou(ip, email) {
      for (const chave of [`c:${ip}:${email}`, `i:${ip}`]) falhas.set(chave, [...ativas(chave), Date.now()]);
    },
    limpar: (ip, email) => falhas.delete(`c:${ip}:${email}`),
  };
}

const publico = (u) => ({
  nome: u.nome, email: u.email, perfil: u.perfil, unidades: VE_TODAS.includes(u.perfil) ? 'todas' : u.unidades, trocar_senha: Boolean(u.trocar_senha),
});

/** Linha de usuario para a tela de administracao (sem hash de senha). */
const paraAdmin = (r) => ({
  id: Number(r.id), email: r.email, nome: r.nome, perfil: r.perfil, ativo: Boolean(r.ativo),
  unidades: r.unidades ? r.unidades.split(',').sort() : [], trocar_senha: Boolean(r.trocar_senha),
  senha_expira_em: r.senha_expira_em, ultimo_login_em: r.ultimo_login_em, criado_em: r.criado_em,
});

/**
 * banco: repositorio de banco.mjs
 * config: { cookieSeguro (padrao true), horasSessao (8), horasSenhaTemporaria (72), origens: [] (vazio = mesmo host),
 *           log (false), confiarProxy (false) }
 */
export function construirApp({ banco, config = {} }) {
  const cfg = { cookieSeguro: true, horasSessao: 8, horasSenhaTemporaria: 72, origens: [], log: false, confiarProxy: false, ...config };
  const app = Fastify({
    logger: cfg.log ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] } : false,
    bodyLimit: 256 * 1024,
    trustProxy: cfg.confiarProxy,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  const limitador = criarLimitador(cfg.limites);
  app.register(cookie);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    // Proteção contra CSRF além do SameSite=Strict: escrita só vinda do próprio site.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let host = '';
      try {
        host = new URL(req.headers.origin).host;
      } catch {
        /* origem inválida */
      }
      const permitido = cfg.origens.length ? cfg.origens.includes(req.headers.origin) : host && host === (req.headers['x-forwarded-host'] || req.headers.host);
      if (!permitido) throw new ErroApi(403, 'Origem não permitida.');
    }
  });

  app.setErrorHandler((erro, req, reply) => {
    if (erro.validation) return reply.code(400).send({ erro: 'Dados inválidos.', detalhe: erro.message });
    const status = erro.statusCode && erro.statusCode < 500 ? erro.statusCode : 500;
    if (status === 500) req.log.error(erro);
    return reply.code(status).send({ erro: status === 500 ? 'Erro interno.' : erro.message, ...(erro.codigo ? { codigo: erro.codigo } : {}) });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ erro: 'Rota não encontrada.' }));

  const usuarioAtual = (req) => {
    const token = req.cookies[COOKIE];
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? banco.usuarioDaSessao(token) : null;
  };
  /**
   * Usuario logado ou 401. Enquanto a senha temporaria nao for trocada, so as rotas com
   * permitirTroca (sessao e troca de senha) respondem; o resto da 403 com codigo 'trocar_senha'.
   */
  const exigirLogin = (req, { permitirTroca = false } = {}) => {
    const u = usuarioAtual(req);
    if (!u) throw new ErroApi(401, 'Faça login para continuar.');
    if (u.trocar_senha && !permitirTroca) throw new ErroApi(403, 'Defina uma nova senha para continuar.', 'trocar_senha');
    return u;
  };
  const exigirAdmin = (req) => {
    const u = exigirLogin(req);
    if (u.perfil !== 'admin') throw new ErroApi(403, 'Só o administrador pode gerenciar usuários.');
    return u;
  };
  const siglasPermitidas = (u) => (VE_TODAS.includes(u.perfil) ? banco.listarUnidades().map((x) => x.sigla) : u.unidades);
  const opcoesCookie = (expira) => ({ path: '/api', httpOnly: true, sameSite: 'strict', secure: cfg.cookieSeguro, expires: expira });
  const novaSenhaTemporaria = async (id) => {
    const senha = gerarSenhaTemporaria();
    const expira = new Date(Date.now() + cfg.horasSenhaTemporaria * 3600e3);
    banco.definirSenha(id, await gerarHash(senha), { temporaria: true, expiraEm: expira });
    return { senha_temporaria: senha, expira_em: expira.toISOString() };
  };
  /** Unidades validas para o perfil: quem ve todas fica sem lista; faturista e gestor de unidade precisam de ao menos uma. */
  const unidadesDoPerfil = (perfil, unidades) => {
    if (VE_TODAS.includes(perfil)) return [];
    for (const s of unidades) if (!banco.unidadeExiste(s)) throw new ErroApi(400, `Unidade desconhecida: ${s}.`);
    if (!unidades.length) throw new ErroApi(400, 'Este perfil precisa de pelo menos uma unidade.');
    return [...unidades].sort();
  };

  // ------------------------------------------------------------------ rotas
  app.get('/api/saude', async () => ({ ok: true, servico: 'fatura-fhemig-api', versao: VERSAO_API }));

  app.post('/api/sessao', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['email', 'senha'],
        properties: { email: { type: 'string', minLength: 3, maxLength: 200 }, senha: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    if (limitador.bloqueado(req.ip, email)) {
      banco.auditar(null, 'login_bloqueado', { email }, req.ip);
      throw new ErroApi(429, 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
    }
    const u = banco.usuarioPorEmail(email);
    const ok = await conferirSenha(req.body.senha, u?.senha_hash);
    if (!u || !ok || !u.ativo) {
      limitador.falhou(req.ip, email);
      banco.auditar(u?.id ?? null, 'login_falhou', { email }, req.ip);
      throw new ErroApi(401, 'E-mail ou senha incorretos.');
    }
    limitador.limpar(req.ip, email);
    if (u.trocar_senha && u.senha_expira_em && u.senha_expira_em <= new Date().toISOString()) {
      banco.auditar(u.id, 'login_senha_temporaria_vencida', null, req.ip);
      throw new ErroApi(401, 'Sua senha temporária venceu. Peça uma nova ao administrador do sistema.');
    }
    banco.limparSessoesExpiradas();
    const token = randomBytes(32).toString('base64url');
    const expira = banco.criarSessao({ token, usuarioId: u.id, horas: cfg.horasSessao, ip: req.ip });
    banco.registrarLogin(u.id);
    banco.auditar(u.id, 'login', null, req.ip);
    reply.setCookie(COOKIE, token, opcoesCookie(expira));
    return { usuario: publico(u), expira_em: expira.toISOString() };
  });

  app.get('/api/sessao', async (req) => ({ usuario: publico(exigirLogin(req, { permitirTroca: true })) }));

  // Troca da propria senha (inclusive a troca obrigatoria depois de uma senha temporaria).
  app.post('/api/sessao/senha', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['senha_atual', 'senha_nova'],
        properties: { senha_atual: esquemaSenha, senha_nova: esquemaSenha },
      },
    },
  }, async (req) => {
    const u = exigirLogin(req, { permitirTroca: true });
    if (limitador.bloqueado(req.ip, u.email)) throw new ErroApi(429, 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
    const completo = banco.usuarioPorId(u.id);
    if (!(await conferirSenha(req.body.senha_atual, completo.senha_hash))) {
      limitador.falhou(req.ip, u.email);
      banco.auditar(u.id, 'troca_senha_falhou', null, req.ip);
      throw new ErroApi(400, 'A senha atual está incorreta.');
    }
    const fraca = senhaFraca(req.body.senha_nova);
    if (fraca) throw new ErroApi(400, fraca);
    if (req.body.senha_nova === req.body.senha_atual) throw new ErroApi(400, 'A nova senha precisa ser diferente da atual.');
    limitador.limpar(req.ip, u.email);
    banco.definirSenha(u.id, await gerarHash(req.body.senha_nova));
    banco.encerrarSessoesDoUsuario(u.id, req.cookies[COOKIE]);
    banco.auditar(u.id, 'senha_trocada', null, req.ip);
    return { usuario: publico({ ...u, trocar_senha: 0 }) };
  });

  app.delete('/api/sessao', async (req, reply) => {
    const token = req.cookies[COOKIE];
    const u = usuarioAtual(req);
    if (token) banco.encerrarSessao(token);
    if (u) banco.auditar(u.id, 'logout', null, req.ip);
    reply.clearCookie(COOKIE, { path: '/api' });
    return { ok: true };
  });

  app.get('/api/unidades', async (req) => {
    const u = exigirLogin(req);
    const permitidas = new Set(siglasPermitidas(u));
    return { unidades: banco.listarUnidades().filter((x) => permitidas.has(x.sigla)) };
  });

  app.post('/api/processamentos', { schema: { body: ESQUEMA_PROCESSAMENTO } }, async (req, reply) => {
    const u = exigirLogin(req);
    const r = req.body;
    if (!banco.unidadeExiste(r.sigla)) throw new ErroApi(400, `Unidade desconhecida: ${r.sigla}.`);
    if (!siglasPermitidas(u).includes(r.sigla)) throw new ErroApi(403, `Seu usuário não pode enviar resultados de ${r.sigla}.`);
    if (r.competencia > competenciaAtual()) throw new ErroApi(400, 'Competência no futuro.');
    const res = banco.registrarProcessamento(r, u.id);
    banco.auditar(u.id, res.duplicado ? 'envio_repetido' : 'envio', { id: res.id, ferramenta: r.ferramenta, sigla: r.sigla, competencia: r.competencia }, req.ip);
    reply.code(res.duplicado ? 200 : 201);
    return res;
  });

  app.get('/api/painel', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { ate: { type: 'string', pattern: RE_COMPETENCIA }, meses: { type: 'string', pattern: '^([1-9]|1[0-9]|2[0-4])$' } },
      },
    },
  }, async (req) => {
    const u = exigirLogin(req);
    if (!PERFIS_PAINEL.includes(u.perfil)) throw new ErroApi(403, 'Seu perfil não tem acesso ao painel gerencial.');
    const siglas = siglasPermitidas(u);
    const disponiveis = banco.competenciasDisponiveis(siglas);
    const ate = req.query.ate || disponiveis[0] || competenciaAtual();
    const competencias = janelaCompetencias(ate, Number(req.query.meses || 6));
    const t = banco.totaisPainel(siglas, competencias[0], competencias.at(-1));
    const porId = new Map(t.processamentos.map((p) => [p.id, { ...p, indicadores: {}, alertas: [], procedimentos: [] }]));
    for (const i of t.indicadores) porId.get(i.processamento_id).indicadores[i.chave] = i.valor;
    for (const a of t.alertas) porId.get(a.processamento_id).alertas.push(a);
    for (const p of t.procedimentos) porId.get(p.processamento_id).procedimentos.push(p);
    const permitidas = new Set(siglas);
    const painel = montarPainel({ competencias, unidades: banco.listarUnidades().filter((x) => permitidas.has(x.sigla)), processamentos: [...porId.values()] });
    banco.auditar(u.id, 'painel', { ate }, req.ip);
    return { ...painel, disponiveis, usuario: publico(u) };
  });

  // Historico de envios (vigentes e substituidos), filtrado pelas unidades do perfil.
  app.get('/api/historico', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { sigla: { type: 'string', pattern: RE_SIGLA }, ferramenta: { type: 'string', enum: FERRAMENTAS } },
      },
    },
  }, async (req) => {
    const u = exigirLogin(req);
    if (!PERFIS_PAINEL.includes(u.perfil)) throw new ErroApi(403, 'Seu perfil não tem acesso ao painel gerencial.');
    const siglas = siglasPermitidas(u);
    const { sigla, ferramenta } = req.query;
    if (sigla && !siglas.includes(sigla)) throw new ErroApi(403, `Seu usuário não tem acesso a ${sigla}.`);
    const envios = banco.historico(siglas, { sigla, ferramenta });
    banco.auditar(u.id, 'historico', { sigla: sigla || null, ferramenta: ferramenta || null }, req.ip);
    return { envios };
  });

  // ------------------------------------------------------------ administracao de usuarios (so admin)
  app.get('/api/usuarios', async (req) => {
    exigirAdmin(req);
    return { usuarios: banco.listarUsuarios().map(paraAdmin), unidades: banco.listarUnidades() };
  });

  app.post('/api/usuarios', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['email', 'nome', 'perfil'],
        properties: {
          email: { type: 'string', minLength: 3, maxLength: 200, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
          nome: esquemaNome, perfil: { type: 'string', enum: PERFIS }, unidades: esquemaUnidades,
        },
      },
    },
  }, async (req, reply) => {
    const admin = exigirAdmin(req);
    const email = req.body.email.trim().toLowerCase();
    const nome = req.body.nome.trim();
    if (!nome) throw new ErroApi(400, 'Informe o nome.');
    const unidades = unidadesDoPerfil(req.body.perfil, req.body.unidades || []);
    if (banco.usuarioPorEmail(email)) throw new ErroApi(409, 'Já existe usuário com este e-mail.');
    const id = banco.criarUsuario({ email, nome, perfil: req.body.perfil, unidades, senhaHash: null });
    const senha = await novaSenhaTemporaria(id);
    banco.auditar(admin.id, 'usuario_criado', { id, email, perfil: req.body.perfil, unidades }, req.ip);
    reply.code(201);
    return { usuario: paraAdmin(banco.listarUsuarios(id)[0]), ...senha };
  });

  app.patch('/api/usuarios/:id', {
    schema: {
      params: parametroId,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { nome: esquemaNome, perfil: { type: 'string', enum: PERFIS }, unidades: esquemaUnidades, ativo: { type: 'boolean' } },
      },
    },
  }, async (req) => {
    const admin = exigirAdmin(req);
    const alvo = banco.usuarioPorId(Number(req.params.id));
    if (!alvo) throw new ErroApi(404, 'Usuário não encontrado.');
    const b = req.body;
    const perfil = b.perfil ?? alvo.perfil;
    const ativo = b.ativo ?? Boolean(alvo.ativo);
    const deixaDeSerAdmin = alvo.perfil === 'admin' && alvo.ativo && (perfil !== 'admin' || !ativo);
    if (alvo.id === admin.id && deixaDeSerAdmin) {
      throw new ErroApi(400, 'Você não pode desativar a própria conta nem tirar dela o perfil de administrador.');
    }
    if (deixaDeSerAdmin && banco.contarAdminsAtivos() <= 1) throw new ErroApi(400, 'O sistema precisa de pelo menos um administrador ativo.');
    const nome = b.nome === undefined ? undefined : b.nome.trim();
    if (nome === '') throw new ErroApi(400, 'Informe o nome.');
    const mudaAcesso = b.perfil !== undefined || b.unidades !== undefined;
    const unidades = mudaAcesso ? unidadesDoPerfil(perfil, b.unidades ?? alvo.unidades) : undefined;
    banco.atualizarUsuario(alvo.id, { nome, perfil: b.perfil, unidades, ativo: b.ativo });
    if (b.ativo === false) banco.encerrarSessoesDoUsuario(alvo.id);
    banco.auditar(admin.id, 'usuario_alterado', { id: alvo.id, email: alvo.email, ...b, ...(unidades ? { unidades } : {}) }, req.ip);
    return { usuario: paraAdmin(banco.listarUsuarios(alvo.id)[0]) };
  });

  app.post('/api/usuarios/:id/senha-temporaria', { schema: { params: parametroId } }, async (req) => {
    const admin = exigirAdmin(req);
    const alvo = banco.usuarioPorId(Number(req.params.id));
    if (!alvo) throw new ErroApi(404, 'Usuário não encontrado.');
    if (alvo.id === admin.id) throw new ErroApi(400, 'Para a sua própria conta, use "Trocar senha".');
    const senha = await novaSenhaTemporaria(alvo.id);
    banco.encerrarSessoesDoUsuario(alvo.id);
    banco.auditar(admin.id, 'senha_redefinida', { id: alvo.id, email: alvo.email }, req.ip);
    return { usuario: paraAdmin(banco.listarUsuarios(alvo.id)[0]), ...senha };
  });

  return app;
}
