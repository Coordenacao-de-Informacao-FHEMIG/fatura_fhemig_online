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
  banco.criarUsuario({ email: 'admin@teste.gov', nome: 'Admin', perfil: 'admin', senhaHash: hash });
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

const entrar = (email, senha) => app.inject({ method: 'POST', url: '/api/sessao', payload: { email, senha } });
const cookieDe = (r) => `fatura_sessao=${r.cookies.find((x) => x.name === 'fatura_sessao').value}`;
const pedir = (cookie, method, url, payload) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

describe('troca de senha', () => {
  it('confere a senha atual, exige senha forte e encerra as outras sessões', async () => {
    const outra = await login('hj@teste.gov');
    const { cookie } = await login('hj@teste.gov');
    expect((await pedir(cookie, 'POST', '/api/sessao/senha', { senha_atual: 'errada', senha_nova: 'novaSenha2026' })).statusCode).toBe(400);
    expect((await pedir(cookie, 'POST', '/api/sessao/senha', { senha_atual: SENHA, senha_nova: 'curta1' })).statusCode).toBe(400);
    expect((await pedir(cookie, 'POST', '/api/sessao/senha', { senha_atual: SENHA, senha_nova: SENHA })).statusCode).toBe(400);
    const ok = await pedir(cookie, 'POST', '/api/sessao/senha', { senha_atual: SENHA, senha_nova: 'novaSenha2026' });
    expect(ok.statusCode).toBe(200);
    expect((await pedir(cookie, 'GET', '/api/sessao')).statusCode).toBe(200);
    expect((await pedir(outra.cookie, 'GET', '/api/sessao')).statusCode).toBe(401);
    expect((await entrar('hj@teste.gov', SENHA)).statusCode).toBe(401);
    expect((await entrar('hj@teste.gov', 'novaSenha2026')).statusCode).toBe(200);
    expect(banco.ultimasAuditorias().some((a) => a.acao === 'senha_trocada')).toBe(true);
  });

  it('exige login', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sessao/senha', payload: { senha_atual: SENHA, senha_nova: 'novaSenha2026' } });
    expect(r.statusCode).toBe(401);
  });
});

describe('senha temporária', () => {
  async function criarComTemporaria(extra = {}) {
    const { cookie } = await login('admin@teste.gov');
    const r = await pedir(cookie, 'POST', '/api/usuarios', { email: 'Nova@Teste.gov', nome: 'Nova Gestora', perfil: 'gestor_unidade', unidades: ['HIJPII'], ...extra });
    expect(r.statusCode).toBe(201);
    return r.json();
  }

  it('bloqueia tudo até a troca e libera depois', async () => {
    const criado = await criarComTemporaria();
    expect(criado.senha_temporaria).toMatch(/^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/);
    expect(criado.usuario).toMatchObject({ email: 'nova@teste.gov', trocar_senha: true, unidades: ['HIJPII'] });
    const r = await entrar('nova@teste.gov', criado.senha_temporaria);
    expect(r.statusCode).toBe(200);
    expect(r.json().usuario.trocar_senha).toBe(true);
    const cookie = cookieDe(r);
    const bloqueado = await pedir(cookie, 'GET', '/api/painel');
    expect(bloqueado.statusCode).toBe(403);
    expect(bloqueado.json().codigo).toBe('trocar_senha');
    expect((await pedir(cookie, 'POST', '/api/processamentos', resumo({ sigla: 'HIJPII' }))).json().codigo).toBe('trocar_senha');
    expect((await pedir(cookie, 'GET', '/api/sessao')).json().usuario.trocar_senha).toBe(true);
    const troca = await pedir(cookie, 'POST', '/api/sessao/senha', { senha_atual: criado.senha_temporaria, senha_nova: 'minhaSenha2026' });
    expect(troca.statusCode).toBe(200);
    expect(troca.json().usuario.trocar_senha).toBe(false);
    expect((await pedir(cookie, 'GET', '/api/painel')).statusCode).toBe(200);
  });

  it('senha temporária vencida não entra', async () => {
    const criado = await criarComTemporaria();
    banco.db.prepare("UPDATE usuario SET senha_expira_em = '2000-01-01T00:00:00.000Z' WHERE email = 'nova@teste.gov'").run();
    const r = await entrar('nova@teste.gov', criado.senha_temporaria);
    expect(r.statusCode).toBe(401);
    expect(r.json().erro).toMatch(/venceu/);
  });

  it('redefinição pelo admin encerra as sessões e invalida a senha antiga', async () => {
    const hj = await login('hj@teste.gov');
    const { cookie } = await login('admin@teste.gov');
    const id = banco.usuarioPorEmail('hj@teste.gov').id;
    const r = await pedir(cookie, 'POST', `/api/usuarios/${id}/senha-temporaria`);
    expect(r.statusCode).toBe(200);
    expect((await pedir(hj.cookie, 'GET', '/api/sessao')).statusCode).toBe(401);
    expect((await entrar('hj@teste.gov', SENHA)).statusCode).toBe(401);
    expect((await entrar('hj@teste.gov', r.json().senha_temporaria)).json().usuario.trocar_senha).toBe(true);
  });
});

describe('administração de usuários', () => {
  it('só o admin acessa', async () => {
    for (const email of ['central@teste.gov', 'hj@teste.gov', 'fat@teste.gov']) {
      const { cookie } = await login(email);
      expect((await pedir(cookie, 'GET', '/api/usuarios')).statusCode, email).toBe(403);
      expect((await pedir(cookie, 'POST', '/api/usuarios', { email: 'x@y.gov', nome: 'X', perfil: 'admin' })).statusCode, email).toBe(403);
    }
    const { cookie } = await login('admin@teste.gov');
    const lista = (await pedir(cookie, 'GET', '/api/usuarios')).json();
    expect(lista.usuarios).toHaveLength(4);
    expect(JSON.stringify(lista)).not.toMatch(/scrypt|senha_hash/);
    expect(lista.unidades.length).toBeGreaterThan(10);
  });

  it('valida perfil, unidades e e-mail repetido', async () => {
    const { cookie } = await login('admin@teste.gov');
    const criar = (dados) => pedir(cookie, 'POST', '/api/usuarios', { email: 'a@b.gov', nome: 'A', perfil: 'gestor_unidade', unidades: ['HJXXIII'], ...dados });
    expect((await criar({ unidades: [] })).statusCode).toBe(400);
    expect((await criar({ unidades: ['XYZ'] })).statusCode).toBe(400);
    expect((await criar({ perfil: 'chefe' })).statusCode).toBe(400);
    expect((await criar({ email: 'sem-arroba' })).statusCode).toBe(400);
    expect((await criar({ email: 'HJ@teste.gov' })).statusCode).toBe(409);
    const central = await criar({ perfil: 'gestor_central' });
    expect(central.statusCode).toBe(201);
    expect(central.json().usuario.unidades).toEqual([]);
  });

  it('mudança de unidades vale na hora para quem já está logado', async () => {
    for (const r of gerarResumosFicticios()) banco.registrarProcessamento(r, null);
    const hj = await login('hj@teste.gov');
    const { cookie } = await login('admin@teste.gov');
    const id = banco.usuarioPorEmail('hj@teste.gov').id;
    const r = await pedir(cookie, 'PATCH', `/api/usuarios/${id}`, { unidades: ['HIJPII', 'HJXXIII'] });
    expect(r.statusCode).toBe(200);
    expect(r.json().usuario.unidades).toEqual(['HIJPII', 'HJXXIII']);
    const painel = (await pedir(hj.cookie, 'GET', '/api/painel')).json();
    expect(Object.keys(painel.dados).sort()).toEqual(['HIJPII', 'HJXXIII']);
    await pedir(cookie, 'PATCH', `/api/usuarios/${id}`, { ativo: false });
    expect((await pedir(hj.cookie, 'GET', '/api/painel')).statusCode).toBe(401);
    expect(banco.ultimasAuditorias().some((a) => a.acao === 'usuario_alterado')).toBe(true);
  });

  it('admin não se desativa nem se rebaixa; sempre sobra um admin', async () => {
    const { cookie } = await login('admin@teste.gov');
    const eu = banco.usuarioPorEmail('admin@teste.gov').id;
    expect((await pedir(cookie, 'PATCH', `/api/usuarios/${eu}`, { ativo: false })).statusCode).toBe(400);
    expect((await pedir(cookie, 'PATCH', `/api/usuarios/${eu}`, { perfil: 'gestor_central' })).statusCode).toBe(400);
    expect((await pedir(cookie, 'POST', `/api/usuarios/${eu}/senha-temporaria`)).statusCode).toBe(400);
    expect((await pedir(cookie, 'PATCH', `/api/usuarios/${eu}`, { nome: 'Admin Novo' })).statusCode).toBe(200);
    expect((await pedir(cookie, 'PATCH', '/api/usuarios/9999', { nome: 'X' })).statusCode).toBe(404);
    expect((await pedir(cookie, 'PATCH', `/api/usuarios/${eu}`, {})).statusCode).toBe(400);
  });
});

describe('histórico de envios', () => {
  beforeEach(() => {
    for (const r of gerarResumosFicticios()) banco.registrarProcessamento(r, banco.usuarioPorEmail('central@teste.gov').id);
  });

  it('gestor de unidade vê só a própria; central filtra por unidade e ferramenta', async () => {
    const hj = await login('hj@teste.gov');
    const r = (await pedir(hj.cookie, 'GET', '/api/historico')).json();
    expect(r.envios.length).toBeGreaterThan(0);
    expect(r.envios.every((e) => e.sigla === 'HJXXIII')).toBe(true);
    expect((await pedir(hj.cookie, 'GET', '/api/historico?sigla=HIJPII')).statusCode).toBe(403);
    const central = await login('central@teste.gov');
    const so = (await pedir(central.cookie, 'GET', '/api/historico?sigla=HIJPII&ferramenta=checa')).json().envios;
    expect(so.length).toBeGreaterThan(0);
    expect(so.every((e) => e.sigla === 'HIJPII' && e.ferramenta === 'checa')).toBe(true);
    expect(so[0]).toMatchObject({ enviado_por: 'Central', vigente: true, indicadores: expect.any(Object) });
  });

  it('mostra o envio substituído', async () => {
    const { cookie } = await login('central@teste.gov');
    await pedir(cookie, 'POST', '/api/processamentos', resumo({ competencia: '202611', arquivo_sha256: 'd'.repeat(64) }));
    await pedir(cookie, 'POST', '/api/processamentos', resumo({ competencia: '202611', arquivo_sha256: 'e'.repeat(64) }));
    const envios = (await pedir(cookie, 'GET', '/api/historico?sigla=HJXXIII&ferramenta=hospitalar')).json().envios.filter((e) => e.competencia === '202611');
    expect(envios.map((e) => e.vigente)).toEqual([true, false]);
  });

  it('faturista não vê o histórico', async () => {
    const { cookie } = await login('fat@teste.gov');
    expect((await pedir(cookie, 'GET', '/api/historico')).statusCode).toBe(403);
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
