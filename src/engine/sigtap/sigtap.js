// Base SIGTAP unica para o Hospitalar e o Ambulatorial.
//
// Fontes aceitas:
//  - pasta/zip de TXT do DATASUS (<tabela>.txt + <tabela>_layout.txt);
//  - base compacta embutida no site (gerada por scripts/build-sigtap.mjs a
//    partir da mesma pasta TXT, so com as colunas usadas);
//  - planilha SIGTAP*.xlsx (somente Ambulatorial, como no .exe).
//
// A partir da fonte, montarSigtapHospitalar() reproduz _ler_sigtap_txt do
// Hospitalar 14.3 e montarSigtapAmbulatorial() reproduz _ler_pasta_txt do
// Ambulatorial 1.0.
import { clean, decodeLatin1, chaveDoMaior, soDigitos, normCode, normText, chaveColunaAmb as chaveDeColuna } from '../comum/texto.js';
import { ATRIBUTO_PERMANENCIA_MAIOR, SIGTAP_SEXO, extractAttributeCodes, extractCboCodes, sigtapAgeMonths } from '../hospitalar/regras.js';

/** Colunas guardadas na base compacta (as unicas lidas pelos dois motores). */
export const COLUNAS_USADAS = {
  tb_procedimento: ['CO_PROCEDIMENTO', 'NO_PROCEDIMENTO', 'TP_SEXO', 'QT_MAXIMA_EXECUCAO', 'QT_DIAS_PERMANENCIA',
    'VL_IDADE_MINIMA', 'VL_IDADE_MAXIMA', 'DT_COMPETENCIA'],
  tb_servico: ['CO_SERVICO', 'NO_SERVICO'],
  tb_servico_classificacao: ['CO_SERVICO', 'CO_CLASSIFICACAO', 'NO_CLASSIFICACAO'],
  tb_detalhe: ['CO_DETALHE', 'NO_DETALHE'],
  tb_ocupacao: ['CO_OCUPACAO'],
  tb_habilitacao: ['CO_HABILITACAO', 'NO_HABILITACAO'],
  tb_grupo_habilitacao: ['NU_GRUPO_HABILITACAO', 'NO_GRUPO_HABILITACAO'],
  rl_procedimento_ocupacao: ['CO_PROCEDIMENTO', 'CO_OCUPACAO'],
  rl_procedimento_cid: ['CO_PROCEDIMENTO', 'CO_CID', 'ST_PRINCIPAL'],
  rl_procedimento_habilitacao: ['CO_PROCEDIMENTO', 'CO_HABILITACAO', 'NU_GRUPO_HABILITACAO'],
  rl_procedimento_servico: ['CO_PROCEDIMENTO', 'CO_SERVICO', 'CO_CLASSIFICACAO'],
  rl_procedimento_detalhe: ['CO_PROCEDIMENTO', 'CO_DETALHE'],
};
const OPCIONAIS = new Set(['tb_grupo_habilitacao']);

// ---------------------------------------------------------------------------
// Fonte TXT DATASUS
// ---------------------------------------------------------------------------
function lerLayout(texto, tabela) {
  const linhas = texto.split(/\r\n|\r|\n/).filter((l) => l.trim());
  const cab = linhas.shift().split(',').map((s) => s.trim());
  const iCol = cab.indexOf('Coluna');
  const iIni = cab.indexOf('Inicio');
  const iFim = cab.indexOf('Fim');
  if (iCol < 0 || iIni < 0 || iFim < 0) throw new Error(`Layout ilegível na base SIGTAP: ${tabela}_layout.txt`);
  const campos = {};
  for (const l of linhas) {
    const p = l.split(',');
    campos[clean(p[iCol])] = [parseInt(p[iIni], 10) - 1, parseInt(p[iFim], 10)];
  }
  return campos;
}

/**
 * Fonte a partir dos arquivos do DATASUS.
 * arquivos: Map(nome em minusculas -> Uint8Array).
 */
export function fonteDatasus(arquivos) {
  const ler = (nome) => {
    const b = arquivos.get(nome.toLowerCase());
    return b ? decodeLatin1(b) : null;
  };
  return {
    tipo: 'txt',
    existe(tabela) {
      return arquivos.has(`${tabela}.txt`) && arquivos.has(`${tabela}_layout.txt`);
    },
    *registros(tabela) {
      const layoutTxt = ler(`${tabela}_layout.txt`);
      if (layoutTxt === null) throw new Error(`Layout ausente na base SIGTAP: ${tabela}_layout.txt`);
      const dados = ler(`${tabela}.txt`);
      if (dados === null) throw new Error(`Arquivo ausente na base SIGTAP: ${tabela}.txt`);
      const campos = Object.entries(lerLayout(layoutTxt, tabela));
      for (const linha of dados.split(/\r\n|\r|\n/)) {
        if (!linha.trim()) continue;
        const r = {};
        for (const [nome, [ini, fim]] of campos) r[nome] = linha.slice(ini, fim).trim();
        yield r;
      }
    },
  };
}

/** Converte a fonte DATASUS na base compacta (so as colunas usadas). */
export function compactar(fonte) {
  const tabelas = {};
  for (const [tabela, colunas] of Object.entries(COLUNAS_USADAS)) {
    if (!fonte.existe(tabela)) {
      if (OPCIONAIS.has(tabela)) continue;
      throw new Error(`Base SIGTAP incompleta: falta ${tabela}.txt/${tabela}_layout.txt`);
    }
    const linhas = [];
    let presentes = null;
    for (const r of fonte.registros(tabela)) {
      if (presentes === null) presentes = colunas.filter((c) => c in r);
      linhas.push(presentes.map((c) => r[c]));
    }
    tabelas[tabela] = { colunas: presentes || colunas, linhas };
  }
  return { formato: 'sigtap-compacto-1', tabelas };
}

/** Fonte a partir da base compacta embutida. */
export function fonteCompacta(json) {
  return {
    tipo: 'txt',
    existe: (tabela) => Boolean(json.tabelas[tabela]),
    *registros(tabela) {
      const t = json.tabelas[tabela];
      if (!t) throw new Error(`Arquivo ausente na base SIGTAP: ${tabela}.txt`);
      for (const l of t.linhas) {
        const r = {};
        t.colunas.forEach((c, i) => {
          r[c] = l[i];
        });
        yield r;
      }
    },
  };
}

/** Competencia (AAAAMM) mais frequente do tb_procedimento. */
export function competenciaDaFonte(fonte) {
  const cont = new Map();
  for (const r of fonte.registros('tb_procedimento')) {
    if (r.DT_COMPETENCIA) cont.set(r.DT_COMPETENCIA, (cont.get(r.DT_COMPETENCIA) || 0) + 1);
  }
  return cont.size ? chaveDoMaior(cont) : '';
}

// ---------------------------------------------------------------------------
// Hospitalar 14.3: _ler_sigtap_txt
// ---------------------------------------------------------------------------
function sigtapNumero(value) {
  const m = String(value ?? '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(',', '.'));
  return n === 9999 ? null : n;
}

function sigtapIdadeTexto(value) {
  const meses = sigtapNumero(value);
  if (meses === null) return 'Não se Aplica';
  const m = Math.trunc(meses);
  return m < 12 ? `${m} Mes(es)` : `${Math.trunc(m / 12)} Ano(s)`;
}

const unicos = (itens) => [...new Set(itens)];

export function montarSigtapHospitalar(fonte) {
  const nomesServico = new Map();
  for (const r of fonte.registros('tb_servico')) nomesServico.set(r.CO_SERVICO, r.NO_SERVICO);
  const nomesClass = new Map();
  for (const r of fonte.registros('tb_servico_classificacao')) nomesClass.set(`${r.CO_SERVICO}|${r.CO_CLASSIFICACAO}`, r.NO_CLASSIFICACAO);
  const nomesDetalhe = new Map();
  for (const r of fonte.registros('tb_detalhe')) nomesDetalhe.set(r.CO_DETALHE, r.NO_DETALHE);
  const familias = new Map();
  for (const r of fonte.registros('tb_ocupacao')) {
    if (r.CO_OCUPACAO) {
      const f = r.CO_OCUPACAO.slice(0, 4);
      if (!familias.has(f)) familias.set(f, new Set());
      familias.get(f).add(r.CO_OCUPACAO);
    }
  }
  const push = (m, k, v) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  };
  const ocupacoes = new Map();
  for (const r of fonte.registros('rl_procedimento_ocupacao')) push(ocupacoes, r.CO_PROCEDIMENTO, r.CO_OCUPACAO);
  const cids = new Map();
  const cidsSec = new Map();
  for (const r of fonte.registros('rl_procedimento_cid')) push(r.ST_PRINCIPAL === 'S' ? cids : cidsSec, r.CO_PROCEDIMENTO, r.CO_CID);
  const habs = new Map();
  for (const r of fonte.registros('rl_procedimento_habilitacao')) if (!r.NU_GRUPO_HABILITACAO) push(habs, r.CO_PROCEDIMENTO, r.CO_HABILITACAO);
  const servicos = new Map();
  for (const r of fonte.registros('rl_procedimento_servico')) push(servicos, r.CO_PROCEDIMENTO, [r.CO_SERVICO, r.CO_CLASSIFICACAO]);
  const detalhes = new Map();
  for (const r of fonte.registros('rl_procedimento_detalhe')) push(detalhes, r.CO_PROCEDIMENTO, r.CO_DETALHE);

  const regras = new Map();
  const descricoes = new Map();
  const competencias = new Map();
  for (const row of fonte.registros('tb_procedimento')) {
    const code = normCode(row.CO_PROCEDIMENTO);
    if (!code) continue;
    const nome = clean(row.NO_PROCEDIMENTO);
    if (nome && !descricoes.has(code)) descricoes.set(code, nome);
    if (row.DT_COMPETENCIA) competencias.set(row.DT_COMPETENCIA, (competencias.get(row.DT_COMPETENCIA) || 0) + 1);

    const ocupProc = new Set(ocupacoes.get(code) || []);
    const categorias = new Set();
    for (const fam of new Set([...ocupProc].map((c) => c.slice(0, 4)))) {
      const todos = familias.get(fam);
      if (todos && todos.size && [...todos].every((c) => ocupProc.has(c))) categorias.add(fam);
    }
    const cboTexto = unicos(ocupacoes.get(code) || []).join(', ');
    const paresVistos = new Set();
    const pares = [];
    for (const [s, c] of servicos.get(code) || []) {
      const k = `${s}|${c}`;
      if (!paresVistos.has(k)) {
        paresVistos.add(k);
        pares.push([s, c]);
      }
    }
    const servicoTexto = pares
      .map(([s, c]) => `${s} - ${nomesServico.get(s) ?? ''} - ${c} - ${nomesClass.get(`${s}|${c}`) ?? ''}`)
      .join(', ');
    const atributoTexto = unicos(detalhes.get(code) || []).map((d) => `${d} - ${nomesDetalhe.get(d) ?? ''}`).join(', ');
    const atributos = extractAttributeCodes(atributoTexto);
    const sexo = String(row.TP_SEXO || '').toUpperCase();
    regras.set(code, {
      sexo: SIGTAP_SEXO[sexo] ?? row.TP_SEXO,
      cbo: cboTexto,
      cbos_codigos: extractCboCodes(cboTexto),
      cbo_categorias: categorias,
      cid: unicos(cids.get(code) || []).join(', '),
      cid_secundario: unicos(cidsSec.get(code) || []).join(', '),
      qtd_maxima: sigtapNumero(row.QT_MAXIMA_EXECUCAO),
      servico_classificacao: servicoTexto,
      servicos_classificacoes_codigos: new Set(pares.map(([s, c]) => `${s}-${c}`)),
      habilitacoes_codigos: new Set(habs.get(code) || []),
      idade_min: sigtapNumero(row.VL_IDADE_MINIMA),
      idade_max: sigtapAgeMonths(sigtapIdadeTexto(row.VL_IDADE_MAXIMA), true),
      media_permanencia: sigtapNumero(row.QT_DIAS_PERMANENCIA),
      atributos,
      admite_permanencia_maior: atributos.has(ATRIBUTO_PERMANENCIA_MAIOR),
    });
  }
  if (!regras.size) throw new Error('tb_procedimento.txt da base SIGTAP não possui procedimentos.');
  return { regras, descricoes, competencia: competencias.size ? chaveDoMaior(competencias) : '' };
}

// ---------------------------------------------------------------------------
// Ambulatorial 1.0: BaseSigtap (TXT e planilha)
// ---------------------------------------------------------------------------
export function novaBaseAmb() {
  return {
    fonte: '', caminho: '', competencia: '',
    procedimentos: new Map(), habilitacoes: new Map(), grupos_habilitacao: new Map(),
    nomes_habilitacao: new Map(), nomes_grupo: new Map(), servicos: new Map(), nomes_servico: new Map(),
    detalhes: new Map(), nomes_detalhe: new Map(), log: [],
  };
}

const addSet = (m, k, v) => {
  if (!m.has(k)) m.set(k, new Set());
  m.get(k).add(v);
};

export function montarSigtapAmbulatorial(fonte) {
  const base = novaBaseAmb();
  const comp = new Map();
  for (const r of fonte.registros('tb_procedimento')) {
    const codigo = soDigitos(r.CO_PROCEDIMENTO);
    if (codigo.length !== 10) continue;
    base.procedimentos.set(codigo, clean(r.NO_PROCEDIMENTO));
    if (r.DT_COMPETENCIA) comp.set(r.DT_COMPETENCIA, (comp.get(r.DT_COMPETENCIA) || 0) + 1);
  }
  base.competencia = comp.size ? chaveDoMaior(comp) : '';
  for (const r of fonte.registros('tb_habilitacao')) base.nomes_habilitacao.set(r.CO_HABILITACAO, clean(r.NO_HABILITACAO));
  if (fonte.existe('tb_grupo_habilitacao')) {
    for (const r of fonte.registros('tb_grupo_habilitacao')) {
      base.nomes_grupo.set(r.NU_GRUPO_HABILITACAO, clean(r.NO_GRUPO_HABILITACAO || r.NU_GRUPO_HABILITACAO));
    }
  }
  const gruposBrutos = new Map();
  for (const r of fonte.registros('rl_procedimento_habilitacao')) {
    const { CO_PROCEDIMENTO: proc, CO_HABILITACAO: hab, NU_GRUPO_HABILITACAO: grupo } = r;
    if (grupo) {
      if (!gruposBrutos.has(proc)) gruposBrutos.set(proc, new Map());
      addSet(gruposBrutos.get(proc), grupo, hab);
    } else addSet(base.habilitacoes, proc, hab);
  }
  for (const [proc, grupos] of gruposBrutos) {
    const m = new Map();
    for (const [g, membros] of grupos) m.set(base.nomes_grupo.get(g) ?? g, membros);
    base.grupos_habilitacao.set(proc, m);
  }
  const nomesSrv = new Map();
  for (const r of fonte.registros('tb_servico')) nomesSrv.set(r.CO_SERVICO, clean(r.NO_SERVICO));
  for (const r of fonte.registros('tb_servico_classificacao')) {
    base.nomes_servico.set(`${r.CO_SERVICO}-${r.CO_CLASSIFICACAO}`, `${nomesSrv.get(r.CO_SERVICO) ?? ''} / ${clean(r.NO_CLASSIFICACAO)}`);
  }
  for (const r of fonte.registros('rl_procedimento_servico')) addSet(base.servicos, r.CO_PROCEDIMENTO, `${r.CO_SERVICO}-${r.CO_CLASSIFICACAO}`);
  for (const r of fonte.registros('tb_detalhe')) base.nomes_detalhe.set(r.CO_DETALHE, clean(r.NO_DETALHE));
  for (const r of fonte.registros('rl_procedimento_detalhe')) addSet(base.detalhes, r.CO_PROCEDIMENTO, r.CO_DETALHE);
  base.log.push(`Base SIGTAP: ${base.procedimentos.size} procedimentos lidos.`);
  base.fonte = 'txt';
  return base;
}

// --- planilha SIGTAP*.xlsx (leitor_sigtap._ler_planilha) ---
const RE_HAB = /(?<![\d])(\d{4})\s*-\s*([\s\S]*?)(?=,\s*\d{4}\s*-|$)/g;
const GRUPO = String.raw`(?:\d{4}\s*,\s*)*\d{4}\s+e\s+\d{4}`;
const RE_GRUPO = new RegExp(String.raw`(${GRUPO})\s*-\s*(\d{4})\s*-\s*([\s\S]*?)(?=,\s*${GRUPO}\s*-|$)`, 'g');
const RE_SERV = /(?<![\d])(\d{3})\s*-\s*([\s\S]*?)\s*-\s*(\d{3})\s*-\s*([\s\S]*?)(?=,\s*\d{3}\s*-|$)/g;
const SEP_DET = /,\s*(?=\d{3}(?:\s*-|\s*,|\s*$))/;

const texto = (v) => (v === null || v === undefined ? '' : typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v));

export function separarHabilitacoes(t) {
  return [...texto(t).matchAll(RE_HAB)].map((m) => [m[1], clean(m[2])]);
}
export function separarGrupos(t) {
  return [...texto(t).matchAll(RE_GRUPO)].map((m) => [clean(m[1]), m[2], clean(m[3])]);
}
export function separarServicos(t) {
  return [...texto(t).matchAll(RE_SERV)].map((m) => [m[1], clean(m[2]), m[3], clean(m[4])]);
}
export function separarDetalhes(t) {
  const itens = [];
  for (const parte of texto(t).split(SEP_DET)) {
    const m = parte.match(/^\s*(\d{3})(?!\d)(?:\s*-\s*([\s\S]*))?/);
    if (m) itens.push([m[1], clean(m[2])]);
  }
  return itens;
}

/** localizar_cabecalho (Ambulatorial): procura o cabecalho nas 20 primeiras linhas. */
export function localizarCabecalho(linhas, definicao, maxLinhas = 20) {
  const sinonimos = Object.entries(definicao.colunas || {}).map(([interno, lista]) => [interno, new Set(lista.map(chaveDeColuna))]);
  const alternativas = definicao.obrigatorias || [];
  let melhor = null;
  for (let n = 0; n < Math.min(maxLinhas, linhas.length); n += 1) {
    const chaves = linhas[n].map(chaveDeColuna);
    const indices = {};
    const usados = new Set();
    for (const [interno, nomes] of sinonimos) {
      for (let i = 0; i < chaves.length; i += 1) {
        if (chaves[i] && nomes.has(chaves[i]) && !usados.has(i)) {
          indices[interno] = i;
          usados.add(i);
          break;
        }
      }
    }
    const completa = alternativas.length
      ? alternativas.some((alt) => alt.every((c) => c in indices))
      : Object.keys(indices).length > 0;
    if (completa) return [n + 1, indices];
    if (Object.keys(indices).length && (melhor === null || Object.keys(indices).length > Object.keys(melhor[1]).length)) {
      melhor = [n + 1, indices];
    }
  }
  return [null, melhor ? melhor[1] : {}];
}

/** Planilha SIGTAP (abas ja lidas por lerPlanilha). */
export function lerPlanilhaSigtap(abas, definicao, nomeArquivo) {
  let aba = null;
  let cab = null;
  let indices = {};
  for (const a of abas) {
    [cab, indices] = localizarCabecalho(a.linhas, definicao);
    if (cab) {
      aba = a;
      break;
    }
  }
  if (!aba) {
    const faltam = ((definicao.obrigatorias || [[]])[0] || []).filter((c) => !(c in indices));
    throw new Error(
      `Planilha SIGTAP "${nomeArquivo}": coluna(s) ${faltam.join(', ') || 'Procedimento'} não encontrada(s). ` +
        'Use a planilha exportada do SIGTAP com as colunas Procedimento, Habilitação, Serviço / Classificação e Atributo Complementar.',
    );
  }
  const base = novaBaseAmb();
  const iCod = indices.CODIGO;
  const val = (l, i) => (i !== undefined && i < l.length ? l[i] : null);
  for (const linha of aba.linhas.slice(cab)) {
    const textoProc = clean(val(linha, indices.PROCEDIMENTO));
    let codigo = iCod !== undefined ? soDigitos(texto(val(linha, iCod))) : '';
    if (!codigo) {
      const m = textoProc.match(/^\s*(\d{10})/);
      codigo = m ? m[1] : '';
    }
    if (codigo && codigo.length < 10) codigo = codigo.padStart(10, '0');
    if (!/^\d{10}$/.test(codigo)) continue;
    base.procedimentos.set(codigo, textoProc.replace(new RegExp(`^\\s*${codigo}\\s*-\\s*`), ''));
    const habs = separarHabilitacoes(val(linha, indices.HABILITACAO));
    const grupos = separarGrupos(val(linha, indices.HABILITACAO_GRUPO));
    const emGrupo = new Set(grupos.map((g) => g[1]));
    const individuais = new Set(habs.map((h) => h[0]).filter((c) => !emGrupo.has(c)));
    if (individuais.size) base.habilitacoes.set(codigo, individuais);
    for (const [c, n] of habs) if (!base.nomes_habilitacao.has(c)) base.nomes_habilitacao.set(c, n);
    if (grupos.length) {
      const porGrupo = new Map();
      for (const [rotulo, c, n] of grupos) {
        addSet(porGrupo, rotulo, c);
        if (!base.nomes_habilitacao.has(c)) base.nomes_habilitacao.set(c, n);
        if (!base.nomes_grupo.has(rotulo)) base.nomes_grupo.set(rotulo, rotulo);
      }
      const m = new Map();
      for (const [rotulo, membros] of porGrupo) m.set(rotulo, new Set([...(rotulo.match(/\d{4}/g) || []), ...membros]));
      base.grupos_habilitacao.set(codigo, m);
    }
    const servs = separarServicos(val(linha, indices.SERVICO_CLASSIFICACAO));
    if (servs.length) {
      base.servicos.set(codigo, new Set(servs.map(([s, , c]) => `${s}-${c}`)));
      for (const [s, ns, c, nc] of servs) if (!base.nomes_servico.has(`${s}-${c}`)) base.nomes_servico.set(`${s}-${c}`, `${ns} / ${nc}`);
    }
    const dets = separarDetalhes(val(linha, indices.ATRIBUTO_COMPLEMENTAR));
    if (dets.length) {
      base.detalhes.set(codigo, new Set(dets.map((d) => d[0])));
      for (const [c, n] of dets) if (!base.nomes_detalhe.has(c)) base.nomes_detalhe.set(c, n);
    }
  }
  base.log.push(`Planilha SIGTAP: ${base.procedimentos.size} procedimentos lidos.`);
  base.fonte = 'xlsx';
  return base;
}

/** Competencia AAAAMM contida no nome (SIGTAP102026.xlsx, 202610...). */
export function competenciaNoNome(nome) {
  const stem = String(nome).replace(/\.[^.]+$/, '');
  for (const bloco of stem.match(/\d{6}/g) || []) {
    let mes = bloco.slice(0, 2);
    let ano = bloco.slice(2);
    if (+mes >= 1 && +mes <= 12 && ano.startsWith('20')) return `${ano}${mes}`;
    ano = bloco.slice(0, 4);
    mes = bloco.slice(4);
    if (ano.startsWith('20') && +mes >= 1 && +mes <= 12) return `${ano}${mes}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Hospitalar a partir da planilha SIGTAP*.xlsx (load_sigtap da versao 14.1,
// com as regras da 14.3: idade maxima em anos inclui os meses ate o proximo
// aniversario e 9999 = "nao se aplica", como na leitura dos TXT).
// ---------------------------------------------------------------------------
const chaveCab = (v) => normText(v === null || v === undefined ? '' : String(v)).replace(/[^A-Z0-9]/g, '');
// Os cabecalhos exportados as vezes chegam com acento trocado ("Idade Mánima").
const COLUNAS_HOSP = {
  codigo: /^CODIGO$/, procedimento: /^PROCEDIMENTO$/, sexo: /^SEXO$/, idadeMin: /^IDADEM.NIMA$/, idadeMax: /^IDADEM.XIMA$/,
  media: /^MEDIAPERMANENCIA$/, cbo: /^CBO$/, categoria: /^CATEGORIACBO$/, cid: /^CID$/, cidSec: /^CIDSECUNDARIO$/,
  qtd: /^QTDMAXIMA$/, servico: /^SERVICOCLASSIFICACAO$/, habilitacao: /^HABILITACAO$/, atributo: /^ATRIBUTOCOMPLEMENTAR$/,
};
const OBRIGATORIAS_HOSP = ['codigo', 'sexo', 'idadeMin', 'idadeMax', 'media', 'cbo', 'cid', 'cidSec', 'qtd', 'servico', 'habilitacao'];
const NOMES_HOSP = { codigo: 'Código', sexo: 'Sexo:', idadeMin: 'Idade Mínima', idadeMax: 'Idade Máxima', media: 'Média Permanência', cbo: 'CBO', cid: 'CID', cidSec: 'CID Secundário', qtd: 'Qtd Máxima', servico: 'Serviço / Classificação', habilitacao: 'Habilitação' };

function numeroOuNulo(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v === 9999 ? null : v;
  const m = String(v).match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(',', '.'));
  return n === 9999 ? null : n;
}

export function extractServiceClassificationPairs(value) {
  const pares = new Set();
  for (const item of String(value || '').split(',')) {
    const c = [...item.matchAll(/(?<!\d)(\d{3})(?!\d)/g)].map((m) => m[1]);
    if (c.length >= 2) pares.add(`${c[0]}-${c[1]}`);
  }
  return pares;
}

export function montarSigtapHospitalarPlanilha(planilha, nomeArquivo = 'SIGTAP.xlsx') {
  const aba = planilha.abas[planilha.ativa || 0];
  const cab = (aba.linhas[0] || []).map(chaveCab);
  const idx = {};
  for (const [k, re] of Object.entries(COLUNAS_HOSP)) {
    const i = cab.findIndex((c) => re.test(c));
    if (i >= 0) idx[k] = i;
  }
  const faltam = OBRIGATORIAS_HOSP.filter((k) => idx[k] === undefined).map((k) => NOMES_HOSP[k]);
  if (faltam.length) throw new Error(`Planilha SIGTAP "${nomeArquivo}": colunas ausentes para o Hospitalar: ${faltam.join(', ')}.`);
  const regras = new Map();
  const descricoes = new Map();
  const cel = (l, k) => (idx[k] === undefined ? null : l[idx[k]]);
  const txt = (v) => (v === null || v === undefined ? '' : String(v));
  for (const l of aba.linhas.slice(1)) {
    const code = normCode(txt(cel(l, 'codigo')));
    if (!code) continue;
    const nomeProc = clean(txt(cel(l, 'procedimento'))).replace(new RegExp(`^\\s*${code}\\s*-\\s*`), '');
    if (nomeProc && !descricoes.has(code)) descricoes.set(code, nomeProc);
    const atributos = extractAttributeCodes(txt(cel(l, 'atributo')));
    const cboTexto = txt(cel(l, 'cbo'));
    const servTexto = txt(cel(l, 'servico'));
    const habs = new Set([...txt(cel(l, 'habilitacao')).matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((m) => m[1]));
    const categorias = new Set([...txt(cel(l, 'categoria')).matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((m) => m[1]));
    regras.set(code, {
      sexo: cel(l, 'sexo'),
      cbo: cboTexto,
      cbos_codigos: extractCboCodes(cboTexto),
      cbo_categorias: categorias,
      cid: txt(cel(l, 'cid')),
      cid_secundario: txt(cel(l, 'cidSec')),
      qtd_maxima: numeroOuNulo(cel(l, 'qtd')),
      servico_classificacao: servTexto,
      servicos_classificacoes_codigos: extractServiceClassificationPairs(servTexto),
      habilitacoes_codigos: habs,
      idade_min: sigtapAgeMonths(txt(cel(l, 'idadeMin'))),
      idade_max: sigtapAgeMonths(txt(cel(l, 'idadeMax')), true),
      media_permanencia: numeroOuNulo(cel(l, 'media')),
      atributos,
      admite_permanencia_maior: atributos.has(ATRIBUTO_PERMANENCIA_MAIOR),
    });
  }
  if (!regras.size) throw new Error(`Planilha SIGTAP "${nomeArquivo}" não possui procedimentos.`);
  return { regras, descricoes, competencia: competenciaNoNome(nomeArquivo) };
}

// ---------------------------------------------------------------------------
// Serializacao (Sets/Maps) para guardar as bases em JSON
// ---------------------------------------------------------------------------
export function serializar(base) {
  const conv = (v) => (v instanceof Set ? { $set: [...v] } : v instanceof Map ? { $map: [...v].map(([k, x]) => [k, conv(x)]) } : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v);
  return conv(base);
}
export function desserializar(obj) {
  const conv = (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$set' in v) return new Set(v.$set);
      if ('$map' in v) return new Map(v.$map.map(([k, x]) => [k, conv(x)]));
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
    }
    return v;
  };
  return conv(obj);
}
export const baseAmbParaJson = serializar;
export const baseAmbDeJson = desserializar;

const compBr = (c) => (c && c.length === 6 ? `${c.slice(4)}/${c.slice(0, 4)}` : '?');

/**
 * Regra da versao online (Hospitalar e Ambulatorial): usa a base da MESMA
 * competencia da producao; sem ela, a da competencia ANTERIOR mais proxima;
 * se so houver bases posteriores, a mais antiga delas (com aviso). Em empate
 * de competencia, a pasta TXT do DATASUS tem prioridade sobre a planilha.
 * candidatos: [{competencia: 'AAAAMM', tipo: 'txt'|'xlsx', ...}]
 */
export function escolherSigtapPorCompetencia(candidatos, competenciaProducao = '') {
  if (!candidatos.length) return null;
  const txtPrimeiro = (a, b) => (a.tipo !== 'txt') - (b.tipo !== 'txt');
  const validos = candidatos.filter((c) => /^\d{6}$/.test(c.competencia || ''));
  if (!/^\d{6}$/.test(competenciaProducao || '') || !validos.length) {
    const mais = [...(validos.length ? validos : candidatos)].sort((a, b) => (b.competencia || '').localeCompare(a.competencia || '') || txtPrimeiro(a, b))[0];
    return { ...mais, motivo: 'competência da produção não identificada; usada a base mais recente' };
  }
  const iguais = validos.filter((c) => c.competencia === competenciaProducao).sort(txtPrimeiro);
  if (iguais.length) return { ...iguais[0], motivo: 'mesma competência da produção' };
  const anteriores = validos.filter((c) => c.competencia < competenciaProducao).sort((a, b) => b.competencia.localeCompare(a.competencia) || txtPrimeiro(a, b));
  if (anteriores.length) return { ...anteriores[0], motivo: `competência anterior mais próxima (${compBr(anteriores[0].competencia)})` };
  const posteriores = validos.sort((a, b) => a.competencia.localeCompare(b.competencia) || txtPrimeiro(a, b));
  return { ...posteriores[0], motivo: `não há base da competência ${compBr(competenciaProducao)} nem anterior; usada a mais antiga disponível (${compBr(posteriores[0].competencia)})` };
}

/**
 * escolher_sigtap (Ambulatorial 1.0, mantido para referencia): candidatos [{competencia, tipo}].
 * Mesma competencia da producao (TXT tem prioridade no empate); senao a mais recente.
 */
export function escolherSigtap(candidatos, competenciaProducao = '', preferirMesma = true) {
  if (!candidatos.length) return null;
  if (preferirMesma && competenciaProducao) {
    const mesmos = candidatos.filter((c) => c.competencia === competenciaProducao);
    if (mesmos.length) {
      mesmos.sort((a, b) => (a.tipo !== 'txt') - (b.tipo !== 'txt'));
      return { ...mesmos[0], motivo: `mesma competência da produção${candidatos.length > 1 ? ` (${candidatos.length} bases encontradas)` : ''}` };
    }
  }
  const ord = [...candidatos].sort((a, b) => {
    const ka = [a.competencia || '', a.tipo === 'txt'];
    const kb = [b.competencia || '', b.tipo === 'txt'];
    if (ka[0] !== kb[0]) return ka[0] < kb[0] ? 1 : -1;
    return Number(kb[1]) - Number(ka[1]);
  });
  return { ...ord[0], motivo: candidatos.length > 1 ? 'competência mais recente' : 'única base encontrada' };
}

export { normText };
