// Entradas do Hospitalar 14.3: TXT posicional do SISAIH01 (convertido para o
// texto do espelho da AIH) e PDF do espelho (texto extraido por posicao).
// Port de ler_txt, _agrupar_registros, _procedimentos_do_registro,
// converter_sisaih01_para_espelho, competencia_producao_* e extrair_espelho_pdf.
import { decodeUtf8Estrito, decodeCp1252Estrito, decodeLatin1, chaveDoMaior } from '../comum/texto.js';

const TAMANHO_REGISTRO = 1800;
const POS = {
  AIH: [43, 56], TIPO: [56, 58], INTERNACAO: [144, 152], SAIDA: [152, 160], SOLICITADO: [160, 170],
  PRINCIPAL: [171, 181], CID: [249, 253], PACIENTE: [268, 338], NASCIMENTO: [338, 346], SEXO: [346, 347],
  MAE: [349, 419], PRONTUARIO: [640, 655], CID_SEC: [1590, 1635], COMPETENCIA: [11, 17],
};
const INICIO_PROCEDIMENTOS = 663;
const TAMANHO_PROCEDIMENTO = 79;
const MAXIMO_PROCEDIMENTOS = 9;
const SEXO_POR_CODIGO = { M: 'MASCULINO', F: 'FEMININO' };
const TIPOS_REGISTRO_AIH = ['01', '03', '05'];
const TIPOS_REGISTRO_CABECALHO = ['01', '05'];
const TIPO_DOCUMENTO_CPF = '1';
export const DESCRICAO_PADRAO = 'PROCEDIMENTO SEM DESCRICAO NO SIGTAP';

/** ler_txt: utf-8-sig, utf-8, cp1252, latin-1. */
export function lerTxt(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!decodeLatin1(u8).trim()) throw new Error('O arquivo TXT esta vazio.');
  let conteudo = null;
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) conteudo = decodeUtf8Estrito(u8.subarray(3));
  if (conteudo === null) conteudo = decodeUtf8Estrito(u8);
  if (conteudo === null) conteudo = decodeCp1252Estrito(u8);
  if (conteudo === null) conteudo = decodeLatin1(u8);
  conteudo = conteudo.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!conteudo.trim()) throw new Error('O arquivo TXT nao possui texto utilizavel.');
  return conteudo;
}

const campo = (r, [a, b]) => r.slice(a, b).trim();

function dataBrPos(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length !== 8 || d === '00000000') return '';
  const [ano, mes, dia] = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)];
  if (mes === '00' || dia === '00') return '';
  return `${dia}/${mes}/${ano}`;
}

export function competenciaBr(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length !== 6 || d === '000000') return '';
  return `${d.slice(4, 6)}/${d.slice(0, 4)}`;
}

function codigoFormatado(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length !== 10 || d === '0000000000') return '';
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6, 9)}-${d[9]}`;
}

function numeroSignificativo(valor) {
  return String(valor || '').replace(/\D/g, '').replace(/^0+/, '') || '';
}

function cnesOuCnpj(valor) {
  const d = String(valor || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return '';
  return d.length <= 7 ? d.padStart(7, '0') : d.padStart(14, '0');
}

function numeroAih(registro) {
  const d = campo(registro, POS.AIH).replace(/\D/g, '');
  if (d.length !== 13 || !d.replace(/0/g, '')) return '';
  return `${d.slice(0, 12)}-${d[12]}`;
}

function cidsSecundarios(registro) {
  const bruto = registro.slice(POS.CID_SEC[0], POS.CID_SEC[1]);
  const achados = [];
  for (let i = 0; i < bruto.length - 4; i += 5) {
    const cid = bruto.slice(i, i + 4).trim().toUpperCase();
    if (/^[A-Z][0-9]{2,3}$/.test(cid) && !achados.includes(cid)) achados.push(cid);
  }
  return achados;
}

function procedimentosDoRegistro(registro) {
  const itens = [];
  for (let i = 0; i < MAXIMO_PROCEDIMENTOS; i += 1) {
    const inicio = INICIO_PROCEDIMENTOS + TAMANHO_PROCEDIMENTO * i;
    const bloco = registro.slice(inicio, inicio + TAMANHO_PROCEDIMENTO);
    if (bloco.length < TAMANHO_PROCEDIMENTO) break;
    const codigo = bloco.slice(54, 64).replace(/\D/g, '');
    if (codigo.length !== 10 || !codigo.replace(/0/g, '')) continue;
    const competencia = competenciaBr(bloco.slice(67, 73));
    if (!competencia) continue;
    const quantidade = numeroSignificativo(bloco.slice(64, 67)) || '0';
    let documento = bloco.slice(1, 16).replace(/\D/g, '');
    if (bloco.slice(0, 1) === TIPO_DOCUMENTO_CPF && documento.replace(/0/g, '')) documento = documento.slice(-11).padStart(11, '0');
    const cbo = bloco.slice(16, 22).toUpperCase().replace(/[^0-9A-Z]/g, '');
    const servico = bloco.slice(73, 76).replace(/\D/g, '');
    const classificacao = bloco.slice(76, 79).replace(/\D/g, '');
    itens.push({
      codigo, quantidade, competencia,
      documento: documento.replace(/0/g, '') ? documento : '',
      cbo: cbo.replace(/0/g, '') ? cbo : '',
      executante: cnesOuCnpj(bloco.slice(24, 38)),
      apuracao: cnesOuCnpj(bloco.slice(40, 54)),
      servico: servico.replace(/0/g, '') ? servico : '',
      classificacao: classificacao.replace(/0/g, '') ? classificacao : '',
    });
  }
  return itens;
}

function agruparRegistros(conteudo) {
  const ordem = [];
  const dados = new Map();
  for (const linha of conteudo.split('\n')) {
    let registro = linha;
    if (!registro.trim() || registro.length < INICIO_PROCEDIMENTOS) continue;
    registro = registro.padEnd(TAMANHO_REGISTRO);
    const tipo = campo(registro, POS.TIPO);
    if (!TIPOS_REGISTRO_AIH.includes(tipo)) continue;
    const aih = numeroAih(registro);
    if (!aih) continue;
    if (!dados.has(aih)) {
      ordem.push(aih);
      dados.set(aih, { cabecalho: null, registros: [] });
    }
    const g = dados.get(aih);
    if (TIPOS_REGISTRO_CABECALHO.includes(tipo) && g.cabecalho === null) g.cabecalho = registro;
    g.registros.push(registro);
  }
  return ordem.map((aih) => [aih, dados.get(aih)]);
}

function linhaProcedimento(numero, item, descricoes) {
  const partes = [String(numero), item.codigo];
  if (item.documento) partes.push(item.documento);
  if (item.cbo) partes.push(item.cbo);
  partes.push(item.executante || '0', item.apuracao || '0', item.quantidade, item.competencia);
  partes.push((descricoes && descricoes.get(item.codigo)) || DESCRICAO_PADRAO);
  return partes.join(' ');
}

/** converter_sisaih01_para_espelho */
export function converterSisaih01ParaEspelho(conteudo, descricoes) {
  const blocos = [];
  for (const [aih, grupo] of agruparRegistros(conteudo)) {
    const cab = grupo.cabecalho || grupo.registros[0];
    const procedimentos = grupo.registros.flatMap(procedimentosDoRegistro);
    const linhas = [`Num AIH : ${aih}`];
    const paciente = campo(cab, POS.PACIENTE) || 'NAO INFORMADO';
    const prontuario = numeroSignificativo(campo(cab, POS.PRONTUARIO)) || '0';
    linhas.push(`Paciente : ${paciente} Prontuário : ${prontuario}`);
    const mae = campo(cab, POS.MAE);
    if (mae) linhas.push(`Nome da Mae : ${mae}`);
    const nascimento = dataBrPos(campo(cab, POS.NASCIMENTO));
    const sexo = SEXO_POR_CODIGO[campo(cab, POS.SEXO).toUpperCase()] || 'NAO INFORMADO';
    linhas.push(`Data Nasc. : ${nascimento} Sexo : ${sexo}`);
    linhas.push(`Data internação : ${dataBrPos(campo(cab, POS.INTERNACAO))} Data saída : ${dataBrPos(campo(cab, POS.SAIDA))}`);
    const solicitado = codigoFormatado(campo(cab, POS.SOLICITADO));
    if (solicitado) linhas.push(`Procedimento solicitado : ${solicitado}`);
    linhas.push(`Procedimento principal : ${codigoFormatado(campo(cab, POS.PRINCIPAL))}`);
    const cid = campo(cab, POS.CID).toUpperCase();
    if (/^[A-Z][0-9]{2,3}$/.test(cid)) linhas.push(`Diag. principal : ${cid}-${(descricoes && descricoes.get(`CID:${cid}`)) || 'NAO INFORMADO'}`);
    linhas.push('PROCEDIMENTOS REALIZADOS');
    linhas.push('Linha Procedimento Documento CBO CNES/CNPJ Apurar Valor p/ Qtde Cmpt Descricao');
    const servicos = [];
    procedimentos.forEach((item, i) => {
      linhas.push(linhaProcedimento(i + 1, item, descricoes));
      if (item.servico && item.classificacao) servicos.push(`${i + 1} ${item.servico} ${item.classificacao}`);
    });
    linhas.push('SERVICO/CLASSIFICACAO', 'Linha Servico Classificacao', ...servicos);
    linhas.push('CID SECUNDÁRIO', 'Cid Caracteristica Descricao');
    for (const c of cidsSecundarios(cab)) linhas.push(`${c} 1 NAO INFORMADO`);
    blocos.push(linhas.join('\n'));
  }
  if (!blocos.length) throw new Error('O arquivo TXT nao possui registros de AIH no layout do SISAIH01.');
  return `${blocos.join('\n')}\n`;
}

/** competencia_producao_txt: AAAAMM mais frequente nos registros de AIH. */
export function competenciaProducaoTxt(conteudo) {
  const cont = new Map();
  for (const linha of conteudo.split('\n')) {
    if (linha.length < INICIO_PROCEDIMENTOS) continue;
    if (!TIPOS_REGISTRO_AIH.includes(campo(linha, POS.TIPO))) continue;
    const v = campo(linha, POS.COMPETENCIA);
    if (/^\d{4}(0[1-9]|1[0-2])$/.test(v)) cont.set(v, (cont.get(v) || 0) + 1);
  }
  return cont.size ? chaveDoMaior(cont) : '';
}

/** competencia_producao_pdf */
export function competenciaProducaoPdf(conteudo) {
  const cont = new Map();
  for (const m of conteudo.matchAll(/Apresenta[çc][ãa]o\s*:\s*(0[1-9]|1[0-2])\s*\/\s*(\d{4})/gi)) {
    const k = m[2] + m[1];
    cont.set(k, (cont.get(k) || 0) + 1);
  }
  return cont.size ? chaveDoMaior(cont) : '';
}

/**
 * extrair_espelho_pdf com pdf.js: trechos agrupados pela linha de base (tolerancia
 * de 2pt) e, dentro da linha, trechos sobrepostos separados em camadas.
 * pdfjsLib: modulo pdfjs-dist ja configurado (navegador ou Node).
 */
export async function extrairEspelhoPdf(pdfjsLib, bytes) {
  let doc;
  const tarefa = pdfjsLib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  try {
    doc = await tarefa.promise;
  } catch (erro) {
    if (erro && erro.name === 'PasswordException') throw new Error('O PDF está protegido por senha.');
    throw new Error(`Não foi possível abrir o PDF (${erro.message}).`);
  }
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const pagina = await doc.getPage(n);
    const altura = pagina.getViewport({ scale: 1 }).height;
    const conteudo = await pagina.getTextContent();
    const spans = [];
    const vistos = new Set();
    for (const it of conteudo.items) {
      const texto = (it.str || '').trim();
      if (!texto) continue;
      const x0 = it.transform[4];
      const y = altura - it.transform[5];
      const x1 = x0 + (it.width || 0);
      const chave = `${texto}|${x0.toFixed(1)}|${y.toFixed(1)}|${x1.toFixed(1)}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      spans.push([y, x0, x1, texto]);
    }
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
    const faixas = [];
    for (const s of spans) {
      if (!faixas.length || Math.abs(s[0] - faixas[faixas.length - 1][0][0]) > 2) faixas.push([s]);
      else faixas[faixas.length - 1].push(s);
    }
    const linhas = [];
    for (const faixa of faixas) {
      const camadas = [];
      for (const s of [...faixa].sort((a, b) => a[1] - b[1])) {
        const alvo = camadas.find((c) => s[1] >= c[c.length - 1][2] - 1);
        if (alvo) alvo.push(s);
        else camadas.push([s]);
      }
      for (const c of camadas) linhas.push(c.map((s) => s[3]).join(' '));
    }
    paginas.push(linhas.join('\n').trim());
  }
  await tarefa.destroy();
  const resultado = paginas.join('\n\f\n').trim();
  if (!resultado) throw new Error('O PDF não possui texto extraível. PDFs digitalizados precisam de OCR.');
  return `${resultado}\n`;
}
