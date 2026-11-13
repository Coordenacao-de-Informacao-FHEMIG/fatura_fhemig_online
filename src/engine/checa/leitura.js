// ChecaProfissionais 2.0 — normalizacao (core/normalizacao.py) e leitura das
// fontes Tasy, CNES, ADC e CBO assistencial (core/leitura.py).
import { semAcento } from '../comum/texto.js';
import { lerPlanilha, sha256Hex } from '../comum/planilha.js';

export const VALIDO = 'VALIDO';
export const AUSENTE = 'AUSENTE';
export const INVALIDO = 'INVALIDO';
export const DV_INVALIDO = 'DV_INVALIDO';
export const SENTINELA = 'SENTINELA';

const CIENTIFICA = /^\s*\d+([.,]\d+)?\s*E\s*[+-]?\d+\s*$/i;

/** texto(): valor da celula como texto, sem '.0' de inteiros lidos como float. */
export function texto(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'boolean') return valor ? 'S' : 'N';
  if (typeof valor === 'number') return Number.isInteger(valor) ? String(valor) : String(valor);
  if (valor instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(valor.getUTCDate())}/${p(valor.getUTCMonth() + 1)}/${valor.getUTCFullYear()}`;
  }
  return String(valor).trim();
}

export function chaveColuna(valor) {
  const t = semAcento(texto(valor)).replace(/[^\x00-\x7f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ');
  return t.split(/\s+/).filter(Boolean).join(' ');
}

export const eNulo = (valor, nulos) => nulos.has(texto(valor).toUpperCase());

export function normalizarNome(valor) {
  return semAcento(texto(valor)).replace(/[^\x00-\x7f]/g, '').toUpperCase().split(/\s+/).filter(Boolean).join(' ');
}

function digitos(valor) {
  if (typeof valor === 'number' && !Number.isInteger(valor)) return null;
  const t = texto(valor);
  if (CIENTIFICA.test(t)) return null;
  return t.replace(/\D/g, '');
}

export function cpfDvOk(cpf) {
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i += 1) soma += +cpf[i] * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== +cpf[n]) return false;
  }
  return true;
}

export function normalizarCpf(valor, nulos = new Set(['']), sentinelas = new Set()) {
  if (eNulo(valor, nulos)) return ['', AUSENTE];
  let d = digitos(valor);
  if (d === null) return ['', INVALIDO];
  if (!d) return ['', AUSENTE];
  if (d.length > 11) return [d, INVALIDO];
  d = d.padStart(11, '0');
  if (sentinelas.has(d) || new Set(d).size === 1) return [d, SENTINELA];
  return [d, cpfDvOk(d) ? VALIDO : DV_INVALIDO];
}

export function cnsDvOk(cns) {
  if (!'12789'.includes(cns[0])) return false;
  let s = 0;
  for (let i = 0; i < 15; i += 1) s += +cns[i] * (15 - i);
  return s % 11 === 0;
}

export function normalizarCns(valor, nulos = new Set(['']), sentinelas = new Set()) {
  if (eNulo(valor, nulos)) return ['', AUSENTE];
  const d = digitos(valor);
  if (d === null) return ['', INVALIDO];
  if (!d) return ['', AUSENTE];
  if (sentinelas.has(d)) return [d, SENTINELA];
  if (d.length !== 15 || !cnsDvOk(d)) return [d, INVALIDO];
  return [d, VALIDO];
}

export function normalizarCbo(valor, nulos = new Set([''])) {
  if (eNulo(valor, nulos)) return ['', AUSENTE];
  if (typeof valor === 'number' && !Number.isInteger(valor)) return [texto(valor), INVALIDO];
  let t = texto(valor).toUpperCase();
  if (CIENTIFICA.test(t)) return [t, INVALIDO];
  t = t.replace(/[\s.\-/]/g, '');
  if (!t) return ['', AUSENTE];
  if (/^\d+$/.test(t) && t.length < 6) t = t.padStart(6, '0');
  return [t, /^[0-9A-Z]{6}$/.test(t) ? VALIDO : INVALIDO];
}

export function normalizarRg(valor, nulos = new Set(['']), minimo = 5) {
  if (eNulo(valor, nulos)) return ['', AUSENTE];
  const t = semAcento(texto(valor)).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^0+/, '');
  if (!t) return ['', AUSENTE];
  return [t, t.length >= minimo ? VALIDO : INVALIDO];
}

export function mascarar(valor) {
  const v = texto(valor);
  return v ? '*'.repeat(Math.max(v.length - 3, 0)) + v.slice(-3) : '';
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
export class ErroEstrutura extends Error {}
export class ErroUnidade extends ErroEstrutura {}

const LINHAS_BUSCA_CABECALHO = 15;
const TITULO_CNES = /CNES\s*:?\s*(\d{5,7})\s*-?\s*(.*)/i;
const ASSINATURA_DO_TIPO = { TASY: 'TASY', ADC: 'TASY', CNES: 'CNES', CBO_ASSIST: 'CBO_ASSIST' };
const NOME_DO_TIPO = { TASY: 'Tasy', ADC: 'ADC', CNES: 'CNES', CBO_ASSIST: 'de CBO assistencial' };

function mapear(cabecalho, assinatura) {
  const chaves = cabecalho.map(chaveColuna);
  const mapa = {};
  const faltam = [];
  for (const [grupo, obrig] of [['obrigatorias', true], ['complementares', false]]) {
    for (const [campo, nomes] of Object.entries(assinatura[grupo] || {})) {
      const idx = chaves.findIndex((c) => nomes.includes(c));
      if (idx < 0) {
        if (obrig) faltam.push(`${campo} (${nomes.join(' / ')})`);
      } else mapa[campo] = idx;
    }
  }
  return [mapa, faltam];
}

export class Linha {
  constructor(fonte, arquivo, aba, linha, bruto) {
    Object.assign(this, {
      fonte, arquivo, aba, linha, bruto, cpf: '', cpf_sit: '', cns: '', cns_sit: '', cbo: '', cbo_sit: '', rg: '', rg_sit: '',
      nome: '', nome_norm: '', trilha: '', motivo_trilha: '', pessoa: '', duplicada: false, adc_chave: '', adc_linha: 0,
    });
  }

  valor(campo) {
    return texto(this.bruto[campo]);
  }
}

/**
 * ler_fonte: tipo TASY, CNES, ADC (assinatura do Tasy) ou CBO_ASSIST.
 * arquivo: {nome, bytes}
 */
export async function lerFonte(arquivo, tipo, regras) {
  const nome = arquivo.nome;
  if (!/\.(xlsx|xlsm)$/i.test(nome)) throw new ErroEstrutura(`${nome}: use planilha .xlsx (encontrado ${nome.includes('.') ? nome.slice(nome.lastIndexOf('.')) : 'sem extensão'}).`);
  const assinatura = regras.assinaturas[ASSINATURA_DO_TIPO[tipo]];
  const nulos = new Set([...(regras.valores_nulos || ['']).map((v) => v.toUpperCase()), '']);
  const cpfSent = new Set(regras.cpf_sentinela || []);
  const cnsSent = new Set(regras.cns_sentinela || []);
  const rgMin = (regras.rg || {}).minimo_digitos ?? 5;
  let planilha;
  try {
    planilha = await lerPlanilha(arquivo.bytes, nome);
  } catch (erro) {
    throw new ErroEstrutura(erro.message);
  }
  let melhor = null;
  for (const ws of planilha.abas) {
    const acima = [];
    for (let i = 0; i < Math.min(LINHAS_BUSCA_CABECALHO, ws.linhas.length); i += 1) {
      const valores = ws.linhas[i] || [];
      const [mapa, faltam] = mapear(valores, assinatura);
      if (Object.keys(mapa).length && (melhor === null || faltam.length < melhor.faltam.length)) {
        melhor = { faltam, aba: ws.nome, i, valores, mapa, titulo: acima.join(' ') };
      }
      if (!faltam.length) break;
      for (const v of valores) if (texto(v)) acima.push(texto(v));
    }
    if (melhor && !melhor.faltam.length) break;
  }
  if (melhor === null || melhor.faltam.length) {
    const encontradas = (melhor ? melhor.valores : []).map(texto).filter(Boolean).join(', ') || 'nenhuma';
    const esperadas = melhor ? melhor.faltam.join(', ') : Object.keys(assinatura.obrigatorias).join(', ');
    throw new ErroEstrutura(`${nome}: não parece ser a planilha ${NOME_DO_TIPO[tipo]}. Faltam as colunas: ${esperadas}. Colunas encontradas: ${encontradas}.`);
  }
  const colunas = Object.fromEntries(Object.entries(melhor.mapa).map(([c, i]) => [c, texto(melhor.valores[i])]));
  const fonte = {
    tipo, arquivo: nome, aba: melhor.aba, linha_cabecalho: melhor.i + 1, titulo: melhor.titulo, colunas, linhas: [], sha256: '', linhas_vazias: 0,
    cnesTitulo() {
      const m = (this.titulo || '').match(TITULO_CNES);
      return m ? [m[1].padStart(7, '0'), m[2].trim()] : ['', ''];
    },
  };
  const ws = planilha.abas.find((a) => a.nome === melhor.aba);
  for (let n = melhor.i + 1; n < ws.linhas.length; n += 1) {
    const valores = ws.linhas[n] || [];
    if (!valores.some((v) => texto(v))) {
      fonte.linhas_vazias += 1;
      continue;
    }
    const bruto = Object.fromEntries(Object.entries(melhor.mapa).map(([c, i]) => [c, i < valores.length ? valores[i] : null]));
    const ln = new Linha(tipo, nome, melhor.aba, n + 1, bruto);
    [ln.cpf, ln.cpf_sit] = normalizarCpf(bruto.cpf, nulos, cpfSent);
    [ln.cns, ln.cns_sit] = normalizarCns(bruto.cns, nulos, cnsSent);
    [ln.cbo, ln.cbo_sit] = normalizarCbo(bruto.cbo, nulos);
    [ln.rg, ln.rg_sit] = normalizarRg(bruto.rg, nulos, rgMin);
    ln.nome = texto(bruto.nome);
    ln.nome_norm = normalizarNome(ln.nome);
    fonte.linhas.push(ln);
  }
  if (!fonte.linhas.length) throw new ErroEstrutura(`${nome}: cabeçalho encontrado na aba "${melhor.aba}", mas não há registros.`);
  fonte.sha256 = await sha256Hex(arquivo.bytes);
  return fonte;
}
