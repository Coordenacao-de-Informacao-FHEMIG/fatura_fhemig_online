// ChecaProfissionais 2.0 — processar() (backend.py) e pacote Excel (core/relatorio.py).
import regras from './config/regras.json' with { type: 'json' };
import alertasCfg from './config/alertas.json' with { type: 'json' };
import unidadesCfg from './config/unidades.json' with { type: 'json' };
import { lerFonte, ErroEstrutura, ErroUnidade, mascarar } from './leitura.js';
import { executar, cbosAssistenciais, resumoAlertas, ELEGIVEL, EXCLUIDO_ADC, ESPECIAL, SEM_IDENTIFICADOR, ANALISADO } from './regras.js';
import { cmpTupla, fmtDataHora, pad, sortedStr } from '../comum/texto.js';
import { novaPasta, gravar, preenchimento, cor, letra } from '../comum/xlsx.js';
import { sha256Hex } from '../comum/planilha.js';

export const APP_VERSION = 'ChecaProfissionais 2.0 - 03/11/2026 (versão online)';
export { ErroEstrutura, ErroUnidade };

const COR_PRIMARIA = '008EA7';
const COR_SEVERIDADE = { Crítica: 'F5B7B1', Alta: 'FAD7A0', Média: 'FCF3CF', Baixa: 'D6EAF8', Informativa: 'EAEDED' };
const COLUNAS_TEXTO = new Set(['CPF', 'CNS', 'CBO', 'CNES', 'CNS Tasy', 'CNS CNES', 'CPF original', 'CPF normalizado', 'CNS original',
  'CNS normalizado', 'CBO original', 'CBO normalizado', 'CBOs Tasy', 'CBOs CNES', 'CBOs comuns', 'Somente Tasy', 'Somente CNES',
  'Linhas Tasy', 'Linhas CNES', 'Valor Tasy', 'Valor CNES', 'Cd estabelecimento', 'RG Tasy', 'RG CNES', 'CBOs assistenciais',
  'Assistenciais no Tasy', 'Assistenciais no CNES']);
export const COLS_ALERTAS = ['Severidade', 'ID', 'Código técnico', 'Alerta', 'Mensagem', 'Unidade', 'Nome', 'CPF', 'CNS', 'CBO', 'Valor Tasy',
  'Valor CNES', 'Fonte', 'Origem Tasy', 'Origem CNES', 'Ação recomendada'];
const CAB = { bold: true, color: { argb: 'FFFFFFFF' } };

const origem = (fonte, linhas) => (linhas ? `${fonte.arquivo} | ${fonte.aba} | linhas ${linhas}` : '');
const linhaAlerta = (a, res) => [a.severidade, a.id, a.codigo, a.nome_negocio, a.mensagem, a.unidade, a.nome, a.cpf, a.cns, a.cbo, a.valor_tasy,
  a.valor_cnes, a.fonte, origem(res.tasy, a.linhas_tasy), origem(res.cnes, a.linhas_cnes), a.acao];

function aba(wb, titulo, colunas, linhas, larguras = {}, descricao = '') {
  const ws = wb.addWorksheet(titulo);
  let inicio = 1;
  if (descricao) {
    const c = ws.getCell(1, 1);
    c.value = descricao;
    c.font = { italic: true, color: cor('5B6B7B') };
    inicio = 3;
  }
  colunas.forEach((nome, j) => {
    const c = ws.getCell(inicio, j + 1);
    c.value = nome;
    c.font = CAB;
    c.fill = preenchimento(COR_PRIMARIA);
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  const texto = new Set(colunas.map((n, j) => (COLUNAS_TEXTO.has(n) ? j : -1)).filter((j) => j >= 0));
  const jSev = colunas.indexOf('Severidade');
  linhas.forEach((valores, i) => {
    const r = inicio + 1 + i;
    valores.forEach((v0, j) => {
      let v = v0;
      if (texto.has(j) && v !== null && v !== undefined && v !== '') v = String(v);
      const c = ws.getCell(r, j + 1);
      c.value = v === undefined || v === '' ? null : v;
      if (texto.has(j)) c.numFmt = '@';
    });
    if (jSev >= 0 && COR_SEVERIDADE[valores[jSev]]) ws.getCell(r, jSev + 1).fill = preenchimento(COR_SEVERIDADE[valores[jSev]]);
  });
  ws.views = [{ state: 'frozen', ySplit: inicio }];
  if (linhas.length) ws.autoFilter = `A${inicio}:${letra(colunas.length)}${inicio + linhas.length}`;
  colunas.forEach((nome, j) => {
    let larg = larguras[nome];
    if (larg === undefined) {
      const amostra = linhas.slice(0, 300).map((r) => r[j]).filter((x) => x !== null && x !== undefined && x !== '').map((x) => String(x).length + 2);
      larg = Math.min(Math.max(nome.length + 2, ...amostra), 60);
    }
    ws.getColumn(j + 1).width = larg;
  });
  return ws;
}

function descricoesCbo(res) {
  const desc = new Map([...res.assistenciais].filter(([, d]) => d));
  for (const ln of res.cnes.linhas) {
    const d = ln.valor('descricao_cbo');
    if (ln.cbo && d && !desc.has(ln.cbo)) desc.set(ln.cbo, d);
  }
  return desc;
}
const comDescricao = (cbos, desc) => sortedStr(cbos).map((c) => (desc.has(c) ? `${c} - ${desc.get(c)}` : c)).join('; ');
const lista = (s) => new Set(String(s || '').split(', ').filter(Boolean));

function resumo(wb, res, meta) {
  const ws = wb.addWorksheet('Resumo_Executivo');
  const { indicadores: ind, unidade: u, catalogo: cat } = res;
  ws.getColumn(1).width = 52;
  for (let c = 2; c <= 6; c += 1) ws.getColumn(c).width = 22;
  ws.getCell('A1').value = `ChecaProfissionais - ${u.sigla} - ${u.nome}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: cor(COR_PRIMARIA) };
  ws.getCell('A2').value = `CNES ${u.cnes} | Tasy ${u.tasy} | Executado em ${meta.data_hora} | ${meta.versao}`;
  ws.getCell('A2').font = { color: cor('5B6B7B') };
  let linha = 4;
  const bloco = (titulo, cab, linhas) => {
    const t = ws.getCell(linha, 1);
    t.value = titulo;
    t.font = { bold: true, size: 12, color: cor(COR_PRIMARIA) };
    linha += 1;
    cab.forEach((n, j) => {
      const c = ws.getCell(linha, j + 1);
      c.value = n;
      c.font = CAB;
      c.fill = preenchimento(COR_PRIMARIA);
    });
    linha += 1;
    for (const valores of linhas) {
      valores.forEach((v, j) => {
        const c = ws.getCell(linha, j + 1);
        c.value = v === '' ? null : v;
        c.border = { bottom: { style: 'thin', color: cor('D6E2E5') } };
        if (Number.isInteger(v)) c.numFmt = '#,##0';
      });
      linha += 1;
    }
    linha += 1;
  };
  const porCod = ind.alertas_por_codigo;
  bloco('Alertas principais', ['Alerta', 'Código técnico', 'Ocorrências', 'Severidade'],
    cat.principais.map((c) => [cat.alertas[c].nome, c, porCod.get(c) || 0, cat.alertas[c].severidade]));
  const pares = ind.pessoas_nas_duas;
  const tt = ind.trilhas_tasy;
  const tc = ind.trilhas_cnes;
  bloco('Indicadores', ['Indicador', 'Tasy', 'CNES', 'ADC'], [
    ['Linhas lidas', ind.linhas_tasy, ind.linhas_cnes, ind.linhas_adc],
    ['Linhas retiradas por pertencerem à ADC', tt[EXCLUIDO_ADC], tc[EXCLUIDO_ADC], ''],
    ['Pessoas retiradas por pertencerem à ADC', ind.pessoas_excluidas_adc_tasy, ind.pessoas_excluidas_adc_cnes, ''],
    ['Linhas especiais (teste, painel, totem)', tt[ESPECIAL], tc[ESPECIAL], ''],
    ['Linhas sem CPF e sem CNS', tt[SEM_IDENTIFICADOR], tc[SEM_IDENTIFICADOR], ''],
    ['Linhas analisadas', tt[ANALISADO], tc[ANALISADO], ''],
    ['Linhas repetidas (duplicidade exata)', res.tasy.linhas.filter((l) => l.duplicada).length, res.cnes.linhas.filter((l) => l.duplicada).length, ''],
    ['Pessoas únicas analisadas', ind.pessoas_tasy, ind.pessoas_cnes, ''],
    ['Pessoas elegíveis (com CBO)', ind.elegiveis_tasy, ind.pessoas_cnes, ''],
    ['Pessoas em revisão (sem CBO no Tasy)', ind.revisao_tasy, '', ''],
    ['Pessoas encontradas nas duas fontes', pares, pares, ''],
    ['   cruzadas por CNS (Tasy sem CPF válido)', ind.cruzadas_por_cns, ind.cruzadas_por_cns, ''],
    ['   com o mesmo conjunto de CBOs', ind.cbo_consistente, ind.cbo_consistente, ''],
    ['   com CBOs diferentes', ind.cbo_divergente, ind.cbo_divergente, ''],
    ['   com o mesmo CNS', ind.cns_consistente, ind.cns_consistente, ''],
    ['   com CNS diferente', ind.cns_divergente, ind.cns_divergente, ''],
    ['Profissional não encontrado na outra fonte', porCod.get('PROFISSIONAL_NAO_ENCONTRADO_CNES') || 0, porCod.get('PROFISSIONAL_NAO_ENCONTRADO_TASY') || 0, ''],
    ['Sem CBO no Tasy e fora do CNES (revisão)', ind.revisao_sem_cnes, '', ''],
    ['Pessoas na matriz sem nenhum alerta', ind.sem_alerta, '', ''],
    ['Profissionais com CBO assistencial', ind.pessoas_cbo_assistencial, '', ''],
    ['   CBOs assistenciais na planilha do faturamento', ind.cbos_assistenciais_base, '', ''],
    ['Pessoas cruzadas por RG (só se Tasy e CNES trouxerem RG)', ind.rg_disponivel ? ind.cruzadas_por_rg : 'sem RG nas planilhas', '', ''],
  ]);
  const somaT = Object.values(tt).reduce((a, b) => a + b, 0);
  const somaC = Object.values(tc).reduce((a, b) => a + b, 0);
  bloco('Fechamento de volume (9.1)', ['Fonte', 'Linhas lidas', 'ADC + especiais + sem identificador + analisadas', 'Fecha?'], [
    ['Tasy', ind.linhas_tasy, `${tt[EXCLUIDO_ADC]} + ${tt[ESPECIAL]} + ${tt[SEM_IDENTIFICADOR]} + ${tt[ANALISADO]} = ${somaT}`, ind.fechamento_tasy ? 'Sim' : 'NÃO'],
    ['CNES', ind.linhas_cnes, `${tc[EXCLUIDO_ADC]} + ${tc[ESPECIAL]} + ${tc[SEM_IDENTIFICADOR]} + ${tc[ANALISADO]} = ${somaC}`, ind.fechamento_cnes ? 'Sim' : 'NÃO'],
  ]);
  bloco('Alertas por severidade', ['Severidade', 'Ocorrências'], cat.ordem.map((s) => [s, ind.alertas_por_severidade.get(s) || 0]));
  const porCodigo = [...porCod.entries()].sort((x, y) => cmpTupla([cat.rank(cat.alertas[x[0]].severidade), cat.alertas[x[0]].id], [cat.rank(cat.alertas[y[0]].severidade), cat.alertas[y[0]].id]));
  bloco('Alertas por tipo', ['Alerta', 'ID', 'Código técnico', 'Severidade', 'Ocorrências'],
    porCodigo.map(([c, q]) => [cat.alertas[c].nome, cat.alertas[c].id, c, cat.alertas[c].severidade, q]));
  bloco('Arquivos utilizados', ['Fonte', 'Arquivo', 'Aba', 'Linha do cabeçalho', 'SHA-256'], [
    ['Tasy', res.tasy.arquivo, res.tasy.aba, res.tasy.linha_cabecalho, res.tasy.sha256],
    ['CNES', res.cnes.arquivo, res.cnes.aba, res.cnes.linha_cabecalho, res.cnes.sha256],
    [`ADC (${meta.adc_origem})`, res.adc.arquivo, res.adc.aba, res.adc.linha_cabecalho, res.adc.sha256],
    ...(res.cbo_assist ? [[`CBO assistencial (${meta.cbo_origem})`, res.cbo_assist.arquivo, res.cbo_assist.aba, res.cbo_assist.linha_cabecalho, res.cbo_assist.sha256]] : []),
  ]);
  const aviso = ws.getCell(linha, 1);
  aviso.value = 'Dados pessoais (CPF, CNS e nome) para correção cadastral: circular apenas entre os responsáveis por Tasy, CNES e ADC da unidade.';
  aviso.font = { italic: true, color: cor('C0392B') };
}

export async function gerarExcel(res, meta) {
  const wb = novaPasta();
  resumo(wb, res, meta);
  const cat = res.catalogo;
  const desc = descricoesCbo(res);
  aba(wb, 'Alertas', COLS_ALERTAS, res.alertas.map((a) => linhaAlerta(a, res)), { Mensagem: 70, 'Ação recomendada': 50, 'Origem Tasy': 40, 'Origem CNES': 40 },
    'Uma linha por ocorrência. Filtre por "Alerta" ou "Severidade". Uma pessoa pode ter vários alertas.');
  const colsM = res.matriz.length ? Object.keys(res.matriz[0]) : ['Presença'];
  aba(wb, 'Matriz_Profissionais', colsM, res.matriz.map((r) => Object.values(r)), {},
    'Uma linha por pessoa, com os CBOs de Tasy e CNES agregados. As linhas de origem estão em Evidencias_Linhas.');
  const ausentes = [];
  for (const r of res.matriz) {
    if (r.Presença === 'SOMENTE TASY') {
      const sit = r.Elegibilidade === ELEGIVEL ? cat.alertas.PROFISSIONAL_NAO_ENCONTRADO_CNES.nome : 'Elegibilidade em revisão (sem CBO no Tasy)';
      ausentes.push([sit, r['Nome Tasy'], r.CPF, r['CNS Tasy'], comDescricao(lista(r['CBOs Tasy']), desc), r.Elegibilidade, r['Motivo elegibilidade'],
        r['Funcionário?'], r.Vínculo, origem(res.tasy, r['Linhas Tasy']), '']);
    } else if (r.Presença === 'SOMENTE CNES') {
      ausentes.push([cat.alertas.PROFISSIONAL_NAO_ENCONTRADO_TASY.nome, r['Nome CNES'], r.CPF, r['CNS CNES'], comDescricao(lista(r['CBOs CNES']), desc),
        r.Elegibilidade, '', '', '', '', origem(res.cnes, r['Linhas CNES'])]);
    }
  }
  aba(wb, 'Ausentes', ['Situação', 'Nome', 'CPF', 'CNS', 'CBOs', 'Elegibilidade', 'Motivo', 'Funcionário?', 'Vínculo', 'Origem Tasy', 'Origem CNES'], ausentes,
    { CBOs: 50, Situação: 40 }, 'Pessoas que estão em uma fonte e não na outra, depois de retirar a ADC e os cadastros especiais.');
  const divCbo = res.matriz.filter((r) => r.Presença === 'TASY E CNES' && r['Situação CBO'] !== 'CBO_CONSISTENTE').map((r) => [
    r['Situação CBO'], r['Nome Tasy'] || r['Nome CNES'], r.CPF, r['CBOs Tasy'], r['CBOs CNES'], r['CBOs comuns'], r['Somente Tasy'], r['Somente CNES'],
    comDescricao(lista(r['Somente Tasy']), desc), comDescricao(lista(r['Somente CNES']), desc), r.Alertas, origem(res.tasy, r['Linhas Tasy']), origem(res.cnes, r['Linhas CNES'])]);
  aba(wb, 'Divergencias_CBO', ['Situação CBO', 'Nome', 'CPF', 'CBOs Tasy', 'CBOs CNES', 'CBOs comuns', 'Somente Tasy', 'Somente CNES',
    'Somente Tasy (descrição CNES)', 'Somente CNES (descrição)', 'Alertas', 'Origem Tasy', 'Origem CNES'], divCbo,
  { 'Somente Tasy (descrição CNES)': 45, 'Somente CNES (descrição)': 45 },
  'Pessoas nas duas fontes com conjuntos de CBO diferentes (a comparação é pelos códigos, não pela quantidade).');
  const divCns = res.matriz.filter((r) => r.Presença === 'TASY E CNES' && r['Situação CNS'] !== 'CONSISTENTE').map((r) => [
    r['Situação CNS'], r['Nome Tasy'] || r['Nome CNES'], r.CPF, r['CNS Tasy'], r['CNS CNES'], r['Chave de cruzamento'], origem(res.tasy, r['Linhas Tasy']), origem(res.cnes, r['Linhas CNES'])]);
  aba(wb, 'Divergencias_CNS', ['Situação CNS', 'Nome', 'CPF', 'CNS Tasy', 'CNS CNES', 'Chave de cruzamento', 'Origem Tasy', 'Origem CNES'], divCns, {},
    'Pessoas nas duas fontes cujo CNS não confere. Conflitos de mesmo CNS em CPFs diferentes estão em Qualidade_Dados.');
  const assist = new Set(res.assistenciais.keys());
  const cboA = [];
  for (const r of res.matriz) {
    if (r['CBO assistencial?'] !== 'Sim') continue;
    const noT = new Set([...lista(r['CBOs Tasy'])].filter((x) => assist.has(x)));
    const noC = new Set([...lista(r['CBOs CNES'])].filter((x) => assist.has(x)));
    cboA.push([r['Nome Tasy'] || r['Nome CNES'], r.CPF, r['CNS Tasy'] || r['CNS CNES'], comDescricao(new Set([...noT, ...noC]), desc), sortedStr(noT).join(', '),
      sortedStr(noC).join(', '), r.Presença, r['Situação CBO'], r['Funcionário?'], r.Vínculo, origem(res.tasy, r['Linhas Tasy']), origem(res.cnes, r['Linhas CNES'])]);
  }
  aba(wb, 'CBO_Assistencial', ['Nome', 'CPF', 'CNS', 'CBOs assistenciais', 'Assistenciais no Tasy', 'Assistenciais no CNES', 'Presença', 'Situação CBO',
    'Funcionário?', 'Vínculo', 'Origem Tasy', 'Origem CNES'], cboA, { 'CBOs assistenciais': 55 },
  `Profissionais da unidade (sem a ADC) com pelo menos um CBO marcado como assistencial na planilha do faturamento (${res.cbo_assist ? res.cbo_assist.arquivo : 'não informada'}).`);
  const todas = [...res.tasy.linhas, ...res.cnes.linhas];
  const excl = todas.filter((ln) => ln.trilha === EXCLUIDO_ADC).map((ln) => [ln.fonte, ln.arquivo, ln.aba, ln.linha, ln.nome, ln.cpf, ln.cns, ln.cbo, ln.adc_chave, ln.adc_linha, ln.motivo_trilha]);
  aba(wb, 'Exclusoes_ADC', ['Fonte', 'Arquivo', 'Aba', 'Linha', 'Nome', 'CPF', 'CNS', 'CBO', 'Chave usada', 'Linha ADC', 'Motivo'], excl, {},
    `Linhas retiradas logicamente da análise por pertencerem à ADC (${res.adc.arquivo}). A linha original continua no arquivo de origem e em Evidencias_Linhas.`);
  const qual = res.alertas.filter((a) => (a.categoria === 'Qualidade' || a.categoria === 'CNS') && a.codigo !== 'CNS_DIVERGENTE').map((a) => linhaAlerta(a, res));
  aba(wb, 'Qualidade_Dados', COLS_ALERTAS, qual, { Mensagem: 70, 'Ação recomendada': 50, 'Origem Tasy': 40, 'Origem CNES': 40 },
    'CPF/CNS/CBO ausentes ou inválidos, conflitos de CNS, nomes divergentes e duplicidades.');
  const esp = todas.filter((ln) => ln.trilha === ESPECIAL || ln.trilha === SEM_IDENTIFICADOR).map((ln) => [ln.fonte, ln.arquivo, ln.aba, ln.linha, ln.trilha, ln.motivo_trilha, ln.nome, ln.cpf, ln.cns, ln.cbo]);
  aba(wb, 'Registros_Especiais', ['Fonte', 'Arquivo', 'Aba', 'Linha', 'Trilha', 'Motivo', 'Nome', 'CPF', 'CNS', 'CBO'], esp, {},
    'Cadastros técnicos, de teste e sem identificador: ficam fora da comparação, sem apagar a origem.');
  const pessoas = { TASY: res.pessoas_tasy, CNES: res.pessoas_cnes };
  const ev = todas.map((ln) => {
    const p = pessoas[ln.fonte].get(ln.pessoa);
    return [ln.fonte, ln.arquivo, ln.aba, ln.linha, ln.trilha, ln.motivo_trilha, ln.pessoa, p ? p.elegibilidade : '', ln.nome, ln.valor('cpf'), ln.cpf, ln.cpf_sit,
      ln.valor('cns'), ln.cns, ln.cns_sit, ln.valor('cbo'), ln.cbo, ln.cbo_sit, desc.get(ln.cbo) || '', ln.valor('especialidade'), ln.valor('vinculo'),
      ln.valor('funcionario'), ln.valor('cd_estabelecimento'), ln.valor('estabelecimento'), ln.duplicada ? 'Sim' : '', (p && p.status_final) || ''];
  });
  aba(wb, 'Evidencias_Linhas', ['Fonte', 'Arquivo', 'Aba', 'Linha', 'Trilha', 'Motivo', 'Chave pessoa', 'Elegibilidade', 'Nome', 'CPF original',
    'CPF normalizado', 'Situação CPF', 'CNS original', 'CNS normalizado', 'Situação CNS', 'CBO original', 'CBO normalizado', 'Situação CBO',
    'Descrição CBO (CNES)', 'Especialidade', 'Vínculo', 'Funcionário?', 'Cd estabelecimento', 'Estabelecimento', 'Repetida', 'Status final da pessoa'], ev, {},
  'Toda linha lida do Tasy e do CNES, com a trilha de decisão (RN-20, RN-26).');
  aba(wb, 'Parametros', ['Parâmetro', 'Valor'], meta.parametros, { Parâmetro: 40, Valor: 90 });
  return gravar(wb);
}

const carimboChecaData = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

async function hashConfig(obj) {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(obj)));
}

/**
 * processar(): tasy, cnes, adc, cbo = {nome, bytes, origem?}. adc/cbo vem das
 * bases padrao (servidor) ou do envio do usuario.
 */
export async function processarChecaProfissionais({ tasy: tasyArq, cnes: cnesArq, adc: adcArq, cbo: cboArq, unidade: unidadeSelecionada, notify = () => {} }) {
  const inicio = new Date();
  const log = [];
  const L = (msg, tela = true) => {
    log.push(`${fmtDataHora(inicio)}  ${msg}`.replace(fmtDataHora(inicio), fmtDataHora(new Date())));
    if (tela) notify(msg);
  };
  if (!adcArq) throw new ErroEstrutura('A instalação está sem a base ADC padrão (Profissionais ADC.xlsx). Selecione uma ADC existente na máquina.');
  if (!cboArq) throw new ErroEstrutura('A instalação está sem a planilha padrão de CBO assistencial (CBO_assistencial.xlsx). Selecione uma planilha existente na máquina.');
  const adcOrigem = adcArq.origem || 'LOCAL';
  const cboOrigem = cboArq.origem || 'LOCAL';
  L(APP_VERSION);
  L(`Configuração: regras ${regras.versao}, alertas ${alertasCfg.versao}, unidades ${unidadesCfg.versao}`, false);
  let tasy;
  let cnes;
  let adc;
  let cbo;
  let res;
  let qtdAssist;
  try {
    L('Lendo o Tasy...');
    tasy = await lerFonte(tasyArq, 'TASY', regras);
    L(`  ${tasy.arquivo} | aba ${tasy.aba} | cabeçalho na linha ${tasy.linha_cabecalho} | ${tasy.linhas.length} linhas | sha256 ${tasy.sha256}`);
    L('Lendo o CNES...');
    cnes = await lerFonte(cnesArq, 'CNES', regras);
    L(`  ${cnes.arquivo} | aba ${cnes.aba} | cabeçalho na linha ${cnes.linha_cabecalho} | ${cnes.linhas.length} linhas | sha256 ${cnes.sha256}`);
    L(`Lendo a ADC (${adcOrigem})...`);
    adc = await lerFonte(adcArq, 'ADC', regras);
    L(`  ${adc.arquivo} | aba ${adc.aba} | ${adc.linhas.length} linhas | sha256 ${adc.sha256}`);
    L(`Lendo a planilha de CBO assistencial (${cboOrigem})...`);
    cbo = await lerFonte(cboArq, 'CBO_ASSIST', regras);
    qtdAssist = cbosAssistenciais(cbo, regras).size;
    L(`  ${cbo.arquivo} | aba ${cbo.aba} | ${cbo.linhas.length} CBOs, ${qtdAssist} assistenciais | sha256 ${cbo.sha256}`);
    if (!qtdAssist) throw new ErroEstrutura(`${cbo.arquivo}: nenhum CBO marcado como assistencial.`);
    L('Cruzando Tasy x CNES...');
    res = executar(tasy, cnes, adc, regras, alertasCfg, unidadesCfg, cbo, unidadeSelecionada);
  } catch (erro) {
    const codigo = erro instanceof ErroUnidade ? 'E002 ERRO_UNIDADE_INCOMPATIVEL' : 'E001 ERRO_ESTRUTURA_ARQUIVO';
    L(`INTERROMPIDO - ${codigo}: ${erro.message}`);
    erro.codigo = codigo.split(' ')[0];
    erro.log = log;
    throw erro;
  }
  const { unidade: u, indicadores: ind } = res;
  L(`Unidade: ${u.sigla} - ${u.nome} | CNES ${u.cnes} | Tasy ${u.tasy}`);
  const trilhaTxt = (t) => Object.entries(t).map(([k, v]) => `${k} ${v}`).join(' + ');
  L(`Tasy: ${ind.linhas_tasy} linhas = ${trilhaTxt(ind.trilhas_tasy)}${ind.fechamento_tasy ? ' (fecha)' : ' (NÃO FECHA)'}`);
  L(`CNES: ${ind.linhas_cnes} linhas = ${trilhaTxt(ind.trilhas_cnes)}${ind.fechamento_cnes ? ' (fecha)' : ' (NÃO FECHA)'}`);
  L(`Pessoas: Tasy ${ind.pessoas_tasy} (elegíveis ${ind.elegiveis_tasy}, revisão ${ind.revisao_tasy}) | CNES ${ind.pessoas_cnes} | nas duas ${ind.pessoas_nas_duas} | por RG: ${ind.rg_disponivel ? ind.cruzadas_por_rg : 'sem RG nas planilhas'}`);
  const resumoAl = resumoAlertas(res);
  for (const [nome, codigo, sev, qtd] of resumoAl) L(`  ${String(qtd).padStart(6)}  ${nome} [${codigo}, ${sev}]`, false);
  const prefixo = `${carimboChecaData(inicio)}_${u.sigla}`;
  const hashes = { regras: await hashConfig(regras), alertas: await hashConfig(alertasCfg), unidades: await hashConfig(unidadesCfg) };
  const parametros = [
    ['Versão', APP_VERSION], ['Executado em', fmtDataHora(inicio)], ['Unidade', `${u.sigla} - ${u.nome}`], ['CNES da unidade', u.cnes],
    ['Tasy', `${tasyArq.nome} (aba ${tasy.aba})`], ['CNES', `${cnesArq.nome} (aba ${cnes.aba})`], ['ADC', `${adcArq.nome} (aba ${adc.aba})`],
    ['Origem da ADC', adcOrigem], ['SHA-256 da ADC', adc.sha256], ['CBO assistencial', `${cboArq.nome} (aba ${cbo.aba})`], ['Origem do CBO assistencial', cboOrigem],
    ['SHA-256 do CBO assistencial', cbo.sha256], ['CBOs assistenciais na planilha', String(qtdAssist)],
    ['RG nas planilhas Tasy e CNES', ind.rg_disponivel ? 'Sim' : 'Não (cruzamento por RG inativo)'],
    ['ADC também retirada do CNES', (regras.adc || {}).excluir_tambem_no_cnes !== false ? 'Sim' : 'Não'],
    ['Elegibilidade exige CBO', (regras.elegibilidade || {}).exigir_cbo !== false ? 'Sim' : 'Não'],
    ['Termos de registro especial', ((regras.registros_especiais || {}).termos_nome || []).join(', ')],
    ['CNS sentinela configurados', String((regras.cns_sentinela || []).length)],
    ['CPF sentinela configurados', (regras.cpf_sentinela || []).map(mascarar).join(', ')],
    ['Versão regras.json', `${regras.versao} (sha256 ${hashes.regras.slice(0, 16)}...)`],
    ['Versão alertas.json', `${alertasCfg.versao} (sha256 ${hashes.alertas.slice(0, 16)}...)`],
    ['Versão unidades.json', `${unidadesCfg.versao} (sha256 ${hashes.unidades.slice(0, 16)}...)`],
  ];
  const meta = { data_hora: fmtDataHora(inicio, false), versao: APP_VERSION, adc_origem: adcOrigem, cbo_origem: cboOrigem, parametros };
  L('Gerando o Excel...');
  const xlsx = await gerarExcel(res, meta);
  L(`Excel: ${prefixo}_ChecaProfissionais.xlsx`);
  L(`Concluído em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)} s.`);
  const cat = res.catalogo;
  return {
    ferramenta: 'checa',
    unidade: u.sigla,
    avisos: [],
    log,
    arquivos: {
      xlsx: { nome: `${prefixo}_ChecaProfissionais.xlsx`, bytes: xlsx },
      log: { nome: `${prefixo}_Log_Execucao.txt`, texto: `${log.join('\n')}\n` },
    },
    resumo: {
      unidade: u,
      kpis: [
        { rotulo: 'Linhas lidas no Tasy', valor: ind.linhas_tasy },
        { rotulo: 'Linhas lidas no CNES', valor: ind.linhas_cnes },
        { rotulo: 'Pessoas nas duas fontes', valor: ind.pessoas_nas_duas },
        { rotulo: 'Pessoas sem nenhum alerta', valor: ind.sem_alerta },
        { rotulo: 'Não encontrados no CNES', valor: ind.alertas_por_codigo.get('PROFISSIONAL_NAO_ENCONTRADO_CNES') || 0, destaque: true },
        { rotulo: 'Não encontrados no Tasy', valor: ind.alertas_por_codigo.get('PROFISSIONAL_NAO_ENCONTRADO_TASY') || 0, destaque: true },
        { rotulo: 'Pessoas com CBOs diferentes', valor: ind.cbo_divergente, destaque: true },
        { rotulo: 'Profissionais com CBO assistencial', valor: ind.pessoas_cbo_assistencial },
      ],
      trilhas: { tasy: ind.trilhas_tasy, cnes: ind.trilhas_cnes, fechaTasy: ind.fechamento_tasy, fechaCnes: ind.fechamento_cnes },
      severidades: cat.ordem.map((s) => [s, ind.alertas_por_severidade.get(s) || 0]),
      alertas: resumoAl.map(([nome, codigo, severidade, quantidade]) => ({ rotulo: nome, codigo, severidade, quantidade, principal: cat.principais.includes(codigo) })),
      ocorrencias: res.alertas.map((a) => ({ severidade: a.severidade, id: a.id, tipo: a.nome_negocio, codigo: a.codigo, nome: a.nome, cbo: a.cbo, mensagem: a.mensagem, acao: a.acao })),
    },
    res,
  };
}
