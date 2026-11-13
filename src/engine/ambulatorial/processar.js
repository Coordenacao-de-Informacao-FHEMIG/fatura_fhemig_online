// Fatura Fhemig Ambulatorial 1.0 — orquestracao (backend.process_arquivo) e
// saidas (core/relatorio.py): Excel com Relatorio, Alertas, Producao e
// Parametros, CSV dos alertas e log.
import layoutBpa from './config/layout_bpa.json' with { type: 'json' };
import mapeamento from './config/mapeamento_colunas.json' with { type: 'json' };
import configAlertas from './config/alertas.json' with { type: 'json' };
import {
  carregarLayout, lerProducao, conferirCabecalho, competenciaProducao, cnesProducao, identificarUnidade,
  lerProfissionais, lerCargaHoraria, lerServicos, lerHabilitacoes, habilitacoesVigentes, aplicarRegras,
} from './motor.js';
import { normText, pyRound, maisComuns, fmtDataHora, fmtHora, carimbo } from '../comum/texto.js';
import { novaPasta, gravar, injetarGraficos, preenchimento, cor, letra, linkInterno, gerarCsv } from '../comum/xlsx.js';
import { UNIDADES } from '../unidades.js';

export const APP_VERSION = 'Fatura Fhemig Ambulatorial 1.0 (versão online)';
export { mapeamento };

export const COLS_ALERTAS = [
  'Tipo de alerta', 'Código do alerta', 'Linha TXT', 'Tipo registro (I/C)', 'Competência', 'CNES', 'Data atendimento',
  'CNS paciente', 'Nome paciente', 'CPF paciente', 'Código do procedimento', 'Nome do procedimento', 'Quantidade',
  'CNS profissional', 'Nome profissional', 'CBO', 'Serviço/Classificação', 'Detalhe',
];
export const COLS_PRODUCAO = [
  'Linha TXT', 'Tipo registro (I/C)', 'Competência', 'CNES', 'Folha', 'Sequência', 'Data atendimento', 'CNS profissional',
  'Nome profissional', 'CBO', 'Código do procedimento', 'Nome do procedimento', 'Quantidade', 'CNS paciente', 'Nome paciente',
  'CPF paciente', 'Sexo', 'Idade', 'Caráter atendimento', 'Serviço/Classificação', 'Exige habilitação?',
  'Exige serviço/classificação?', 'Exige CPF (atributo 058)?', 'Status', 'Qtd. alertas', 'Códigos dos alertas',
];
const LARGURAS = {
  'Tipo de alerta': 40, 'Código do alerta': 30, 'Linha TXT': 10, 'Tipo registro (I/C)': 11, Competência: 12, CNES: 10,
  'Data atendimento': 14, 'CNS paciente': 18, 'Nome paciente': 32, 'CPF paciente': 14, 'Código do procedimento': 15,
  'Nome do procedimento': 46, Quantidade: 11, 'CNS profissional': 18, 'Nome profissional': 32, CBO: 9,
  'Serviço/Classificação': 14, Detalhe: 80, Folha: 7, Sequência: 10, Sexo: 6, Idade: 7, 'Caráter atendimento': 11,
  'Exige habilitação?': 13, 'Exige serviço/classificação?': 15, 'Exige CPF (atributo 058)?': 14, Status: 10,
  'Qtd. alertas': 9, 'Códigos dos alertas': 60,
};
const L = {
  kpiRows: [4, 7], kpiCols: [1, 4, 7, 10], avisos: { rotulo: 1, ini: 11 },
  alertas: { rotulo: 14, valor: 15, procs: 16, codigo: 17, ini: 3 },
  producao: { rotulo: 20, valor: 21, procs: 22, ini: 3 },
  top: { rotulo: 24, valor: 25, ini: 3 },
  tipo: { rotulo: 27, valor: 28, procs: 29, ini: 3 },
};
export const KPI_ROTULOS = [
  'Linhas de atendimento', 'Linhas BPA-I', 'Linhas BPA-C', 'Procedimentos (soma das quantidades)', 'Procedimentos distintos',
  'Profissionais distintos', 'Linhas com alerta', '% de linhas com alerta',
];
const COR_TITULO = '008EA7';
const COR_CABECALHO = '00697A';
const COR_SUAVE = '5B6B7B';
const COR_ALERTA = 'C0392B';
const COR_AVISO = 'FFF4CE';
const CADASTROS = ['profissionais', 'carga_horaria', 'servico_classificacao', 'habilitacao'];
const DESCRICAO_CADASTRO = { profissionais: 'Profissionais', carga_horaria: 'Carga horária', servico_classificacao: 'Serviço/Classificação', habilitacao: 'Habilitação' };

const compBr = (a) => (a && /^\d{6}$/.test(a) ? `${a.slice(4)}/${a.slice(0, 4)}` : a || '');
const simNao = (v) => (v === null || v === undefined ? '' : v ? 'SIM' : 'NÃO');

export function linhaBase(reg, nomesProc, nomesProf) {
  const tipo = reg.tipo;
  const proc = reg.procedimento || '';
  const cnsProf = reg.cns_profissional || '';
  const s = reg.servico || '';
  const c = reg.classificacao || '';
  return {
    'Linha TXT': reg.linha_txt,
    'Tipo registro (I/C)': tipo === 'I' || tipo === 'C' ? tipo : 'Inválida',
    Competência: compBr(reg.competencia),
    CNES: reg.cnes || '',
    Folha: reg.folha || '',
    Sequência: reg.sequencia || '',
    'Data atendimento': reg.data_atendimento ? reg.data_atendimento.br : reg.data_atendimento_txt || '',
    'CNS paciente': reg.cns_paciente || '',
    'Nome paciente': (reg.nome_paciente || '').trim(),
    'CPF paciente': reg.cpf_paciente || '',
    'Código do procedimento': proc || reg.linha_bruta || '',
    'Nome do procedimento': nomesProc.get(proc) || '',
    Quantidade: reg.quantidade !== null && reg.quantidade !== undefined ? reg.quantidade : '',
    'CNS profissional': cnsProf,
    'Nome profissional': nomesProf.get(cnsProf) || '',
    CBO: reg.cbo || '',
    'Serviço/Classificação': s || c ? `${s}-${c}` : '',
    Sexo: reg.sexo || '',
    Idade: reg.idade !== null && reg.idade !== undefined ? reg.idade : '',
    'Caráter atendimento': reg.carater_atendimento || '',
    'Exige habilitação?': simNao(reg.exige_habilitacao),
    'Exige serviço/classificação?': simNao(reg.exige_servico),
    'Exige CPF (atributo 058)?': simNao(reg.exige_cpf),
  };
}

export function montarAlertas(registros, definicoes, nomesProc, nomesProf) {
  const ordem = new Map(definicoes.map((d, i) => [d.codigo, i]));
  const rotulo = new Map(definicoes.map((d) => [d.codigo, d.rotulo]));
  const saida = [];
  for (const reg of registros) {
    if (!reg.alertas || !reg.alertas.length) continue;
    const base = linhaBase(reg, nomesProc, nomesProf);
    for (const [codigo, detalhe] of reg.alertas) {
      saida.push({ ...base, 'Tipo de alerta': rotulo.get(codigo) || codigo, 'Código do alerta': codigo, Detalhe: detalhe, _ordem: ordem.has(codigo) ? ordem.get(codigo) : ordem.size });
    }
  }
  saida.sort((a, b) => a._ordem - b._ordem || a['Linha TXT'] - b['Linha TXT']);
  return saida;
}

export function resumir(registros, definicoes) {
  const validos = registros.filter((r) => r.tipo === 'I' || r.tipo === 'C');
  const qtd = (r) => parseInt(r.quantidade || 0, 10);
  const comAlerta = registros.filter((r) => r.alertas && r.alertas.length);
  const total = registros.length;
  const kpis = [
    total,
    registros.filter((r) => r.tipo === 'I').length,
    registros.filter((r) => r.tipo === 'C').length,
    validos.reduce((s, r) => s + qtd(r), 0),
    new Set(validos.filter((r) => r.proc_valido).map((r) => r.procedimento)).size,
    new Set(validos.filter((r) => r.cns_profissional).map((r) => r.cns_profissional)).size,
    comAlerta.length,
    total ? pyRound((100 * comAlerta.length) / total, 1) : 0,
  ];
  const linhasPorAlerta = new Map();
  const procPorAlerta = new Map();
  for (const r of registros) {
    for (const codigo of new Set((r.alertas || []).map((a) => a[0]))) {
      if (!linhasPorAlerta.has(codigo)) linhasPorAlerta.set(codigo, new Set());
      linhasPorAlerta.get(codigo).add(r.linha_txt);
      procPorAlerta.set(codigo, (procPorAlerta.get(codigo) || 0) + qtd(r));
    }
  }
  const serieAlertas = definicoes.map((d) => [d.rotulo, (linhasPorAlerta.get(d.codigo) || new Set()).size, procPorAlerta.get(d.codigo) || 0, d.codigo]);
  const porData = new Map();
  for (const r of validos) {
    const d = r.data_atendimento;
    if (!d) continue;
    if (!porData.has(d.chave)) porData.set(d.chave, [d.br, 0, 0]);
    const v = porData.get(d.chave);
    v[1] += 1;
    v[2] += qtd(r);
  }
  const serieProducao = [...porData.keys()].sort().map((k) => porData.get(k));
  const porProc = new Map();
  for (const r of validos) if (r.proc_valido) porProc.set(r.procedimento, (porProc.get(r.procedimento) || 0) + qtd(r));
  const top = maisComuns(porProc, 10);
  const resumoTipo = [
    ['BPA-I (individualizado)', registros.filter((r) => r.tipo === 'I').length, registros.filter((r) => r.tipo === 'I').reduce((s, r) => s + qtd(r), 0)],
    ['BPA-C (consolidado)', registros.filter((r) => r.tipo === 'C').length, registros.filter((r) => r.tipo === 'C').reduce((s, r) => s + qtd(r), 0)],
  ];
  const invalidas = registros.filter((r) => r.tipo !== 'I' && r.tipo !== 'C').length;
  if (invalidas) resumoTipo.push(['Linhas inválidas', invalidas, 0]);
  return { kpis: KPI_ROTULOS.map((r, i) => [r, kpis[i]]), serieAlertas, serieProducao, top, resumoTipo };
}

function abaTabela(wb, nome, colunas, linhas) {
  const ws = wb.addWorksheet(nome);
  colunas.forEach((c, i) => {
    ws.getColumn(i + 1).width = LARGURAS[c] ?? 16;
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = `A1:${letra(colunas.length)}${Math.max(linhas.length + 1, 2)}`;
  const cab = ws.addRow(colunas);
  cab.height = 32;
  cab.eachCell((c) => {
    c.font = { bold: true, color: cor('FFFFFF') };
    c.fill = preenchimento(COR_CABECALHO);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  for (const l of linhas) {
    ws.addRow(colunas.map((c) => {
      const v = l[c];
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'boolean') return v ? 'SIM' : 'NÃO';
      return v;
    }));
  }
  return ws;
}

async function salvarExcel(alertas, producao, resumo, meta, avisos, parametros) {
  const wb = novaPasta();
  const primeira = new Map();
  alertas.forEach((item, i) => {
    if (!primeira.has(item['Código do alerta'])) primeira.set(item['Código do alerta'], i + 2);
  });
  // Relatorio
  const ws = wb.addWorksheet('Relatorio');
  const put = (r, c, valor, o = {}) => {
    const cell = ws.getCell(r, c);
    cell.value = valor;
    if (o.negrito || o.cor || o.tamanho) cell.font = { bold: Boolean(o.negrito), color: o.cor ? cor(o.cor) : undefined, size: o.tamanho };
    if (o.fundo) cell.fill = preenchimento(o.fundo);
    if (o.alinhar || o.wrap) cell.alignment = { horizontal: o.alinhar, vertical: 'middle', wrapText: Boolean(o.wrap) };
  };
  put(1, 1, 'Fatura Fhemig Ambulatorial · Auditoria do BPA', { negrito: true, cor: COR_TITULO, tamanho: 16 });
  put(2, 1, meta.subtitulo, { cor: COR_SUAVE });
  resumo.kpis.forEach(([rotulo, valor], idx) => {
    const linha = L.kpiRows[Math.floor(idx / L.kpiCols.length)];
    const col = L.kpiCols[idx % L.kpiCols.length];
    const destaque = rotulo.toLowerCase().includes('alerta');
    put(linha, col, rotulo, { negrito: true, cor: COR_SUAVE });
    put(linha + 1, col, valor, { negrito: true, cor: destaque ? COR_ALERTA : COR_TITULO, tamanho: 18, alinhar: 'left' });
  });
  put(10, 1, 'Avisos gerais', { negrito: true, cor: COR_CABECALHO, tamanho: 12 });
  avisos.forEach((t, i) => put(L.avisos.ini + i, L.avisos.rotulo, t, { fundo: COR_AVISO }));
  if (!avisos.length) put(L.avisos.ini + 1, 1, '(nenhum aviso)', { cor: COR_SUAVE });
  const fimAvisos = L.avisos.ini + Math.max(avisos.length, 2);
  const tituloSerie = (cfg, nomes) => nomes.forEach((n, d) => put(cfg.ini - 1, cfg.rotulo + d, n, { negrito: true, cor: 'FFFFFF', fundo: COR_CABECALHO }));
  tituloSerie(L.alertas, ['Alerta', 'Linhas de atendimento', 'Procedimentos', 'Código', 'Lista']);
  resumo.serieAlertas.forEach(([rotulo, linhas, procs, codigo], i) => {
    const r = L.alertas.ini + i;
    const c = linhas ? undefined : '9AA7B2';
    put(r, L.alertas.rotulo, rotulo, { cor: c });
    put(r, L.alertas.valor, linhas, { negrito: Boolean(linhas), cor: linhas ? COR_ALERTA : c });
    put(r, L.alertas.procs, procs, { cor: c });
    put(r, L.alertas.codigo, codigo, { cor: COR_SUAVE });
    const destino = primeira.get(codigo);
    if (destino) put(r, L.alertas.codigo + 1, linkInterno(`'Alertas'!A${destino}`, 'ver lista'), { cor: '0563C1' });
  });
  tituloSerie(L.producao, ['Data de atendimento', 'Linhas', 'Procedimentos']);
  resumo.serieProducao.forEach(([d, l, p], i) => {
    put(L.producao.ini + i, L.producao.rotulo, d);
    put(L.producao.ini + i, L.producao.valor, l);
    put(L.producao.ini + i, L.producao.procs, p);
  });
  tituloSerie(L.top, ['Procedimento (top 10)', 'Quantidade']);
  resumo.top.forEach(([proc, q], i) => {
    put(L.top.ini + i, L.top.rotulo, `${proc} - ${meta.nomesProc.get(proc) || ''}`.replace(/[ -]+$/, ''));
    put(L.top.ini + i, L.top.valor, q);
  });
  tituloSerie(L.tipo, ['Tipo de registro', 'Linhas', 'Procedimentos']);
  resumo.resumoTipo.forEach(([r, l, p], i) => {
    put(L.tipo.ini + i, L.tipo.rotulo, r);
    put(L.tipo.ini + i, L.tipo.valor, l);
    put(L.tipo.ini + i, L.tipo.procs, p);
  });
  const larg = { 1: 16, 2: 6, 3: 6, 4: 16, 5: 6, 6: 6, 7: 16, 8: 6, 9: 6, 10: 16, 11: 6, 12: 6, [L.alertas.rotulo]: 44, [L.alertas.valor]: 12,
    [L.alertas.procs]: 13, [L.alertas.codigo]: 30, [L.alertas.codigo + 1]: 10, [L.producao.rotulo]: 14, [L.producao.valor]: 9,
    [L.producao.procs]: 13, [L.top.rotulo]: 52, [L.top.valor]: 11, [L.tipo.rotulo]: 24, [L.tipo.valor]: 9, [L.tipo.procs]: 13, 13: 3, 19: 3, 23: 3, 26: 3 };
  for (const [c, w] of Object.entries(larg)) ws.getColumn(+c).width = w;

  abaTabela(wb, 'Alertas', COLS_ALERTAS, alertas);
  abaTabela(wb, 'Producao', COLS_PRODUCAO, producao);
  const par = wb.addWorksheet('Parametros');
  par.getColumn(1).width = 38;
  par.getColumn(2).width = 110;
  const cabP = par.addRow(['Item', 'Valor']);
  cabP.eachCell((c) => {
    c.font = { bold: true, color: cor('FFFFFF') };
    c.fill = preenchimento(COR_CABECALHO);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  for (const [item, valor] of parametros) {
    const r = par.addRow([item, valor]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
  }

  const graficos = [];
  const nA = resumo.serieAlertas.length;
  if (nA) {
    graficos.push({ aba: 'Relatorio', tipo: 'barra', horizontal: true, ordemInversa: true, semGrade: true, titulo: 'Linhas de atendimento por tipo de alerta',
      serieNome: [L.alertas.valor, L.alertas.ini - 1], categorias: [L.alertas.rotulo, L.alertas.ini, L.alertas.ini + nA - 1],
      valores: [L.alertas.valor, L.alertas.ini, L.alertas.ini + nA - 1], ancora: [0, fimAvisos + 1], largura: 17, altura: 8.5, cor: 'C0392B' });
  }
  const nD = resumo.serieProducao.length;
  if (nD > 1) {
    graficos.push({ aba: 'Relatorio', tipo: 'linha', titulo: 'Linhas de atendimento por data',
      serieNome: [L.producao.valor, L.producao.ini - 1], categorias: [L.producao.rotulo, L.producao.ini, L.producao.ini + nD - 1],
      valores: [L.producao.valor, L.producao.ini, L.producao.ini + nD - 1], ancora: [0, fimAvisos + 19], largura: 17, altura: 8.5, cor: '0092C3' });
  }
  return injetarGraficos(await gravar(wb), graficos);
}

/**
 * process_arquivo.
 * entrada: {nome, bytes}; bases: {profissionais, carga_horaria, servico_classificacao,
 * habilitacao} cada uma {nome, planilha, origem}; obterSigtap(comp) -> {base, rotulo, tipo, motivo}
 */
export async function processarAmbulatorial({ entrada, bases, obterSigtap, unidade: unidadeSelecionada, notify = () => {} }) {
  const inicio = new Date();
  const log = [APP_VERSION, `Processamento iniciado em ${fmtDataHora(inicio)}`, ''];
  const etapa = (m) => {
    log.push(`[${fmtHora(new Date())}] ${m}`);
    notify(m);
  };
  etapa('Lendo a configuração...');
  const layouts = carregarLayout(layoutBpa);
  const definicoes = configAlertas.alertas;
  const opcoes = configAlertas.opcoes || {};
  etapa(`Lendo o TXT de produção: ${entrada.nome}`);
  const leitura = lerProducao(entrada.bytes, layouts);
  const { contagem } = leitura;
  const competencia = competenciaProducao(leitura);
  const cnesTxt = cnesProducao(leitura);
  const cab = leitura.cabecalho || {};
  const unidade = identificarUnidade(UNIDADES, { cnes: cnesTxt, nomes: [entrada.nome], siglaCabecalho: cab.cbc_sigla_origem || '' });
  const sigla = (unidade && unidade.sigla) || (cab.cbc_sigla_origem || '').trim() || cnesTxt || 'UNIDADE';
  etapa(`  ${contagem.I} linhas BPA-I, ${contagem.C} linhas BPA-C, ${contagem.invalidas} linha(s) de tipo desconhecido · codificação ${leitura.codificacao}`);
  etapa(`  Competência ${compBr(competencia) || '(não identificada)'} · CNES ${cnesTxt || '?'} · unidade ${unidade ? unidade.sigla : 'não identificada no cadastro de unidades'}`);
  if (!leitura.registros.length) throw new Error('O TXT não contém linhas de produção BPA (tipos 02 ou 03).');
  const avisos = [];
  for (const t of conferirCabecalho(leitura)) {
    avisos.push(t);
    etapa(`  AVISO: ${t}`);
  }
  const cnesDistintos = [...new Set(leitura.registros.map((r) => r.cnes).filter(Boolean))].sort();
  if (cnesDistintos.length > 1) avisos.push(`O TXT tem linhas de ${cnesDistintos.length} CNES diferentes: ${cnesDistintos.join(', ')}. Cada processamento deve tratar uma unidade.`);
  if (unidadeSelecionada && unidade && unidade.sigla !== unidadeSelecionada) {
    const t = `O TXT é da unidade ${unidade.sigla} (CNES ${cnesTxt}), mas a unidade selecionada no topo da tela é ${unidadeSelecionada}. Confira se as planilhas da unidade correspondem ao arquivo.`;
    avisos.push(t);
    etapa(`  AVISO: ${t}`);
  }
  const faltando = CADASTROS.filter((t) => !bases[t]).map((t) => `${DESCRICAO_CADASTRO[t]}: não encontrada para ${unidadeSelecionada || sigla} — selecione manualmente`);
  if (faltando.length) throw new Error(`Selecione as planilhas da unidade antes de processar:\n- ${faltando.join('\n- ')}`);

  const sig = await obterSigtap(competencia);
  if (!sig) throw new Error('Tabela SIGTAP não encontrada. Carregue a planilha SIGTAP (.xlsx) ou o zip com os TXT do DATASUS em "Base SIGTAP".');
  const sigtap = sig.base;
  etapa(`Carregando o SIGTAP: ${sig.rotulo} (${sig.tipo === 'xlsx' ? 'planilha' : 'TXT DATASUS'}, competência ${compBr(sigtap.competencia) || 'não identificada'}, ${sig.motivo})`);
  for (const t of sigtap.log || []) etapa(`  ${t}`);
  if (competencia && sigtap.competencia && sigtap.competencia !== competencia) {
    const t = `A competência do SIGTAP (${compBr(sigtap.competencia)}) é diferente da competência da produção (${compBr(competencia)}). Regras do SIGTAP podem ter mudado.`;
    avisos.push(t);
    etapa(`  AVISO: ${t}`);
  } else if (!sigtap.competencia) {
    avisos.push('Não foi possível identificar a competência do SIGTAP (o nome da planilha deve conter MMAAAA, ex.: SIGTAP102026.xlsx). Confira se é a tabela da competência.');
  }
  const b = bases;
  etapa(`Lendo Profissionais: ${b.profissionais.nome} (${b.profissionais.origem})`);
  const prof = lerProfissionais(b.profissionais.planilha, b.profissionais.nome, mapeamento);
  etapa(`  ${prof.dados.size} profissionais (CNS) em ${prof.linhas} linhas`);
  etapa(`Lendo Carga horária: ${b.carga_horaria.nome} (${b.carga_horaria.origem})`);
  const ch = lerCargaHoraria(b.carga_horaria.planilha, b.carga_horaria.nome, mapeamento);
  etapa(`  ${ch.dados.size} pares CNS/CBO em ${ch.linhas} linhas`);
  etapa(`Lendo Serviço/Classificação: ${b.servico_classificacao.nome} (${b.servico_classificacao.origem})`);
  const serv = lerServicos(b.servico_classificacao.planilha, b.servico_classificacao.nome, mapeamento);
  etapa(`  ${serv.dados.size} serviços/classificações`);
  etapa(`Lendo Habilitação: ${b.habilitacao.nome} (${b.habilitacao.origem})`);
  const hab = lerHabilitacoes(b.habilitacao.planilha, b.habilitacao.nome, mapeamento);
  const vigentes = habilitacoesVigentes(hab.dados, competencia);
  etapa(`  ${hab.dados.size} habilitações (${vigentes.size} vigentes em ${compBr(competencia)})`);
  for (const [nome, d] of [['Profissionais', prof], ['Carga horária', ch], ['Serviço/Classificação', serv], ['Habilitação', hab]]) {
    if (d.ignoradas) log.push(`  ${nome}: ${d.ignoradas} linha(s) sem código legível ignorada(s).`);
  }
  let cnesPlanilhas = hab.cnes_unidade || '';
  let unidadePlanilhas = null;
  if (!cnesPlanilhas) {
    unidadePlanilhas = identificarUnidade(UNIDADES, { nomes: CADASTROS.map((t) => b[t].nome) });
    cnesPlanilhas = (unidadePlanilhas || {}).cnes || '';
  }
  if (cnesPlanilhas && cnesTxt && cnesPlanilhas !== cnesTxt) {
    const uPlan = unidadePlanilhas || identificarUnidade(UNIDADES, { cnes: cnesPlanilhas });
    const t = `O TXT é do CNES ${cnesTxt}${unidade ? ` (${unidade.sigla})` : ''}, mas as planilhas da unidade são do CNES ${cnesPlanilhas}${uPlan ? ` (${uPlan.sigla})` : ''}. ` +
      'Confira se os cadastros são da mesma unidade: os alertas de profissional, carga horária, habilitação e serviço dependem disso.';
    avisos.push(t);
    etapa(`  AVISO: ${t}`);
  }
  etapa('Aplicando as regras R01 a R11 por linha de atendimento...');
  const registros = aplicarRegras(leitura.registros, {
    sigtap, profissionais: prof.dados, carga_horaria: ch.dados, cbos_com_carga: ch.cbos_por_cns, servicos_unidade: serv.dados,
    habilitacoes_unidade: hab.dados, habilitacoes_vigentes: vigentes, competencia, opcoes,
  });
  if (opcoes.r11_ativa === false) avisos.push('A regra R11 (CPF obrigatório) está desativada em config/alertas.json.');
  const nomesProc = sigtap.procedimentos;
  const nomesProf = new Map([...prof.dados].map(([cns, info]) => [cns, info.nome]));
  const alertas = montarAlertas(registros, definicoes, nomesProc, nomesProf);
  const producao = registros.map((reg) => {
    const linha = linhaBase(reg, nomesProc, nomesProf);
    const codigos = [...new Set((reg.alertas || []).map((a) => a[0]))];
    linha.Status = codigos.length ? 'ALERTA' : 'OK';
    linha['Qtd. alertas'] = (reg.alertas || []).length;
    linha['Códigos dos alertas'] = codigos.join(', ');
    return linha;
  });
  const resumo = resumir(registros, definicoes);
  for (const [rotulo, linhas, procs] of resumo.serieAlertas) if (linhas) etapa(`  ${rotulo}: ${linhas} linha(s), ${procs} procedimento(s)`);
  const kpis = Object.fromEntries(resumo.kpis);
  etapa(`  ${kpis['Linhas com alerta']} de ${kpis['Linhas de atendimento']} linhas com alerta (${String(kpis['% de linhas com alerta'].toFixed(1)).replace('.', ',')}%)`);

  const base = `FaturaAmb_${normText(sigla).replace(/ /g, '')}_${competencia || 'SEMCOMP'}_${carimbo(inicio)}`;
  const subtitulo = `Unidade ${sigla}${unidade && unidade.nome ? ` - ${unidade.nome}` : ''} · CNES ${cnesTxt} · Competência ${compBr(competencia)} · ` +
    `Arquivo ${entrada.nome} · Gerado em ${fmtDataHora(inicio, false)}`;
  const parametros = [
    ['Versão', APP_VERSION], ['Processado em', fmtDataHora(inicio)], ['Arquivo de produção', entrada.nome],
    ['Codificação do TXT', leitura.codificacao], ['Unidade', sigla], ['Nome da unidade', (unidade || {}).nome || ''],
    ['Unidade selecionada na tela', unidadeSelecionada || ''], ['CNES da produção', cnesTxt], ['Competência da produção', compBr(competencia)],
    ['SIGTAP', `${sig.rotulo} (${sig.tipo}, competência ${compBr(sigtap.competencia) || 'não identificada'}, ${sig.motivo})`],
    ...CADASTROS.map((t) => [`Planilha de ${DESCRICAO_CADASTRO[t]}`, `${b[t].nome} (${b[t].origem})`]),
    ['CNES das planilhas da unidade', cnesPlanilhas || 'não identificado'],
    ['Linhas lidas', `${contagem.I} BPA-I, ${contagem.C} BPA-C, ${contagem.invalidas} de tipo desconhecido`],
    ['Contagem', 'Por linha de atendimento (linha do TXT). Uma linha com vários alertas conta uma vez no total e uma vez em cada tipo de alerta.'],
    ['Regras', 'R01 linha inválida; R02 procedimento no SIGTAP; R04 CNS do profissional; R05 CBO do profissional; R06 carga horária ambulatorial; ' +
      'R07/R08 habilitação; R09/R10 serviço/classificação; R11 CPF obrigatório (atributo 058). R04-R06 e R11 só no BPA-I.'],
    ['Opções (config/alertas.json)', Object.entries(opcoes).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.map((x) => `'${x}'`).join(', ')}]` : typeof v === 'boolean' ? (v ? 'True' : 'False') : v}`).join(', ')],
    ['Avisos gerais', avisos.join('\n') || 'nenhum'],
    ['Observação', 'Alerta automatizado não é glosa definitiva: indica a linha que precisa de conferência antes do envio. O arquivo contém dados pessoais de pacientes; não circule fora da unidade.'],
  ];
  etapa('Gerando o consolidado em Excel e CSV...');
  const xlsx = await salvarExcel(alertas, producao, resumo, { subtitulo, nomesProc }, avisos, parametros);
  const csv = gerarCsv(COLS_ALERTAS, alertas);
  log.push('', 'Avisos do leitor (posição/valor):');
  if (leitura.avisos.length) {
    for (const a of leitura.avisos.slice(0, 500)) log.push(`  linha ${a.linha_txt} ${a.campo}: ${a.mensagem}`);
    if (leitura.avisos.length > 500) log.push(`  ... mais ${leitura.avisos.length - 500} aviso(s)`);
  } else log.push('  nenhum');
  const invalidas = registros.filter((r) => r.erros && r.erros.length);
  log.push(`Linhas com R01 (mantidas no relatório): ${invalidas.length}`);
  for (const r of invalidas.slice(0, 500)) log.push(`  linha ${r.linha_txt}: ${r.erros.join('; ')}`);
  etapa(`Concluído em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1).replace('.', ',')} s.`);
  return {
    ferramenta: 'ambulatorial',
    unidade: sigla,
    competencia,
    sigtap: { rotulo: sig.rotulo, competencia: sigtap.competencia },
    avisos,
    log,
    arquivos: {
      xlsx: { nome: `${base}.xlsx`, bytes: xlsx },
      csv: { nome: `${base}.csv`, texto: csv },
      log: { nome: `${base}.log`, texto: `${log.join('\n')}\n` },
    },
    resumo: {
      kpis: resumo.kpis.map(([rotulo, valor]) => ({ rotulo, valor, destaque: rotulo.toLowerCase().includes('alerta') })),
      alertas: resumo.serieAlertas.map(([rotulo, linhas, procedimentos, codigo]) => ({ rotulo, codigo, linhas, procedimentos })),
      producao: resumo.serieProducao,
      top: resumo.top.map(([proc, q]) => [`${proc} - ${nomesProc.get(proc) || ''}`.replace(/[ -]+$/, ''), q]),
      tipos: resumo.resumoTipo,
      ocorrencias: alertas.map((a) => ({
        tipo: a['Tipo de alerta'], codigo: a['Código do alerta'], linha: a['Linha TXT'], registro: a['Tipo registro (I/C)'],
        procedimento: `${a['Código do procedimento']} ${a['Nome do procedimento']}`.trim(), profissional: a['Nome profissional'] || a['CNS profissional'],
        paciente: a['Nome paciente'], detalhe: a.Detalhe,
      })),
    },
    registros,
  };
}
