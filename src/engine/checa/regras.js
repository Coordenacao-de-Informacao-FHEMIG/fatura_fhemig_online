// ChecaProfissionais 2.0 — regras de negocio (core/regras.py).
// identificar a unidade -> registros especiais -> retirar a ADC -> consolidar
// pessoas -> qualidade e elegibilidade -> cruzar Tasy x CNES -> comparar CNS e
// conjuntos de CBO -> matriz e indicadores. Toda linha recebe uma trilha.
import { cmpStr, cmpTupla, escapeRe, formatMap, maisComuns, sortedStr } from '../comum/texto.js';
import { VALIDO, DV_INVALIDO, INVALIDO, AUSENTE, SENTINELA, texto, normalizarNome, chaveColuna, ErroUnidade } from './leitura.js';

const CPF_USAVEL = new Set([VALIDO, DV_INVALIDO]);
export const EXCLUIDO_ADC = 'EXCLUIDO_ADC';
export const ESPECIAL = 'ESPECIAL';
export const SEM_IDENTIFICADOR = 'SEM_IDENTIFICADOR';
export const ANALISADO = 'ANALISADO';
export const TRILHAS = [EXCLUIDO_ADC, ESPECIAL, SEM_IDENTIFICADOR, ANALISADO];
export const ELEGIVEL = 'ELEGIVEL';
export const REVISAO = 'REVISAO';

const juntar = (valores) => sortedStr(valores).join(', ');
const inter = (a, b) => new Set([...a].filter((x) => b.has(x)));
const menos = (a, b) => new Set([...a].filter((x) => !b.has(x)));
const uniao = (a, b) => new Set([...a, ...b]);

export class Catalogo {
  constructor(config, unidade = '') {
    this.alertas = config.alertas;
    this.ordem = config.ordem_severidade;
    this.principais = config.principais || [];
    this.unidade = unidade;
  }

  rank(sev) {
    const i = this.ordem.indexOf(sev);
    return i >= 0 ? i : this.ordem.length;
  }

  novo(codigo, { fonte, nome = '', cpf = '', cns = '', cbo = '', valor_tasy = '', valor_cnes = '', linhas_tasy = '', linhas_cnes = '', ...extra }) {
    const d = this.alertas[codigo];
    const campos = { nome: nome || '(sem nome)', unidade: this.unidade, cbo, cns, valor_tasy, valor_cnes, ...extra };
    return {
      codigo, id: d.id, nome_negocio: d.nome, categoria: d.categoria, severidade: d.severidade, mensagem: formatMap(d.mensagem, campos),
      acao: d.acao, unidade: this.unidade, fonte, nome, cpf, cns, cbo, valor_tasy, valor_cnes, linhas_tasy, linhas_cnes,
    };
  }
}

export const refLinhas = (linhas) => [...new Set(linhas.map((l) => l.linha))].sort((a, b) => a - b).join(', ');

function novaPessoa(fonte, chave, linhas) {
  return {
    fonte, chave, linhas, cpf: '', cpf_sit: '', nome: '', nomes_norm: new Set(), cns_validos: new Set(), cns_invalidos: new Set(),
    cbos: new Set(), cbos_invalidos: new Set(), rgs: new Set(), cds_pessoa: new Set(), assistenciais: new Set(),
    elegibilidade: ELEGIVEL, motivo_elegibilidade: '', par: null, duplicata_de: null, chave_match: '', status_cns: '',
    status_cbo: '', status_final: '', alertas: [],
  };
}
const atributo = (p, campo) => sortedStr(new Set(p.linhas.map((ln) => ln.valor(campo)).filter(Boolean)));

const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'D']);
const nomeComparavel = (n) => n.replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((p) => p && !PARTICULAS.has(p)).join(' ');
function nomesDiferentes(...conjuntos) {
  const chaves = conjuntos.map((c) => new Set([...c].map(nomeComparavel)));
  if (chaves.length === 1) return chaves[0].size > 1;
  return inter(chaves[0], chaves[1]).size === 0;
}

function consolidar(linhas, fonte) {
  const grupos = new Map();
  const add = (k, ln) => {
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(ln);
  };
  const cnsParaCpf = new Map();
  for (const ln of linhas) {
    if (CPF_USAVEL.has(ln.cpf_sit)) {
      add(`CPF:${ln.cpf}`, ln);
      if (ln.cns_sit === VALIDO) {
        if (!cnsParaCpf.has(ln.cns)) cnsParaCpf.set(ln.cns, new Set());
        cnsParaCpf.get(ln.cns).add(ln.cpf);
      }
    }
  }
  for (const ln of linhas) {
    if (CPF_USAVEL.has(ln.cpf_sit)) continue;
    const cpfs = cnsParaCpf.get(ln.cns) || new Set();
    if (cpfs.size === 1) add(`CPF:${[...cpfs][0]}`, ln);
    else add(`CNS:${ln.cns}`, ln);
  }
  const pessoas = new Map();
  for (const chave of sortedStr(grupos.keys())) {
    const lns = [...grupos.get(chave)].sort((a, b) => a.linha - b.linha);
    const p = novaPessoa(fonte, chave, lns);
    if (chave.startsWith('CPF:')) {
      p.cpf = chave.slice(4);
      p.cpf_sit = lns.find((ln) => ln.cpf === p.cpf).cpf_sit;
    }
    const nomes = new Map();
    for (const ln of lns) if (ln.nome) nomes.set(ln.nome, (nomes.get(ln.nome) || 0) + 1);
    p.nome = nomes.size ? maisComuns(nomes, 1)[0][0] : '';
    p.nomes_norm = new Set(lns.map((ln) => ln.nome_norm).filter(Boolean));
    for (const ln of lns) {
      ln.pessoa = chave;
      if (ln.cns_sit === VALIDO) p.cns_validos.add(ln.cns);
      else if (ln.cns_sit === INVALIDO) p.cns_invalidos.add(ln.cns || texto(ln.bruto.cns));
      if (ln.cbo_sit === VALIDO) p.cbos.add(ln.cbo);
      else if (ln.cbo_sit === INVALIDO) p.cbos_invalidos.add(ln.cbo);
      if (ln.rg_sit === VALIDO) p.rgs.add(ln.rg);
      if (ln.valor('cd_pessoa')) p.cds_pessoa.add(ln.valor('cd_pessoa'));
    }
    pessoas.set(chave, p);
  }
  return pessoas;
}

const siglaChave = (v) => chaveColuna(v).replace(/ /g, '');

export function identificarUnidade(tasy, cnes, cfgUnidades, unidadeSelecionada) {
  const unidades = cfgUnidades.unidades;
  const adc = cfgUnidades.adc || {};
  const estab = new Map();
  for (const ln of tasy.linhas) {
    const k = JSON.stringify([ln.valor('cd_estabelecimento'), ln.valor('estabelecimento')]);
    estab.set(k, (estab.get(k) || 0) + 1);
  }
  const ordem = maisComuns(estab);
  const [codigo, sigla] = JSON.parse(ordem[0][0]);
  const descTasy = `código ${codigo || '?'}, ${sigla || 'sem sigla'}`;
  if (estab.size > 1) {
    const lista = ordem.map(([k, q]) => {
      const [c, s] = JSON.parse(k);
      return `código ${c}, ${s}: ${q} linhas`;
    }).join('; ');
    throw new ErroUnidade(`A planilha do Tasy tem mais de um estabelecimento (${lista}). Exporte o relatório de uma unidade por vez.`);
  }
  if (codigo === String(adc.codigo_tasy) || siglaChave(sigla) === siglaChave(adc.sigla || 'ADC')) {
    throw new ErroUnidade('A planilha selecionada como Tasy é a da ADC. Selecione o Tasy da unidade.');
  }
  const porCodigo = unidades.find((u) => u.codigo_tasy && String(u.codigo_tasy) === codigo) || null;
  const porSigla = unidades.find((u) => [u.sigla, ...(u.apelidos || [])].map(siglaChave).includes(siglaChave(sigla))) || null;
  if (porCodigo && porSigla && porCodigo !== porSigla) {
    throw new ErroUnidade(`No Tasy, o código ${codigo} é de ${porCodigo.sigla}, mas a sigla é ${sigla}. Confira a planilha ou config/unidades.json.`);
  }
  const uTasy = porCodigo || porSigla;
  if (!uTasy) throw new ErroUnidade(`Unidade do Tasy (${descTasy}) não cadastrada em config/unidades.json.`);
  const [cnesNum, cnesNome] = cnes.cnesTitulo();
  const descCnes = cnesNum ? `CNES ${cnesNum} - ${cnesNome}` : 'sem CNES no título';
  let uCnes = unidades.find((u) => cnesNum && u.cnes.padStart(7, '0') === cnesNum) || null;
  if (!uCnes && cnesNome) uCnes = unidades.find((u) => chaveColuna(u.nome) === chaveColuna(cnesNome)) || null;
  if (!uCnes) {
    throw new ErroUnidade(`Não foi possível identificar a unidade do CNES (${descCnes}). O título da planilha deve trazer "CNES : 0000000 - NOME" e o CNES deve estar em config/unidades.json.`);
  }
  if (uTasy.sigla !== uCnes.sigla) {
    throw new ErroUnidade(`Tasy de ${uTasy.sigla} (${descTasy}) e CNES de ${uCnes.sigla} (${descCnes}). Selecione as duas planilhas da mesma unidade.`);
  }
  if (unidadeSelecionada && uTasy.sigla !== unidadeSelecionada) {
    throw new ErroUnidade(`As planilhas Tasy e CNES são de ${uTasy.sigla}, mas a unidade selecionada no topo da tela é ${unidadeSelecionada}. Selecione a unidade correta.`);
  }
  return { sigla: uTasy.sigla, nome: uTasy.nome, cnes: uTasy.cnes.padStart(7, '0'), codigo_tasy: codigo, tasy: descTasy, titulo_cnes: descCnes };
}

function especial(ln, termos) {
  if (ln.cpf_sit === SENTINELA) return 'CPF sentinela';
  if (ln.cns_sit === SENTINELA && !CPF_USAVEL.has(ln.cpf_sit)) return 'CNS sentinela sem CPF';
  if (termos) {
    const m = ln.nome_norm.match(termos);
    if (m) return `nome contém ${m[1]}`;
  }
  return '';
}

function indexarAdc(adc) {
  const porCpf = new Map();
  const porRg = new Map();
  const porCns = new Map();
  for (const ln of adc.linhas) {
    if (CPF_USAVEL.has(ln.cpf_sit) && !porCpf.has(ln.cpf)) porCpf.set(ln.cpf, ln);
    if (ln.rg_sit === VALIDO && !porRg.has(ln.rg)) porRg.set(ln.rg, ln);
    if (ln.cns_sit === VALIDO && !porCns.has(ln.cns)) porCns.set(ln.cns, ln);
  }
  return [porCpf, porRg, porCns];
}

function retirarAdc(linhas, porCpf, porRg, porCns) {
  for (const ln of linhas) {
    if (ln.trilha) continue;
    let alvo = null;
    let chave = null;
    if (CPF_USAVEL.has(ln.cpf_sit)) [alvo, chave] = [porCpf.get(ln.cpf) || null, 'CPF'];
    else if (ln.rg_sit === VALIDO && porRg.has(ln.rg)) [alvo, chave] = [porRg.get(ln.rg), 'RG'];
    else if (ln.cns_sit === VALIDO) [alvo, chave] = [porCns.get(ln.cns) || null, 'CNS'];
    if (alvo) {
      ln.trilha = EXCLUIDO_ADC;
      ln.adc_chave = chave;
      ln.adc_linha = alvo.linha;
      ln.motivo_trilha = `${chave} encontrado na ADC (linha ${alvo.linha})`;
    }
  }
}

function descrever(p, cns = null) {
  let lns = p.linhas.filter((ln) => cns === null || ln.cns === cns);
  if (!lns.length) lns = p.linhas;
  const partes = [`CPF ${p.cpf || 'ausente'}`, `linha ${refLinhas(lns)}`];
  if (p.cds_pessoa.size) partes.push(`Cd pessoa ${juntar(p.cds_pessoa)}`);
  return `${p.nome} (${partes.join(', ')})`;
}

const refCampo = (fonte) => (fonte === 'TASY' ? 'linhas_tasy' : 'linhas_cnes');

function qualidadeFonte(linhas, pessoas, fonte, regras, cat, donoCns = null) {
  const alertas = [];
  for (const ln of linhas) {
    const base = { fonte, nome: ln.nome, cpf: ln.cpf, cns: ln.cns, cbo: ln.cbo, [refCampo(fonte)]: String(ln.linha) };
    if (ln.cpf_sit === DV_INVALIDO || ln.cpf_sit === INVALIDO) {
      alertas.push(cat.novo('CPF_INVALIDO', { ...base, valor_tasy: fonte === 'TASY' ? ln.valor('cpf') : '', valor_cnes: fonte === 'CNES' ? ln.valor('cpf') : '' }));
    } else if (ln.cpf_sit === AUSENTE) alertas.push(cat.novo('CPF_AUSENTE', base));
    if (ln.cns_sit === INVALIDO) {
      alertas.push(cat.novo('CNS_INVALIDO', { ...base, valor_tasy: fonte === 'TASY' ? ln.valor('cns') : '', valor_cnes: fonte === 'CNES' ? ln.valor('cns') : '' }));
    }
    if (ln.cbo_sit === INVALIDO) alertas.push(cat.novo('CBO_INVALIDO', base));
  }
  const vistos = new Map();
  for (const ln of linhas) {
    const k = JSON.stringify(Object.entries(ln.bruto).map(([a, v]) => [a, texto(v)]).sort((x, y) => cmpTupla(x, y)));
    if (!vistos.has(k)) vistos.set(k, []);
    vistos.get(k).push(ln);
  }
  for (const grupo of vistos.values()) {
    if (grupo.length > 1) {
      for (const ln of grupo.slice(1)) ln.duplicada = true;
      alertas.push(cat.novo('DUPLICIDADE_EXATA', { fonte, nome: grupo[0].nome, cpf: grupo[0].cpf, cns: grupo[0].cns, cbo: grupo[0].cbo, [refCampo(fonte)]: refLinhas(grupo) }));
    }
  }
  const camposAttr = ((regras.atributos_comparados || {})[fonte]) || [];
  const cnsCpfs = new Map();
  for (const p of pessoas.values()) {
    const ref = { [refCampo(fonte)]: refLinhas(p.linhas) };
    const base = { fonte, nome: p.nome, cpf: p.cpf, cns: juntar(p.cns_validos), ...ref };
    if (nomesDiferentes(p.nomes_norm)) {
      const nomes = sortedStr(p.nomes_norm).join(' / ');
      p.alertas.push(cat.novo('NOME_DIVERGENTE', { ...base, valor_tasy: fonte === 'TASY' ? nomes : '', valor_cnes: fonte === 'CNES' ? nomes : '' }));
    }
    if (p.cns_validos.size > 1) p.alertas.push(cat.novo('CNS_MULTIPLOS_MESMO_CPF', { ...base, valor_tasy: juntar(p.cns_validos) }));
    if (fonte === 'TASY' && p.cpf && p.cds_pessoa.size > 1) {
      p.alertas.push(cat.novo('CADASTRO_DUPLICADO_TASY', { ...base, valor_tasy: `Cd pessoa física ${juntar(p.cds_pessoa)} com o mesmo CPF` }));
    }
    if (p.rgs.size > 1) {
      const rgs = sortedStr(p.rgs).join(' / ');
      p.alertas.push(cat.novo('RG_DIVERGENTE', { ...base, valor_tasy: fonte === 'TASY' ? `${rgs} (mesmo CPF)` : '', valor_cnes: fonte === 'CNES' ? `${rgs} (mesmo CPF)` : '' }));
    }
    if (p.cpf) {
      for (const cns of p.cns_validos) {
        if (!cnsCpfs.has(cns)) cnsCpfs.set(cns, new Set());
        cnsCpfs.get(cns).add(p.chave);
      }
    }
    const porCbo = new Map();
    for (const ln of p.linhas) {
      if (ln.cbo_sit === VALIDO && !ln.duplicada) {
        if (!porCbo.has(ln.cbo)) porCbo.set(ln.cbo, []);
        porCbo.get(ln.cbo).push(ln);
      }
    }
    for (const cbo of sortedStr(porCbo.keys())) {
      const lns = porCbo.get(cbo);
      if (lns.length < 2 || !camposAttr.length) continue;
      const difs = [];
      for (const campo of camposAttr) {
        const vals = sortedStr(new Set(lns.map((ln) => ln.valor(campo) || '(vazio)')));
        if (vals.length > 1) difs.push(`${campo}: ${vals.join(' | ')}`);
      }
      if (difs.length) p.alertas.push(cat.novo('ATRIBUTOS_DIVERGENTES', { ...base, [refCampo(fonte)]: refLinhas(lns), cbo, valor_tasy: difs.join('; ') }));
    }
  }
  for (const cns of sortedStr(cnsCpfs.keys())) {
    const chaves = cnsCpfs.get(cns);
    if (chaves.size < 2) continue;
    const grupo = sortedStr(chaves).map((c) => pessoas.get(c));
    const nums = grupo.flatMap((p) => p.linhas.filter((ln) => ln.cns === cns).map((ln) => ln.linha)).sort((a, b) => a - b);
    const donos = grupo.filter((p) => ((donoCns && donoCns.get(cns)) || new Set()).has(p.cpf));
    let indicio = '';
    if (donos.length) indicio += ` O CNES informa este CNS para ${donos.map((p) => p.nome).join(', ')}.`;
    if (fonte === 'TASY' && nums[nums.length - 1] - nums[0] <= 2) indicio += ' As linhas são vizinhas no relatório do Tasy: provável erro na extração.';
    for (const p of grupo) {
      const outros = grupo.filter((o) => o !== p).map((o) => descrever(o, cns)).join('; ');
      p.alertas.push(cat.novo('CNS_CPFS_DISTINTOS', {
        fonte, nome: p.nome, cpf: p.cpf, cns, outros, indicio,
        valor_tasy: fonte === 'TASY' ? `também em: ${outros}` : '', valor_cnes: fonte === 'CNES' ? `também em: ${outros}` : '',
        [refCampo(fonte)]: refLinhas(p.linhas.filter((ln) => ln.cns === cns)),
      }));
    }
  }
  return alertas;
}

function parear(p, c, chave) {
  p.par = c;
  c.par = p;
  p.chave_match = chave;
  c.chave_match = chave;
}

function cruzar(pessoasT, pessoasC, cat) {
  const idxCpf = new Map();
  for (const p of pessoasC.values()) if (p.cpf) idxCpf.set(p.cpf, p);
  const idxRg = new Map();
  const idxCns = new Map();
  const push = (m, k, v) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  };
  for (const p of pessoasC.values()) {
    for (const rg of sortedStr(p.rgs)) push(idxRg, rg, p);
    for (const cns of sortedStr(p.cns_validos)) push(idxCns, cns, p);
  }
  for (const p of pessoasT.values()) {
    const c = p.cpf ? idxCpf.get(p.cpf) : null;
    if (c && c.par === null) parear(p, c, 'CPF');
  }
  for (const p of pessoasT.values()) {
    if (p.par !== null || !p.rgs.size) continue;
    const livres = new Set();
    for (const rg of sortedStr(p.rgs)) for (const c of idxRg.get(rg) || []) if (c.par === null) livres.add(c);
    if (livres.size !== 1) continue;
    const c = [...livres][0];
    parear(p, c, 'RG');
    if (p.cpf && c.cpf && p.cpf !== c.cpf) {
      p.alertas.push(cat.novo('CPF_DIVERGENTE', { fonte: 'TASY x CNES', nome: p.nome, cpf: p.cpf, valor_tasy: p.cpf, valor_cnes: c.cpf, rg: juntar(inter(p.rgs, c.rgs)), linhas_tasy: refLinhas(p.linhas), linhas_cnes: refLinhas(c.linhas) }));
    }
  }
  for (const p of pessoasT.values()) {
    if (p.par !== null) continue;
    const vistos = new Set();
    for (const cns of sortedStr(p.cns_validos)) for (const c of idxCns.get(cns) || []) vistos.add(c);
    const cands = [...vistos].sort((a, b) => cmpStr(a.chave, b.chave));
    if (!cands.length) continue;
    const livres = cands.filter((c) => c.par === null);
    if (p.cpf_sit !== VALIDO && !livres.length) {
      p.duplicata_de = cands[0].par;
      for (const c of cands) {
        p.alertas.push(cat.novo('CADASTRO_DUPLICADO_TASY', {
          fonte: 'TASY x CNES', nome: p.nome, cpf: c.cpf, cns: juntar(inter(p.cns_validos, c.cns_validos)),
          valor_tasy: `registro sem CPF válido cujo CNS o CNES informa para ${descrever(c)}, que já está no Tasy como ${descrever(c.par)}`,
          linhas_tasy: refLinhas(p.linhas), linhas_cnes: refLinhas(c.linhas),
        }));
      }
      continue;
    }
    if (p.cpf_sit === VALIDO || livres.length !== 1) {
      for (const c of cands) {
        const a = cat.novo('CNS_CPFS_DISTINTOS', {
          fonte: 'TASY x CNES', nome: p.nome, cpf: p.cpf, cns: juntar(inter(p.cns_validos, c.cns_validos)), outros: `no CNES: ${descrever(c)}`,
          indicio: p.cpf ? ' O CPF do Tasy não está no CNES da unidade.' : '', valor_tasy: `Tasy: ${descrever(p)}`, valor_cnes: `CNES: ${descrever(c)}`,
          linhas_tasy: refLinhas(p.linhas), linhas_cnes: refLinhas(c.linhas),
        });
        p.alertas.push(a);
        c.alertas.push(a);
      }
      continue;
    }
    parear(p, livres[0], 'CNS');
  }
}

function compararPar(t, c, cat) {
  const ref = { linhas_tasy: refLinhas(t.linhas), linhas_cnes: refLinhas(c.linhas) };
  const cpf = t.cpf || c.cpf;
  if (!t.cns_validos.size) t.status_cns = t.cns_invalidos.size ? 'CNS_INVALIDO' : 'CNS_AUSENTE_TASY';
  else if (!c.cns_validos.size) t.status_cns = 'CNS_AUSENTE_CNES';
  else if (inter(t.cns_validos, c.cns_validos).size) t.status_cns = 'CONSISTENTE';
  else {
    t.status_cns = 'CNS_DIVERGENTE';
    t.alertas.push(cat.novo('CNS_DIVERGENTE', { fonte: 'TASY x CNES', nome: t.nome, cpf, cns: juntar(t.cns_validos), valor_tasy: juntar(t.cns_validos), valor_cnes: juntar(c.cns_validos), ...ref }));
  }
  const soT = menos(t.cbos, c.cbos);
  const soC = menos(c.cbos, t.cbos);
  const comuns = inter(t.cbos, c.cbos);
  const base = { fonte: 'TASY x CNES', nome: t.nome, cpf, cns: juntar(uniao(t.cns_validos, c.cns_validos)), ...ref };
  if (!soT.size && !soC.size) t.status_cbo = 'CBO_CONSISTENTE';
  else {
    t.status_cbo = t.cbos.size ? 'CBO_DIVERGENTE' : 'CBO_AUSENTE_TASY';
    for (const cbo of sortedStr(soC)) t.alertas.push(cat.novo('CBO_NAO_CADASTRADO_TASY', { ...base, cbo, valor_tasy: juntar(t.cbos) || '(nenhum)', valor_cnes: juntar(c.cbos) }));
    for (const cbo of sortedStr(soT)) t.alertas.push(cat.novo('CBO_FALTANTE_CNES', { ...base, cbo, valor_tasy: juntar(t.cbos), valor_cnes: juntar(c.cbos) || '(nenhum)' }));
    if (t.cbos.size) {
      t.alertas.push(cat.novo('CBO_DIFERENTE_TASY_CNES', {
        ...base, cbos_tasy: juntar(soT) || '(nenhum)', cbos_cnes: juntar(soC) || '(nenhum)', valor_tasy: juntar(t.cbos), valor_cnes: juntar(c.cbos),
        cbo: `comuns: ${juntar(comuns) || '(nenhum)'}`,
      }));
    }
  }
  c.status_cns = t.status_cns;
  c.status_cbo = t.status_cbo;
  if (t.rgs.size && c.rgs.size && !inter(t.rgs, c.rgs).size) {
    t.alertas.push(cat.novo('RG_DIVERGENTE', { fonte: 'TASY x CNES', nome: t.nome, cpf, valor_tasy: `Tasy ${juntar(t.rgs)}`, valor_cnes: ` / CNES ${juntar(c.rgs)}`, ...ref }));
  }
  if (t.nomes_norm.size && c.nomes_norm.size && nomesDiferentes(t.nomes_norm, c.nomes_norm)) {
    t.alertas.push(cat.novo('NOME_DIVERGENTE', { fonte: 'TASY x CNES', nome: t.nome, cpf, valor_tasy: sortedStr(t.nomes_norm).join(' / '), valor_cnes: sortedStr(c.nomes_norm).join(' / '), ...ref }));
  }
}

export function cbosAssistenciais(fonte, regras) {
  if (!fonte) return new Map();
  const sim = new Set(((regras.cbo_assistencial || {}).valores_sim || ['SIM']).map(normalizarNome));
  const r = new Map();
  for (const ln of fonte.linhas) if (ln.cbo_sit === VALIDO && sim.has(normalizarNome(ln.valor('assistencial')))) r.set(ln.cbo, ln.valor('descricao_cbo'));
  return r;
}

function marcarAssistenciais(pessoasT, pessoasC, assist, cat) {
  const pares = [...[...pessoasT.values()].map((t) => [t, t.par]), ...[...pessoasC.values()].filter((c) => c.par === null).map((c) => [null, c])];
  for (const [t, c] of pares) {
    const cbosT = new Set([...(t ? t.cbos : [])].filter((x) => assist.has(x)));
    const cbosC = new Set([...(c ? c.cbos : [])].filter((x) => assist.has(x)));
    const achados = uniao(cbosT, cbosC);
    if (!achados.size) continue;
    const p = t || c;
    for (const x of [t, c]) if (x) x.assistenciais = achados;
    p.alertas.push(cat.novo('CBO_ASSISTENCIAL_ENCONTRADO', {
      fonte: t && c ? 'TASY x CNES' : p.fonte, nome: p.nome, cpf: p.cpf || (c ? c.cpf : ''),
      cns: juntar(uniao(t ? t.cns_validos : new Set(), c ? c.cns_validos : new Set())),
      cbo: sortedStr(achados).map((x) => (assist.get(x) ? `${x} - ${assist.get(x)}` : x)).join('; '),
      valor_tasy: juntar(cbosT), valor_cnes: juntar(cbosC), linhas_tasy: t ? refLinhas(t.linhas) : '', linhas_cnes: c ? refLinhas(c.linhas) : '',
    }));
  }
}

function status(alertas, cat) {
  const rel = alertas.filter((a) => a.severidade !== 'Informativa');
  if (!rel.length) return ['CONSISTENTE', ''];
  const pior = rel.reduce((m, a) => (cmpTupla([cat.rank(a.severidade), a.id], [cat.rank(m.severidade), m.id]) < 0 ? a : m));
  return [pior.codigo, pior.severidade];
}

function matriz(pessoasT, pessoasC, cat) {
  const linhas = [];
  const pares = [...[...pessoasT.values()].map((t) => [t, t.par]), ...[...pessoasC.values()].filter((c) => c.par === null).map((c) => [null, c])];
  const temRg = [...pessoasT.values(), ...pessoasC.values()].some((p) => p.rgs.size);
  for (const [t, c] of pares) {
    const mapa = new Map();
    for (const p of [t, c]) if (p) for (const a of p.alertas) mapa.set(a, a);
    const als = [...mapa.values()];
    let [st, sev] = status(als, cat);
    const cbosT = t ? t.cbos : new Set();
    const cbosC = c ? c.cbos : new Set();
    const presenca = t && c ? 'TASY E CNES' : t ? 'SOMENTE TASY' : 'SOMENTE CNES';
    if (t && !c && t.elegibilidade === REVISAO) {
      st = 'REVISAO_ELEGIBILIDADE';
      sev = sev || 'Baixa';
    }
    for (const p of [t, c]) if (p) p.status_final = st;
    const x = t || c;
    const linha = {
      Presença: presenca,
      'Chave de cruzamento': x.chave_match || (x.cpf ? 'CPF' : 'CNS'),
      CPF: x.cpf || (c ? c.cpf : ''),
      'Nome Tasy': t ? t.nome : '',
      'Nome CNES': c ? c.nome : '',
      'CNS Tasy': t ? juntar(t.cns_validos) : '',
      'CNS CNES': c ? juntar(c.cns_validos) : '',
      'RG Tasy': t ? juntar(t.rgs) : '',
      'RG CNES': c ? juntar(c.rgs) : '',
      'Situação CNS': x.status_cns || (t && c ? '' : '-'),
      'CBOs Tasy': juntar(cbosT),
      'CBOs CNES': juntar(cbosC),
      'CBOs comuns': juntar(inter(cbosT, cbosC)),
      'Somente Tasy': t && c ? juntar(menos(cbosT, cbosC)) : '',
      'Somente CNES': t && c ? juntar(menos(cbosC, cbosT)) : '',
      'Situação CBO': x.status_cbo || (t && c ? '' : '-'),
      'CBO assistencial?': x.assistenciais.size ? 'Sim' : 'Não',
      'CBOs assistenciais': juntar(x.assistenciais),
      'Qtd CBOs Tasy': cbosT.size,
      'Qtd CBOs CNES': cbosC.size,
      'Funcionário?': t ? atributo(t, 'funcionario').join(', ') : '',
      Vínculo: t ? atributo(t, 'vinculo').join(', ') : '',
      Elegibilidade: t ? t.elegibilidade : ELEGIVEL,
      'Motivo elegibilidade': t ? t.motivo_elegibilidade : '',
      'Status final': st,
      Severidade: sev,
      Alertas: sortedStr(new Set(als.filter((a) => a.severidade !== 'Informativa').map((a) => a.codigo))).join(', '),
      'Qtd alertas': als.filter((a) => a.severidade !== 'Informativa').length,
      'Linhas Tasy': t ? refLinhas(t.linhas) : '',
      'Linhas CNES': c ? refLinhas(c.linhas) : '',
    };
    if (!temRg) {
      delete linha['RG Tasy'];
      delete linha['RG CNES'];
    }
    linhas.push(linha);
  }
  const ordem = { 'TASY E CNES': 0, 'SOMENTE TASY': 1, 'SOMENTE CNES': 2 };
  linhas.sort((a, b) => cmpTupla([ordem[a.Presença], normalizarNome(a['Nome Tasy'] || a['Nome CNES']), a.CPF], [ordem[b.Presença], normalizarNome(b['Nome Tasy'] || b['Nome CNES']), b.CPF]));
  return linhas;
}

function indicadores(tasy, cnes, adc, pessoasT, pessoasC, alertas, mat) {
  const trilhas = (fonte) => Object.fromEntries(TRILHAS.map((t) => [t, fonte.linhas.filter((ln) => ln.trilha === t).length]));
  const tt = trilhas(tasy);
  const tc = trilhas(cnes);
  const contAlertas = new Map();
  for (const a of alertas) contAlertas.set(a.codigo, (contAlertas.get(a.codigo) || 0) + 1);
  const contSev = new Map();
  for (const a of alertas) contSev.set(a.severidade, (contSev.get(a.severidade) || 0) + 1);
  const pares = [...pessoasT.values()].filter((p) => p.par !== null);
  const soma = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  return {
    linhas_tasy: tasy.linhas.length, linhas_cnes: cnes.linhas.length, linhas_adc: adc.linhas.length, trilhas_tasy: tt, trilhas_cnes: tc,
    fechamento_tasy: soma(tt) === tasy.linhas.length, fechamento_cnes: soma(tc) === cnes.linhas.length,
    pessoas_tasy: pessoasT.size, pessoas_cnes: pessoasC.size,
    elegiveis_tasy: [...pessoasT.values()].filter((p) => p.elegibilidade === ELEGIVEL).length,
    revisao_tasy: [...pessoasT.values()].filter((p) => p.elegibilidade === REVISAO).length,
    pessoas_excluidas_adc_tasy: new Set(tasy.linhas.filter((ln) => ln.trilha === EXCLUIDO_ADC).map((ln) => ln.cpf || ln.rg || ln.cns)).size,
    pessoas_excluidas_adc_cnes: new Set(cnes.linhas.filter((ln) => ln.trilha === EXCLUIDO_ADC).map((ln) => ln.cpf || ln.rg || ln.cns)).size,
    pessoas_nas_duas: pares.length,
    cruzadas_por_cns: pares.filter((p) => p.chave_match === 'CNS').length,
    cruzadas_por_rg: pares.filter((p) => p.chave_match === 'RG').length,
    rg_disponivel: tasy.linhas.some((ln) => ln.rg) && cnes.linhas.some((ln) => ln.rg),
    pessoas_cbo_assistencial: contAlertas.get('CBO_ASSISTENCIAL_ENCONTRADO') || 0,
    cbo_consistente: pares.filter((p) => p.status_cbo === 'CBO_CONSISTENTE').length,
    cbo_divergente: pares.filter((p) => p.status_cbo !== 'CBO_CONSISTENTE').length,
    cns_consistente: pares.filter((p) => p.status_cns === 'CONSISTENTE').length,
    cns_divergente: pares.filter((p) => p.status_cns === 'CNS_DIVERGENTE').length,
    sem_alerta: mat.filter((r) => r['Status final'] === 'CONSISTENTE').length,
    revisao_sem_cnes: [...pessoasT.values()].filter((p) => p.par === null && p.elegibilidade === REVISAO).length,
    linhas_duplicadas: [...tasy.linhas, ...cnes.linhas].filter((ln) => ln.duplicada).length,
    alertas_por_codigo: contAlertas,
    alertas_por_severidade: contSev,
    pessoas_matriz: mat.length,
  };
}

/** executar(): cboAssist = fonte CBO_ASSIST (null desliga o alerta). */
export function executar(tasy, cnes, adc, regras, cfgAlertas, cfgUnidades, cboAssist = null, unidadeSelecionada = null) {
  const unidade = identificarUnidade(tasy, cnes, cfgUnidades, unidadeSelecionada);
  const cat = new Catalogo(cfgAlertas, unidade.sigla);
  let alertas = [];
  const termos = ((regras.registros_especiais || {}).termos_nome || []).map((t) => escapeRe(normalizarNome(t)));
  const rxTermos = termos.length ? new RegExp(`\\b(${termos.join('|')})\\b`) : null;
  for (const ln of [...tasy.linhas, ...cnes.linhas]) {
    const motivo = especial(ln, rxTermos);
    if (motivo) {
      ln.trilha = ESPECIAL;
      ln.motivo_trilha = motivo;
      alertas.push(cat.novo('REGISTRO_TESTE_TECNICO', {
        fonte: ln.fonte, nome: ln.nome, cpf: ln.cpf, cns: ln.cns, cbo: ln.cbo,
        valor_tasy: ln.fonte === 'TASY' ? motivo : '', valor_cnes: ln.fonte === 'CNES' ? motivo : '', [refCampo(ln.fonte)]: String(ln.linha),
      }));
    }
  }
  const idx = indexarAdc(adc);
  retirarAdc(tasy.linhas, ...idx);
  if ((regras.adc || {}).excluir_tambem_no_cnes !== false) retirarAdc(cnes.linhas, ...idx);
  const excluidas = new Map();
  for (const ln of [...tasy.linhas, ...cnes.linhas]) {
    if (ln.trilha !== EXCLUIDO_ADC) continue;
    const k = JSON.stringify([ln.fonte, ({ CPF: ln.cpf, RG: ln.rg })[ln.adc_chave] ?? ln.cns]);
    if (!excluidas.has(k)) excluidas.set(k, []);
    excluidas.get(k).push(ln);
  }
  for (const k of [...excluidas.keys()].sort((a, b) => cmpTupla(JSON.parse(a), JSON.parse(b)))) {
    const lns = excluidas.get(k);
    const ln = lns[0];
    const fonte = JSON.parse(k)[0];
    alertas.push(cat.novo('EXCLUIDO_ADC', { fonte, nome: ln.nome, cpf: ln.cpf, cns: ln.cns, valor_tasy: `chave ${ln.adc_chave}, linha ADC ${ln.adc_linha}`, [refCampo(fonte)]: refLinhas(lns) }));
  }
  for (const ln of [...tasy.linhas, ...cnes.linhas]) {
    if (ln.trilha) continue;
    if (CPF_USAVEL.has(ln.cpf_sit) || ln.cns_sit === VALIDO) ln.trilha = ANALISADO;
    else {
      ln.trilha = SEM_IDENTIFICADOR;
      ln.motivo_trilha = 'sem CPF e sem CNS válidos';
      alertas.push(cat.novo('REVISAO_ELEGIBILIDADE', { fonte: ln.fonte, nome: ln.nome, cbo: ln.cbo, valor_tasy: 'sem CPF e sem CNS válidos', [refCampo(ln.fonte)]: String(ln.linha) }));
    }
  }
  const linT = tasy.linhas.filter((ln) => ln.trilha === ANALISADO);
  const linC = cnes.linhas.filter((ln) => ln.trilha === ANALISADO);
  const pessoasT = consolidar(linT, 'TASY');
  const pessoasC = consolidar(linC, 'CNES');
  const donoCns = new Map();
  for (const ln of cnes.linhas) {
    if (ln.cns_sit === VALIDO && ln.cpf) {
      if (!donoCns.has(ln.cns)) donoCns.set(ln.cns, new Set());
      donoCns.get(ln.cns).add(ln.cpf);
    }
  }
  alertas = alertas.concat(qualidadeFonte(linT, pessoasT, 'TASY', regras, cat, donoCns), qualidadeFonte(linC, pessoasC, 'CNES', regras, cat));
  const exigirCbo = (regras.elegibilidade || {}).exigir_cbo !== false;
  for (const p of pessoasT.values()) {
    if (exigirCbo && !p.cbos.size) {
      p.elegibilidade = REVISAO;
      p.motivo_elegibilidade = 'sem CBO válido no Tasy';
      p.alertas.push(cat.novo('CBO_AUSENTE', { fonte: 'TASY', nome: p.nome, cpf: p.cpf, cns: juntar(p.cns_validos), linhas_tasy: refLinhas(p.linhas) }));
    } else if (p.cbos.size > 1) {
      p.alertas.push(cat.novo('MULTIPLOS_CBOS_VALIDOS', { fonte: 'TASY', nome: p.nome, cpf: p.cpf, cns: juntar(p.cns_validos), valor_tasy: String(p.cbos.size), cbo: juntar(p.cbos), linhas_tasy: refLinhas(p.linhas) }));
    }
  }
  cruzar(pessoasT, pessoasC, cat);
  for (const p of pessoasT.values()) {
    if (p.par !== null) compararPar(p, p.par, cat);
    else if (p.elegibilidade === ELEGIVEL && p.duplicata_de === null) {
      p.alertas.push(cat.novo('PROFISSIONAL_NAO_ENCONTRADO_CNES', { fonte: 'TASY', nome: p.nome, cpf: p.cpf, cns: juntar(p.cns_validos), valor_tasy: juntar(p.cbos), linhas_tasy: refLinhas(p.linhas) }));
    }
    if ((p.elegibilidade === ELEGIVEL || p.par !== null) && !p.cns_validos.size) {
      const info = p.par !== null && p.par.cns_validos.size ? ` (CNES informa ${juntar(p.par.cns_validos)})` : '';
      p.alertas.push(cat.novo('CNS_AUSENTE', { fonte: 'TASY', nome: p.nome, cpf: p.cpf, valor_cnes: info, linhas_tasy: refLinhas(p.linhas) }));
    }
  }
  for (const c of pessoasC.values()) {
    if (c.par === null) {
      c.alertas.push(cat.novo('PROFISSIONAL_NAO_ENCONTRADO_TASY', { fonte: 'CNES', nome: c.nome, cpf: c.cpf, cns: juntar(c.cns_validos), valor_cnes: juntar(c.cbos), linhas_cnes: refLinhas(c.linhas) }));
    }
  }
  const assist = cbosAssistenciais(cboAssist, regras);
  marcarAssistenciais(pessoasT, pessoasC, assist, cat);
  const vistos = new Set();
  for (const p of [...pessoasT.values(), ...pessoasC.values()]) {
    for (const a of p.alertas) {
      if (!vistos.has(a)) {
        vistos.add(a);
        alertas.push(a);
      }
    }
  }
  alertas.sort((a, b) => cmpTupla(
    [cat.rank(a.severidade), a.id, normalizarNome(a.nome), a.cpf, a.cbo, a.linhas_tasy, a.linhas_cnes],
    [cat.rank(b.severidade), b.id, normalizarNome(b.nome), b.cpf, b.cbo, b.linhas_tasy, b.linhas_cnes],
  ));
  const mat = matriz(pessoasT, pessoasC, cat);
  const ind = indicadores(tasy, cnes, adc, pessoasT, pessoasC, alertas, mat);
  ind.cbos_assistenciais_base = assist.size;
  return { unidade, tasy, cnes, adc, alertas, pessoas_tasy: pessoasT, pessoas_cnes: pessoasC, matriz: mat, indicadores: ind, catalogo: cat, cbo_assist: cboAssist, assistenciais: assist };
}

/** resumo_alertas: [(nome, codigo, severidade, quantidade)] para a tela. */
export function resumoAlertas(res) {
  const cat = res.catalogo;
  const cont = new Map();
  for (const a of res.alertas) cont.set(a.codigo, (cont.get(a.codigo) || 0) + 1);
  return [...cont.entries()]
    .map(([c, q]) => [cat.alertas[c].nome, c, cat.alertas[c].severidade, q])
    .sort((x, y) => cmpTupla([!cat.principais.includes(x[1]), cat.rank(x[2]), cat.alertas[x[1]].id], [!cat.principais.includes(y[1]), cat.rank(y[2]), cat.alertas[y[1]].id]));
}
