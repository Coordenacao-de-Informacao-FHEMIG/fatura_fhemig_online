// Fatura Fhemig Ambulatorial 1.0 — leitura do BPA, planilhas da unidade e
// regras R01 a R11. Port de core/leitor_bpa.py, core/leitor_planilhas.py,
// core/regras.py e core/util.py (situacao_cpf, codigo_planilha...).
import { clean, normText, soDigitos, chaveColunaAmb, decodeLatin1, decodeUtf8Estrito, maisComuns, pyStr, sortedStr } from '../comum/texto.js';
import { localizarCabecalho } from '../sigtap/sigtap.js';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function carregarLayout(config) {
  const r = {};
  for (const nome of ['cabecalho', 'bpa_i', 'bpa_c']) {
    const def = config[nome];
    const campos = [];
    let esperado = 1;
    for (const item of def.campos) {
      const ini = +item.inicio;
      const fim = ini + +item.tamanho - 1;
      if (ini !== esperado) throw new Error(`layout_bpa.json: o campo "${item.nome}" do registro ${nome} começa na posição ${ini}, mas era esperado ${esperado}.`);
      campos.push({ nome: item.nome, ini, fim, tipo: item.tipo || 'txt' });
      esperado = fim + 1;
    }
    if (esperado - 1 !== +def.tamanho) throw new Error(`layout_bpa.json: os campos do registro ${nome} somam ${esperado - 1} posições, mas o tamanho declarado é ${def.tamanho}.`);
    r[nome] = { nome, identificador: String(def.identificador), tamanho: +def.tamanho, minimo: +(def.minimo ?? def.tamanho), campos };
  }
  return r;
}

function dataValida(txt) {
  if (!/^\d{8}$/.test(txt)) return null;
  const y = +txt.slice(0, 4);
  const m = +txt.slice(4, 6);
  const d = +txt.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d, chave: txt, br: `${txt.slice(6, 8)}/${txt.slice(4, 6)}/${txt.slice(0, 4)}` };
}

function converter(campo, bruto, linhaTxt, avisos) {
  if (campo.tipo === 'alfa') {
    const valor = bruto.replace(/\s+$/, '');
    return valor.trim() ? valor : null;
  }
  const valor = bruto.trim();
  if (!valor) return null;
  if (campo.tipo === 'int') {
    if (/^\d+$/.test(valor)) return parseInt(valor, 10);
    avisos.push({ linha_txt: linhaTxt, campo: campo.nome, mensagem: `Valor não numérico: "${valor}"` });
    return null;
  }
  if (campo.tipo === 'data') {
    const d = dataValida(valor);
    if (d) return d;
    avisos.push({ linha_txt: linhaTxt, campo: campo.nome, mensagem: `Data inválida: "${valor}"` });
    return null;
  }
  return valor;
}

export function fatiar(layout, linha, linhaTxt, avisos) {
  const l = linha.padEnd(layout.tamanho);
  const reg = {};
  for (const c of layout.campos) {
    const bruto = l.slice(c.ini - 1, c.fim);
    reg[c.nome] = converter(c, bruto, linhaTxt, avisos);
    if (c.tipo === 'data') reg[`${c.nome}_txt`] = bruto.trim();
  }
  return reg;
}

/** decodificar: ISO-8859-1 por padrao; UTF-8 quando claramente for UTF-8. */
export function decodificar(u8) {
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return [new TextDecoder('utf-8').decode(u8.subarray(3)), 'UTF-8 (com BOM)'];
  if (u8.some((b) => b > 0x7f)) {
    const t = decodeUtf8Estrito(u8);
    if (t !== null) return [t, 'UTF-8'];
  }
  return [decodeLatin1(u8), 'ISO-8859-1'];
}

// Quebras de linha reconhecidas por str.splitlines() do Python.
const QUEBRAS = new RegExp(String.fromCharCode(92) + 'r' + String.fromCharCode(92) + 'n|[' +
  ['n', 'r', 'v', 'f', 'x1c', 'x1d', 'x1e', 'x85', 'u2028', 'u2029'].map((c) => String.fromCharCode(92) + c).join('') + ']');

/** str.splitlines() do Python. */
export function splitlines(texto) {
  const partes = texto.split(QUEBRAS);
  if (partes.length && partes[partes.length - 1] === '') partes.pop();
  return partes;
}

function problemasObrigatorios(reg) {
  const p = [];
  const proc = reg.procedimento || '';
  if (!/^\d{10}$/.test(proc)) p.push(`código do procedimento ilegível ("${proc}")`);
  if (reg.quantidade === null || reg.quantidade === undefined) p.push('quantidade ausente ou não numérica');
  const comp = reg.competencia || '';
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(comp)) p.push(`competência inválida ("${comp}")`);
  if (!reg.cnes) p.push('CNES não informado');
  return p;
}

export function lerProducao(bytes, layouts) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const [conteudo, codificacao] = decodificar(u8);
  const linhas = splitlines(conteudo);
  const { cabecalho: lc, bpa_i: li, bpa_c: lcc } = layouts;
  let cabecalho = null;
  const registros = [];
  const avisos = [];
  let vazias = 0;
  let comConteudo = 0;
  linhas.forEach((linha, i) => {
    const indice = i + 1;
    if (!linha.trim()) {
      vazias += 1;
      return;
    }
    comConteudo += 1;
    const ident = linha.slice(0, 2);
    if (ident === lc.identificador && cabecalho === null && !registros.length) {
      cabecalho = fatiar(lc, linha, indice, avisos);
      cabecalho.linha_txt = indice;
      return;
    }
    if (ident === li.identificador || ident === lcc.identificador) {
      const layout = ident === li.identificador ? li : lcc;
      const tipo = layout === li ? 'I' : 'C';
      const erros = [];
      const util = linha.replace(/\s+$/, '').length;
      if (util < layout.minimo) erros.push(`linha ${tipo === 'I' ? 'BPA-I' : 'BPA-C'} truncada: ${util} posições (mínimo ${layout.minimo}, layout ${layout.tamanho})`);
      if (linha.length > layout.tamanho && linha.slice(layout.tamanho).trim()) {
        avisos.push({ linha_txt: indice, campo: '', mensagem: `Linha com ${linha.length} posições; o excedente após a posição ${layout.tamanho} foi ignorado.` });
      }
      const truncada = erros.length > 0;
      const reg = fatiar(layout, linha, indice, avisos);
      if (!truncada) erros.push(...problemasObrigatorios(reg));
      Object.assign(reg, { linha_txt: indice, tipo, erros, truncada, proc_valido: /^\d{10}$/.test(reg.procedimento || '') });
      registros.push(reg);
      return;
    }
    const motivo = ident === lc.identificador ? 'cabeçalho (tipo 01) repetido ou fora da primeira linha' : `tipo de registro desconhecido ("${ident}")`;
    registros.push({ linha_txt: indice, tipo: '?', erros: [motivo], tipo_registro: ident, quantidade: null, procedimento: null, linha_bruta: linha.slice(0, 60) });
  });
  return {
    cabecalho, registros, avisos, codificacao, linhas_com_conteudo: comConteudo, linhas_vazias: vazias,
    contagem: { I: registros.filter((r) => r.tipo === 'I').length, C: registros.filter((r) => r.tipo === 'C').length, invalidas: registros.filter((r) => r.tipo === '?').length },
  };
}

export function campoControle(registros) {
  let soma = 0;
  for (const r of registros) {
    if (r.tipo !== 'I' && r.tipo !== 'C') continue;
    const proc = r.procedimento || '';
    if (/^\d+$/.test(proc)) soma += parseInt(proc, 10);
    soma += parseInt(r.quantidade || 0, 10);
  }
  return (soma % 1111) + 1111;
}

export function conferirCabecalho(leitura) {
  const cab = leitura.cabecalho;
  const regs = leitura.registros;
  if (cab === null) return ['O arquivo não tem cabeçalho (linha tipo 01 com #BPA#). Confira se é o TXT de produção BPA original.'];
  const avisos = [];
  if ((cab.cbc_marcador || '') !== '#BPA#') avisos.push(`Cabeçalho sem o marcador #BPA# (lido: "${cab.cbc_marcador || ''}").`);
  const total = leitura.linhas_com_conteudo;
  if (cab.cbc_qtd_linhas !== null && cab.cbc_qtd_linhas !== undefined && cab.cbc_qtd_linhas !== total) {
    avisos.push(`Cabeçalho informa ${cab.cbc_qtd_linhas} linhas, mas o arquivo tem ${total} (incluindo o cabeçalho). Pode estar incompleto.`);
  }
  const folhas = new Set(regs.filter((r) => (r.tipo === 'I' || r.tipo === 'C') && r.folha).map((r) => `${r.tipo}|${r.folha}`));
  if (cab.cbc_qtd_folhas !== null && cab.cbc_qtd_folhas !== undefined && cab.cbc_qtd_folhas !== folhas.size) {
    avisos.push(`Cabeçalho informa ${cab.cbc_qtd_folhas} folhas, mas foram encontradas ${folhas.size}.`);
  }
  const controle = campoControle(regs);
  if (cab.cbc_controle !== null && cab.cbc_controle !== undefined && cab.cbc_controle !== controle) {
    avisos.push(`Campo de controle do cabeçalho (${cab.cbc_controle}) difere do recalculado (${controle}). O arquivo pode ter sido alterado ou estar incompleto.`);
  }
  return avisos;
}

export function competenciaProducao(leitura) {
  const comp = (leitura.cabecalho || {}).cbc_competencia || '';
  if (/^\d{4}(0[1-9]|1[0-2])$/.test(comp)) return comp;
  const c = new Map();
  for (const r of leitura.registros) if (r.competencia) c.set(r.competencia, (c.get(r.competencia) || 0) + 1);
  return c.size ? maisComuns(c, 1)[0][0] : '';
}

export function cnesProducao(leitura) {
  const c = new Map();
  for (const r of leitura.registros) if (r.cnes) c.set(r.cnes, (c.get(r.cnes) || 0) + 1);
  return c.size ? maisComuns(c, 1)[0][0] : '';
}

// ---------------------------------------------------------------------------
// Planilhas (util.codigo_planilha etc.)
// ---------------------------------------------------------------------------
export function codigoPlanilha(valor, tamanho) {
  if (valor === null || valor === undefined || typeof valor === 'boolean') return '';
  let v = valor;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return '';
    v = Math.trunc(v);
  }
  let d = soDigitos(v instanceof Date ? pyStr(v) : v);
  if (!d) return '';
  if (tamanho && d.length < tamanho) d = d.padStart(tamanho, '0');
  return d;
}

export function cboPlanilha(valor) {
  if (valor === null || valor === undefined) return '';
  let v = valor;
  if (typeof v === 'number') v = Math.trunc(v);
  let t = normText(pyStr(v)).replace(/[^0-9A-Z]/g, '');
  if (/^\d+$/.test(t) && t.length < 6) t = t.padStart(6, '0');
  return t;
}

export function numeroPlanilha(valor) {
  if (valor === null || valor === undefined || valor === '' || typeof valor === 'boolean') return null;
  if (typeof valor === 'number') return valor;
  const m = String(valor).match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}

export function competenciaPlanilha(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (valor instanceof Date) return `${valor.getUTCFullYear()}${String(valor.getUTCMonth() + 1).padStart(2, '0')}`;
  const t = clean(pyStr(valor));
  if (!t || t === '/' || t === '-') return '';
  if (/^9{2}\s*\/\s*9{4}$/.test(t) || t.startsWith('9999')) return '999999';
  let m = t.match(/^(\d{1,2})\s*\/\s*(\d{4})$/);
  if (m) return `${m[2]}${String(+m[1]).padStart(2, '0')}`;
  m = t.match(/^(\d{4})\s*[/-]?\s*(\d{2})$/);
  if (m) return `${m[1]}${m[2]}`;
  m = t.match(/^\d{1,2}\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (m) return `${m[2]}${String(+m[1]).padStart(2, '0')}`;
  return '';
}

export function situacaoCpf(cpf) {
  const bruto = String(cpf ?? '').trim();
  const texto = soDigitos(cpf ?? '');
  if (!bruto) return 'CPF não informado';
  if (!texto.replace(/0/g, '')) return 'CPF zerado';
  if (texto.length !== 11 || bruto.length !== texto.length) return `CPF com tamanho/formato inválido (${bruto.length} posições)`;
  if (new Set(texto).size === 1) return 'CPF com todos os dígitos iguais';
  for (const pos of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < pos; i += 1) soma += +texto[i] * (pos + 1 - i);
    if (((soma * 10) % 11) % 10 !== +texto[pos]) return 'CPF com dígito verificador inválido';
  }
  return '';
}

const DESCRICAO_TIPO = { profissionais: 'Profissionais', carga_horaria: 'Carga horária', servico_classificacao: 'Serviço/Classificação', habilitacao: 'Habilitação' };
const NOME_COLUNA = { CNS: 'CNS', NOME: 'NOME', CBO: 'CBO', CH_AMBULATORIAL: 'carga horária ambulatorial (Amb.)', CODIGO: 'Código (serviço - classificação)', CO_SERVICO: 'código do serviço', CO_CLASSIFICACAO: 'código da classificação', CO_HABILITACAO: 'Habilitação' };

export function abrirTabela(planilha, nomeArquivo, tipo, mapeamento) {
  const def = mapeamento[tipo];
  const descricao = DESCRICAO_TIPO[tipo] || tipo;
  let melhor = {};
  for (const aba of planilha.abas) {
    const [cab, indices] = localizarCabecalho(aba.linhas, def);
    if (cab) {
      const antes = [];
      for (const l of aba.linhas.slice(0, cab - 1)) for (const v of l) if (v !== null && v !== '') antes.push(clean(pyStr(v)));
      const linhas = aba.linhas.slice(cab).filter((l) => l.some((v) => v !== null && v !== ''));
      return { linhas, indices, antes };
    }
    if (Object.keys(indices).length > Object.keys(melhor).length) melhor = indices;
  }
  const faltam = def.obrigatorias[0].filter((c) => !(c in melhor)).map((c) => NOME_COLUNA[c] || c);
  const pl = faltam.length > 1 ? 's' : '';
  throw new Error(`Coluna${pl} ${faltam.join(', ')} não encontrada${pl} na planilha de ${descricao.toLowerCase()} (${nomeArquivo}). Confira o cabeçalho ou ajuste config/mapeamento_colunas.json.`);
}

const val = (l, ind, nome) => (ind[nome] === undefined || ind[nome] >= l.length ? null : l[ind[nome]]);
const cleanV = (v) => clean(v === null || v === undefined ? '' : pyStr(v));

export function lerProfissionais(planilha, nome, mapa) {
  const { linhas, indices: ind } = abrirTabela(planilha, nome, 'profissionais', mapa);
  const dados = new Map();
  let ignoradas = 0;
  for (const l of linhas) {
    const cns = codigoPlanilha(val(l, ind, 'CNS'), 15);
    const cbo = cboPlanilha(val(l, ind, 'CBO'));
    if (!cns) {
      ignoradas += 1;
      continue;
    }
    if (!dados.has(cns)) dados.set(cns, { nome: '', cbos: new Set() });
    const info = dados.get(cns);
    const n = cleanV(val(l, ind, 'NOME'));
    if (n && !info.nome) info.nome = n;
    if (cbo) info.cbos.add(cbo);
  }
  if (!dados.size) throw new Error('A planilha de Profissionais não contém CNS preenchidos.');
  return { dados, linhas: linhas.length, ignoradas };
}

export function lerCargaHoraria(planilha, nome, mapa) {
  const { linhas, indices: ind } = abrirTabela(planilha, nome, 'carga_horaria', mapa);
  const dados = new Map();
  const cbosPorCns = new Map();
  let ignoradas = 0;
  for (const l of linhas) {
    const cns = codigoPlanilha(val(l, ind, 'CNS'), 15);
    const cbo = cboPlanilha(val(l, ind, 'CBO'));
    if (!cns || !cbo) {
      ignoradas += 1;
      continue;
    }
    const k = `${cns}|${cbo}`;
    if (!dados.has(k)) dados.set(k, { amb: null, hosp: null, outros: null, linhas: 0 });
    const item = dados.get(k);
    item.linhas += 1;
    for (const [chave, coluna] of [['amb', 'CH_AMBULATORIAL'], ['hosp', 'CH_HOSPITALAR'], ['outros', 'CH_OUTROS']]) {
      const n = numeroPlanilha(val(l, ind, coluna));
      if (n !== null) item[chave] = (item[chave] || 0) + n;
    }
    if (!cbosPorCns.has(cns)) cbosPorCns.set(cns, new Set());
    cbosPorCns.get(cns).add(cbo);
  }
  if (!dados.size) throw new Error('A planilha de Carga horária não contém pares CNS/CBO preenchidos.');
  return { dados, cbos_por_cns: cbosPorCns, linhas: linhas.length, ignoradas };
}

export function lerServicos(planilha, nome, mapa) {
  const { linhas, indices: ind } = abrirTabela(planilha, nome, 'servico_classificacao', mapa);
  const dados = new Map();
  let ignoradas = 0;
  for (const l of linhas) {
    let servico;
    let classificacao;
    if ('CODIGO' in ind) {
      const nums = [...cleanV(val(l, ind, 'CODIGO')).matchAll(/(?<!\d)(\d{1,3})(?!\d)/g)].map((m) => m[1]);
      const brutos = [...(val(l, ind, 'CODIGO') === null ? '' : pyStr(val(l, ind, 'CODIGO'))).matchAll(/(?<!\d)(\d{1,3})(?!\d)/g)].map((m) => m[1]);
      const n = brutos.length ? brutos : nums;
      if (n.length < 2) {
        ignoradas += 1;
        continue;
      }
      servico = n[0].padStart(3, '0');
      classificacao = n[1].padStart(3, '0');
    } else {
      servico = codigoPlanilha(val(l, ind, 'CO_SERVICO'), 3);
      classificacao = codigoPlanilha(val(l, ind, 'CO_CLASSIFICACAO'), 3);
      if (!servico || !classificacao) {
        ignoradas += 1;
        continue;
      }
    }
    const terceiro = 'TERCEIRO' in ind ? normText(cleanV(val(l, ind, 'TERCEIRO'))) : 'NAO';
    const cnes = 'CNES' in ind ? codigoPlanilha(val(l, ind, 'CNES'), 7) : '';
    const nomeS = [cleanV(val(l, ind, 'NO_SERVICO')), cleanV(val(l, ind, 'NO_CLASSIFICACAO'))].filter(Boolean).join(' / ');
    const entrada = { terceiro: (terceiro.startsWith('SIM') || terceiro.startsWith('S')) && terceiro !== 'SEM' ? 'SIM' : 'NAO', cnes, nome: nomeS };
    const k = `${servico}-${classificacao}`;
    if (!dados.has(k)) dados.set(k, []);
    const lista = dados.get(k);
    if (lista.every((e) => e.terceiro !== entrada.terceiro || e.cnes !== entrada.cnes)) lista.push(entrada);
  }
  if (!dados.size) throw new Error('A planilha de Serviço/Classificação não contém códigos legíveis (000 - 000).');
  return { dados, linhas: linhas.length, ignoradas };
}

export function lerHabilitacoes(planilha, nome, mapa) {
  const { linhas, indices: ind, antes } = abrirTabela(planilha, nome, 'habilitacao', mapa);
  const dados = new Map();
  let ignoradas = 0;
  for (const l of linhas) {
    const bruto = val(l, ind, 'CO_HABILITACAO');
    let codigo;
    let nomeH;
    if (typeof bruto === 'number') {
      codigo = codigoPlanilha(bruto, 4);
      nomeH = '';
    } else {
      const texto = cleanV(bruto);
      const m = texto.match(/^(\d{1,4})\s*(?:-\s*(.*))?$/);
      if (!m) {
        ignoradas += 1;
        continue;
      }
      codigo = m[1].padStart(4, '0');
      nomeH = clean(m[2] || '');
    }
    if (!codigo) {
      ignoradas += 1;
      continue;
    }
    if (!dados.has(codigo)) dados.set(codigo, []);
    dados.get(codigo).push({ inicio: competenciaPlanilha(val(l, ind, 'VIGENCIA_INICIO')), fim: competenciaPlanilha(val(l, ind, 'VIGENCIA_FIM')), nome: nomeH });
  }
  let cnes = '';
  for (const t of antes) {
    const m = t.match(/^\s*(\d{7})\b/);
    if (m) {
      cnes = m[1];
      break;
    }
  }
  if (!cnes && 'CNES' in ind) {
    for (const l of linhas) {
      cnes = codigoPlanilha(val(l, ind, 'CNES'), 7);
      if (cnes) break;
    }
  }
  return { dados, cnes_unidade: cnes, titulo: antes.join(' ').slice(0, 120), linhas: linhas.length, ignoradas };
}

export function habilitacoesVigentes(habilitacoes, competencia) {
  const vig = new Set();
  for (const [codigo, periodos] of habilitacoes) {
    for (const p of periodos) {
      const ini = p.inicio || '000000';
      const fim = p.fim || '999999';
      if (!competencia || (ini <= competencia && competencia <= fim)) {
        vig.add(codigo);
        break;
      }
    }
  }
  return vig;
}

const chaveNome = (t) => normText(t).replace(/[^A-Z0-9]/g, '');

export function identificarUnidade(unidades, { cnes = '', nomes = [], siglaCabecalho = '' } = {}) {
  if (cnes) {
    const u = unidades.find((x) => x.cnes && x.cnes === cnes);
    if (u) return u;
  }
  for (const nome of nomes) {
    const alvo = chaveNome(String(nome).replace(/\.[^.]+$/, ''));
    for (const u of [...unidades].sort((a, b) => b.sigla.length - a.sigla.length)) {
      for (const s of [u.sigla, ...(u.apelidos || [])]) if (s && alvo.includes(chaveNome(s))) return u;
    }
  }
  if (siglaCabecalho) {
    const alvo = chaveNome(siglaCabecalho);
    for (const u of unidades) for (const s of [u.sigla, ...(u.apelidos || [])]) if (s && chaveNome(s) === alvo) return u;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Regras R01 a R11
// ---------------------------------------------------------------------------
export const R01 = 'R01-LINHA_INVALIDA';
export const R02 = 'R02-PROC_INEXISTENTE';
export const R04 = 'R04-CNS_NAO_CADASTRADO';
export const R05 = 'R05-CBO_NAO_VINCULADO';
export const R06 = 'R06-SEM_CH_AMBULATORIAL';
export const R08 = 'R08-SEM_HABILITACAO';
export const R10_SEM = 'R10-SEM_SERVICO_CLASSIF';
export const R10_TERCEIRO = 'R10-TERCEIRO_CNES_DIFERENTE';
export const R10_INCOMPATIVEL = 'R10-SERV_CLASSIF_INCOMPATIVEL';
export const R11 = 'R11-CPF_OBRIGATORIO';

function lista(codigos, nomes, limite = 8) {
  let itens = sortedStr(codigos).map((c) => `${c} - ${nomes.get(c) ?? ''}`.replace(/[ -]+$/, ''));
  if (itens.length > limite) itens = [...itens.slice(0, limite), `(+${itens.length - limite})`];
  return itens.join('; ');
}
const compBr = (a) => (a && a.length === 6 ? `${a.slice(4)}/${a.slice(0, 4)}` : '(competência não identificada)');
const h = (v) => (v !== null && v !== undefined ? `${Number.isInteger(v) ? v : +v.toPrecision(6)}h` : 'vazia');

export function aplicarRegras(registros, ctx) {
  const atribCpf = new Set(ctx.opcoes.atributos_cpf_obrigatorio || ['058']);
  const S = ctx.sigtap;
  for (const reg of registros) {
    const alertas = reg.erros && reg.erros.length ? [[R01, `Linha inválida: ${reg.erros.join('; ')}.`]] : [];
    reg.exige_habilitacao = null;
    reg.exige_servico = null;
    reg.exige_cpf = null;
    if ((reg.tipo !== 'I' && reg.tipo !== 'C') || reg.truncada) {
      reg.alertas = alertas;
      continue;
    }
    const individual = reg.tipo === 'I';
    if (individual) {
      const cns = reg.cns_profissional;
      if (!cns) alertas.push([R04, 'CNS do profissional não informado na linha.']);
      else if (!ctx.profissionais.has(cns)) alertas.push([R04, `CNS ${cns} não consta na planilha de Profissionais da unidade.`]);
      const info = cns ? ctx.profissionais.get(cns) : null;
      if (info) {
        const cbo = reg.cbo || '';
        if (!info.cbos.has(cbo)) alertas.push([R05, `CBO ${cbo || '(vazio)'} não vinculado ao profissional. CBOs cadastrados: ${sortedStr(info.cbos).join(', ') || 'nenhum'}.`]);
      }
      const item = ctx.carga_horaria.get(`${cns || ''}|${reg.cbo || ''}`);
      if (item === undefined) {
        const outros = ctx.cbos_com_carga.get(cns || '');
        if (outros && outros.size) alertas.push([R06, `Sem carga horária para o CBO ${reg.cbo || '(vazio)'}. CBOs com carga horária: ${sortedStr(outros).join(', ')}.`]);
        else alertas.push([R06, 'Profissional sem linha na planilha de Carga horária.']);
      } else if (item.amb === null || item.amb <= 0) {
        alertas.push([R06, `Carga horária ambulatorial ${h(item.amb)} para o CBO ${reg.cbo || ''} (hospitalar ${h(item.hosp)}, outros ${h(item.outros)}).`]);
      }
    }
    if (reg.proc_valido) {
      const proc = reg.procedimento;
      if (!S.procedimentos.has(proc)) {
        alertas.push([R02, `Procedimento ${proc} não existe no SIGTAP ${compBr(S.competencia)}.`]);
      } else {
        reg.exige_habilitacao = Boolean((S.habilitacoes.get(proc) && S.habilitacoes.get(proc).size) || (S.grupos_habilitacao.get(proc) && S.grupos_habilitacao.get(proc).size));
        reg.exige_servico = Boolean(S.servicos.get(proc) && S.servicos.get(proc).size);
        reg.exige_cpf = [...(S.detalhes.get(proc) || [])].some((d) => atribCpf.has(d));
        // R08
        const individuais = S.habilitacoes.get(proc) || new Set();
        let grupos = S.grupos_habilitacao.get(proc) || new Map();
        if (ctx.opcoes.habilitacao_por_grupo === 'ignorar') grupos = new Map();
        if (individuais.size || grupos.size) {
          const vig = ctx.habilitacoes_vigentes;
          const okInd = [...individuais].some((x) => vig.has(x));
          const okGrupo = [...grupos.values()].some((m) => m.size && [...m].every((x) => vig.has(x)));
          if (!okInd && !okGrupo) {
            const partes = [];
            if (individuais.size) partes.push(`Exige uma das habilitações: ${lista(individuais, S.nomes_habilitacao)}`);
            if (grupos.size) partes.push(`ou o conjunto completo de um grupo: ${sortedStr(grupos.keys()).join('; ')}`);
            const todas = new Set([...individuais, ...[...grupos.values()].flatMap((m) => [...m])]);
            const fora = sortedStr([...todas].filter((x) => ctx.habilitacoes_unidade.has(x) && !vig.has(x)));
            if (fora.length) partes.push(`A unidade possui ${fora.join(', ')} fora da vigência na competência`);
            alertas.push([R08, `${partes.join('. ')}.`]);
          }
        }
        // R10
        const exigidos = S.servicos.get(proc) || new Set();
        if (exigidos.size) {
          const cadastrados = [...exigidos].filter((p) => ctx.servicos_unidade.has(p));
          if (!cadastrados.length) {
            alertas.push([R10_SEM, `Exige um dos serviços/classificações: ${lista(exigidos, S.nomes_servico)}.`]);
          } else {
            const executante = reg.cnes || '';
            let aprovado = false;
            const terceiros = new Set();
            for (const par of cadastrados) {
              for (const e of ctx.servicos_unidade.get(par)) {
                if (e.terceiro !== 'SIM') aprovado = true;
                else if (!executante || (e.cnes && e.cnes === executante)) aprovado = true;
                else if (e.cnes) terceiros.add(e.cnes);
                else terceiros.add('CNES não informado');
              }
            }
            if (!aprovado) {
              alertas.push([R10_TERCEIRO, `Serviço ${sortedStr(cadastrados).join(', ')} só executado por terceiro (CNES ${sortedStr(terceiros).join(', ')}); CNES da linha: ${executante}.`]);
            }
          }
          if (individual) {
            const s = reg.servico || '';
            const c = reg.classificacao || '';
            if (s || c) {
              const par = `${s || '   '}-${c || '   '}`;
              if (!exigidos.has(par)) alertas.push([R10_INCOMPATIVEL, `Informado ${par}; o procedimento exige: ${lista(exigidos, S.nomes_servico)}.`]);
            }
          }
        }
        // R11
        if (individual && ctx.opcoes.r11_ativa !== false) {
          if ([...(S.detalhes.get(proc) || [])].some((d) => atribCpf.has(d))) {
            const motivo = situacaoCpf(reg.cpf_paciente);
            if (motivo) alertas.push([R11, `${motivo}; o procedimento tem o atributo 058 (CPF obrigatório).`]);
          }
        }
      }
    }
    reg.alertas = alertas;
  }
  return registros;
}

export { chaveColunaAmb };
