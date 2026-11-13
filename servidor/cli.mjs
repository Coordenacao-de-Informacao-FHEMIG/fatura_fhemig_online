// Administracao da API pela linha de comando (na VM). Exemplos:
//   npm run api:cli -- usuario:criar --email maria@fhemig.mg.gov.br --nome "Maria" --perfil gestor_unidade --unidades HJXXIII,HIJPII
//   npm run api:cli -- usuario:senha --email maria@fhemig.mg.gov.br
//   npm run api:cli -- usuario:desativar --email maria@fhemig.mg.gov.br
//   npm run api:cli -- usuario:listar
//   npm run api:cli -- auditoria
//   npm run api:cli -- demo        (SÓ PARA TESTES: usuário teste@gmail.com / teste e dados fictícios)
// A senha é lida da variável FATURA_SENHA ou pedida no terminal (sem eco).
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { abrirBanco } from './banco.mjs';
import { lerConfig } from './config.mjs';
import { gerarHash, senhaFraca } from './senha.mjs';
import { gerarResumosFicticios } from '../src/gestao/ficticio.js';

const PERFIS = ['faturista', 'gestor_unidade', 'gestor_central', 'admin'];
const [comando, ...resto] = process.argv.slice(2);
const { values: op } = parseArgs({
  args: resto,
  options: { email: { type: 'string' }, nome: { type: 'string' }, perfil: { type: 'string' }, unidades: { type: 'string' }, n: { type: 'string' } },
});

function falhar(msg) {
  console.error(`Erro: ${msg}`);
  process.exit(1);
}

async function lerSenha(rotulo) {
  if (process.env.FATURA_SENHA) return process.env.FATURA_SENHA;
  if (!process.stdin.isTTY) falhar('defina FATURA_SENHA ou rode em um terminal interativo.');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => rl.output.write(s.includes(rotulo) ? s : '');
  const senha = await new Promise((ok) => rl.question(rotulo, ok));
  rl.close();
  process.stdout.write('\n');
  return senha;
}

async function novaSenha() {
  const s1 = await lerSenha('Senha: ');
  const fraca = senhaFraca(s1);
  if (fraca) falhar(fraca);
  if (!process.env.FATURA_SENHA && s1 !== (await lerSenha('Repita a senha: '))) falhar('as senhas não conferem.');
  return gerarHash(s1);
}

const cfg = lerConfig();
const banco = abrirBanco(cfg.banco);
const email = op.email?.trim().toLowerCase();

switch (comando) {
  case 'usuario:criar': {
    if (!email || !op.nome || !op.perfil) falhar('informe --email, --nome e --perfil.');
    if (!PERFIS.includes(op.perfil)) falhar(`perfil deve ser um de: ${PERFIS.join(', ')}.`);
    const unidades = (op.unidades || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    for (const s of unidades) if (!banco.unidadeExiste(s)) falhar(`unidade desconhecida: ${s}.`);
    if (['faturista', 'gestor_unidade'].includes(op.perfil) && !unidades.length) falhar('este perfil precisa de --unidades.');
    if (banco.usuarioPorEmail(email)) falhar('já existe usuário com este e-mail.');
    const id = banco.criarUsuario({ email, nome: op.nome, perfil: op.perfil, unidades, senhaHash: await novaSenha() });
    banco.auditar(null, 'cli_usuario_criado', { id, email, perfil: op.perfil, unidades });
    console.log(`Usuário ${email} criado (id ${id}, perfil ${op.perfil}).`);
    break;
  }
  case 'usuario:senha': {
    const u = email && banco.usuarioPorEmail(email);
    if (!u) falhar('usuário não encontrado.');
    banco.atualizarSenha(u.id, await novaSenha());
    banco.auditar(null, 'cli_senha_alterada', { email });
    console.log(`Senha de ${email} alterada.`);
    break;
  }
  case 'usuario:desativar':
  case 'usuario:ativar': {
    const u = email && banco.usuarioPorEmail(email);
    if (!u) falhar('usuário não encontrado.');
    banco.definirAtivo(u.id, comando === 'usuario:ativar');
    banco.auditar(null, `cli_${comando.replace(':', '_')}`, { email });
    console.log(`Usuário ${email} ${comando === 'usuario:ativar' ? 'ativado' : 'desativado'}.`);
    break;
  }
  case 'usuario:listar':
    console.table(banco.listarUsuarios());
    break;
  case 'auditoria':
    console.table(banco.ultimasAuditorias(Number(op.n || 30)));
    break;
  case 'demo': {
    if (process.env.NODE_ENV === 'production') falhar('o modo demonstração não pode rodar em produção.');
    const reais = banco.db.prepare("SELECT count(*) AS n FROM processamento WHERE versao_regras IS NOT 'demonstração'").get().n;
    if (reais) falhar('o banco já tem envios reais; a demonstração só roda em banco de testes.');
    if (!banco.usuarioPorEmail('teste@gmail.com')) {
      banco.criarUsuario({ email: 'teste@gmail.com', nome: 'Gestor de teste', perfil: 'gestor_central', senhaHash: await gerarHash('teste') });
    }
    let n = 0;
    for (const r of gerarResumosFicticios()) if (!banco.registrarProcessamento(r, null).duplicado) n += 1;
    console.log(`Demonstração pronta: usuário teste@gmail.com / teste (gestor_central) e ${n} resumos fictícios novos.`);
    console.log(`Banco: ${cfg.banco}`);
    break;
  }
  default:
    console.log('Comandos: usuario:criar, usuario:senha, usuario:ativar, usuario:desativar, usuario:listar, auditoria, demo');
    if (comando) process.exitCode = 1;
}
banco.fechar();
