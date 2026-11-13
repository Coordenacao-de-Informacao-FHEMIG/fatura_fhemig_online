// Utilitarios de texto e numero com o MESMO comportamento das funcoes Python
// dos tres aplicativos (clean, norm_text, norm_code, as_number...). Qualquer
// diferenca aqui muda alertas, por isso cada funcao cita a origem.

const RE_ESPACOS = /\s+/g;

/** clean(x) — Hospitalar/Ambulatorial: espacos repetidos e NUL viram um espaco. */
export function clean(x) {
  return String(x || '').replace(/\x00/g, ' ').replace(RE_ESPACOS, ' ').trim();
}

/** Remove acentos (NFKD + descarta marcas combinantes), como unicodedata. */
export function semAcento(x) {
  return String(x ?? '').normalize('NFKD').replace(/[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g, '');
}

/** norm_text(x) — maiusculas, sem acento, espacos simples. */
export function normText(x) {
  return clean(semAcento(x)).toUpperCase();
}

/** norm_code(x) / so_digitos(x) — so os digitos. */
export function normCode(x) {
  return String(x ?? '').replace(/\D/g, '');
}
export const soDigitos = normCode;

/** as_number(value) — primeiro numero do texto (virgula decimal aceita). */
export function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const m = String(value).match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}

/** as_int(value) — int(as_number) com truncamento em direcao ao zero. */
export function asInt(value) {
  const n = asNumber(value);
  return n !== null ? Math.trunc(n) : 0;
}

/** str(value) de Python para valores lidos de planilha. */
export function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  if (v instanceof Date) return dataPy(v);
  return String(v);
}

/** repr(float) aproximado: Python mostra 1.0, JS mostraria 1. */
export function pyFloatRepr(v) {
  if (Number.isInteger(v)) return `${v}.0`;
  return String(v);
}

function dataPy(d) {
  const p = (n, t = 2) => String(n).padStart(t, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** round(x, casas) do Python (arredonda o valor binario exato, empate para o par). */
export function pyRound(x, casas = 0) {
  const fator = 10 ** casas;
  const y = x * fator;
  const piso = Math.floor(y);
  const diff = y - piso;
  let r;
  if (Math.abs(diff - 0.5) < 1e-12) r = piso % 2 === 0 ? piso : piso + 1;
  else r = Math.round(y);
  return r / fator;
}

/** Comparacao de strings por ponto de codigo, como sorted() do Python. */
export function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Comparacao de tuplas (arrays) elemento a elemento, como no Python. */
export function cmpTupla(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'boolean' || typeof y === 'boolean') return Number(x) < Number(y) ? -1 : 1;
    return cmpStr(String(x), String(y));
  }
  return a.length - b.length;
}

export function ordenar(lista, chave) {
  return [...lista].sort((a, b) => cmpTupla(chave(a), chave(b)));
}

export function sortedStr(iteravel) {
  return [...iteravel].sort(cmpStr);
}

/** max(dict, key=dict.get): primeira chave com o maior valor (ordem de insercao). */
export function chaveDoMaior(mapa) {
  let melhor = '';
  let valor = -Infinity;
  for (const [k, v] of mapa) {
    if (v > valor) {
      melhor = k;
      valor = v;
    }
  }
  return melhor;
}

/** Counter.most_common(): por contagem decrescente, empate pela ordem de insercao. */
export function maisComuns(mapa, n) {
  const itens = [...mapa.entries()].map((e, i) => [...e, i]);
  itens.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  const r = itens.map(([k, v]) => [k, v]);
  return n === undefined ? r : r.slice(0, n);
}

export function contar(iteravel) {
  const m = new Map();
  for (const x of iteravel) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

/** Inteiro com separador de milhar ponto (formato brasileiro). */
export function milhar(n) {
  return Number(n || 0).toLocaleString('pt-BR');
}

export function pad(n, t = 2) {
  return String(n).padStart(t, '0');
}

/** datetime.now() formatado. */
export function agora() {
  return new Date();
}

export function fmtDataHora(d, comSegundos = true) {
  const base = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return comSegundos ? `${base}:${pad(d.getSeconds())}` : base;
}

export function fmtHora(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** %Y%m%d_%H%M%S */
export function carimbo(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Decodificacao latin-1 exata (bytes 0x80-0x9F viram controles C1, como no Python). */
export function decodeLatin1(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let saida = '';
  const BLOCO = 0x8000;
  for (let i = 0; i < u8.length; i += BLOCO) {
    saida += String.fromCharCode.apply(null, u8.subarray(i, i + BLOCO));
  }
  return saida;
}

/** bytes.decode('utf-8') estrito: devolve null se nao for UTF-8 valido. */
export function decodeUtf8Estrito(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** cp1252 estrito como o codec Python (bytes indefinidos geram erro). */
const CP1252_INDEFINIDOS = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
export function decodeCp1252Estrito(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of u8) if (CP1252_INDEFINIDOS.has(b)) return null;
  return new TextDecoder('windows-1252').decode(u8);
}

/** chave_coluna do Ambulatorial: sem acento, pontuacao ou espaco. */
export function chaveColunaAmb(valor) {
  return normText(valor === null || valor === undefined ? '' : pyStr(valor)).replace(/[^A-Z0-9]/g, '');
}

/** Escapa texto para expressoes regulares. */
export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** str.format_map(defaultdict(str, ...)): campos ausentes viram ''. */
export function formatMap(modelo, campos) {
  return modelo.replace(/\{(\w+)\}/g, (_, k) => (campos[k] === undefined || campos[k] === null ? '' : String(campos[k])));
}
