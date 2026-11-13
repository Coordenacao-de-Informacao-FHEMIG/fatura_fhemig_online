// Página inicial: o que é o Fatura Fhemig, as três conferências e como usar.
import { FERRAMENTAS } from './ferramentas.js';
import { esc } from './util.js';

const CONTEUDO = {
  hospitalar: {
    le: 'TXT do SISAIH01 ou PDF do espelho da AIH',
    confere: 'Compatibilidade com o SIGTAP (CBO, idade, sexo, quantidade), habilitação, serviço/classificação, permanência a maior e reinternações em menos de 72 horas.',
    entrega: 'Alertas por AIH, indicadores e Excel consolidado com gráficos.',
  },
  ambulatorial: {
    le: 'TXT de produção BPA (individualizado e consolidado)',
    confere: 'Procedimento no SIGTAP, profissional e CBO, carga horária, habilitação, serviço/classificação e CPF obrigatório (regras R01 a R11).',
    entrega: 'Alertas por linha de atendimento, produção por data e Excel consolidado.',
  },
  checa: {
    le: 'Planilhas de profissionais do Tasy e do CNES',
    confere: 'Quem está em uma base e não na outra, CBOs divergentes e cadastros incompletos ou sem identificação.',
    entrega: 'Pendências por severidade e Excel com o cruzamento completo.',
  },
};

const PASSOS = [
  ['Escolha a unidade', 'No topo da tela. As planilhas de serviço/classificação, habilitação e profissionais da unidade já vêm carregadas.'],
  ['Envie o arquivo de produção', 'Arraste o TXT, o PDF ou as planilhas para a ferramenta. Não é preciso escolher o SIGTAP: ele é selecionado pela competência do arquivo.'],
  ['Clique em Processar', 'A análise roda neste computador, em poucos segundos, e mostra os indicadores e os alertas na tela.'],
  ['Corrija e baixe o Excel', 'Revise os alertas antes do envio ao SUS e baixe o consolidado. Se a unidade usa o painel gerencial, envie os totais para a gestão.'],
];

const seta = '<svg viewBox="0 0 20 20" fill="currentColor" class="size-4" aria-hidden="true"><path fill-rule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.64l-4.2-3.96a.75.75 0 1 1 1.02-1.1l5.5 5.25a.75.75 0 0 1 0 1.1l-5.5 5.25a.75.75 0 1 1-1.02-1.1l4.2-3.96H3.75A.75.75 0 0 1 3 10Z" clip-rule="evenodd"/></svg>';
const check = '<svg viewBox="0 0 20 20" fill="currentColor" class="size-4 shrink-0 text-turquesa-claro" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z" clip-rule="evenodd"/></svg>';
const cadeado = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-6" aria-hidden="true"><rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
const grafico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-6" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';

/** opcoes: { abrirFerramenta(id), abrirGestor() } */
export function montarInicio(alvo, { abrirFerramenta, abrirGestor }) {
  alvo.innerHTML = `
    <div class="relative isolate overflow-hidden bg-azul-900">
      <img src="/fotos/centro-cirurgico.webp" alt="" width="1124" height="633" fetchpriority="high"
        class="absolute inset-0 -z-20 size-full object-cover object-[65%_center] opacity-45 mix-blend-luminosity" />
      <div class="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgb(0_47_71/0.97)_0%,rgb(0_72_108/0.9)_38%,rgb(0_146_195/0.62)_75%,rgb(0_175_210/0.45)_100%)]" aria-hidden="true"></div>
      <div class="mx-auto max-w-7xl px-4 pt-16 pb-20 sm:px-8 sm:pt-24 sm:pb-28 lg:pt-28 lg:pb-32">
        <p class="text-[13px] font-semibold tracking-[0.14em] text-turquesa-claro uppercase">FHEMIG · Faturamento SUS</p>
        <h1 class="mt-4 max-w-3xl text-[40px] leading-[1.04] !text-white sm:text-[60px]">Fatura Fhemig</h1>
        <p class="mt-6 max-w-2xl text-[17px] leading-relaxed text-white/85 sm:text-lg">
          Confira a produção hospitalar, a ambulatorial e o cadastro de profissionais <strong class="font-semibold text-white">antes do envio ao SUS</strong>.
          O sistema aponta o que pode virar glosa, conta por conta, e entrega o consolidado em Excel.
        </p>
        <div class="mt-9 flex flex-wrap gap-3">
          <button type="button" class="btn h-11 bg-white px-6 text-[15px] text-azul shadow-lg shadow-azul-900/30 hover:bg-turquesa-50" data-comecar>Começar análise ${seta}</button>
          <a href="#como-usar" class="btn h-11 border border-white/40 px-6 text-[15px] text-white hover:bg-white/10">Como funciona</a>
        </div>
        <ul class="mt-12 flex flex-col gap-3 text-sm text-white/85 sm:flex-row sm:flex-wrap sm:gap-x-8">
          <li class="flex items-center gap-2">${check}Sem instalar nada</li>
          <li class="flex items-center gap-2">${check}Os arquivos não saem do seu computador</li>
          <li class="flex items-center gap-2">${check}SIGTAP e planilhas da unidade automáticos</li>
        </ul>
      </div>
    </div>

    <div class="mx-auto max-w-7xl px-4 sm:px-8">
      <section class="py-16 sm:py-20" aria-labelledby="inicio-ferramentas">
        <div class="max-w-2xl">
          <h2 id="inicio-ferramentas" class="text-[26px] leading-tight sm:text-[30px]">Três conferências em um só lugar</h2>
          <p class="mt-3 text-suave">As mesmas regras do Fatura Hospitalar 14.3, do Fatura Ambulatorial 1.0 e do ChecaProfissionais 2.0, agora no navegador.</p>
        </div>
        <div class="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3">
          ${FERRAMENTAS.map((f) => {
            const c = CONTEUDO[f.id];
            return `<article class="cartao flex flex-col p-6">
              <div class="flex items-center gap-3">
                <span class="grid size-11 place-items-center rounded-lg bg-turquesa-50 text-turquesa-700">${f.icone}</span>
                <h3 class="text-[19px]">${esc(f.titulo)}</h3>
              </div>
              <dl class="mt-5 flex-1 space-y-3 text-sm">
                <div><dt class="font-semibold text-tinta">Lê</dt><dd class="text-suave">${esc(c.le)}</dd></div>
                <div><dt class="font-semibold text-tinta">Confere</dt><dd class="text-suave">${esc(c.confere)}</dd></div>
                <div><dt class="font-semibold text-tinta">Entrega</dt><dd class="text-suave">${esc(c.entrega)}</dd></div>
              </dl>
              <button type="button" class="btn-secundario mt-6 self-start" data-abrir="${esc(f.id)}">Abrir ${esc(f.titulo)} ${seta}</button>
            </article>`;
          }).join('')}
        </div>
      </section>

      <section id="como-usar" class="scroll-mt-24 border-t border-linha py-16 sm:py-20" aria-labelledby="inicio-como">
        <div class="max-w-2xl">
          <h2 id="inicio-como" class="text-[26px] leading-tight sm:text-[30px]">Como usar</h2>
          <p class="mt-3 text-suave">Do arquivo de produção ao consolidado, em quatro passos.</p>
        </div>
        <ol class="mt-10 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          ${PASSOS.map(([titulo, texto], i) => `<li>
            <span class="display grid size-10 place-items-center rounded-full bg-azul text-[16px] font-bold !text-white" aria-hidden="true">${i + 1}</span>
            <h3 class="mt-4 text-[17px]">${esc(titulo)}</h3>
            <p class="mt-2 text-sm text-suave">${esc(texto)}</p>
          </li>`).join('')}
        </ol>
      </section>

      <section class="grid grid-cols-1 gap-5 border-t border-linha py-16 sm:py-20 lg:grid-cols-2" aria-label="Privacidade e acompanhamento">
        <div class="cartao flex gap-4 p-6">
          <span class="grid size-11 shrink-0 place-items-center rounded-lg bg-ok-50 text-ok">${cadeado}</span>
          <div>
            <h3 class="text-[17px]">Os dados dos pacientes ficam com você</h3>
            <p class="mt-2 text-sm text-suave">A análise acontece neste computador. Nenhum arquivo de produção é enviado pela internet, e o histórico guarda só o nome do arquivo e os totais.</p>
          </div>
        </div>
        <div class="cartao flex gap-4 p-6">
          <span class="grid size-11 shrink-0 place-items-center rounded-lg bg-turquesa-50 text-turquesa-700">${grafico}</span>
          <div>
            <h3 class="text-[17px]">Acompanhamento da gestão</h3>
            <p class="mt-2 text-sm text-suave">Na Área do gestor, a gestão acompanha a produção e a qualidade do faturamento das unidades mês a mês, com alarmes do que precisa de atenção.</p>
            <button type="button" class="btn-sutil mt-3 -ml-2 text-turquesa-700" data-gestor>Abrir a Área do gestor ${seta}</button>
          </div>
        </div>
      </section>
    </div>`;

  alvo.querySelector('[data-comecar]').addEventListener('click', () => abrirFerramenta());
  alvo.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => abrirFerramenta(b.dataset.abrir)));
  alvo.querySelector('[data-gestor]').addEventListener('click', abrirGestor);
  alvo.querySelector('a[href="#como-usar"]').addEventListener('click', (e) => {
    e.preventDefault();
    alvo.querySelector('#como-usar').scrollIntoView({ behavior: 'smooth' });
  });
}
