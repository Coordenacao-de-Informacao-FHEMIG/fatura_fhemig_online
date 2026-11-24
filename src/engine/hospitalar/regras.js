// Fatura Fhemig Hospitalar 14.3 — regras, leitura do espelho da AIH e alertas.
// Port 1:1 de "Fatura Fhemig 14.3/_suporte/codigo/backend.py". Os nomes das
// funcoes Python estao citados em cada bloco para facilitar a conferencia.
import { clean, normCode, normText as _normText, asNumber, asInt, cmpTupla } from '../comum/texto.js';

const normText = (x) => _normText(x || '');

export const APP_VERSION = 'Fatura Fhemig 14.3 - PDF e TXT SISAIH01 (versão online)';

// Diarias de CTI/UTI (UTI_CODES)
export const UTI_CODES = new Set(['0802010164', '0802010130', '0802010113', '0802010075', '0802010091', '0802010156', '0802010083', '0503040045']);
export const ATRIBUTO_PERMANENCIA_MAIOR = '004';
export const CIRURGIAS_SEM_ALERTA_HABILITACAO = new Set(['0401', '0403', '0404', '0405', '0406', '0407', '0408', '0409', '0411', '0412', '0413', '0414', '0415']);
export const CBO_SEGUNDO_EXECUTANTE = '225151';
export const CODIGO_TOMOGRAFIA = '0206010079';
export const TOMOGRAFIA_MAX_POR_AIH = 3;
export const UNIDADE_PADRAO = 'HJXXIII';
export const SIGTAP_SEXO = { M: 'Masculino', F: 'Feminino', I: 'Ambos', N: 'Não se Aplica' };
const DATA = String.raw`\d{2}\s*/\s*\d{2}\s*/\s*\d{4}`;

/** detectar_unidade */
export function detectarUnidade(...nomes) {
  for (const nome of nomes) {
    const alvo = normText(nome);
    for (const sigla of ['HJXXIII', 'HIJPII']) if (alvo.includes(normText(sigla))) return sigla;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------
/** format_numeric_code: Excel pode ler numeros grandes como float. */
export function formatNumericCode(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)).toString().replace(/\D/g, '') : '';
  return normCode(String(value));
}

/** format_cbo_code: preserva CBOs alfanumericos (2231F8). */
export function formatCboCode(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') value = Math.trunc(value);
  return normText(String(value)).replace(/[^0-9A-Z]/g, '');
}

export function ageInMonths(birth, reference) {
  if (!birth || !reference || reference.t < birth.t) return null;
  let months = (reference.y - birth.y) * 12 + reference.m - birth.m;
  if (reference.d < birth.d) months -= 1;
  return months;
}

/** sigtap_age_months: '18 Ano(s)' / '6 Mes(es)' -> meses. */
export function sigtapAgeMonths(value, maximum = false) {
  const x = normText(value);
  const m = x.match(/(\d+(?:[.,]\d+)?)\s*(ANO|MES|DIA)/);
  if (!m) return null;
  const number = parseFloat(m[1].replace(',', '.'));
  if (m[2] === 'ANO') return pyRoundInt(number * 12) + (maximum ? 11 : 0);
  if (m[2] === 'MES') return pyRoundInt(number);
  return pyRoundInt(number / 30.4375);
}

function pyRoundInt(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export function extractAttributeCodes(value) {
  const codes = new Set();
  for (const item of String(value || '').split(',')) {
    const m = item.match(/^\s*(\d{3})\s*-/);
    if (m) codes.add(m[1]);
  }
  return codes;
}

export const CBO_PADRAO = String.raw`\d{4}[0-9A-Z]\d`;
export function extractCboCodes(value) {
  return new Set([...String(value || '').toUpperCase().matchAll(new RegExp(String.raw`(?<![0-9A-Z])(${CBO_PADRAO})(?![0-9A-Z])`, 'g'))].map((m) => m[1]));
}
export function extractCboCategories(value) {
  return new Set([...String(value || '').matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((m) => m[1]));
}
export function extractHabilitationCodes(value) {
  return new Set([...pyStrOrEmpty(value).matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((m) => m[1]));
}

/** str(value or '') do Python para celulas de planilha. */
function pyStrOrEmpty(v) {
  if (!v) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ---------------------------------------------------------------------------
// Bases da unidade (planilhas ja lidas: [{nome, linhas}], usa a aba ativa)
// ---------------------------------------------------------------------------
export function loadUnitHabilitations(planilha) {
  const linhas = planilha.abas[planilha.ativa || 0].linhas;
  let header = null;
  let idx = null;
  for (let n = 0; n < Math.min(20, linhas.length); n += 1) {
    const normalized = linhas[n].map((v) => normText(v === null ? '' : pyStrOrEmpty(v)));
    const i = normalized.indexOf('HABILITACAO');
    if (i >= 0) {
      header = n;
      idx = i;
      break;
    }
  }
  if (header === null) throw new Error('Coluna Habilitacao nao encontrada na planilha da unidade.');
  const codes = new Set();
  for (const row of linhas.slice(header + 1)) for (const c of extractHabilitationCodes(row[idx])) codes.add(c);
  return codes;
}

// O CNES tem 7 dígitos. Planilha que guarda o CNES como número perde os zeros
// à esquerda (0026921 vira 26921); aqui ele volta a ter 7 dígitos.
export function formatarCnes(valor) {
  const v = String(valor ?? '').trim();
  return /^\d{1,6}$/.test(v) ? v.padStart(7, '0') : v;
}

// Mesmo estabelecimento? Compara só os dígitos, sem os zeros à esquerda:
// 0026921, 26921 e 00026921 são o mesmo CNES. CNPJ (14 dígitos) segue a mesma regra.
export function mesmoCnes(a, b) {
  const chave = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const ca = chave(a);
  return Boolean(ca) && ca === chave(b);
}

export function loadUnitServiceClassifications(planilha) {
  const linhas = planilha.abas[planilha.ativa || 0].linhas;
  const headers = (linhas[0] || []).map((v) => normText(pyStrOrEmpty(v)));
  const codeIndex = headers.indexOf('CODIGO');
  if (codeIndex < 0) throw new Error('Coluna Codigo nao encontrada na planilha de Servico e Classificacao.');
  const tIdx = headers.indexOf('TERCEIRO');
  const cIdx = headers.indexOf('CNES');
  const codes = new Map();
  for (const row of linhas.slice(1)) {
    const numbers = [...pyStrOrEmpty(row[codeIndex]).matchAll(/(?<!\d)(\d{3})(?!\d)/g)].map((m) => m[1]);
    if (numbers.length < 2) continue;
    const key = `${numbers[0]}-${numbers[1]}`;
    const terceiro = tIdx >= 0 ? normText(pyStrOrEmpty(row[tIdx])) : 'NAO';
    const cnes = cIdx >= 0 ? formatarCnes(formatNumericCode(row[cIdx])) : '';
    const entrada = { terceiro: terceiro.startsWith('SIM') ? 'SIM' : 'NAO', cnes };
    if (!codes.has(key)) codes.set(key, []);
    const lista = codes.get(key);
    if (!lista.some((e) => e.terceiro === entrada.terceiro && e.cnes === entrada.cnes)) lista.push(entrada);
  }
  return codes;
}

export function loadProfissionais(planilha) {
  const linhas = planilha.abas[planilha.ativa || 0].linhas;
  const headers = (linhas[0] || []).map((v) => normText(pyStrOrEmpty(v)));
  const cnsIdx = headers.indexOf('CNS');
  const cboIdx = headers.indexOf('CBO');
  if (cnsIdx < 0 || cboIdx < 0) throw new Error('Colunas CNS e/ou CBO não encontradas na planilha de Profissionais.');
  const cpfIdx = headers.indexOf('CPF');
  const profissionais = new Set();
  for (const row of linhas.slice(1)) {
    const cns = formatNumericCode(row[cnsIdx]);
    const cbo = formatCboCode(row[cboIdx]);
    if (cns && cbo) profissionais.add(`${cns}|${cbo}`);
    if (cpfIdx >= 0 && cbo) {
      const cpf = formatNumericCode(row[cpfIdx]);
      if (cpf.replace(/0/g, '') && cpf.length <= 11) profissionais.add(`${cpf.padStart(11, '0')}|${cbo}`);
    }
  }
  if (!profissionais.size) throw new Error('A planilha de Profissionais não contém pares CNS/CBO preenchidos.');
  return profissionais;
}

export function cnesCadastradosPara(requiredPairs, unitServiceCodes) {
  const aceitos = new Set();
  for (const par of requiredPairs || []) for (const e of unitServiceCodes.get(par) || []) if (e.cnes) aceitos.add(e.cnes);
  return aceitos;
}

export function servicoEstabelecimentoPendente(requiredPairs, unitServiceCodes, cnesDaLinha) {
  const required = new Set(requiredPairs || []);
  if (!required.size) return 'NAO';
  const cadastrados = [...required].filter((p) => unitServiceCodes.has(p));
  if (!cadastrados.length) return 'SIM (NAO CADASTRADO)';
  const executante = normCode(cnesDaLinha);
  let temTerceiro = false;
  for (const par of cadastrados) {
    for (const e of unitServiceCodes.get(par)) {
      if (e.terceiro !== 'SIM') return 'NAO';
      temTerceiro = true;
      if (e.cnes && executante && mesmoCnes(e.cnes, executante)) return 'NAO';
    }
  }
  if (temTerceiro && !executante) return 'NAO';
  return 'SIM (TERCEIRO CNES DIFERENTE)';
}

// ---------------------------------------------------------------------------
// Regras de validacao
// ---------------------------------------------------------------------------
const RE_CID = /(?<![A-Z0-9])([A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2}|[0-9A-Z]{1,2})?)(?![A-Z0-9])/g;

export function cidSecondaryCompatible(patient, allowed) {
  const conj = (t) => new Set([...normText(t).matchAll(RE_CID)].map((m) => m[1].replace(/[^A-Z0-9]/g, '')).filter(Boolean));
  const p = conj(patient);
  const a = conj(allowed);
  if (!a.size) return 'S/N';
  if (!p.size) return 'NAO INFORMADO';
  return [...p].some((x) => a.has(x)) ? 'SIM' : 'NAO';
}

export function cidCompatible(mainCid, allowedCids) {
  const cid = normText(mainCid).replace(/[^A-Z0-9]/g, '');
  const allowed = new Set(
    [...normText(allowedCids).matchAll(/(?<![A-Z0-9])([A-Z][0-9]{2}(?:\.?[0-9A-Z]{1,3})?)(?![A-Z0-9])/g)]
      .map((m) => m[1].replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean),
  );
  if (!allowed.size) return 'S/N';
  if (!cid || cid === 'NAOINFORMADO') return 'NAO INFORMADO';
  return allowed.has(cid) ? 'SIM' : 'NAO';
}

export function cboCompatible(procedureCbo, allowedCbos, allowedCategories) {
  let cbo = formatCboCode(procedureCbo);
  if (!new RegExp(`^${CBO_PADRAO}$`).test(cbo)) cbo = /^\d+$/.test(cbo) ? normCode(cbo) : '';
  const allowed = typeof allowedCbos === 'string' ? extractCboCodes(allowedCbos) : new Set(allowedCbos || []);
  const categories = typeof allowedCategories === 'string' ? extractCboCategories(allowedCategories) : new Set(allowedCategories || []);
  if (!allowed.size && !categories.size) return 'S/N';
  if (!cbo || cbo === '0') return 'NAO INFORMADO';
  if (allowed.has(cbo)) return 'SIM';
  if (categories.has(cbo.slice(0, 4))) return 'SIM (CATEGORIA)';
  return 'NAO';
}

export function sexCompatible(patientSex, allowedSex) {
  const patient = normText(patientSex);
  const allowed = normText(allowedSex);
  if (!allowed || allowed.includes('NAO SE APLICA') || allowed.includes('AMBOS')) return 'S/N';
  if (!patient || patient.startsWith('NAO INFORMADO')) return 'NAO INFORMADO';
  if (patient.startsWith('MASC') && allowed.startsWith('MASC')) return 'SIM';
  if (patient.startsWith('FEM') && allowed.startsWith('FEM')) return 'SIM';
  return 'NAO';
}

export function ageCompatible(months, minimum, maximum) {
  if (minimum === null || maximum === null) return 'S/N';
  if (months === null) return 'NAO INFORMADO';
  return minimum <= months && months <= maximum ? 'SIM' : 'NAO';
}

export function unitHasRequiredHabilitation(required, unit) {
  const r = new Set(required || []);
  const u = new Set(unit || []);
  if (!r.size) return 'S/N';
  if (!u.size) return 'NAO';
  return [...r].some((x) => u.has(x)) ? 'SIM' : 'NAO';
}

export function presentedServiceClassificationMatches(originalValue, sigtapPairs) {
  const nums = [...String(originalValue || '').matchAll(/(?<!\d)(\d{3})(?!\d)/g)].map((m) => m[1]);
  const par = nums.length >= 2 ? `${nums[0]}-${nums[1]}` : null;
  const required = new Set(sigtapPairs || []);
  if (par === null && !required.size) return 'S/N';
  if (par === null || !required.size) return 'NAO';
  return required.has(par) ? 'SIM' : 'NAO';
}

export function unitHasServiceClassification(requiredPairs, unitPairs) {
  if (!requiredPairs || !requiredPairs.size || !unitPairs || !unitPairs.size) return 'NAO';
  return [...requiredPairs].some((p) => unitPairs.has(p)) ? 'SIM' : 'NAO';
}

export function requiresExemptedService(requiredPairs, rawServiceText) {
  const exempted = ['121-001', '122-001', '122-003', '122-004'];
  if (requiredPairs && exempted.some((e) => requiredPairs.has(e))) return true;
  return /(?<!\d)145(?!\d)/.test(String(rawServiceText));
}

export function procedureRequiresServiceClassification(value) {
  const n = normText(value);
  if (!n || ['/', '-', 'NAO INFORMADO', 'NAN', 'NONE'].includes(n)) return 'NAO';
  return /(?<!\d)\d{3}\s*-/.test(n) ? 'SIM' : 'NAO';
}

export function principalPermanenceBelowAllowed(stay, meanStay, isPrincipal) {
  if (!isPrincipal) return 'NAO';
  if (!Number.isInteger(stay) || meanStay === null || meanStay < 0) return 'NAO';
  return stay < meanStay ? 'SIM' : 'NAO';
}

export function quantityOverMaximum(quantity, maximum) {
  const presented = asNumber(quantity);
  if (presented === null || maximum === null || maximum < 0) return 'NAO';
  return presented > maximum ? 'SIM' : 'NAO';
}

export function diasConsideradosParaPrincipal(diasInternacao, diasUti = 0) {
  const internacao = asNumber(diasInternacao);
  if (internacao === null) return null;
  const uti = Math.max(0, asNumber(diasUti) || 0);
  return Math.max(0, internacao - uti);
}

export function calcularPermanenciaAMaior(diasInternacao, mediaSigtap, diasUti = 0, admite = false) {
  if (!admite) return 0;
  const media = asNumber(mediaSigtap);
  if (media === null || media <= 0) return 0;
  const considerados = diasConsideradosParaPrincipal(diasInternacao, diasUti);
  if (considerados === null) return 0;
  return Math.max(0, considerados - 2 * media);
}

// ---------------------------------------------------------------------------
// Leitura do espelho da AIH
// ---------------------------------------------------------------------------
export function get(t, p) {
  const m = t.match(new RegExp(p, 'is'));
  return m ? clean(m[1]) : '';
}

/** date(x): dd/mm/aaaa -> {y,m,d} (ou null). */
export function parseData(x) {
  const s = String(x || '').replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  const y = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1) return null;
  return { y, m: mo, d, t: dt.getTime() };
}

export function dataBr(dt) {
  return dt ? `${String(dt.d).padStart(2, '0')}/${String(dt.m).padStart(2, '0')}/${String(dt.y).padStart(4, '0')}` : '';
}

export function br(x) {
  return dataBr(parseData(x));
}

const diasEntre = (a, b) => Math.round((b.t - a.t) / 86400000);

export function age(n, r) {
  if (!n || !r || r.t < n.t) return 'NAO INFORMADO';
  let total = (r.y - n.y) * 12 + (r.m - n.m);
  if (r.d < n.d) total -= 1;
  total = Math.max(total, 0);
  return `${Math.floor(total / 12)} ANOS, ${total % 12} MESES`;
}

export function section(b, start, ends) {
  const m = b.match(new RegExp(`${start}\\s*(.*?)(?=\\n\\s*(?:${ends})|(?![\\s\\S]))`, 'is'));
  return m ? m[1] : '';
}

export function groups(t) {
  const re = /Num AIH\s*:\s*(\d{12}-\d)/gi;
  const ms = [...t.matchAll(re)];
  const order = [];
  const data = new Map();
  ms.forEach((m, i) => {
    const aih = m[1];
    const end = i + 1 < ms.length ? ms[i + 1].index : t.length;
    if (!data.has(aih)) {
      order.push(aih);
      data.set(aih, '');
    }
    data.set(aih, `${data.get(aih)}\n${t.slice(m.index, end)}`);
  });
  return order.map((aih) => [aih, data.get(aih)]);
}

export function secondary(b) {
  let s = section(b, 'CID SECUND[ÁA]RIO', String.raw`N[ÚU]MERO DE NASCIDOS|Num AIH\s*:`);
  s = s.replace(/^\s*Cid\s+Caracter[ií]stica\s+Descri[çc][ãa]o/i, '');
  const values = [...s.matchAll(/(?<![A-Z0-9])([A-Z][0-9]{2,3}[A-Z0-9]?)(?![A-Z0-9])/gi)].map((m) => m[1].toUpperCase());
  return [...new Set(values)].join(', ') || 'Nao informado';
}

export function services(b) {
  const s = section(b, 'SERVI[ÇC]O/CLASSIFICA[ÇC][ÃA]O', String.raw`CID SECUND[ÁA]RIO|N[ÚU]MERO DE NASCIDOS`);
  const out = new Map();
  for (const raw of s.split(/\r\n|\r|\n/)) {
    const x = clean(raw);
    if (!x || x.toLowerCase().startsWith('linha servi')) continue;
    let m = x.match(/^(\d+)\s+.*?\b(\d{3})\s+(\d{3})\s*$/);
    if (!m) m = x.match(/^(\d+)\s+(\d{3})\s+(\d{3})(?:\s+.*)?$/);
    if (m) out.set(String(parseInt(m[1], 10)), `${m[2]}-${m[3]}`);
  }
  return out;
}

export function procs(b) {
  const s = section(
    b,
    'PROCEDIMENTOS REALIZADOS',
    String.raw`DADOS DE OPM|VALORES DA PR[ÉE]VIA|SERVI[ÇC]O/CLASSIFICA[ÇC][ÃA]O|CID SECUND[ÁA]RIO|N[ÚU]MERO DE NASCIDOS|Num AIH\s*:`,
  );
  const items = [];
  let current = null;
  for (const raw of s.split(/\r\n|\r|\n/)) {
    const x = clean(raw);
    const m = x.match(/^(\d+)\s+(\d{10})\b(.*)$/);
    if (m) {
      if (current) items.push(current);
      current = [m[1], m[2], m[3]];
    } else if (current && x) current[2] += ` ${x}`;
  }
  if (current) items.push(current);
  const out = [];
  for (const [number, code, rest] of items) {
    const q = rest.match(/(?<!\d)(\d+)\s+(?=\d{2}\/\d{4}\b)(\d{2}\/\d{4})\s+(.+?)\s*$/);
    if (!q) continue;
    const beforeQ = rest.slice(0, q.index).trim();
    const tokens = beforeQ.split(/\s+/).filter(Boolean);
    const cnesCnpj = tokens.length >= 2 ? normCode(tokens[tokens.length - 2]) : '';
    const cm = beforeQ.match(new RegExp(String.raw`\b(\d{11,15})\s+(${CBO_PADRAO})(?:\(\d+\))?\b`, 'i'));
    let doc;
    let cbo;
    if (cm) {
      doc = cm[1];
      cbo = formatCboCode(cm[2]);
    } else {
      doc = 'Nao informado';
      cbo = 'Nao informado';
      for (const token of tokens.slice(0, -2)) {
        if (doc === 'Nao informado' && /^\d{11,15}$/.test(token)) doc = token;
        else if (cbo === 'Nao informado' && new RegExp(`^${CBO_PADRAO}(?:\\(\\d+\\))?$`, 'i').test(token)) cbo = formatCboCode(token.split('(')[0]);
      }
    }
    out.push([number, code, q[3], parseInt(q[1], 10), cbo, doc, cnesCnpj]);
  }
  return out;
}

export function codigoPrincipal(bloco) {
  const padroes = [/Procedimento\s+principal\s*:?\s*([0-9]{2}[0-9.\s-]{6,24})/gi, /Procedimento\s+principal\b[^0-9\n]{0,40}([0-9]{2}[0-9.\s-]{6,24})/gi];
  for (const p of padroes) {
    for (const m of bloco.matchAll(p)) {
      const codigo = normCode(m[1]);
      if (codigo.length >= 10) return codigo.slice(0, 10);
    }
  }
  return '';
}

export function annotateReadmissions(rows) {
  const admissions = new Map();
  for (const row of rows) {
    const aih = String(row.AIH ?? '').trim();
    if (!aih || admissions.has(aih)) continue;
    admissions.set(aih, { aih, patient: normText(row['Nome paciente']), entry: parseData(row['Data entrada']), exit: parseData(row['Data saida']) });
  }
  const byPatient = new Map();
  for (const a of admissions.values()) {
    if (!a.patient) continue;
    if (!byPatient.has(a.patient)) byPatient.set(a.patient, []);
    byPatient.get(a.patient).push(a);
  }
  const flags = new Map();
  for (const lista of byPatient.values()) {
    lista.sort((x, y) => cmpTupla([x.entry ? x.entry.t : Infinity, x.aih], [y.entry ? y.entry.t : Infinity, y.aih]));
    let previous = null;
    for (const a of lista) {
      const readmitted = previous !== null;
      let within = false;
      if (previous && previous.exit && a.entry) {
        const days = diasEntre(previous.exit, a.entry);
        within = days >= 0 && days < 3;
      }
      flags.set(a.aih, [readmitted ? 'SIM' : 'NAO', within ? 'SIM' : 'NAO']);
      previous = a;
    }
  }
  for (const row of rows) {
    const [r, w] = flags.get(String(row.AIH ?? '').trim()) || ['NAO', 'NAO'];
    row['REINTERNOU (REAPARECE NA LISTAGEM DO PDF)?'] = r;
    row['REINTERNOU COM MENOS DE 72H (SEGUNDA ENTRADA MENOS PRIMEIRA SAIDA)?'] = w;
  }
  return rows;
}

const S_N = 'S/N';

/** extract(): uma linha por procedimento, com todas as conferencias. */
export function extract(t, sigtap, unitServiceCodes, unitHabilitationCodes, profissionaisValidos, progress, unidade) {
  const isHj = normText(unidade) === normText(UNIDADE_PADRAO);
  const unidadeTomo = ['HJXXIII', 'HIJPII'].includes(normText(unidade));
  const rows = [];
  const all = groups(t);
  all.forEach(([aih, b], idx) => {
    const i = idx + 1;
    if (progress && (i === 1 || i === all.length || i % 25 === 0)) progress(`Analisando AIH ${i} de ${all.length}...`);
    const entry = get(b, `Data interna[çc][ãa]o\\s*:\\s*(${DATA})`);
    const exitDate = get(b, `Data sa[íi]da\\s*:\\s*(${DATA})`);
    const birth = get(b, `Data Nasc\\.\\s*:\\s*(${DATA})`);
    const dEntry = parseData(entry);
    const dExit = parseData(exitDate);
    const dBirth = parseData(birth);
    const principal = codigoPrincipal(b);
    const serviceMap = services(b);
    const patientMonths = ageInMonths(dBirth, dEntry);
    const stay = dEntry && dExit && dExit.t >= dEntry.t ? diasEntre(dEntry, dExit) : null;
    const procedimentos = procs(b);
    const diasUti = procedimentos.reduce((s, p) => s + (UTI_CODES.has(normCode(p[1])) ? asInt(p[3]) : 0), 0);
    const principalRule = principal ? sigtap.get(principal) || null : null;
    const mediaPrincipal = principalRule ? principalRule.media_permanencia : null;
    const admiteMaior = Boolean(principalRule && principalRule.admite_permanencia_maior);
    const considerados = diasConsideradosParaPrincipal(stay, diasUti);
    const passouDobro = considerados !== null && mediaPrincipal !== null && mediaPrincipal > 0 && considerados > 2 * mediaPrincipal ? 'SIM' : 'NAO';
    const diariasMaior = calcularPermanenciaAMaior(stay, mediaPrincipal, diasUti, admiteMaior);
    let admiteTexto;
    if (!principal) admiteTexto = 'PRINCIPAL NAO INFORMADO';
    else if (principalRule === null) admiteTexto = 'PRINCIPAL FORA DO SIGTAP';
    else if (mediaPrincipal === null) admiteTexto = admiteMaior ? 'SIM (SEM MEDIA NO SIGTAP)' : 'NAO';
    else admiteTexto = admiteMaior ? 'SIM' : 'NAO';

    const sexo = get(b, String.raw`Data Nasc\..*?Sexo\s*:\s*([A-Z]+)`) || 'Nao informado';
    const base = {
      AIH: aih,
      'Data entrada': br(entry),
      'Data saida': br(exitDate),
      'Nome paciente': get(b, String.raw`Paciente\s*:\s*(.*?)\s+Prontu[áa]rio\s*:`),
      SEXO: titulo(sexo),
      'IDADE COMPLETA': age(dBirth, dEntry),
      'TEMPO DE PERMANÊNCIA (Data de saída menos a data de entrada)': stay !== null ? stay : '',
      'DIARIAS DE UTI NA AIH': diasUti,
      CID: (get(b, String.raw`Diag\. principal\s*:\s*([A-Z][0-9A-Z]{1,4})\s*-`) || 'Nao informado').toUpperCase(),
      'Código do CID Secundário': secondary(b),
      'PROCEDIMENTO PRINCIPAL DA AIH': principal || 'NAO INFORMADO',
      'MEDIA DE PERMANENCIA SIGTAP (PROC. PRINCIPAL)': mediaPrincipal !== null ? mediaPrincipal : '',
      'ADMITE PERMANENCIA A MAIOR (ATRIBUTO 004)?': admiteTexto,
      'PERMANENCIA PASSOU DO DOBRO DA MEDIA (DESCONTADA UTI)?': passouDobro,
    };
    const codigosDaAih = new Set(procedimentos.map((p) => normCode(p[1])));
    const principalNaLista = Boolean(principal) && codigosDaAih.has(principal);
    const contagem = new Map();
    for (const p of procedimentos) contagem.set(normCode(p[1]), (contagem.get(normCode(p[1])) || 0) + 1);
    const com2o = new Set(procedimentos.filter((p) => normCode(p[4]) === CBO_SEGUNDO_EXECUTANTE).map((p) => normCode(p[1])));
    const dispensaCbo = new Set([...com2o].filter((c) => contagem.get(c) > 1));
    const totalTomografia = procedimentos.reduce((s, p) => s + (normCode(p[1]) === CODIGO_TOMOGRAFIA ? asInt(p[3]) : 0), 0);

    let linhaDoCalculo = null;
    const primeiraLinha = rows.length;
    for (const [number, code, description, quantity, cbo, doc, cnesCnpj] of procedimentos) {
      let excecaoServico = 'NAO';
      let faltaServico = 'NAO';
      let cnesAceitos = new Set();
      const rule = sigtap.get(normCode(code)) || null;
      const nLinha = String(parseInt(number, 10));
      let unidadePossuiHab;
      let servicoApresentado;
      let unidadeTemServico;
      let exigeServico;
      let qtdMaior;
      let cidSecOk;
      let cidOk;
      let cboOk;
      let sexoOk;
      let idadeOk;
      if (rule) {
        unidadePossuiHab = unitHasRequiredHabilitation(rule.habilitacoes_codigos, unitHabilitationCodes);
        servicoApresentado = presentedServiceClassificationMatches(serviceMap.get(nLinha) || '', rule.servicos_classificacoes_codigos);
        unidadeTemServico = unitHasServiceClassification(rule.servicos_classificacoes_codigos, unitServiceCodes);
        exigeServico = procedureRequiresServiceClassification(rule.servico_classificacao);
        qtdMaior = quantityOverMaximum(quantity, rule.qtd_maxima) === 'SIM' ? quantity : 'NAO';
        cidSecOk = cidSecondaryCompatible(base['Código do CID Secundário'], rule.cid_secundario);
        cidOk = cidCompatible(base.CID, rule.cid);
        cboOk = cboCompatible(cbo, rule.cbos_codigos, rule.cbo_categorias);
        sexoOk = sexCompatible(base.SEXO, rule.sexo);
        idadeOk = ageCompatible(patientMonths, rule.idade_min, rule.idade_max);
        if (requiresExemptedService(rule.servicos_classificacoes_codigos, rule.servico_classificacao)) excecaoServico = 'SIM';
        faltaServico = servicoEstabelecimentoPendente(rule.servicos_classificacoes_codigos, unitServiceCodes, cnesCnpj);
        cnesAceitos = cnesCadastradosPara(rule.servicos_classificacoes_codigos, unitServiceCodes);
      } else {
        unidadePossuiHab = S_N;
        servicoApresentado = serviceMap.get(nLinha) ? 'NAO' : S_N;
        unidadeTemServico = S_N;
        exigeServico = 'NAO';
        qtdMaior = 'NAO';
        cidSecOk = S_N;
        cidOk = S_N;
        cboOk = S_N;
        sexoOk = S_N;
        idadeOk = S_N;
      }
      const isPrincipal = normCode(code) === principal && Boolean(principal);
      const permMenor = principalPermanenceBelowAllowed(stay, mediaPrincipal, isPrincipal);
      if (isPrincipal && linhaDoCalculo === null) linhaDoCalculo = rows.length;
      const profissional =
        cbo === 'Nao informado' || doc === 'Nao informado' ? 'NAO INFORMADO' : profissionaisValidos.has(`${normCode(doc)}|${formatCboCode(cbo)}`) ? 'SIM' : 'NAO';

      const codigoNorm = normCode(code);
      if (codigoNorm.startsWith('02')) cboOk = S_N;
      else if (dispensaCbo.has(codigoNorm) && cboOk === 'NAO') cboOk = S_N;
      if (['0603030033', '0603070019', '0301100101'].includes(codigoNorm) && cboOk === 'NAO INFORMADO') cboOk = S_N;
      if (isHj && CIRURGIAS_SEM_ALERTA_HABILITACAO.has(codigoNorm.slice(0, 4))) unidadePossuiHab = S_N;
      if (unidadeTomo && codigoNorm === CODIGO_TOMOGRAFIA) qtdMaior = totalTomografia > TOMOGRAFIA_MAX_POR_AIH ? totalTomografia : 'NAO';

      rows.push({
        ...base,
        'Linha do procedimento': parseInt(number, 10),
        'Codigo do procedimento': code,
        Documento: doc,
        CBO: cbo,
        'Servico/Classificacao': serviceMap.get(nLinha) || '',
        Procedimento: `${code} - ${description}`,
        'Principal/secundario': isPrincipal ? 'Principal' : 'Secundario',
        'Quantidade apresentada': quantity,
        'PROCEDIMENTO EXIGE HABILITACAO?': rule && rule.habilitacoes_codigos.size ? 'SIM' : 'NAO',
        'UNIDADE POSSUI HABILITACAO PARA O PROCEDIMENTO?': unidadePossuiHab,
        'O SERVICO/CLASSIFICACAO FOI APRESENTADO?': servicoApresentado,
        'UNIDADE TEM O SERVICO/CLASSIFICACAO?': unidadeTemServico,
        'PROCEDIMENTO EXIGE SERVICO/CLASSIFICACAO?': exigeServico,
        'QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?': qtdMaior,
        'LIMITE TOMOGRAFIA POR AIH': codigoNorm === CODIGO_TOMOGRAFIA && unidadeTomo ? TOMOGRAFIA_MAX_POR_AIH : null,
        'CID SECUNDARIO E O MESMO DO SIGTAP?': cidSecOk,
        'CID E O MESMO DO SIGTAP?': cidOk,
        'CBO E O MESMO DO SIGTAP?': cboOk,
        'PROFISSIONAL E CBO CADASTRADOS?': profissional,
        'SEXO E COMPATIVEL?': sexoOk,
        'IDADE DENTRO DA FAIXA?': idadeOk,
        'PERMANENCIA E MENOR QUE A PERMITIDA (PROC. PRINCIPAL)?': permMenor,
        'DIARIAS DE PERMANENCIA A MAIOR': 0,
        'PROCEDIMENTO PRINCIPAL LOCALIZADO NA AIH?': principalNaLista ? 'SIM' : 'NAO',
        'TEM CODIGO 0802010199': codigosDaAih.has('0802010199') ? 'SIM' : 'NAO',
        'EXCECAO SERVICO NAO APRESENTADO?': excecaoServico,
        'FALTA SERVICO ESTABELECIMENTO?': faltaServico,
        'CNES/CNPJ DA LINHA': cnesCnpj,
        'CNES CADASTRADOS PARA O SERVICO': [...cnesAceitos].sort().join(', '),
      });
    }
    if (linhaDoCalculo === null && rows.length > primeiraLinha) linhaDoCalculo = primeiraLinha;
    if (linhaDoCalculo !== null) {
      rows[linhaDoCalculo]['DIARIAS DE PERMANENCIA A MAIOR'] = diariasMaior;
      rows[linhaDoCalculo]['LINHA BASE DO CALCULO DA AIH?'] = 'SIM';
    }
  });
  return annotateReadmissions(rows);
}

/** str.title() do Python para palavras simples (MASCULINO -> Masculino). */
function titulo(s) {
  return s.toLowerCase().replace(/(^|[^a-zà-ÿ])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());
}

// ---------------------------------------------------------------------------
// Alertas (ALERT_DEFINITIONS)
// ---------------------------------------------------------------------------
const fmtNum = (v) => (typeof v === 'number' && !Number.isInteger(v) ? String(v) : String(v ?? ''));

export const ALERT_DEFINITIONS = [
  ['Admite permanência à maior', '00B050',
    (r) => normText(r['LINHA BASE DO CALCULO DA AIH?']) === 'SIM' && String(r['ADMITE PERMANENCIA A MAIOR (ATRIBUTO 004)?']).startsWith('SIM') &&
      r['TEM CODIGO 0802010199'] === 'NAO' && asInt(r['DIARIAS DE PERMANENCIA A MAIOR']) > 0,
    (r) => fmtNum(r['DIARIAS DE PERMANENCIA A MAIOR'] ?? 0)],
  ['Sem habilitação', 'C00000',
    (r) => normText(r['PROCEDIMENTO EXIGE HABILITACAO?']) === 'SIM' && normText(r['UNIDADE POSSUI HABILITACAO PARA O PROCEDIMENTO?']) === 'NAO',
    () => 'O procedimento exige habilitação que a unidade não possui.'],
  ['Serviço não apresentado', 'C55A11',
    (r) => normText(r['O SERVICO/CLASSIFICACAO FOI APRESENTADO?']) === 'NAO' && normText(r['UNIDADE TEM O SERVICO/CLASSIFICACAO?']) === 'SIM' &&
      normText(r['EXCECAO SERVICO NAO APRESENTADO?']) !== 'SIM',
    (r) => `Serviço/classificação exigido pelo SIGTAP não foi apresentado. Apresentado na AIH: ${r['Servico/Classificacao'] || 'vazio'}.`],
  ['Estabelecimento não possui serviço/classificação exigido para o procedimento', 'E26B0A',
    (r) => normText(r['FALTA SERVICO ESTABELECIMENTO?']).startsWith('SIM'),
    (r) => {
      if (normText(r['FALTA SERVICO ESTABELECIMENTO?']).includes('TERCEIRO CNES DIFERENTE')) {
        const aceitos = r['CNES CADASTRADOS PARA O SERVICO'] || 'nenhum CNES cadastrado';
        return `O serviço exigido é executado por terceiro. A AIH apresentou o CNES/CNPJ ${r['CNES/CNPJ DA LINHA'] || 'vazio'}, mas a unidade só tem cadastrado: ${aceitos}.`;
      }
      return 'O serviço/classificação exigido pelo procedimento não está cadastrado na planilha da unidade.';
    }],
  ['Quantidade acima da máxima', 'BF8F00',
    (r) => asNumber(r['QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?']) !== null,
    (r) =>
      r['LIMITE TOMOGRAFIA POR AIH'] !== null && r['LIMITE TOMOGRAFIA POR AIH'] !== undefined
        ? `Total de tomografias 0206010079 na AIH (${r['QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?']}) acima do limite de ${r['LIMITE TOMOGRAFIA POR AIH']} por AIH (HJXXIII/HIJPII).`
        : `Quantidade apresentada (${r['QUANTIDADE APRESENTADA E MAIOR QUE A MAXIMA?']}) acima da quantidade máxima do SIGTAP.`],
  ['CBO incompatível', 'A02B93', (r) => normText(r['CBO E O MESMO DO SIGTAP?']) === 'NAO',
    (r) => `CBO ${r.CBO} não consta na lista de CBOs nem na Categoria CBO do SIGTAP.`],
  ['CBO não informado', '7F6000', (r) => normText(r['CBO E O MESMO DO SIGTAP?']) === 'NAO INFORMADO',
    () => 'O SIGTAP exige CBO e o espelho da AIH não trouxe nenhum.'],
  ['Profissional/CBO não cadastrado', '800080', (r) => normText(r['PROFISSIONAL E CBO CADASTRADOS?']) === 'NAO',
    (r) => `O documento ${r.Documento} com CBO ${r.CBO} não foi encontrado na planilha auxiliar.`],
  ['Sexo incompatível', '2E75B6', (r) => normText(r['SEXO E COMPATIVEL?']) === 'NAO', (r) => `Sexo ${r.SEXO} incompatível com a regra do SIGTAP.`],
  ['Idade incompatível', '548235', (r) => normText(r['IDADE DENTRO DA FAIXA?']) === 'NAO',
    (r) => `Idade ${r['IDADE COMPLETA']} fora da faixa etária do SIGTAP.`],
].map(([label, color, test, detail]) => ({ label, color, test, detail }));

export function annotateAlerts(rows) {
  for (const row of rows) {
    const labels = ALERT_DEFINITIONS.filter((a) => a.test(row)).map((a) => a.label);
    row.ALERTAS = labels.join(' | ');
    row['TEM ALERTA?'] = labels.length ? 'SIM' : 'NAO';
  }
  return rows;
}

export function buildAlertRecords(rows) {
  const records = [];
  const counts = [];
  for (const def of ALERT_DEFINITIONS) {
    const aihs = new Set();
    let procedures = 0;
    for (const row of rows) {
      if (!def.test(row)) continue;
      procedures += 1;
      aihs.add(String(row.AIH ?? '').trim());
      records.push({
        'Tipo de alerta': def.label,
        AIH: row.AIH ?? '',
        'Data entrada': row['Data entrada'] ?? '',
        'Data saida': row['Data saida'] ?? '',
        'Nome paciente': row['Nome paciente'] ?? '',
        'Linha do procedimento': row['Linha do procedimento'] ?? '',
        'Codigo do procedimento': row['Codigo do procedimento'] ?? '',
        Procedimento: row.Procedimento ?? '',
        'Principal/secundario': row['Principal/secundario'] ?? '',
        'Quantidade apresentada': row['Quantidade apresentada'] ?? '',
        Documento: row.Documento ?? '',
        CBO: row.CBO ?? '',
        CID: row.CID ?? '',
        Detalhe: def.detail(row),
      });
    }
    counts.push({ label: def.label, color: def.color, aihs: aihs.size, procedimentos: procedures });
  }
  return { records, counts };
}

export function classificarTipoAih(codigoPrincipal) {
  return normCode(codigoPrincipal).startsWith('04') ? 'CIRURGICA' : 'CLINICA';
}

export function resumoAihTipoCti(rows) {
  const aihs = new Map();
  for (const row of rows) {
    const aih = String(row.AIH ?? '').trim();
    if (!aih || aihs.has(aih)) continue;
    aihs.set(aih, [classificarTipoAih(row['PROCEDIMENTO PRINCIPAL DA AIH']), asInt(row['DIARIAS DE UTI NA AIH']) > 0]);
  }
  const v = [...aihs.values()];
  return [
    ['AIH: cirúrgica sem CTI', v.filter(([t, c]) => t === 'CIRURGICA' && !c).length],
    ['AIH: clínica sem CTI', v.filter(([t, c]) => t === 'CLINICA' && !c).length],
    ['AIHs com CTI na cirúrgica', v.filter(([t, c]) => t === 'CIRURGICA' && c).length],
    ['AIHs com CTI na clínica', v.filter(([t, c]) => t === 'CLINICA' && c).length],
  ];
}

export { normText };
