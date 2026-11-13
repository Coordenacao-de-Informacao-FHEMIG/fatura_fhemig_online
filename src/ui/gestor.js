// Área do gestor.
//
// Dois modos, com a mesma tela:
//  - API (VM do Estado): login real (sessão em cookie HttpOnly) e totais enviados pelas unidades,
//    guardados no SQLite da VM (servidor/). Ver docs/ARQUITETURA_GESTAO.md.
//  - Protótipo (Netlify, ou sem API): login de teste e dados FICTÍCIOS gerados no navegador.
import { desenharGrafico } from './resultados.js';
import { $, esc, numero, armazenamento, toast } from './util.js';
import { api, apiDisponivel } from '../gestao/api.js';
import { gerarResumosFicticios, MESES_FICTICIOS } from '../gestao/ficticio.js';
import { janelaCompetencias, montarPainel } from '../gestao/painel.js';
import { UNIDADES } from '../engine/unidades.js';
import { calcularAlarmes } from '../gestao/alarmes.js';

// Credenciais apenas para o protótipo (dados fictícios; nada a proteger).
const USUARIO_TESTE = { email: 'teste@gmail.com', senha: 'teste', nome: 'Gestor FHEMIG' };
const CHAVE_SESSAO = 'fatura.gestor.sessao';
const PERFIS = { faturista: 'Faturista', gestor_unidade: 'Gestor de unidade', gestor_central: 'Gestão central', admin: 'Administrador' };

const nomeMes = (c) => `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+c.slice(4) - 1]}/${c.slice(2, 4)}`;

// ---------------------------------------------------------------------------
// Fonte de dados: API real ou protótipo
// ---------------------------------------------------------------------------
let resumosFicticios = null;
const prototipo = {
  async sessao() {
    const s = armazenamento.ler(CHAVE_SESSAO, null);
    return s ? { ...s, perfil: 'gestor_central', unidades: 'todas' } : null;
  },
  async entrar(email, senha) {
    if (email !== USUARIO_TESTE.email || senha !== USUARIO_TESTE.senha) throw new Error('E-mail ou senha incorretos.');
    armazenamento.gravar(CHAVE_SESSAO, { nome: USUARIO_TESTE.nome, email, desde: new Date().toISOString() });
  },
  async sair() {
    armazenamento.gravar(CHAVE_SESSAO, null);
  },
  async painel(ate) {
    resumosFicticios ??= gerarResumosFicticios();
    const disponiveis = [...MESES_FICTICIOS].reverse();
    const competencias = janelaCompetencias(ate || disponiveis[0], 6);
    const siglas = new Set(resumosFicticios.map((r) => r.sigla));
    const p = montarPainel({ competencias, unidades: UNIDADES.filter((u) => siglas.has(u.sigla)), processamentos: resumosFicticios });
    return { ...p, disponiveis };
  },
};

const real = {
  sessao: () => api.sessao(),
  entrar: (email, senha) => api.entrar(email, senha),
  sair: () => api.sair(),
  painel: (ate) => api.painel(ate),
};

// No build da VM o protótipo nunca aparece: sem API, o painel avisa que o servidor está fora do ar.
const PROTOTIPO_PERMITIDO = (typeof __MODO__ !== 'undefined' ? __MODO__ : 'netlify') !== 'vm';
const indisponivel = {
  sessao: async () => null,
  entrar: async () => {
    throw new Error('O servidor da Área do gestor está fora do ar. Tente mais tarde ou fale com o administrador.');
  },
  sair: async () => {},
  painel: async () => {
    throw new Error('O servidor da Área do gestor está fora do ar.');
  },
};
const fonte = async () => ((await apiDisponivel()) ? real : PROTOTIPO_PERMITIDO ? prototipo : indisponivel);
export const modoReal = () => apiDisponivel();

/** Usuário logado (ou null). */
export async function logado() {
  try {
    return await (await fonte()).sessao();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export async function abrirLogin(aoEntrar, motivo = '') {
  const d = $('#dialogo-gestor');
  d.innerHTML = `<form method="dialog" class="bg-white p-6 sm:p-8" novalidate>
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[22px]">Área do gestor</h2>
        <p class="mt-1 text-sm text-suave">${esc(motivo || 'Acompanhamento da produção e da qualidade do faturamento das unidades.')}</p>
      </div>
      <button type="button" class="btn-sutil text-suave" data-fechar aria-label="Fechar">✕</button>
    </div>
    <p class="mt-5 rounded-lg border border-linha bg-fundo px-4 py-3 text-[13px] text-suave">Entre com o e-mail e a senha cadastrados pela administração do sistema. <span class="font-semibold text-turquesa-700">Versão beta.</span></p>
    <div class="mt-6 space-y-4">
      <label class="block"><span class="rotulo">E-mail</span>
        <input type="email" class="campo mt-1" name="email" autocomplete="username" required maxlength="200" /></label>
      <label class="block"><span class="rotulo">Senha</span>
        <input type="password" class="campo mt-1" name="senha" autocomplete="current-password" required maxlength="200" /></label>
      <p class="hidden text-sm font-semibold text-alerta" data-erro role="alert"></p>
    </div>
    <div class="mt-7 flex justify-end gap-2">
      <button type="button" class="btn-secundario" data-fechar>Cancelar</button>
      <button type="submit" class="btn-primario px-6" data-entrar>Entrar</button>
    </div>
  </form>`;
  const form = d.querySelector('form');
  const erro = d.querySelector('[data-erro]');
  d.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => d.close()));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = d.querySelector('[data-entrar]');
    botao.disabled = true;
    try {
      await (await fonte()).entrar(form.email.value.trim().toLowerCase(), form.senha.value);
      d.close();
      aoEntrar();
    } catch (falha) {
      erro.textContent = falha.message;
      erro.classList.remove('hidden');
      form.senha.select();
    } finally {
      botao.disabled = false;
    }
  });
  d.showModal();
  form.email.focus();
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
const pct = (a, b) => (b ? (100 * a) / b : 0);
const fmtPct = (v) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const maior = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0] || null;

function variacao(atual, anterior, inverso = false, sufixo = true) {
  if (!anterior) return '';
  const v = ((atual - anterior) / anterior) * 100;
  const bom = inverso ? v <= 0 : v >= 0;
  const seta = v >= 0 ? '▲' : '▼';
  return `<span class="text-[13px] font-semibold ${bom ? 'text-ok' : 'text-alerta'}">${seta} ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>${sufixo ? '<span class="text-[13px] text-apagado"> vs mês anterior</span>' : ''}`;
}

const kpi = (rotulo, valor, rodape = '', destaque = false) => `
  <div class="cartao relative overflow-hidden px-5 py-4">
    ${destaque ? '<span class="absolute inset-y-0 left-0 w-1 bg-alerta" aria-hidden="true"></span>' : ''}
    <p class="text-[13px] text-suave">${esc(rotulo)}</p>
    <p class="kpi-valor mt-1 ${destaque ? 'text-alerta' : 'text-azul'}">${valor}</p>
    <p class="mt-1 min-h-5">${rodape}</p>
  </div>`;

const grafico = (id, titulo, sub, altura = 'h-72') => `
  <figure class="cartao p-6">
    <figcaption class="mb-5"><span class="display block text-[15px] font-bold text-azul">${esc(titulo)}</span>${sub ? `<span class="mt-0.5 block text-[13px] text-suave">${esc(sub)}</span>` : ''}</figcaption>
    <div class="relative ${altura}"><canvas id="${id}" role="img" aria-label="${esc(titulo)}"></canvas></div>
  </figure>`;

/** Soma as unidades `siglas` na competência de índice i (e a série de todas as competências). */
function agregar(p, siglas, i) {
  const meses = (idx) => siglas.map((s) => p.dados[s][idx]);
  const soma = (fn, idx = i) => meses(idx).reduce((t, m) => t + fn(m), 0);
  const pend = (m) => (m.checa ? m.checa.naoCnes + m.checa.naoTasy + m.checa.cboDiv : 0);
  const alertas = {};
  const procs = new Map();
  for (const m of meses(i)) {
    for (const [t, v] of Object.entries(m.alertas)) alertas[t] = (alertas[t] || 0) + v;
    for (const [c, d, q] of m.procs) {
      const atual = procs.get(c) || [c, d, 0];
      atual[2] += q;
      procs.set(c, atual);
    }
  }
  return {
    aihs: soma((m) => m.aihs), aihsAnt: i > 0 ? soma((m) => m.aihs, i - 1) : 0,
    comAlerta: soma((m) => m.comAlerta), comAlertaAnt: i > 0 ? soma((m) => m.comAlerta, i - 1) : 0,
    diarias: soma((m) => m.diariasMaior), linhasBpa: soma((m) => m.linhasBpa), bpaAlerta: soma((m) => m.bpaComAlerta),
    pendencias: soma(pend), pendenciasAnt: i > 0 ? soma(pend, i - 1) : 0,
    enviaram: meses(i).filter((m) => m.envios.hospitalar || m.envios.ambulatorial || m.envios.checa).length,
    alertas, procs: [...procs.values()].sort((a, b) => b[2] - a[2]).slice(0, 8),
    serie: p.competencias.map((_, j) => ({ aihs: soma((m) => m.aihs, j), taxa: pct(soma((m) => m.comAlerta, j), soma((m) => m.aihs, j)) })),
  };
}

function corCalor(v) {
  // verde (bom) -> amarelo -> vermelho (muitos alertas)
  if (v < 5) return 'background:#e7f6ee;color:#0b5d31';
  if (v < 8) return 'background:#fff4d6;color:#7a5300';
  if (v < 11) return 'background:#fde6d6;color:#8f3a06';
  return 'background:#fbd9d5;color:#8c1d14';
}

const vazioHtml = (titulo, texto) => `<div class="cartao px-6 py-12 text-center">
  <p class="display text-[17px] font-bold text-azul">${esc(titulo)}</p>
  <p class="mx-auto mt-2 max-w-xl text-sm text-suave">${esc(texto)}</p></div>`;

function htmlAlarmes(alarmes, mes) {
  const criticos = alarmes.filter((x) => x.nivel === 'critico').length;
  const atencao = alarmes.length - criticos;
  const item = (x) => `<li class="flex items-start gap-3 py-3">
      <span class="mt-1.5 size-2.5 shrink-0 rounded-full ${x.nivel === 'critico' ? 'bg-alerta' : 'bg-aviso'}" aria-hidden="true"></span>
      <div class="min-w-0 flex-1">
        <p class="text-sm"><button type="button" class="font-semibold text-turquesa-700 hover:underline" data-unidade="${esc(x.sigla)}">${esc(x.sigla)}</button> · <strong class="text-tinta">${esc(x.titulo)}</strong></p>
        <p class="mt-0.5 text-[13px] text-suave">${esc(x.detalhe)}</p>
      </div>
      <span class="etiqueta ${x.nivel === 'critico' ? 'etiqueta-pendente' : 'etiqueta-neutra'}">${x.nivel === 'critico' ? 'Crítico' : 'Atenção'}</span>
    </li>`;
  const visiveis = alarmes.slice(0, 6);
  const resto = alarmes.slice(6);
  return `<section class="cartao p-6" aria-labelledby="alarmes-titulo">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 id="alarmes-titulo" class="display text-[15px] font-bold">Alarmes de ${esc(nomeMes(mes))}</h3>
      <p class="text-[13px] text-suave">${alarmes.length
        ? [criticos ? `<span class="font-semibold text-alerta">${criticos} ${criticos === 1 ? 'crítico' : 'críticos'}</span>` : '', atencao ? `${atencao} de atenção` : ''].filter(Boolean).join(' · ')
        : 'Nenhuma situação fora dos limites'}</p>
    </div>
    ${alarmes.length
      ? `<ul class="mt-2 divide-y divide-linha">${visiveis.map(item).join('')}</ul>
         ${resto.length ? `<details><summary class="cursor-pointer py-2 text-[13px] font-semibold text-turquesa-700">Ver mais ${resto.length}</summary><ul class="divide-y divide-linha">${resto.map(item).join('')}</ul></details>` : ''}`
      : '<p class="mt-3 text-sm text-suave">Taxas de alerta, envios, produção e cadastro de profissionais dentro do esperado nesta competência.</p>'}
  </section>`;
}

export async function renderizarPainel(alvo, aoSair) {
  const f = await fonte();
  let usuario = await f.sessao().catch(() => null);
  if (!usuario) {
    aoSair();
    return;
  }
  let painelBase = null;
  let unidade = '';
  // Simulação de perfil (só para quem vê todas as unidades): '' = perfil real, 'gestor_unidade' ou 'faturista'.
  let simulacao = '';
  const podeSimular = ['gestor_central', 'admin'].includes(usuario.perfil);

  /** O painel como o perfil simulado o veria (o gestor de unidade só enxerga a própria unidade). */
  const visao = () => {
    if (simulacao !== 'gestor_unidade') return painelBase;
    return {
      ...painelBase,
      unidades: painelBase.unidades.filter((u) => u.sigla === unidade),
      dados: painelBase.dados[unidade] ? { [unidade]: painelBase.dados[unidade] } : {},
    };
  };

  const faixaSimulacao = () => {
    const alvoFaixa = alvo.querySelector('[data-simulacao]');
    if (!simulacao) {
      alvoFaixa.innerHTML = '';
      return;
    }
    const quem = simulacao === 'faturista' ? 'Faturista' : `Gestor de unidade (${esc(unidade)})`;
    const como = simulacao === 'faturista'
      ? 'O faturista não acessa o painel: só processa as análises e envia os totais da unidade dele.'
      : 'Só a unidade dele aparece, sem comparação com as demais. Troque a unidade no filtro para simular outro gestor.';
    alvoFaixa.innerHTML = `<div class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-aviso/20 bg-aviso-50 px-4 py-3 text-sm text-aviso" role="status">
      <p class="min-w-0 flex-1"><strong>Simulação de perfil:</strong> você está vendo a Área do gestor como <strong>${quem}</strong>. ${como} Suas permissões reais não mudam.</p>
      <button type="button" class="btn-secundario h-8 px-3 text-[13px]" data-encerrar-simulacao>Voltar ao meu perfil</button></div>`;
    alvoFaixa.querySelector('[data-encerrar-simulacao]').addEventListener('click', () => trocarSimulacao(''));
  };

  const desenhar = async () => {
    const conteudo = alvo.querySelector('[data-conteudo]');
    faixaSimulacao();
    if (simulacao === 'faturista') {
      conteudo.innerHTML = `<div class="cartao px-6 py-8">
        <p class="display text-[17px] font-bold text-azul">O perfil Faturista não acessa o painel gerencial</p>
        <p class="mt-2 max-w-2xl text-sm text-suave">Ao abrir a Área do gestor, ele vê a mensagem “Seu perfil não tem acesso ao painel gerencial”. O que ele faz no sistema:</p>
        <ul class="mt-3 max-w-2xl list-disc space-y-1 pl-5 text-sm text-tinta">
          <li>Processa as análises nas três ferramentas, como qualquer usuário, sem precisar de login.</li>
          <li>Ao fim de cada análise, entra com o próprio login e clica em <strong>Enviar ao painel gerencial</strong>.</li>
          <li>Só consegue enviar resultados das unidades às quais está vinculado.</li>
        </ul>
        <div class="mt-6 overflow-x-auto rounded-lg border border-linha"><table class="tabela">
          <thead><tr><th>Perfil</th><th>Envia resumos</th><th>Vê o painel</th></tr></thead>
          <tbody>
            <tr><td class="font-semibold">Faturista</td><td>das unidades dele</td><td>não</td></tr>
            <tr><td class="font-semibold">Gestor de unidade</td><td>das unidades dele</td><td>só das unidades dele</td></tr>
            <tr><td class="font-semibold">Gestão central</td><td>de todas</td><td>de todas</td></tr>
            <tr><td class="font-semibold">Administrador</td><td>de todas</td><td>de todas</td></tr>
          </tbody></table></div></div>`;
      return;
    }
    const painel = visao();
    const comDados = Object.keys(painel.dados);
    if (!comDados.length) {
      conteudo.innerHTML = vazioHtml('Nenhum resumo recebido ainda',
        'Os totais chegam ao painel quando a unidade conclui uma análise e clica em “Enviar ao painel gerencial”. Nenhum dado de paciente é enviado: só indicadores, tipos de alerta e procedimentos mais realizados.');
      return;
    }
    if (unidade && !comDados.includes(unidade)) {
      conteudo.innerHTML = vazioHtml(`Sem envios de ${unidade} no período`, 'Escolha outra competência ou outra unidade.');
      return;
    }
    const siglas = unidade ? [unidade] : comDados;
    const i = painel.competencias.length - 1;
    const mes = painel.competencias[i];
    const a = agregar(painel, siglas, i);
    const taxa = pct(a.comAlerta, a.aihs);
    const taxaAnt = pct(a.comAlertaAnt, a.aihsAnt);
    const principal = maior(a.alertas);
    const nomes = new Map(painel.unidades.map((u) => [u.sigla, u.nome]));
    const ranking = siglas.map((s) => {
      const m = painel.dados[s][i];
      const ant = i > 0 ? painel.dados[s][i - 1] : null;
      const p = maior(m.alertas);
      return { sigla: s, nome: nomes.get(s) || s, m, ant, taxa: pct(m.comAlerta, m.aihs), principal: p ? p[0] : '—' };
    }).sort((x, y) => y.m.aihs - x.m.aihs || y.m.linhasBpa - x.m.linhasBpa);
    const comAih = ranking.filter((r) => r.m.aihs);
    const porTaxa = [...comAih].sort((x, y) => y.taxa - x.taxa);

    conteudo.innerHTML = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${kpi('AIHs apresentadas', numero(a.aihs), variacao(a.aihs, a.aihsAnt))}
        ${kpi('AIHs com alerta', fmtPct(taxa), `<span class="text-[13px] text-suave">${numero(a.comAlerta)} AIHs · </span>${variacao(taxa, taxaAnt, true, false)}`, taxa >= 10)}
        ${kpi('Unidades com envio', `${numero(a.enviaram)} <span class="text-[18px] font-semibold text-suave">de ${numero(siglas.length)}</span>`, `<span class="text-[13px] text-apagado">enviaram alguma análise de ${esc(nomeMes(mes))}</span>`)}
        ${kpi('Diárias de perm. a maior', numero(a.diarias), '<span class="text-[13px] text-apagado">calculadas pelo atributo 004</span>')}
        ${kpi('Linhas BPA com alerta', fmtPct(pct(a.bpaAlerta, a.linhasBpa)), `<span class="text-[13px] text-suave">${numero(a.bpaAlerta)} de ${numero(a.linhasBpa)} linhas</span>`)}
        ${kpi('Pendências cadastrais', numero(a.pendencias), variacao(a.pendencias, a.pendenciasAnt, true))}
      </div>

      ${htmlAlarmes(calcularAlarmes(painel, siglas, i), mes)}

      <div class="rounded-lg border border-turquesa-100 bg-turquesa-50/80 px-5 py-4 text-sm text-azul">
        <p class="font-semibold">Destaques de ${esc(nomeMes(mes))}${unidade ? ` · ${esc(unidade)}` : ' · todas as unidades'}</p>
        <ul class="mt-1 list-disc space-y-0.5 pl-5 text-tinta">
          ${principal ? `<li>Principal motivo de alerta: <strong>${esc(principal[0])}</strong> (${numero(principal[1])} contas ou linhas afetadas).</li>` : '<li>Nenhum alerta registrado na competência.</li>'}
          ${a.aihsAnt ? `<li>Taxa de AIHs com alerta ${taxa <= taxaAnt ? 'caiu' : 'subiu'} de ${fmtPct(taxaAnt)} para <strong>${fmtPct(taxa)}</strong> em relação ao mês anterior.</li>` : ''}
          ${!unidade && porTaxa.length > 1 ? `<li>Maior taxa de alerta: <strong>${esc(porTaxa[0].sigla)}</strong> (${fmtPct(porTaxa[0].taxa)}); menor: <strong>${esc(porTaxa.at(-1).sigla)}</strong>.</li>` : ''}
        </ul>
      </div>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        ${grafico('gestor-g1', 'Produção mensal e qualidade', 'Barras: AIHs apresentadas · linha: % de AIHs com alerta', 'h-80')}
        ${grafico('gestor-g2', 'Principais motivos de alerta', `AIHs (ou linhas BPA) afetadas em ${nomeMes(mes)}`, 'h-80')}
      </div>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section class="cartao p-6">
          <h3 class="display mb-1 text-[15px] font-bold">Unidades em ${esc(nomeMes(mes))}</h3>
          <p class="mb-5 text-[13px] text-suave">Ordenadas pelo volume de AIHs. Clique na sigla para ver só a unidade.</p>
          <div class="overflow-x-auto rounded-lg border border-linha"><table class="tabela">
            <thead><tr><th>Unidade</th><th class="text-right">AIHs</th><th class="text-right">Variação</th><th class="text-right">% com alerta</th><th>Principal alerta</th><th class="text-right">Linhas BPA</th></tr></thead>
            <tbody>${ranking.map(({ sigla, nome, m, ant, taxa: t, principal: p }) => `<tr>
              <td><button type="button" class="font-semibold text-turquesa-700 hover:underline" data-unidade="${esc(sigla)}">${esc(sigla)}</button><span class="block text-xs text-apagado">${esc(nome)}</span></td>
              <td class="text-right tabular-nums">${m.aihs ? numero(m.aihs) : '—'}</td>
              <td class="text-right">${ant && m.aihs ? variacao(m.aihs, ant.aihs, false, false) || '—' : '—'}</td>
              <td class="text-right">${m.aihs ? `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums" style="${corCalor(t)}">${fmtPct(t)}</span>` : '—'}</td>
              <td class="text-[13px]">${esc(p)}</td>
              <td class="text-right tabular-nums">${m.linhasBpa ? numero(m.linhasBpa) : '—'}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>
        ${grafico('gestor-g3', 'Procedimentos mais realizados', `Quantidade em ${nomeMes(mes)} (AIH)`, 'h-96')}
      </div>

      <section class="cartao p-6">
        <h3 class="display mb-1 text-[15px] font-bold">Qualidade por unidade e mês</h3>
        <p class="mb-5 text-[13px] text-suave">% de AIHs com pelo menos um alerta. Verde abaixo de 5%, vermelho a partir de 11%. Traço: sem envio do Hospitalar.</p>
        <div class="overflow-x-auto rounded-lg border border-linha"><table class="tabela">
          <thead><tr><th>Unidade</th>${painel.competencias.map((c) => `<th class="text-center">${esc(nomeMes(c))}</th>`).join('')}</tr></thead>
          <tbody>${ranking.map(({ sigla }) => `<tr><td class="font-semibold">${esc(sigla)}</td>${painel.dados[sigla].map((m) => {
            if (!m.aihs) return '<td class="text-center text-apagado">—</td>';
            const t = pct(m.comAlerta, m.aihs);
            return `<td class="text-center"><span class="inline-block min-w-14 rounded px-2 py-1 text-xs font-semibold tabular-nums" style="${corCalor(t)}">${fmtPct(t)}</span></td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </section>

      <section class="cartao p-6">
        <h3 class="display mb-1 text-[15px] font-bold">Cadastro de profissionais (ChecaProfissionais)</h3>
        <p class="mb-5 text-[13px] text-suave">Divergências Tasy × CNES na última conferência enviada em ${esc(nomeMes(mes))}. Afetam diretamente os alertas de CBO e de profissional não cadastrado.</p>
        <div class="overflow-x-auto rounded-lg border border-linha"><table class="tabela">
          <thead><tr><th>Unidade</th><th class="text-right">Não encontrados no CNES</th><th class="text-right">Não encontrados no Tasy</th><th class="text-right">CBOs divergentes</th><th class="text-right">Total</th></tr></thead>
          <tbody>${ranking.map(({ sigla, m }) => {
            const c = m.checa;
            if (!c) return `<tr><td class="font-semibold">${esc(sigla)}</td><td colspan="4" class="text-right text-[13px] text-apagado">sem conferência enviada</td></tr>`;
            return `<tr><td class="font-semibold">${esc(sigla)}</td><td class="text-right tabular-nums">${numero(c.naoCnes)}</td><td class="text-right tabular-nums">${numero(c.naoTasy)}</td><td class="text-right tabular-nums">${numero(c.cboDiv)}</td><td class="text-right font-semibold tabular-nums">${numero(c.naoCnes + c.naoTasy + c.cboDiv)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>`;

    conteudo.querySelectorAll('[data-unidade]').forEach((b) => b.addEventListener('click', () => {
      unidade = b.dataset.unidade;
      alvo.querySelector('[data-filtro-unidade]').value = unidade;
      desenhar();
    }));

    await desenharGrafico(conteudo.querySelector('#gestor-g1'), {
      type: 'bar',
      data: {
        labels: painel.competencias.map(nomeMes),
        datasets: [
          { type: 'bar', label: 'AIHs apresentadas', data: a.serie.map((s) => s.aihs), backgroundColor: painel.competencias.map((c) => (c === mes ? '#0092c3' : '#b9e1ef')), borderRadius: 4, yAxisID: 'y', order: 2 },
          { type: 'line', label: '% com alerta', data: a.serie.map((s) => +s.taxa.toFixed(1)), borderColor: '#b42318', backgroundColor: '#b42318', pointRadius: 4, tension: 0.3, yAxisID: 'y1', order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } } },
        scales: {
          y: { beginAtZero: true, grid: { color: '#eef0f2' }, border: { display: false }, ticks: { precision: 0 } },
          y1: { position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { callback: (v) => `${v}%` } },
          x: { grid: { display: false } },
        },
      },
    });
    const ordem = Object.entries(a.alertas).sort((x, y) => y[1] - x[1]).slice(0, 7);
    await desenharGrafico(conteudo.querySelector('#gestor-g2'), {
      type: 'bar',
      data: { labels: ordem.map(([n]) => n), datasets: [{ label: 'Afetadas', data: ordem.map(([, v]) => v), backgroundColor: ordem.map((_, k) => (k === 0 ? '#b42318' : '#e8a69f')), borderRadius: 4, maxBarThickness: 18 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: '#eef0f2' }, border: { display: false } }, y: { grid: { display: false }, ticks: { autoSkip: false, callback(v) { const t = this.getLabelForValue(v); return t.length > 30 ? `${t.slice(0, 29)}…` : t; } } } } },
    });
    await desenharGrafico(conteudo.querySelector('#gestor-g3'), {
      type: 'bar',
      data: { labels: a.procs.map(([c, d]) => d || c), datasets: [{ label: 'Quantidade', data: a.procs.map(([, , q]) => q), backgroundColor: '#00486c', borderRadius: 4, maxBarThickness: 18 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => `${a.procs[it[0].dataIndex][0]} · ${a.procs[it[0].dataIndex][1]}` } } },
        scales: { x: { beginAtZero: true, grid: { color: '#eef0f2' }, border: { display: false } }, y: { grid: { display: false }, ticks: { autoSkip: false, callback(v) { const t = this.getLabelForValue(v); return t.length > 28 ? `${t.slice(0, 27)}…` : t; } } } },
      },
    });
  };

  const carregar = async (ate) => {
    alvo.querySelector('[data-conteudo]').innerHTML = '<p class="py-12 text-center text-sm text-suave">Carregando o painel…</p>';
    try {
      painelBase = await f.painel(ate);
    } catch (e) {
      if (e.status === 401) {
        toast('Sua sessão expirou. Entre novamente.');
        aoSair();
        return;
      }
      alvo.querySelector('[data-conteudo]').innerHTML = vazioHtml('Não foi possível carregar o painel', e.message);
      return;
    }
    const selMes = alvo.querySelector('[data-filtro-mes]');
    const opcoes = [...new Set([painelBase.competencias.at(-1), ...(painelBase.disponiveis || [])])].sort().reverse();
    selMes.innerHTML = opcoes.map((m) => `<option value="${esc(m)}">${esc(nomeMes(m))}</option>`).join('');
    selMes.value = painelBase.competencias.at(-1);
    const selUn = alvo.querySelector('[data-filtro-unidade]');
    if (selUn.options.length <= 1) {
      selUn.innerHTML = `<option value="">Todas as unidades</option>${painelBase.unidades.map((u) => `<option value="${esc(u.sigla)}">${esc(u.sigla)} — ${esc(u.nome)}</option>`).join('')}`;
      if (painelBase.unidades.length === 1) unidade = painelBase.unidades[0].sigla;
    }
    selUn.options[0].disabled = simulacao === 'gestor_unidade';
    selUn.value = unidade;
    await desenhar();
  };

  function trocarSimulacao(valor) {
    simulacao = valor;
    const selPerfil = alvo.querySelector('[data-filtro-perfil]');
    if (selPerfil) selPerfil.value = valor;
    const selUn = alvo.querySelector('[data-filtro-unidade]');
    selUn.options[0].disabled = valor === 'gestor_unidade';
    if (valor === 'gestor_unidade' && !unidade) unidade = Object.keys(painelBase.dados)[0] || painelBase.unidades[0]?.sigla || '';
    if (!valor && painelBase.unidades.length > 1) unidade = '';
    selUn.value = unidade;
    desenhar();
  }

  const perfil = PERFIS[usuario.perfil] || usuario.perfil;
  alvo.innerHTML = `
    <div class="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div class="max-w-3xl">
        <div class="mb-2 flex flex-wrap gap-2"><span class="etiqueta etiqueta-servidor">Versão beta</span><span class="etiqueta etiqueta-neutra">${esc(usuario.nome || 'gestor')} · ${esc(perfil)}</span></div>
        <h1 class="text-[30px] leading-tight sm:text-[34px]">Painel gerencial</h1>
        <p class="mt-2 text-suave">Produção e qualidade do faturamento das unidades da FHEMIG, consolidadas a partir das análises do Fatura Hospitalar, do Fatura Ambulatorial e do ChecaProfissionais.</p>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        ${podeSimular ? `<label class="flex flex-col gap-1"><span class="rotulo">Ver como</span>
          <select class="campo w-52" data-filtro-perfil>
            <option value="">Meu perfil (${esc(perfil)})</option>
            <option value="gestor_unidade">Gestor de unidade</option>
            <option value="faturista">Faturista</option>
          </select></label>` : ''}
        <label class="flex flex-col gap-1"><span class="rotulo">Competência</span>
          <select class="campo w-36" data-filtro-mes></select></label>
        <label class="flex flex-col gap-1"><span class="rotulo">Unidade</span>
          <select class="campo w-56" data-filtro-unidade><option value="">Todas as unidades</option></select></label>
        <button type="button" class="btn-secundario" data-sair>Sair</button>
      </div>
    </div>
    <div data-simulacao></div>
    <div class="space-y-6" data-conteudo></div>`;
  alvo.querySelector('[data-filtro-perfil]')?.addEventListener('change', (e) => trocarSimulacao(e.target.value));
  alvo.querySelector('[data-filtro-mes]').addEventListener('change', (e) => carregar(e.target.value));
  alvo.querySelector('[data-filtro-unidade]').addEventListener('change', (e) => { unidade = e.target.value; desenhar(); });
  alvo.querySelector('[data-sair]').addEventListener('click', async () => {
    await f.sair().catch(() => {});
    usuario = null;
    toast('Sessão encerrada.');
    aoSair();
  });
  await carregar();
}
