// Orquestracao do Hospitalar 14.3 (process_arquivo) e relatorio (save).
import {
  APP_VERSION, ALERT_DEFINITIONS, annotateAlerts, buildAlertRecords, detectarUnidade, extract,
  loadProfissionais, loadUnitHabilitations, loadUnitServiceClassifications, parseData, resumoAihTipoCti, normText,
} from './regras.js';
import { lerTxt, converterSisaih01ParaEspelho, competenciaProducaoTxt, competenciaProducaoPdf, competenciaBr } from './entrada.js';
import { asInt, asNumber, fmtDataHora } from '../comum/texto.js';
import { novaPasta, gravar, injetarGraficos, preenchimento, cor, letra, linkInterno, gerarCsv } from '../comum/xlsx.js';

export const COLS = [
  'AIH', 'Codigo do procedimento', 'Data entrada', 'Data saida', 'Nome paciente', 'SEXO', 'IDADE COMPLETA',
  'REINTERNOU (REAPARECE NA LISTAGEM DO PDF)?', 'REINTERNOU COM MENOS DE 72H (SEGUNDA ENTRADA MENOS PRIMEIRA SAIDA)?',
  'TEMPO DE PERMANÊNCIA (Data de saída menos a data de entrada)', 'DIARIAS DE UTI NA AIH', 'Linha do procedimento',
  'Documento', 'CBO', 'CID', 'Código do CID Secundário', 'Servico/Classificacao', 'Procedimento', 'Principal/secundario',
  'Quantidade apresentada', 'PROCEDIMENTO EXIGE HABILITACAO?', 'UNIDADE POSSUI HABILITACAO PARA O PROCEDIMENTO?',
  'O SERVICO/CLASSIFICACAO FOI APRESENTADO?', 'UNIDADE TEM O SERVICO/CLASSIFICACAO?', 'PROCEDIMENTO EXIGE SERVICO/CLASSIFICACAO?',
  'QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?', 'CID SECUNDARIO E O MESMO DO SIGTAP?', 'CID E O MESMO DO SIGTAP?',
  'CBO E O MESMO DO SIGTAP?', 'PROFISSIONAL E CBO CADASTRADOS?', 'SEXO E COMPATIVEL?', 'IDADE DENTRO DA FAIXA?',
  'PROCEDIMENTO PRINCIPAL DA AIH', 'MEDIA DE PERMANENCIA SIGTAP (PROC. PRINCIPAL)', 'ADMITE PERMANENCIA A MAIOR (ATRIBUTO 004)?',
  'PERMANENCIA E MENOR QUE A PERMITIDA (PROC. PRINCIPAL)?', 'PERMANENCIA PASSOU DO DOBRO DA MEDIA (DESCONTADA UTI)?',
  'DIARIAS DE PERMANENCIA A MAIOR', 'TEM ALERTA?', 'ALERTAS',
];
export const COLS_CSV = [
  'AIH', 'Codigo do procedimento', 'Data entrada', 'Data saida', 'Nome paciente', 'SEXO', 'IDADE COMPLETA',
  'REINTERNOU COM MENOS DE 72H (SEGUNDA ENTRADA MENOS PRIMEIRA SAIDA)?', 'TEMPO DE PERMANÊNCIA (Data de saída menos a data de entrada)',
  'Linha do procedimento', 'Documento', 'CBO', 'CID', 'Código do CID Secundário', 'Servico/Classificacao', 'Procedimento',
  'Principal/secundario', 'Quantidade apresentada', 'QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?',
  'PERMANENCIA E MENOR QUE A PERMITIDA (PROC. PRINCIPAL)?', 'DIARIAS DE PERMANENCIA A MAIOR',
];
export const COLS_ALERTAS = [
  'Tipo de alerta', 'AIH', 'Data entrada', 'Data saida', 'Nome paciente', 'Linha do procedimento', 'Codigo do procedimento',
  'Procedimento', 'Principal/secundario', 'Quantidade apresentada', 'Documento', 'CBO', 'CID', 'Detalhe',
];
const WIDTHS = {
  AIH: 18, 'Data entrada': 13, 'Data saida': 13, 'Nome paciente': 34, SEXO: 12, 'IDADE COMPLETA': 22,
  'REINTERNOU (REAPARECE NA LISTAGEM DO PDF)?': 38, 'REINTERNOU COM MENOS DE 72H (SEGUNDA ENTRADA MENOS PRIMEIRA SAIDA)?': 52,
  'TEMPO DE PERMANÊNCIA (Data de saída menos a data de entrada)': 48, 'DIARIAS DE UTI NA AIH': 20, 'Linha do procedimento': 20,
  'Codigo do procedimento': 22, Documento: 18, CBO: 14, CID: 12, 'Código do CID Secundário': 25, 'Servico/Classificacao': 26,
  Procedimento: 58, 'Principal/secundario': 20, 'Quantidade apresentada': 22, 'PROCEDIMENTO EXIGE HABILITACAO?': 32,
  'UNIDADE POSSUI HABILITACAO PARA O PROCEDIMENTO?': 44, 'O SERVICO/CLASSIFICACAO FOI APRESENTADO?': 40,
  'UNIDADE TEM O SERVICO/CLASSIFICACAO?': 38, 'PROCEDIMENTO EXIGE SERVICO/CLASSIFICACAO?': 40,
  'QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?': 40, 'CID SECUNDARIO E O MESMO DO SIGTAP?': 36, 'CID E O MESMO DO SIGTAP?': 26,
  'CBO E O MESMO DO SIGTAP?': 28, 'PROFISSIONAL E CBO CADASTRADOS?': 36, 'SEXO E COMPATIVEL?': 22, 'IDADE DENTRO DA FAIXA?': 24,
  'PROCEDIMENTO PRINCIPAL DA AIH': 28, 'MEDIA DE PERMANENCIA SIGTAP (PROC. PRINCIPAL)': 40, 'ADMITE PERMANENCIA A MAIOR (ATRIBUTO 004)?': 38,
  'PERMANENCIA E MENOR QUE A PERMITIDA (PROC. PRINCIPAL)?': 44, 'PERMANENCIA PASSOU DO DOBRO DA MEDIA (DESCONTADA UTI)?': 44,
  'DIARIAS DE PERMANENCIA A MAIOR': 32, 'TEM ALERTA?': 14, ALERTAS: 60, 'Tipo de alerta': 34, Detalhe: 70,
};
const COR_TITULO = '17365D';
const COR_CABECALHO = '1F4E78';
const COR_ALERTA = 'C00000';
const LAYOUT = { serieProducao: [14, 15], serieTop: [17, 18], serieAlertas: [20, 21, 22] };

const v = (x) => (x === null || x === undefined ? '' : x);

function formatarCabecalho(ws, columns) {
  ws.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(ws.rowCount, 1), column: columns.length } };
  const r1 = ws.getRow(1);
  r1.height = 35;
  r1.eachCell((c) => {
    c.fill = preenchimento(COR_CABECALHO);
    c.font = { color: cor('FFFFFF'), bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  columns.forEach((name, i) => {
    ws.getColumn(i + 1).width = WIDTHS[name] ?? 20;
  });
}

/** Indicadores do Relatorio (mesma conta do save). */
export function indicadores(rows) {
  const aihs = new Set(rows.map((r) => String(r.AIH ?? '').trim()).filter(Boolean));
  const pacientes = new Set(rows.map((r) => normText(r['Nome paciente'])).filter(Boolean));
  const quantidade = rows.reduce((s, r) => s + asInt(r['Quantidade apresentada']), 0);
  const stays = new Map();
  for (const r of rows) {
    const aih = String(r.AIH ?? '').trim();
    const val = asNumber(r['TEMPO DE PERMANÊNCIA (Data de saída menos a data de entrada)']);
    if (aih && val !== null && !stays.has(aih)) stays.set(aih, val);
  }
  const media = stays.size ? [...stays.values()].reduce((a, b) => a + b, 0) / stays.size : 0;
  const reint = new Set(rows.filter((r) => normText(r['REINTERNOU COM MENOS DE 72H (SEGUNDA ENTRADA MENOS PRIMEIRA SAIDA)?']) === 'SIM').map((r) => String(r.AIH).trim()));
  const permMaior = rows.reduce((s, r) => s + asInt(r['DIARIAS DE PERMANENCIA A MAIOR']), 0);
  const comAlerta = new Set(rows.filter((r) => normText(r['TEM ALERTA?']) === 'SIM').map((r) => String(r.AIH).trim()));
  return {
    aihs: aihs.size, comAlerta: comAlerta.size,
    kpis: [
      ['AIHs distintas', aihs.size, COR_CABECALHO, null],
      ['Pacientes distintos', pacientes.size, '2F75B5', null],
      ['Procedimentos', rows.length, '00A6A6', null],
      ['Quantidade total', quantidade, '70AD47', null],
      ['Permanência média', media, '8064A2', null],
      ['Reinternações < 72h', reint.size, 'C65911', null],
      ['Diárias de perm. a maior', permMaior, 'ED7D31', "'Alertas'!A1"],
      ['AIHs com alerta', comAlerta.size, COR_ALERTA, "'Alertas'!A1"],
    ].map(([rotulo, valor, c, destino], i) => ({ rotulo, valor, cor: c, destino: i === 7 ? destino : null })),
  };
}

export function producaoMensal(rows) {
  const porMes = new Map();
  for (const r of rows) {
    const d = parseData(r['Data saida']);
    if (!d) continue;
    const k = d.y * 100 + d.m;
    if (!porMes.has(k)) porMes.set(k, new Set());
    porMes.get(k).add(r.AIH);
  }
  return [...porMes.keys()].sort((a, b) => a - b).map((k) => [`${String(k % 100).padStart(2, '0')}/${Math.floor(k / 100)}`, porMes.get(k).size]);
}

export function topProcedimentos(rows) {
  const tot = new Map();
  for (const r of rows) {
    const rotulo = String(r.Procedimento ?? '').trim() || String(r['Codigo do procedimento'] ?? '').trim();
    if (rotulo) tot.set(rotulo, (tot.get(rotulo) || 0) + asInt(r['Quantidade apresentada']));
  }
  return [...tot.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, 10);
}

/** save(): monta o xlsx (Relatorio, Alertas, Dados, Producao) e o CSV. */
export async function gerarSaidas(rows, nomeEntrada, dataHora = new Date()) {
  annotateAlerts(rows);
  const { records, counts } = buildAlertRecords(rows);
  const csv = gerarCsv(COLS_CSV, rows);
  const wb = novaPasta();

  // Relatorio (criada primeiro para ficar na posicao 0)
  const rel = wb.addWorksheet('Relatorio');
  const ws = wb.addWorksheet('Dados');
  const alertas = wb.addWorksheet('Alertas');
  const production = wb.addWorksheet('Producao');

  // ---------------------------------------------------------------- Dados
  ws.addRow(COLS);
  const statusCols = new Set(['QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?', 'PERMANENCIA E MENOR QUE A PERMITIDA (PROC. PRINCIPAL)?']);
  for (const row of rows) {
    ws.addRow(COLS.map((c) => (statusCols.has(c) && normText(row[c]) === 'NAO' ? 'NÃO' : v(row[c]))));
  }
  formatarCabecalho(ws, COLS);
  for (const name of ['Quantidade apresentada', 'DIARIAS DE PERMANENCIA A MAIOR', 'DIARIAS DE UTI NA AIH']) {
    const col = ws.getColumn(COLS.indexOf(name) + 1);
    col.eachCell((c, n) => {
      if (n > 1) c.numFmt = '0';
    });
  }
  const last = Math.max(ws.rowCount, 2);
  const cf = (name, formula) => {
    const L = letra(COLS.indexOf(name) + 1);
    ws.addConditionalFormatting({
      ref: `${L}2:${L}${last}`,
      rules: [{ type: 'expression', formulae: [formula(L)], stopIfTrue: true, style: { font: { color: { argb: 'FFFF0000' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } } }],
    });
  };
  cf('QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?', (L) => `ISNUMBER($${L}2)`);
  cf('DIARIAS DE PERMANENCIA A MAIOR', (L) => `$${L}2>0`);
  cf('TEM ALERTA?', (L) => `$${L}2="SIM"`);

  // ---------------------------------------------------------------- Producao
  const mensal = producaoMensal(rows);
  production.addRow(['Mês de alta (mm/aaaa)', 'Qtde de contas apresentadas']);
  for (const linha of mensal) production.addRow(linha);
  formatarCabecalho(production, ['Mês de alta (mm/aaaa)', 'Qtde de contas apresentadas']);
  production.getColumn(1).width = 25;
  production.getColumn(2).width = 30;

  // ---------------------------------------------------------------- Alertas
  const ordem = new Map(ALERT_DEFINITIONS.map((a, i) => [a.label, i]));
  records.sort((a, b) => (ordem.get(a['Tipo de alerta']) ?? 99) - (ordem.get(b['Tipo de alerta']) ?? 99) || (a.AIH < b.AIH ? -1 : a.AIH > b.AIH ? 1 : 0));
  alertas.addRow(COLS_ALERTAS);
  const primeira = new Map();
  for (const r of records) {
    alertas.addRow(COLS_ALERTAS.map((c) => v(r[c])));
    if (!primeira.has(r['Tipo de alerta'])) primeira.set(r['Tipo de alerta'], alertas.rowCount);
  }
  formatarCabecalho(alertas, COLS_ALERTAS);
  const cores = new Map(ALERT_DEFINITIONS.map((a) => [a.label, a.color]));
  for (let i = 2; i <= alertas.rowCount; i += 1) {
    const c = alertas.getCell(i, 1);
    c.font = { bold: true, color: cor(cores.get(c.value) || '404040') };
  }
  if (alertas.rowCount === 1) alertas.getCell(2, 1).value = 'Nenhum alerta encontrado.';
  const volta = alertas.getCell(1, COLS_ALERTAS.length + 2);
  volta.value = linkInterno("'Relatorio'!A10", '← Voltar ao Relatório');
  volta.font = { color: cor('0563C1'), underline: true, bold: true };

  // ---------------------------------------------------------------- Relatorio
  rel.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
  rel.mergeCells('A1:L1');
  const a1 = rel.getCell('A1');
  a1.value = 'RELATÓRIO EXECUTIVO - PRODUÇÃO E QUALIDADE DAS AIHs';
  a1.font = { name: 'Calibri', size: 20, bold: true, color: cor('FFFFFF') };
  a1.fill = preenchimento(COR_TITULO);
  a1.alignment = { horizontal: 'center', vertical: 'middle' };
  rel.getRow(1).height = 34;
  rel.mergeCells('A2:L2');
  rel.getCell('A2').value = `${nomeEntrada} | processado em ${fmtDataHora(dataHora, false)}`;
  rel.getCell('A2').font = { size: 11, italic: true, color: cor('5B6573') };
  rel.getCell('A2').alignment = { horizontal: 'center' };
  rel.mergeCells('A3:L3');
  rel.getCell('A3').value = 'Alertas contados por AIH, sem dupla contagem. Clique no alerta para abrir a lista completa na aba Alertas.';
  rel.getCell('A3').font = { size: 9, color: cor('7F7F7F') };
  rel.getCell('A3').alignment = { horizontal: 'center' };

  const ind = indicadores(rows);
  const kpiRows = [4, 7];
  const kpiCols = [1, 4, 7, 10];
  ind.kpis.forEach((k, idx) => {
    const col = kpiCols[idx % 4];
    const row = idx < 4 ? kpiRows[0] : kpiRows[1];
    rel.mergeCells(row, col, row, col + 1);
    rel.mergeCells(row + 1, col, row + 1, col + 1);
    const lc = rel.getCell(row, col);
    const vc = rel.getCell(row + 1, col);
    lc.value = k.rotulo;
    vc.value = k.destino ? linkInterno(k.destino, k.valor) : k.valor;
    for (const c of [lc, vc]) {
      c.fill = preenchimento(k.cor);
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    lc.font = { color: cor('FFFFFF'), bold: true, size: 10 };
    vc.font = { color: cor('FFFFFF'), bold: true, size: 18 };
    vc.numFmt = k.rotulo === 'Permanência média' ? '0.0' : '#,##0';
    rel.getRow(row).height = 22;
    rel.getRow(row + 1).height = 32;
  });

  let linha = 10;
  rel.mergeCells(linha, 1, linha, 12);
  const painel = rel.getCell(linha, 1);
  painel.value = `ALERTAS DE QUALIDADE | ${ind.comAlerta.toLocaleString('pt-BR')} de ${ind.aihs.toLocaleString('pt-BR')} AIHs com pelo menos um alerta`;
  painel.fill = preenchimento(COR_ALERTA);
  painel.font = { color: cor('FFFFFF'), bold: true, size: 12 };
  painel.alignment = { horizontal: 'center', vertical: 'middle' };
  rel.getRow(linha).height = 24;
  linha += 1;
  const blocos = [[1, 6], [7, 8], [9, 10], [11, 12]];
  blocos.forEach(([a, b]) => rel.mergeCells(linha, a, linha, b));
  [[1, 'Alerta'], [7, 'AIHs'], [9, 'Procedimentos'], [11, 'Ver detalhe']].forEach(([c, t]) => {
    const cell = rel.getCell(linha, c);
    cell.value = t;
    cell.font = { bold: true, color: cor('FFFFFF') };
    cell.fill = preenchimento('595959');
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  const ordenados = [...counts].sort((a, b) => b.aihs - a.aihs || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  for (const item of ordenados) {
    linha += 1;
    blocos.forEach(([a, b]) => rel.mergeCells(linha, a, linha, b));
    const rot = rel.getCell(linha, 1);
    rot.value = item.label;
    rot.font = { bold: true, color: cor(item.color) };
    rot.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    for (const c of [7, 9]) {
      const cell = rel.getCell(linha, c);
      cell.value = c === 7 ? item.aihs : item.procedimentos;
      cell.numFmt = '#,##0';
      cell.font = { bold: c === 7, color: cor('404040') };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    const acao = rel.getCell(linha, 11);
    const dest = primeira.get(item.label);
    if (dest) {
      acao.value = linkInterno(`'Alertas'!A${dest}`, 'abrir na aba Alertas →');
      acao.font = { color: cor('0563C1'), underline: true, size: 9 };
    } else {
      acao.value = 'sem ocorrências';
      acao.font = { color: cor('A6A6A6'), italic: true, size: 9 };
    }
    acao.alignment = { horizontal: 'center', vertical: 'middle' };
    rel.getRow(linha).height = 18;
  }

  const cti = resumoAihTipoCti(rows);
  linha += 2;
  rel.mergeCells(linha, 1, linha, 12);
  const tcti = rel.getCell(linha, 1);
  tcti.value = 'RELATÓRIO DE AIHs POR TIPO E CTI';
  tcti.fill = preenchimento(COR_CABECALHO);
  tcti.font = { color: cor('FFFFFF'), bold: true, size: 12 };
  tcti.alignment = { horizontal: 'center', vertical: 'middle' };
  rel.getRow(linha).height = 24;
  for (const [rotulo, valor] of cti) {
    linha += 1;
    rel.mergeCells(linha, 1, linha, 8);
    rel.mergeCells(linha, 9, linha, 12);
    rel.getCell(linha, 1).value = rotulo;
    rel.getCell(linha, 1).font = { bold: true, color: cor('404040') };
    const c9 = rel.getCell(linha, 9);
    c9.value = valor;
    c9.font = { bold: true, color: cor(COR_TITULO) };
    c9.numFmt = '#,##0';
    c9.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // Tabelas de apoio dos graficos
  const [pR, pV] = LAYOUT.serieProducao;
  rel.getCell(2, pR).value = 'Mês';
  rel.getCell(2, pV).value = 'AIHs';
  mensal.forEach(([mes, q], i) => {
    rel.getCell(3 + i, pR).value = mes;
    rel.getCell(3 + i, pV).value = q;
  });
  const top = topProcedimentos(rows);
  const [tR, tV] = LAYOUT.serieTop;
  rel.getCell(2, tR).value = 'Procedimento';
  rel.getCell(2, tV).value = 'Quantidade';
  top.forEach(([rotulo, q], i) => {
    rel.getCell(3 + i, tR).value = rotulo.slice(0, 80);
    rel.getCell(3 + i, tV).value = q;
  });
  const [aR, aV, aP] = LAYOUT.serieAlertas;
  rel.getCell(2, aR).value = 'Alerta';
  rel.getCell(2, aV).value = 'AIHs';
  rel.getCell(2, aP).value = 'Procedimentos';
  ordenados.forEach((item, i) => {
    rel.getCell(3 + i, aR).value = item.label;
    rel.getCell(3 + i, aV).value = item.aihs;
    rel.getCell(3 + i, aP).value = item.procedimentos;
  });
  for (const c of [pR, pV, tR, tV, aR, aV, aP]) {
    const cell = rel.getCell(2, c);
    cell.fill = preenchimento(COR_CABECALHO);
    cell.font = { color: cor('FFFFFF'), bold: true };
  }
  for (let c = 1; c <= 12; c += 1) rel.getColumn(c).width = 13;
  [[pR, 14], [pV, 12], [tR, 42], [tV, 12], [aR, 34], [aV, 12], [aP, 14]].forEach(([c, w]) => {
    rel.getColumn(c).width = w;
  });
  const linhaGraficos = linha + 2;
  rel.pageSetup = { fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:L${linhaGraficos + 30}` };

  const graficos = [];
  if (mensal.length) {
    graficos.push({ aba: 'Relatorio', tipo: 'linha', titulo: 'Evolução mensal das AIHs apresentadas', tituloX: 'Mês de alta', tituloY: 'Quantidade de AIHs',
      serieNome: [pV, 2], categorias: [pR, 3, mensal.length + 2], valores: [pV, 3, mensal.length + 2], ancora: [0, linhaGraficos - 1], largura: 14.2, altura: 7.2, cor: '0092C3' });
  }
  if (top.length) {
    graficos.push({ aba: 'Relatorio', tipo: 'barra', horizontal: true, titulo: 'Top 10 procedimentos por quantidade', tituloX: 'Quantidade apresentada',
      serieNome: [tV, 2], categorias: [tR, 3, 2 + top.length], valores: [tV, 3, 2 + top.length], ancora: [6, linhaGraficos - 1], largura: 14.2, altura: 7.2, cor: '00486C' });
  }
  if (ordenados.some((i) => i.aihs)) {
    graficos.push({ aba: 'Relatorio', tipo: 'barra', horizontal: true, titulo: 'Alertas de qualidade por AIH', tituloX: 'AIHs atingidas', rotulos: true,
      serieNome: [aV, 2], categorias: [aR, 3, 2 + ordenados.length], valores: [aV, 3, 2 + ordenados.length], ancora: [0, linhaGraficos + 14], largura: 14.2, altura: 7.6, cor: 'C00000' });
  }
  const xlsx = injetarGraficos(await gravar(wb), graficos);
  return { xlsx, csv, records, counts: ordenados, ind, mensal, top, cti };
}

/**
 * process_arquivo.
 * entrada: { formato: 'txt'|'pdf', nome, bytes (txt) | espelho (texto do PDF) }
 * obterSigtap(competencia) -> {regras, descricoes, competencia, rotulo}
 * bases: { servico, habilitacao, profissionais } cada uma {nome, planilha} ou null
 */
export async function processarHospitalar({ entrada, obterSigtap, bases, unidade, notify = () => {} }) {
  const inicio = new Date();
  const log = [APP_VERSION, `Processamento iniciado em ${fmtDataHora(inicio)}`, ''];
  const avisos = [];
  const etapa = (m) => {
    log.push(m);
    notify(m);
  };
  const formato = entrada.formato;
  let conteudo = null;
  let espelho;
  let competenciaProducao;
  if (formato === 'txt') {
    etapa('Lendo o arquivo TXT do SISAIH01...');
    conteudo = lerTxt(entrada.bytes);
    competenciaProducao = competenciaProducaoTxt(conteudo);
  } else {
    etapa('Usando o texto extraído do espelho em PDF...');
    espelho = entrada.espelho;
    competenciaProducao = competenciaProducaoPdf(espelho);
  }
  etapa('Carregando o SIGTAP...');
  const sigtap = await obterSigtap(competenciaProducao);
  etapa(`SIGTAP: ${sigtap.rotulo} (competência ${competenciaBr(sigtap.competencia) || 'não informada'}).`);
  if (competenciaProducao && sigtap.competencia && competenciaProducao !== sigtap.competencia) {
    const t = `⚠ AVISO: a produção é da competência ${competenciaBr(competenciaProducao)}, mas o SIGTAP é de ${competenciaBr(sigtap.competencia)}. ` +
      'Os alertas podem refletir regras de outra competência. Atualize a base SIGTAP.';
    avisos.push(t);
    etapa(t);
  }
  const exigir = (chave, descricao) => {
    if (!bases[chave]) throw new Error(`${descricao} não encontrada. Selecione a planilha no campo correspondente.`);
    return bases[chave];
  };
  etapa('Carregando Serviço e Classificação da unidade...');
  const servico = exigir('servico', 'Planilha de Serviço e Classificação da unidade');
  const unitService = loadUnitServiceClassifications(servico.planilha);
  etapa('Carregando as habilitações da unidade...');
  const habil = exigir('habilitacao', 'Planilha de Habilitações da unidade');
  const unitHab = loadUnitHabilitations(habil.planilha);
  const unidadesBases = new Set([detectarUnidade(servico.nome), detectarUnidade(habil.nome)].filter(Boolean));
  if (unidadesBases.size > 1) throw new Error('Selecione as planilhas de Serviço/Classificação e Habilitação da mesma unidade.');
  const detectada = [...unidadesBases][0];
  if (detectada && unidade && normText(detectada) !== normText(unidade)) {
    throw new Error(`As planilhas da unidade são de ${detectada}, mas a unidade selecionada é ${unidade}. Selecione as planilhas da mesma unidade.`);
  }
  etapa('Carregando a planilha de Profissionais...');
  const prof = exigir('profissionais', 'Planilha de Profissionais da unidade (colunas CNS e CBO)');
  const profissionais = loadProfissionais(prof.planilha);
  const paresCpf = [...profissionais].filter((p) => p.split('|')[0].length === 11).length;
  etapa(`Cadastro de profissionais: ${prof.nome} (${profissionais.size - paresCpf} pares CNS/CBO e ${paresCpf} pares CPF/CBO).`);
  const regraUnidade = ['HJXXIII', 'HIJPII'].includes(normText(unidade)) ? unidade : null;
  etapa(`Unidade identificada: ${unidade || 'generica (sem regras especificas)'}${regraUnidade ? '' : ' (sem regras específicas de HJXXIII/HIJPII)'}.`);
  if (formato === 'txt') {
    etapa('Convertendo o layout posicional para o espelho da AIH...');
    espelho = converterSisaih01ParaEspelho(conteudo, sigtap.descricoes);
  }
  etapa('Identificando AIHs e procedimentos...');
  const rows = extract(espelho, sigtap.regras, unitService, unitHab, profissionais, etapa, unidade);
  if (!rows.length) throw new Error('Nenhum procedimento foi encontrado no arquivo selecionado.');
  etapa('Gerando o consolidado em Excel e CSV...');
  const stem = entrada.nome.replace(/\.[^.]+$/, '');
  const saida = await gerarSaidas(rows, entrada.nome, inicio);
  etapa(`Concluído em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1).replace('.', ',')} s.`);
  return {
    ferramenta: 'hospitalar',
    unidade,
    competencia: competenciaProducao,
    sigtap: { rotulo: sigtap.rotulo, competencia: sigtap.competencia },
    avisos,
    log,
    arquivos: {
      xlsx: { nome: `${stem}_FaturaFhemig.xlsx`, bytes: saida.xlsx },
      csv: { nome: `${stem}_FaturaFhemig.csv`, texto: saida.csv },
      espelho: { nome: `${stem}_espelho.txt`, texto: espelho },
    },
    resumo: {
      kpis: saida.ind.kpis.map((k) => ({ rotulo: k.rotulo, valor: k.valor, destaque: k.rotulo === 'AIHs com alerta' })),
      alertas: saida.counts.map((c) => ({ rotulo: c.label, cor: c.color, aihs: c.aihs, procedimentos: c.procedimentos })),
      cti: saida.cti,
      mensal: saida.mensal,
      top: saida.top,
      ocorrencias: saida.records.map((r) => ({
        tipo: r['Tipo de alerta'], aih: r.AIH, paciente: r['Nome paciente'], linha: r['Linha do procedimento'],
        procedimento: r.Procedimento, cbo: r.CBO, detalhe: r.Detalhe,
      })),
    },
    rows,
  };
}
