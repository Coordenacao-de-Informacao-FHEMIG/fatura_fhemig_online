import './styles.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { UNIDADES } from './engine/unidades.js';
import { extrairEspelhoPdf } from './engine/hospitalar/entrada.js';
import { FERRAMENTAS, porId } from './ui/ferramentas.js';
import { renderizarResultado } from './ui/resultados.js';
import { abrirLogin, logado, renderizarPainel } from './ui/gestor.js';
import { api, apiDisponivel, sha256DeArquivos } from './gestao/api.js';
import { montarResumoGestao } from './gestao/resumo.js';
import { $, $$, esc, toast, tamanho, armazenamento, competencia, ICONES } from './ui/util.js';

const MODO = typeof __MODO__ !== 'undefined' ? __MODO__ : 'netlify';
const DEMO = MODO === 'netlify';

// ---------------------------------------------------------------------------
// Worker (motor de processamento)
// ---------------------------------------------------------------------------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let proxId = 1;
const pendentes = new Map();
worker.onmessage = (ev) => {
  const { id, progresso } = ev.data;
  const p = pendentes.get(id);
  if (!p) return;
  if (progresso !== undefined) {
    p.progresso?.(progresso);
    return;
  }
  pendentes.delete(id);
  if (ev.data.ok) p.ok(ev.data.dados);
  else {
    const erro = new Error(ev.data.erro);
    erro.codigo = ev.data.codigo;
    p.falha(erro);
  }
};
function chamar(tipo, dados = {}, progresso, transferir = []) {
  const id = proxId++;
  return new Promise((ok, falha) => {
    pendentes.set(id, { ok, falha, progresso });
    worker.postMessage({ id, tipo, ...dados }, transferir);
  });
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const estado = {
  unidade: armazenamento.ler('fatura.unidade', ''),
  aba: armazenamento.ler('fatura.aba', 'hospitalar'),
  manifesto: { hospitalar: {}, ambulatorial: {}, checa: {} },
  sigtap: [],
  exemplos: null,
  ferramentas: Object.fromEntries(FERRAMENTAS.map((f) => [f.id, { arquivos: {}, ocupado: false }])),
};
if (!FERRAMENTAS.some((f) => f.id === estado.aba)) estado.aba = 'hospitalar';
const historico = () => armazenamento.ler('fatura.historico.v1', []);

function baseServidor(fid, slotId) {
  if (fid === 'checa') return estado.manifesto.checa?.[slotId] || null;
  if (!estado.unidade) return null;
  return estado.manifesto[fid]?.[estado.unidade]?.[slotId] || null;
}

// ---------------------------------------------------------------------------
// Cabecalho, unidade e marcas
// ---------------------------------------------------------------------------
function montarUnidades() {
  const sel = $('#unidade');
  const temBase = (sigla) => ['hospitalar', 'ambulatorial'].some((f) => estado.manifesto[f]?.[sigla]);
  sel.innerHTML = '<option value="">Selecione a unidade…</option>' + [...UNIDADES]
    .sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR'))
    .map((u) => `<option value="${esc(u.sigla)}">${esc(u.sigla)} — ${esc(u.nome)}${temBase(u.sigla) ? ' ●' : ''}</option>`)
    .join('');
  sel.value = UNIDADES.some((u) => u.sigla === estado.unidade) ? estado.unidade : '';
  estado.unidade = sel.value;
}

async function montarMarcas() {
  try {
    const r = await fetch('/marca/marcas.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const marcas = await r.json();
    if (!marcas.length) return;
    const img = (m, altura) => `<img src="${esc(m.src)}" alt="${esc(m.alt)}" style="height:${altura}px;width:${Math.round(altura * (m.proporcao || 2))}px" loading="lazy" />`;
    const rodape = $('#marcas-rodape');
    rodape.innerHTML = marcas.map((m) => img(m, m.proporcao > 4 ? 28 : 34)).join('<span class="h-8 w-px bg-linha" aria-hidden="true"></span>');
    rodape.hidden = false;
  } catch {
    /* sem marcas adicionais */
  }
}

// ---------------------------------------------------------------------------
// Abas e paineis
// ---------------------------------------------------------------------------
const ICONE_ABA = (svg) => svg.replace('class="size-6"', 'class="size-5"');

function montarAbas() {
  $('#abas').innerHTML = FERRAMENTAS.map((f) => `
    <button type="button" role="tab" id="aba-${f.id}" class="aba" aria-controls="painel-${f.id}" aria-selected="${f.id === estado.aba}" tabindex="${f.id === estado.aba ? 0 : -1}" data-aba="${f.id}">
      ${ICONE_ABA(f.icone)}<span>${esc(f.titulo)}</span>
    </button>`).join('');
  $$('[data-aba]').forEach((b) => {
    b.addEventListener('click', () => trocarAba(b.dataset.aba));
    b.addEventListener('keydown', (e) => {
      const i = FERRAMENTAS.findIndex((f) => f.id === b.dataset.aba);
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const prox = FERRAMENTAS[(i + d + FERRAMENTAS.length) % FERRAMENTAS.length].id;
      trocarAba(prox);
      $(`#aba-${prox}`).focus();
    });
  });
}

function trocarAba(id) {
  estado.aba = id;
  armazenamento.gravar('fatura.aba', id);
  $$('[data-aba]').forEach((b) => {
    const ativo = b.dataset.aba === id;
    b.setAttribute('aria-selected', String(ativo));
    b.tabIndex = ativo ? 0 : -1;
  });
  $$('[role="tabpanel"]').forEach((p) => {
    p.hidden = p.id !== `painel-${id}`;
  });
}

function htmlEntrada(slot) {
  return `<div class="rounded-lg border border-dashed border-linha-forte bg-fundo/70 p-4 transition-colors" data-slot="${slot.id}">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-lg border border-linha bg-white text-turquesa">${ICONES.arquivo}</span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-tinta">${esc(slot.rotulo)}</p>
        <p class="truncate text-[13px] text-suave" data-status></p>
      </div>
      <span class="etiqueta" data-etiqueta></span>
      <div class="flex items-center gap-1">
        <button type="button" class="btn-sutil" data-limpar hidden>Remover</button>
        <label class="btn-secundario cursor-pointer">
          <span data-rotulo-botao>Selecionar arquivo</span>
          <input type="file" class="sr-only" ${slot.aceita ? `accept="${esc(slot.aceita)}"` : ''} data-input aria-label="${esc(slot.rotulo)}" />
        </label>
      </div>
    </div>
  </div>`;
}

function htmlBase(slot) {
  return `<li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5" data-slot="${slot.id}">
    <div class="min-w-0 flex-1 basis-56">
      <p class="text-sm font-semibold text-tinta">${esc(slot.rotulo)}</p>
      <p class="truncate text-[13px] text-suave" data-status></p>
    </div>
    <span class="etiqueta" data-etiqueta></span>
  </li>`;
}

const passo = (n, titulo, sub = '') => `
  <div class="mb-4 flex items-start gap-3">
    <span class="passo mt-0.5">${n}</span>
    <div><h2 class="text-[17px] leading-snug">${esc(titulo)}</h2>${sub ? `<p class="mt-0.5 text-[13px] text-suave">${esc(sub)}</p>` : ''}</div>
  </div>`;

function montarPaineis() {
  $('#paineis').innerHTML = FERRAMENTAS.map((f) => {
    let n = 0;
    return `
    <section role="tabpanel" id="painel-${f.id}" aria-labelledby="aba-${f.id}" ${f.id === estado.aba ? '' : 'hidden'} data-ferramenta="${f.id}">
      <div class="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div class="max-w-3xl">
          <h1 class="text-[30px] leading-tight sm:text-[34px]">${esc(f.titulo)}</h1>
          <p class="mt-2 text-suave">${esc(f.descricao)}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <span class="etiqueta etiqueta-neutra">${esc(f.versao)}</span>
          <span class="etiqueta etiqueta-ok">${ICONES.cadeado} Processamento local</span>
        </div>
      </div>

      <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div class="cartao overflow-hidden">
          <div class="p-6 sm:p-8">
            ${passo(++n, f.entradas.length > 1 ? 'Arquivos para análise' : 'Arquivo para análise', f.entradas.map((s) => s.ajuda).join(' · '))}
            <div class="space-y-3">${f.entradas.map(htmlEntrada).join('')}</div>
          </div>
          <div class="border-t border-linha p-6 sm:p-8">
            ${passo(++n, f.id === 'checa' ? f.tituloBases : 'Bases de conferência', f.id === 'checa' ? 'Bases padrão embutidas no sistema.' : 'Embutidas no sistema e escolhidas automaticamente. Não é preciso selecionar nada.')}
            <ul class="divide-y divide-linha rounded-lg border border-linha bg-white px-4">${f.bases.map(htmlBase).join('')}
              ${f.sigtap ? `<li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                <div class="min-w-0 flex-1 basis-56">
                  <p class="text-sm font-semibold text-tinta">SIGTAP</p>
                  <p class="text-[13px] text-suave" data-sigtap-info>Mesma competência do arquivo ou a anterior mais próxima.</p>
                </div>
                <span class="etiqueta etiqueta-servidor">Automática</span>
              </li>` : ''}
            </ul>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-linha bg-fundo/70 px-6 py-4 sm:px-8">
            <button type="button" class="btn-primario h-10 px-6" data-processar>${ICONES.play} Processar</button>
            <span class="text-[13px] text-suave" data-pendencias></span>
            <div class="ml-auto flex flex-wrap items-center gap-1" data-demo hidden>
              <span class="mr-1 text-[13px] text-apagado">Exemplos:</span>
              <span class="contents" data-demo-botoes></span>
            </div>
          </div>
        </div>

        <aside class="cartao flex flex-col p-6 lg:sticky lg:top-32">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-[17px]">Andamento</h2>
            <span class="etiqueta etiqueta-neutra" data-estado>Aguardando</span>
          </div>
          <ol class="mt-4 max-h-[24rem] min-h-24 space-y-1.5 overflow-auto text-[13px] leading-snug text-suave" data-log aria-live="polite">
            <li>Selecione os arquivos e clique em Processar.</li>
          </ol>
          <details class="mt-5 border-t border-linha pt-4 text-sm" data-historico>
            <summary class="cursor-pointer font-semibold text-azul">Histórico neste navegador</summary>
            <div class="mt-3 space-y-2 text-[13px] text-suave" data-historico-lista></div>
          </details>
        </aside>
      </div>
      <div class="mt-10" data-resultado aria-live="polite"></div>
    </section>`;
  }).join('');

  for (const f of FERRAMENTAS) {
    const painel = $(`#painel-${f.id}`);
    for (const slot of f.entradas) {
      const el = painel.querySelector(`[data-slot="${slot.id}"]`);
      el.querySelector('[data-input]').addEventListener('change', (e) => {
        const arq = e.target.files[0];
        e.target.value = '';
        if (arq) definirArquivo(f.id, slot.id, arq);
      });
      el.querySelector('[data-limpar]').addEventListener('click', () => definirArquivo(f.id, slot.id, null));
      habilitarSoltar(el, (arq) => definirArquivo(f.id, slot.id, arq));
    }
    painel.querySelector('[data-processar]').addEventListener('click', () => processar(f.id));
  }
}

function habilitarSoltar(el, aoSoltar) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('soltar-aqui');
  });
  el.addEventListener('dragleave', () => el.classList.remove('soltar-aqui'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('soltar-aqui');
    const arq = e.dataTransfer.files[0];
    if (arq) aoSoltar(arq);
  });
}

function definirArquivo(fid, slotId, arquivo) {
  estado.ferramentas[fid].arquivos[slotId] = arquivo;
  atualizarSlots(fid);
}

function atualizarSlots(fid) {
  const f = porId(fid);
  const painel = $(`#painel-${fid}`);
  const st = estado.ferramentas[fid];
  for (const slot of [...f.entradas, ...f.bases]) {
    const el = painel.querySelector(`[data-slot="${slot.id}"]`);
    const arq = st.arquivos[slot.id];
    const ehBase = f.bases.includes(slot);
    const servidor = ehBase ? baseServidor(fid, slot.id) : null;
    const etiqueta = el.querySelector('[data-etiqueta]');
    const status = el.querySelector('[data-status]');
    let texto;
    let classe;
    let rotulo;
    if (arq) {
      classe = 'etiqueta-ok';
      rotulo = 'Enviado';
      let extra = '';
      if (fid === 'hospitalar' && slot.id === 'entrada') extra = /\.pdf$/i.test(arq.name) ? ' · PDF do espelho' : ' · TXT SISAIH01';
      texto = `${arq.name} · ${tamanho(arq.size)}${extra}`;
    } else if (servidor) {
      classe = 'etiqueta-servidor';
      rotulo = 'Embutida';
      texto = servidor.nome;
    } else if (!ehBase) {
      classe = 'etiqueta-pendente';
      rotulo = 'Pendente';
      texto = 'Arraste o arquivo para cá ou clique em Selecionar arquivo.';
    } else if (fid !== 'checa' && !estado.unidade) {
      classe = 'etiqueta-neutra';
      rotulo = 'Aguardando unidade';
      texto = 'Selecione a unidade no topo da tela.';
    } else {
      classe = 'etiqueta-pendente';
      rotulo = 'Indisponível';
      texto = fid === 'checa' ? 'Base padrão não encontrada no sistema.' : `Ainda não há esta planilha de ${estado.unidade} no sistema. Fale com o administrador.`;
    }
    etiqueta.className = `etiqueta ${classe}`;
    etiqueta.textContent = rotulo;
    status.textContent = texto;
    status.title = texto;
    if (!ehBase) {
      el.querySelector('[data-limpar]').hidden = !arq;
      el.querySelector('[data-rotulo-botao]').textContent = arq ? 'Trocar arquivo' : 'Selecionar arquivo';
    }
  }
  atualizarPendencias(fid);
}

function pendencias(fid) {
  const f = porId(fid);
  const st = estado.ferramentas[fid];
  const p = [];
  if (!estado.unidade) p.push('a unidade');
  for (const s of f.entradas) if (!st.arquivos[s.id]) p.push(s.rotulo.toLowerCase());
  if (estado.unidade || fid === 'checa') for (const s of f.bases) if (!baseServidor(fid, s.id)) p.push(`${s.rotulo} (indisponível)`);
  return p;
}

function atualizarPendencias(fid) {
  const painel = $(`#painel-${fid}`);
  const p = pendencias(fid);
  const st = estado.ferramentas[fid];
  painel.querySelector('[data-processar]').disabled = p.length > 0 || st.ocupado;
  let texto = 'Pronto para processar';
  if (st.ocupado) texto = 'Processando…';
  else if (!estado.unidade) texto = 'Selecione a unidade no topo da tela';
  else if (p.length === 1) texto = `Falta: ${p[0]}`;
  else if (p.length) texto = `Faltam ${p.length} itens`;
  const el = painel.querySelector('[data-pendencias]');
  el.textContent = texto;
  el.title = p.length ? `Falta: ${p.join(', ')}` : '';
}

function definirEstado(fid, texto, classe) {
  const e = $(`#painel-${fid} [data-estado]`);
  e.className = `etiqueta ${classe}`;
  e.innerHTML = texto;
}

// ---------------------------------------------------------------------------
// SIGTAP
// ---------------------------------------------------------------------------
async function carregarSigtap() {
  try {
    estado.sigtap = (await chamar('sigtap-listar')).filter((b) => b.origem === 'embutida');
  } catch {
    estado.sigtap = [];
  }
  for (const f of FERRAMENTAS.filter((x) => x.sigtap)) {
    const info = $(`#painel-${f.id} [data-sigtap-info]`);
    if (!info) continue;
    const comps = [...new Set(estado.sigtap.filter((b) => b.usos.includes(f.id)).map((b) => b.competencia))].sort();
    info.textContent = comps.length
      ? `Mesma competência do arquivo ou a anterior mais próxima. Disponíveis: ${comps.map(competencia).join(', ')}.`
      : 'Nenhuma base SIGTAP embutida no sistema. Fale com o administrador.';
  }
}

// ---------------------------------------------------------------------------
// Processamento
// ---------------------------------------------------------------------------
let pdfjs = null;
async function textoDoPdf(arquivo) {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  return extrairEspelhoPdf(pdfjs, await arquivo.arrayBuffer());
}

async function slotParaEnvio(fid, slotId, transferir) {
  const arq = estado.ferramentas[fid].arquivos[slotId];
  if (arq) {
    const bytes = await arq.arrayBuffer();
    transferir.push(bytes);
    return { nome: arq.name, bytes };
  }
  const s = baseServidor(fid, slotId);
  return s ? { nome: s.nome, servidor: s.caminho } : null;
}

async function processar(fid) {
  const f = porId(fid);
  const st = estado.ferramentas[fid];
  const painel = $(`#painel-${fid}`);
  const log = painel.querySelector('[data-log]');
  const botao = painel.querySelector('[data-processar]');
  if (pendencias(fid).length || st.ocupado) return;
  st.ocupado = true;
  botao.innerHTML = `${ICONES.girar} Processando…`;
  definirEstado(fid, `${ICONES.girar} Processando`, 'etiqueta-servidor');
  atualizarPendencias(fid);
  log.innerHTML = '';
  const escrever = (msg, classe = '') => {
    const li = document.createElement('li');
    li.className = `whitespace-pre-wrap ${classe}`;
    li.textContent = msg.trim();
    log.append(li);
    while (log.children.length > 400) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  };
  const inicio = performance.now();
  try {
    const transferir = [];
    const payload = { unidade: estado.unidade };
    let nomeEntrada;
    if (fid === 'checa') {
      for (const s of ['tasy', 'cnes', 'adc', 'cbo']) payload[s] = await slotParaEnvio(fid, s, transferir);
      nomeEntrada = `${payload.tasy.nome} × ${payload.cnes.nome}`;
    } else {
      const arq = st.arquivos.entrada;
      nomeEntrada = arq.name;
      if (fid === 'hospitalar' && /\.pdf$/i.test(arq.name)) {
        escrever('Extraindo o texto do espelho em PDF (neste computador)…');
        payload.entrada = { formato: 'pdf', nome: arq.name, espelho: await textoDoPdf(arq) };
      } else {
        const bytes = await arq.arrayBuffer();
        transferir.push(bytes);
        payload.entrada = { formato: 'txt', nome: arq.name, bytes };
      }
      payload.bases = {};
      for (const s of f.bases) payload.bases[s.id] = await slotParaEnvio(fid, s.id, transferir);
    }
    const r = await chamar('processar', { ferramenta: fid, payload }, (m) => escrever(m, /AVISO/.test(m) ? 'font-semibold text-aviso' : /^\s/.test(m) ? 'pl-3' : 'text-tinta'), transferir);
    const tempo = ((performance.now() - inicio) / 1000).toFixed(1).replace('.', ',');
    escrever(`Análise concluída em ${tempo} s.`, 'font-semibold text-ok');
    definirEstado(fid, 'Concluído', 'etiqueta-ok');
    await renderizarResultado(painel.querySelector('[data-resultado]'), r, nomeEntrada);
    registrarHistorico(fid, r, nomeEntrada);
    if (await apiDisponivel()) {
      const arquivos = fid === 'checa' ? [st.arquivos.tasy, st.arquivos.cnes] : [st.arquivos.entrada];
      sha256DeArquivos(arquivos)
        .then((sha) => oferecerEnvio(painel.querySelector('[data-resultado]'), r, { arquivoNome: nomeEntrada, arquivoSha256: sha, versaoRegras: f.versao || '' }))
        .catch((e) => escrever(`Painel gerencial: ${e.message}`, 'text-aviso'));
    }
    painel.querySelector('[data-resultado]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    escrever(`${e.codigo ? `${e.codigo}: ` : ''}${e.message}`, 'font-semibold text-alerta');
    definirEstado(fid, 'Interrompido', 'etiqueta-pendente');
    painel.querySelector('[data-resultado]').innerHTML = `<div class="flex gap-3 rounded-lg border border-alerta/20 bg-alerta-50 p-5 text-sm" role="alert">
      <span class="mt-0.5 text-lg leading-none text-alerta" aria-hidden="true">⚠</span>
      <div><p class="font-semibold text-alerta">${e.codigo === 'E002' ? 'Tasy e CNES de unidades diferentes' : 'Não foi possível concluir a análise'}</p>
      <p class="mt-1 whitespace-pre-wrap text-tinta">${esc(e.message)}</p></div></div>`;
    toast('A análise foi interrompida. Veja o motivo no painel.', 'erro');
  } finally {
    st.ocupado = false;
    botao.innerHTML = `${ICONES.play} Processar`;
    atualizarPendencias(fid);
  }
}

// ---------------------------------------------------------------------------
// Historico (so metadados, nunca dados de pacientes)
// ---------------------------------------------------------------------------
function registrarHistorico(fid, r, nomeEntrada) {
  const k = r.resumo.kpis;
  const resumo = fid === 'hospitalar' ? `${k[0].valor} AIHs, ${k[7].valor} com alerta` : fid === 'ambulatorial' ? `${k[0].valor} linhas, ${k[6].valor} com alerta` : `${k[2].valor} pessoas nas duas fontes, ${k[3].valor} sem alerta`;
  const lista = [{ fid, unidade: r.unidade, competencia: r.competencia || '', arquivo: nomeEntrada, quando: new Date().toISOString(), resumo }, ...historico()].slice(0, 30);
  armazenamento.gravar('fatura.historico.v1', lista);
  montarHistorico();
}

function montarHistorico() {
  const h = historico();
  for (const f of FERRAMENTAS) {
    const alvo = $(`#painel-${f.id} [data-historico-lista]`);
    const itens = h.filter((x) => x.fid === f.id).slice(0, 10);
    alvo.innerHTML = itens.length
      ? itens.map((x) => `<div class="rounded-md border border-linha bg-fundo/60 px-3 py-2">
          <p class="font-semibold text-tinta">${esc(x.unidade)}${x.competencia ? ` · ${esc(competencia(x.competencia))}` : ''} <span class="font-normal text-apagado">· ${esc(new Date(x.quando).toLocaleString('pt-BR'))}</span></p>
          <p class="truncate" title="${esc(x.arquivo)}">${esc(x.arquivo)}</p><p>${esc(x.resumo)}</p></div>`).join('') +
        '<button type="button" class="btn-sutil" data-limpar-historico>Limpar histórico</button>'
      : '<p>Nenhum processamento registrado. O histórico guarda só o nome do arquivo e os totais.</p>';
    alvo.querySelector('[data-limpar-historico]')?.addEventListener('click', () => {
      armazenamento.gravar('fatura.historico.v1', historico().filter((x) => x.fid !== f.id));
      montarHistorico();
    });
  }
}

// ---------------------------------------------------------------------------
// Modo demonstracao (Netlify)
// ---------------------------------------------------------------------------
const ROTULO_DEMO = {
  entrada_txt: 'TXT SISAIH01', entrada_pdf: 'PDF do espelho', entrada: 'BPA', entrada_alternativa: 'BPA com cabeçalho errado',
  tasy: 'Tasy + CNES', cnes_alternativo: 'CNES de outra unidade',
};

async function montarDemo() {
  if (!DEMO) return;
  try {
    const r = await fetch('/exemplos/exemplos.json', { cache: 'no-cache' });
    if (!r.ok) return;
    estado.exemplos = await r.json();
  } catch {
    return;
  }
  for (const f of FERRAMENTAS) {
    const itens = (estado.exemplos[f.id] || []).filter((x) => ROTULO_DEMO[x.papel]);
    if (!itens.length) continue;
    const painel = $(`#painel-${f.id}`);
    painel.querySelector('[data-demo]').hidden = false;
    painel.querySelector('[data-demo-botoes]').innerHTML = itens.map((x) => `<button type="button" class="btn-sutil" data-exemplo="${esc(x.papel)}">${esc(ROTULO_DEMO[x.papel])}</button>`).join('');
    painel.querySelectorAll('[data-exemplo]').forEach((b) => b.addEventListener('click', () => usarExemplo(f.id, b.dataset.exemplo)));
  }
}

async function arquivoDoSite(item) {
  const r = await fetch(`/${item.caminho.split('/').map(encodeURIComponent).join('/')}`);
  if (!r.ok) throw new Error(`Exemplo indisponível: ${item.nome}`);
  return new File([await r.blob()], item.nome);
}

async function usarExemplo(fid, papel) {
  const itens = estado.exemplos[fid];
  const escolhido = itens.find((x) => x.papel === papel);
  try {
    if (estado.unidade !== escolhido.unidade) {
      trocarUnidade(escolhido.unidade);
      toast(`Unidade alterada para ${escolhido.unidade} (exemplo).`);
    }
    if (fid === 'checa') {
      const tasy = itens.find((x) => x.papel === 'tasy');
      const cnes = itens.find((x) => x.papel === (papel === 'cnes_alternativo' ? 'cnes_alternativo' : 'cnes'));
      definirArquivo(fid, 'tasy', await arquivoDoSite(tasy));
      definirArquivo(fid, 'cnes', await arquivoDoSite(cnes));
    } else {
      definirArquivo(fid, 'entrada', await arquivoDoSite(escolhido));
    }
  } catch (e) {
    toast(e.message, 'erro');
  }
}

// ---------------------------------------------------------------------------
// Area do gestor (prototipo): alterna entre as ferramentas e o painel
// ---------------------------------------------------------------------------
function mostrarGestor(ativo) {
  $('#conteudo').hidden = ativo;
  $('#nav-ferramentas').hidden = ativo;
  $('#seletor-unidade').classList.toggle('invisible', ativo);
  $('#area-gestor').hidden = !ativo;
  $('[data-rotulo-gestor]').textContent = ativo ? 'Voltar às ferramentas' : 'Área do gestor';
  if (ativo) {
    if (location.hash !== '#gestor') history.replaceState(null, '', '#gestor');
    renderizarPainel($('#area-gestor'), () => mostrarGestor(false));
  } else if (location.hash === '#gestor') {
    history.replaceState(null, '', location.pathname);
  }
  scrollTo(0, 0);
}

function ligarGestor() {
  $('#botao-gestor').addEventListener('click', async () => {
    if (!$('#area-gestor').hidden) mostrarGestor(false);
    else if (await logado()) mostrarGestor(true);
    else abrirLogin(() => mostrarGestor(true));
  });
  if (location.hash === '#gestor') logado().then((u) => u && mostrarGestor(true));
}

// ---------------------------------------------------------------------------
// Envio do resumo ao painel gerencial (so com a API da VM; so totais)
// ---------------------------------------------------------------------------
async function oferecerEnvio(alvo, r, extra) {
  if (!(await apiDisponivel())) return;
  let resumo;
  try {
    resumo = montarResumoGestao(r, extra);
  } catch {
    return;
  }
  const cartao = document.createElement('section');
  cartao.className = 'cartao flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5';
  cartao.innerHTML = `<div class="min-w-0 flex-1 basis-72">
      <p class="display text-[15px] font-bold text-azul">Painel gerencial</p>
      <p class="mt-0.5 text-[13px] text-suave" data-envio-status>Envie os totais desta análise (${esc(resumo.sigla)} · ${esc(competencia(resumo.competencia))}) para o acompanhamento da gestão. Vão só indicadores, tipos de alerta e procedimentos mais realizados, sem nenhum dado de paciente ou profissional.</p>
    </div>
    <button type="button" class="btn-primario" data-enviar>Enviar ao painel gerencial</button>`;
  alvo.firstElementChild ? alvo.firstElementChild.after(cartao) : alvo.prepend(cartao);
  const botao = cartao.querySelector('[data-enviar]');
  const status = cartao.querySelector('[data-envio-status]');
  const enviar = async () => {
    botao.disabled = true;
    botao.innerHTML = `${ICONES.girar} Enviando…`;
    try {
      const res = await api.enviar(resumo);
      status.textContent = res.duplicado ? 'Este arquivo já tinha sido enviado; nada mudou no painel.' : `Enviado em ${new Date().toLocaleString('pt-BR')}. Este passa a ser o resultado vigente de ${resumo.sigla} em ${competencia(resumo.competencia)}.`;
      botao.textContent = 'Enviado';
      toast('Resumo enviado ao painel gerencial.', 'ok');
    } catch (e) {
      if (e.status === 401) {
        botao.disabled = false;
        botao.textContent = 'Enviar ao painel gerencial';
        abrirLogin(enviar, 'Entre para enviar os totais desta análise ao painel gerencial.');
        return;
      }
      botao.disabled = false;
      botao.textContent = 'Tentar de novo';
      status.textContent = e.message;
      toast(e.message, 'erro');
    }
  };
  botao.addEventListener('click', enviar);
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
function trocarUnidade(sigla) {
  estado.unidade = sigla;
  $('#unidade').value = sigla;
  armazenamento.gravar('fatura.unidade', sigla);
  for (const f of FERRAMENTAS) {
    for (const b of f.bases) if (f.id !== 'checa') estado.ferramentas[f.id].arquivos[b.id] = null;
    atualizarSlots(f.id);
  }
}

async function iniciar() {
  $('#versao').textContent = `${typeof __VERSAO__ !== 'undefined' ? __VERSAO__ : ''}`;
  montarAbas();
  montarPaineis();
  ligarGestor();
  try {
    estado.manifesto = await chamar('manifesto');
  } catch {
    /* sem bases no servidor */
  }
  montarUnidades();
  $('#unidade').addEventListener('change', (e) => trocarUnidade(e.target.value));
  for (const f of FERRAMENTAS) atualizarSlots(f.id);
  montarHistorico();
  await Promise.all([carregarSigtap(), montarDemo(), montarMarcas()]);
}

iniciar();
