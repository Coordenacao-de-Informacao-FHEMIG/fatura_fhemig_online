// Painel de resultados: indicadores, avisos, graficos, resumo de alertas e
// lista de ocorrencias filtravel. Todo texto vindo dos arquivos passa por esc().
import { esc, numero, competencia, baixarArquivo, ICONES } from './util.js';

let ChartLib = null;
async function chart() {
  if (!ChartLib) {
    const m = await import('chart.js');
    m.Chart.register(m.BarController, m.BarElement, m.LineController, m.LineElement, m.PointElement, m.CategoryScale, m.LinearScale,
      m.DoughnutController, m.ArcElement, m.Tooltip, m.Legend, m.Filler);
    m.Chart.defaults.font.family = "'Open Sans Variable', 'Open Sans', system-ui, sans-serif";
    m.Chart.defaults.color = '#616161';
    m.Chart.defaults.font.size = 12;
    ChartLib = m.Chart;
  }
  return ChartLib;
}

const graficosAtivos = new Map();
const TURQUESA = '#0092c3';
const AZUL = '#00486c';
const ALERTA = '#b42318';
const SEVERIDADE = { Crítica: '#b42318', Alta: '#d4620a', Média: '#c79a00', Baixa: '#2e75b6', Informativa: '#8a99a6' };
const SEV_FUNDO = { Crítica: 'bg-alerta-50 text-alerta', Alta: 'bg-[#fdf0e6] text-[#9a4507]', Média: 'bg-aviso-50 text-aviso', Baixa: 'bg-turquesa-50 text-azul', Informativa: 'bg-slate-100 text-suave' };

export { desenhar as desenharGrafico };

async function desenhar(canvas, config) {
  const C = await chart();
  if (graficosAtivos.has(canvas.id)) graficosAtivos.get(canvas.id).destroy();
  graficosAtivos.set(canvas.id, new C(canvas, config));
}

const corta = (s, n = typeof innerWidth !== 'undefined' && innerWidth < 640 ? 18 : 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function barrasHorizontais(rotulos, valores, cor, titulo) {
  return {
    type: 'bar',
    data: { labels: rotulos.map((r) => corta(r)), datasets: [{ label: titulo, data: valores, backgroundColor: cor, borderRadius: 4, maxBarThickness: 18 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => rotulos[it[0].dataIndex] } } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef0f2' }, border: { display: false } }, y: { grid: { display: false }, ticks: { autoSkip: false }, border: { color: '#e3e6ea' } } },
    },
  };
}

function linha(rotulos, valores, titulo) {
  return {
    type: 'line',
    data: { labels: rotulos, datasets: [{ label: titulo, data: valores, borderColor: TURQUESA, backgroundColor: 'rgba(0,146,195,.12)', fill: true, tension: 0.25, pointRadius: 4, pointBackgroundColor: AZUL }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef0f2' }, border: { display: false } }, x: { grid: { display: false } } } },
  };
}

const cartaoGrafico = (id, titulo, altura = 'h-72') => `
  <figure class="cartao p-6">
    <figcaption class="display mb-5 text-[15px] font-bold text-azul">${esc(titulo)}</figcaption>
    <div class="relative ${altura}"><canvas id="${id}" role="img" aria-label="${esc(titulo)}"></canvas></div>
  </figure>`;

const tituloSecao = (t, sub = '') => `<div class="mb-4"><h3 class="text-[19px]">${esc(t)}</h3>${sub ? `<p class="mt-0.5 text-[13px] text-suave">${esc(sub)}</p>` : ''}</div>`;

function kpis(lista) {
  return `<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">${lista
    .map((k) => {
      const alerta = k.destaque && k.valor;
      return `
      <div class="cartao relative overflow-hidden px-5 py-4">
        ${alerta ? '<span class="absolute inset-y-0 left-0 w-1 bg-alerta" aria-hidden="true"></span>' : ''}
        <p class="text-[13px] text-suave">${esc(k.rotulo)}</p>
        <p class="kpi-valor mt-1 ${alerta ? 'text-alerta' : 'text-azul'}">${numero(k.valor, typeof k.valor === 'number' && (!Number.isInteger(k.valor) || k.rotulo.startsWith('%')) ? 1 : 0)}${k.rotulo.startsWith('%') ? '<span class="ml-0.5 text-[20px]">%</span>' : ''}</p>
      </div>`;
    })
    .join('')}</div>`;
}

function avisos(lista) {
  if (!lista || !lista.length) return '';
  return `<div class="flex gap-3 rounded-lg border border-aviso/20 bg-aviso-50 px-5 py-4" role="alert">
    <span class="mt-0.5 font-bold text-aviso" aria-hidden="true">!</span>
    <div><p class="text-sm font-semibold text-aviso">Avisos gerais</p>
    <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-tinta">${lista.map((a) => `<li>${esc(a.replace(/^⚠\s*AVISO:\s*/, ''))}</li>`).join('')}</ul></div>
  </div>`;
}

const COLUNAS = {
  hospitalar: [['tipo', 'Alerta'], ['aih', 'AIH'], ['paciente', 'Paciente'], ['linha', 'Linha'], ['procedimento', 'Procedimento'], ['cbo', 'CBO'], ['detalhe', 'Detalhe']],
  ambulatorial: [['tipo', 'Alerta'], ['linha', 'Linha TXT'], ['registro', 'Tipo'], ['procedimento', 'Procedimento'], ['profissional', 'Profissional'], ['paciente', 'Paciente'], ['detalhe', 'Detalhe']],
  checa: [['severidade', 'Severidade'], ['id', 'ID'], ['tipo', 'Alerta'], ['nome', 'Nome'], ['cbo', 'CBO'], ['mensagem', 'Mensagem'], ['acao', 'Ação recomendada']],
};

function ocorrencias(ferramenta, lista) {
  const tipos = [...new Set(lista.map((o) => o.tipo))];
  return `<section class="cartao p-6" data-ocorrencias>
    <div class="mb-5 flex flex-wrap items-end gap-4">
      <div class="mr-auto">
        <h3 class="text-[19px]">Ocorrências</h3>
        <p class="mt-0.5 text-[13px] text-suave">Uma linha por alerta. A lista completa, com todas as colunas, está no Excel.</p>
      </div>
      <label class="flex min-w-48 flex-1 flex-col gap-1 sm:w-80 sm:flex-none"><span class="rotulo">Tipo de alerta</span>
        <select class="campo" data-filtro-tipo><option value="">Todos (${numero(lista.length)})</option>${tipos
          .map((t) => `<option value="${esc(t)}">${esc(t)} (${numero(lista.filter((o) => o.tipo === t).length)})</option>`)
          .join('')}</select></label>
      <label class="flex min-w-48 flex-1 flex-col gap-1 sm:w-64 sm:flex-none"><span class="rotulo">Buscar</span>
        <input type="search" class="campo" placeholder="AIH, nome, procedimento…" data-filtro-texto /></label>
    </div>
    <div class="max-h-[32rem] overflow-auto rounded-lg border border-linha">
      <table class="tabela"><thead><tr>${COLUNAS[ferramenta].map(([, t]) => `<th scope="col">${t}</th>`).join('')}</tr></thead><tbody data-corpo></tbody></table>
    </div>
    <div class="mt-4 flex items-center justify-between gap-3 text-[13px] text-suave"><span data-contagem></span>
      <span class="flex gap-2"><button type="button" class="btn-secundario h-8 px-3 text-[13px]" data-pag="-1">Anterior</button><button type="button" class="btn-secundario h-8 px-3 text-[13px]" data-pag="1">Próxima</button></span></div>
  </section>`;
}

function ligarOcorrencias(raiz, ferramenta, lista) {
  const sec = raiz.querySelector('[data-ocorrencias]');
  const corpo = sec.querySelector('[data-corpo]');
  const selTipo = sec.querySelector('[data-filtro-tipo]');
  const busca = sec.querySelector('[data-filtro-texto]');
  const contagem = sec.querySelector('[data-contagem]');
  const POR_PAGINA = 50;
  let pagina = 0;
  const cols = COLUNAS[ferramenta];
  const render = () => {
    const termo = busca.value.trim().toLowerCase();
    const filtrada = lista.filter((o) => (!selTipo.value || o.tipo === selTipo.value) && (!termo || cols.some(([k]) => String(o[k] ?? '').toLowerCase().includes(termo))));
    const total = Math.max(1, Math.ceil(filtrada.length / POR_PAGINA));
    pagina = Math.min(Math.max(0, pagina), total - 1);
    const fatia = filtrada.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
    corpo.innerHTML = fatia.length
      ? fatia.map((o) => `<tr>${cols.map(([k]) => {
        if (k === 'severidade') return `<td><span class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${SEV_FUNDO[o[k]] || ''}">${esc(o[k])}</span></td>`;
        const largo = k === 'detalhe' || k === 'mensagem' || k === 'acao';
        return `<td class="${largo ? 'min-w-72 text-suave' : k === 'tipo' ? 'min-w-44 font-semibold text-tinta' : 'whitespace-nowrap'}">${esc(o[k])}</td>`;
      }).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="py-6 text-center text-suave">Nenhuma ocorrência com esse filtro.</td></tr>`;
    contagem.textContent = `${numero(filtrada.length)} ocorrência(s) · página ${pagina + 1} de ${total}`;
  };
  selTipo.addEventListener('change', () => { pagina = 0; render(); });
  busca.addEventListener('input', () => { pagina = 0; render(); });
  sec.querySelectorAll('[data-pag]').forEach((b) => b.addEventListener('click', () => { pagina += Number(b.dataset.pag); render(); }));
  render();
  return (tipo) => {
    selTipo.value = tipo;
    pagina = 0;
    render();
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

function tabelaResumo(titulo, cabecalho, linhas, clicavel) {
  return `<section class="cartao p-6">
    <h3 class="display mb-5 text-[15px] font-bold">${esc(titulo)}</h3>
    <div class="overflow-x-auto rounded-lg border border-linha"><table class="tabela">
      <thead><tr>${cabecalho.map((c, i) => `<th scope="col" class="${i ? 'text-right' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map((l) => `<tr>${l.map((v, i) => {
        if (i === 0 && clicavel && v && typeof v === 'object' && v.texto) {
          return `<td><button type="button" class="text-left font-semibold text-turquesa-700 underline-offset-2 hover:underline" data-ver-tipo="${esc(v.texto)}">${v.html ?? esc(v.texto)}</button></td>`;
        }
        return `<td class="${i ? 'text-right tabular-nums' : ''}">${typeof v === 'number' ? numero(v) : v && v.html ? v.html : esc(v)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}

function cabecalho(r, nomeEntrada) {
  const botoes = [];
  botoes.push(`<button type="button" class="btn-primario" data-baixar="xlsx">${ICONES.baixar} Excel consolidado</button>`);
  if (r.arquivos.csv) botoes.push(`<button type="button" class="btn-secundario" data-baixar="csv">${ICONES.baixar} CSV</button>`);
  if (r.arquivos.espelho) botoes.push(`<button type="button" class="btn-secundario" data-baixar="espelho">${ICONES.baixar} Espelho TXT</button>`);
  if (r.arquivos.log) botoes.push(`<button type="button" class="btn-secundario" data-baixar="log">${ICONES.baixar} Log</button>`);
  const meta = [`<span>Unidade <strong class="font-semibold text-tinta">${esc(r.unidade)}</strong></span>`];
  if (r.competencia !== undefined) meta.push(`<span>Competência <strong class="font-semibold text-tinta">${esc(competencia(r.competencia))}</strong></span>`);
  if (r.sigtap) meta.push(`<span>SIGTAP ${esc(r.sigtap.rotulo)}</span>`);
  return `<div class="flex flex-wrap items-end gap-x-8 gap-y-4">
      <div class="mr-auto min-w-0">
        <h2 class="text-[26px] leading-tight">Resultado da análise</h2>
        <p class="mt-1 truncate text-[15px] font-semibold text-tinta" title="${esc(nomeEntrada)}">${esc(nomeEntrada)}</p>
        <p class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-suave">${meta.join('')}</p>
      </div>
      <div class="flex flex-wrap gap-2">${botoes.join('')}</div>
    </div>`;
}

/** Renderiza o resultado de qualquer ferramenta no elemento alvo. */
export async function renderizarResultado(alvo, r, nomeEntrada) {
  const f = r.ferramenta;
  const s = r.resumo;
  const pre = `res-${f}`;
  let corpo = '';
  if (f === 'hospitalar') {
    corpo = `${tituloSecao('Indicadores')}${kpis(s.kpis.map((k) => ({ ...k, destaque: k.rotulo === 'AIHs com alerta' })))}
      ${avisos(r.avisos)}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        ${cartaoGrafico(`${pre}-g1`, 'Alertas de qualidade por AIH')}
        ${cartaoGrafico(`${pre}-g2`, 'Top 10 procedimentos por quantidade')}
        ${cartaoGrafico(`${pre}-g3`, 'Evolução mensal das AIHs apresentadas (mês de alta)', 'h-60')}
        ${tabelaResumo('AIHs por tipo e CTI', ['Grupo', 'AIHs'], s.cti, false)}
      </div>
      ${tabelaResumo('Alertas de qualidade', ['Alerta', 'AIHs', 'Procedimentos'], s.alertas.map((a) => [{ texto: a.rotulo, html: `<span class="mr-2 inline-block size-2.5 rounded-full align-middle" style="background:#${esc(a.cor)}"></span>${esc(a.rotulo)}` }, a.aihs, a.procedimentos]), true)}
      ${ocorrencias(f, s.ocorrencias)}`;
  } else if (f === 'ambulatorial') {
    corpo = `${tituloSecao('Indicadores')}${kpis(s.kpis)}
      ${avisos(r.avisos)}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        ${cartaoGrafico(`${pre}-g1`, 'Linhas de atendimento por tipo de alerta')}
        ${cartaoGrafico(`${pre}-g2`, 'Top 10 procedimentos (quantidade)')}
        ${cartaoGrafico(`${pre}-g3`, 'Linhas de atendimento por data', 'h-60')}
        ${tabelaResumo('Linhas por tipo de registro', ['Tipo de registro', 'Linhas', 'Procedimentos'], s.tipos, false)}
      </div>
      ${tabelaResumo('Alertas por regra', ['Alerta', 'Linhas', 'Procedimentos'], s.alertas.map((a) => [
        a.linhas ? { texto: a.rotulo, html: `${esc(a.rotulo)} <span class="ml-1 text-xs font-normal text-suave">${esc(a.codigo)}</span>` } : { html: `<span class="text-suave">${esc(a.rotulo)}</span>` },
        a.linhas, a.procedimentos]), true)}
      ${ocorrencias(f, s.ocorrencias)}`;
  } else {
    const t = s.trilhas;
    const trilha = (o) => `${numero(o.EXCLUIDO_ADC)} + ${numero(o.ESPECIAL)} + ${numero(o.SEM_IDENTIFICADOR)} + ${numero(o.ANALISADO)}`;
    corpo = `${tituloSecao('Indicadores')}${kpis(s.kpis)}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        ${cartaoGrafico(`${pre}-g1`, 'Ocorrências por severidade')}
        ${cartaoGrafico(`${pre}-g2`, 'Ocorrências por tipo de alerta')}
      </div>
      ${tabelaResumo('Fechamento de volume (toda linha recebe uma trilha)', ['Fonte', 'ADC + especiais + sem identificador + analisadas', 'Fecha?'], [
        ['Tasy', trilha(t.tasy), { html: t.fechaTasy ? '<span class="font-semibold text-ok">Sim</span>' : '<span class="font-semibold text-alerta">NÃO</span>' }],
        ['CNES', trilha(t.cnes), { html: t.fechaCnes ? '<span class="font-semibold text-ok">Sim</span>' : '<span class="font-semibold text-alerta">NÃO</span>' }],
      ], false)}
      ${tabelaResumo('Alertas', ['Alerta', 'Severidade', 'Ocorrências'], s.alertas.map((a) => [{ texto: a.rotulo, html: `${a.principal ? '<span class="mr-1 text-turquesa" title="Alerta principal">★</span>' : ''}${esc(a.rotulo)}` }, { html: `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${SEV_FUNDO[a.severidade] || ''}">${esc(a.severidade)}</span>` }, a.quantidade]), true)}
      ${ocorrencias(f, s.ocorrencias)}`;
  }
  alvo.innerHTML = `<div class="space-y-8"><div class="cartao p-6 sm:p-8">${cabecalho(r, nomeEntrada)}</div><div class="space-y-6">${corpo}</div></div>`;

  const filtrar = ligarOcorrencias(alvo, f, s.ocorrencias);
  alvo.querySelectorAll('[data-ver-tipo]').forEach((b) => b.addEventListener('click', () => filtrar(b.dataset.verTipo)));
  alvo.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', () => {
    const a = r.arquivos[b.dataset.baixar];
    if (b.dataset.baixar === 'xlsx') baixarArquivo(a.nome, a.bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else baixarArquivo(a.nome, a.texto, b.dataset.baixar === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8');
  }));

  const g = (n) => alvo.querySelector(`#${pre}-g${n}`);
  if (f === 'hospitalar') {
    const al = s.alertas.filter((a) => a.aihs);
    await desenhar(g(1), barrasHorizontais(al.map((a) => a.rotulo), al.map((a) => a.aihs), al.map((a) => `#${a.cor}`), 'AIHs'));
    await desenhar(g(2), barrasHorizontais(s.top.map((t) => t[0]), s.top.map((t) => t[1]), AZUL, 'Quantidade'));
    await desenhar(g(3), linha(s.mensal.map((m) => m[0]), s.mensal.map((m) => m[1]), 'AIHs'));
  } else if (f === 'ambulatorial') {
    const al = s.alertas.filter((a) => a.linhas);
    await desenhar(g(1), barrasHorizontais(al.map((a) => a.rotulo), al.map((a) => a.linhas), ALERTA, 'Linhas'));
    await desenhar(g(2), barrasHorizontais(s.top.map((t) => t[0]), s.top.map((t) => t[1]), AZUL, 'Quantidade'));
    await desenhar(g(3), linha(s.producao.map((p) => p[0]), s.producao.map((p) => p[1]), 'Linhas'));
  } else {
    const sev = s.severidades.filter(([, q]) => q);
    await desenhar(g(1), {
      type: 'doughnut',
      data: { labels: sev.map(([n]) => n), datasets: [{ data: sev.map(([, q]) => q), backgroundColor: sev.map(([n]) => SEVERIDADE[n]), borderColor: '#fff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' } } },
    });
    const al = s.alertas.filter((a) => a.severidade !== 'Informativa');
    await desenhar(g(2), barrasHorizontais(al.map((a) => a.rotulo), al.map((a) => a.quantidade), al.map((a) => SEVERIDADE[a.severidade]), 'Ocorrências'));
  }
}
