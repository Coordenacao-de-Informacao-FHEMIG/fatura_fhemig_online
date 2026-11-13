// Leitor de .xlsx proprio, equivalente ao openpyxl em modo read_only +
// data_only: cada aba vira uma lista de linhas (null, string, number, boolean
// ou Date), completadas ate a ultima coluna usada.
//
// Por que nao ExcelJS: arquivos exportados por outros sistemas (a planilha do
// SIGTAP, por exemplo) usam prefixos de namespace (<ns0:Relationships>) que o
// ExcelJS nao entende e o openpyxl aceita. Este leitor e tolerante a prefixos
// e roda dentro de Web Worker (sem DOMParser).
import { unzipSync, strFromU8 } from 'fflate';

const P = '(?:[A-Za-z_][\\w.-]*:)?';
const tagRe = (nome, flags = 'g') => new RegExp(`<${P}${nome}\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${P}${nome}>)`, flags);
const attr = (attrs, nome) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${nome}\\s*=\\s*"([^"]*)"`)) || attrs.match(new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${nome}\\s*=\\s*'([^']*)'`));
  return m ? m[1] : null;
};

function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Texto de um <si>/<is>: todos os <t>, ignorando a fonetica (<rPh>). */
function textoRico(xml) {
  const sem = xml.replace(new RegExp(`<${P}rPh\\b[\\s\\S]*?<\\/${P}rPh>`, 'g'), '');
  let s = '';
  for (const m of sem.matchAll(tagRe('t'))) s += m[3] !== undefined ? decodeXml(m[3]) : '';
  return s;
}

const DATAS_PADRAO = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function formatoEhData(codigo) {
  const f = codigo.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(f) && !/^[#0.,%\s]*$/.test(f);
}

function lerEstilos(xml) {
  if (!xml) return [];
  const custom = new Map();
  for (const m of xml.matchAll(tagRe('numFmt'))) custom.set(+attr(m[1], 'numFmtId'), attr(m[1], 'formatCode') || '');
  const xfsBloco = xml.match(new RegExp(`<${P}cellXfs\\b[^>]*>([\\s\\S]*?)<\\/${P}cellXfs>`));
  if (!xfsBloco) return [];
  const datas = [];
  for (const m of xfsBloco[1].matchAll(new RegExp(`<${P}xf\\b([^>]*?)(?:\\/>|>)`, 'g'))) {
    const id = +(attr(m[1], 'numFmtId') || 0);
    datas.push(DATAS_PADRAO.has(id) || (custom.has(id) && formatoEhData(decodeXml(custom.get(id)))));
  }
  return datas;
}

function serialParaData(n, data1904) {
  let dias = n;
  if (data1904) dias += 1462;
  else if (dias < 60) dias += 1;
  const ms = Math.round((dias - 25569) * 86400000);
  return new Date(ms);
}

function colunaDeRef(ref) {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function caminhoAlvo(base, alvo) {
  if (alvo.startsWith('/')) return alvo.slice(1);
  const partes = base.split('/').slice(0, -1);
  for (const p of alvo.split('/')) {
    if (p === '..') partes.pop();
    else if (p !== '.') partes.push(p);
  }
  return partes.join('/');
}

function lerAba(xml, sst, datas, data1904) {
  const linhas = [];
  let maxCol = 0;
  const dados = xml.match(new RegExp(`<${P}sheetData\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/${P}sheetData>)`));
  if (!dados || !dados[1]) return { linhas, maxCol };
  let proxLinha = 1;
  for (const mr of dados[1].matchAll(tagRe('row'))) {
    const rAttr = attr(mr[1], 'r');
    const numero = rAttr ? parseInt(rAttr, 10) : proxLinha;
    proxLinha = numero + 1;
    const valores = [];
    let proxCol = 0;
    if (mr[3]) {
      for (const mc of mr[3].matchAll(tagRe('c'))) {
        const a = mc[1];
        const col = colunaDeRef(attr(a, 'r'));
        const c = col === null ? proxCol : col;
        proxCol = c + 1;
        const t = attr(a, 't') || 'n';
        const s = +(attr(a, 's') || 0);
        const corpo = mc[3] || '';
        const vm = corpo.match(new RegExp(`<${P}v\\b[^>]*>([\\s\\S]*?)<\\/${P}v>`));
        const bruto = vm ? decodeXml(vm[1]) : null;
        let valor = null;
        if (t === 's') valor = bruto === null ? null : sst[parseInt(bruto, 10)] ?? null;
        else if (t === 'inlineStr') {
          const is = corpo.match(new RegExp(`<${P}is\\b[^>]*>([\\s\\S]*?)<\\/${P}is>`));
          valor = is ? textoRico(is[1]) : null;
        } else if (t === 'str') valor = bruto;
        else if (t === 'b') valor = bruto === null ? null : bruto === '1' || bruto.toLowerCase() === 'true';
        else if (t === 'e') valor = bruto;
        else if (t === 'd') valor = bruto ? new Date(bruto) : null;
        else if (bruto !== null && bruto !== '') {
          const n = Number(bruto);
          valor = Number.isNaN(n) ? bruto : datas[s] ? serialParaData(n, data1904) : n;
        }
        valores[c] = valor;
      }
    }
    if (valores.length > maxCol) maxCol = valores.length;
    linhas[numero - 1] = valores;
  }
  for (let i = 0; i < linhas.length; i += 1) if (!linhas[i]) linhas[i] = [];
  return { linhas, maxCol };
}

/**
 * Le um .xlsx a partir de ArrayBuffer/Uint8Array.
 * Retorna { abas: [{nome, linhas}], ativa } (ativa = indice da aba ativa).
 */
export async function lerPlanilha(bytes, nomeArquivo = 'planilha.xlsx') {
  let arquivos;
  try {
    arquivos = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    throw new Error(`${nomeArquivo}: não é um .xlsx válido. A planilha pode estar protegida por senha, corrompida ou ser outro formato salvo com extensão .xlsx.`);
  }
  const ler = (nome) => {
    const chave = Object.keys(arquivos).find((k) => k.toLowerCase() === nome.toLowerCase());
    return chave ? strFromU8(arquivos[chave]) : null;
  };
  const wbXml = ler('xl/workbook.xml');
  if (!wbXml) throw new Error(`${nomeArquivo}: não é uma planilha .xlsx (falta xl/workbook.xml).`);
  const relsXml = ler('xl/_rels/workbook.xml.rels') || '';
  const alvos = {};
  for (const m of relsXml.matchAll(new RegExp(`<${P}Relationship\\b([^>]*?)\\/?>`, 'g'))) {
    const id = attr(m[1], 'Id');
    const t = attr(m[1], 'Target');
    if (id && t) alvos[id] = caminhoAlvo('xl/workbook.xml', t);
  }
  const data1904 = /date1904\s*=\s*"(1|true)"/i.test(wbXml);
  const ativaM = wbXml.match(new RegExp(`<${P}workbookView\\b([^>]*?)\\/?>`));
  const ativa = ativaM ? +(attr(ativaM[1], 'activeTab') || 0) : 0;
  let sst = [];
  const sstXml = ler('xl/sharedStrings.xml');
  if (sstXml) sst = [...sstXml.matchAll(tagRe('si'))].map((m) => (m[3] ? textoRico(m[3]) : ''));
  const datas = lerEstilos(ler('xl/styles.xml'));
  const abas = [];
  for (const m of wbXml.matchAll(new RegExp(`<${P}sheet\\b([^>]*?)\\/?>`, 'g'))) {
    const nome = decodeXml(attr(m[1], 'name') || `Planilha${abas.length + 1}`);
    const rid = attr(m[1], 'id');
    const caminho = rid && alvos[rid];
    const xml = caminho ? ler(caminho) : null;
    const { linhas, maxCol } = xml ? lerAba(xml, sst, datas, data1904) : { linhas: [], maxCol: 0 };
    for (const l of linhas) for (let c = 0; c < maxCol; c += 1) if (l[c] === undefined) l[c] = null;
    abas.push({ nome, linhas });
  }
  if (!abas.length) throw new Error(`${nomeArquivo}: a planilha não tem abas.`);
  return { abas, ativa: Math.min(ativa, abas.length - 1) };
}

/** SHA-256 em hexadecimal (Web Crypto, disponivel no navegador e no Node 22). */
export async function sha256Hex(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
