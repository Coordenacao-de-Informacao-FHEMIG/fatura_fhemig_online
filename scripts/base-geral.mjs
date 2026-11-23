// Base geral das unidades (todas as unidades numa planilha só), enviada pelo faturamento.
//
// Fonte: dados/vm/geral/<arquivo>.xlsx com as abas (reconhecidas pelo cabeçalho, não pelo nome):
//   - Serviço/Classificação: UNIDADE, Código ("149 - 015"), Serviço, Classificação, Terceiro, CNES
//   - Habilitações: UNIDADE, Código, Descrição, Origem, Competência Inicial, Competência Final, Portaria
//   - Profissionais (relatório do CNES): UNIDADE, Nome, CNS, CBO, Descrição, Vinculação, CH Outro, CH Amb., CH Hosp.
//   - CBOs assistenciais: CBO, Descrição (sem UNIDADE)
// Também aceita .csv só com os profissionais.
//
// Saída (scripts/preparar-vm.mjs grava): bases/geral/base-geral.json, já limpo, que o site filtra pela
// unidade selecionada (src/engine/comum/base-geral.js), e bases/geral/CBO_assistencial.xlsx para o Checa.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Cabeçalhos da saída: casam com os leitores do Hospitalar (regras.js) e do Ambulatorial (mapeamento_colunas.json). */
export const COLUNAS = {
  profissionais: ['UNIDADE', 'NOME', 'CNS', 'CBO', 'DESCRICAO CBO', 'VINCULO', 'CH OUTROS', 'CH AMBULATORIAL', 'CH HOSPITALAR'],
  servico: ['UNIDADE', 'CODIGO', 'SERVICO', 'CLASSIFICACAO', 'TERCEIRO', 'CNES'],
  habilitacao: ['UNIDADE', 'HABILITACAO', 'DESCRICAO', 'ORIGEM', 'COMP INICIAL', 'COMP FINAL', 'PORTARIA'],
};
export const NOME_TABELA = { profissionais: 'Profissionais', servico: 'Serviço/Classificação', habilitacao: 'Habilitações' };

// Grafias da planilha que não são a sigla do catálogo (avisadas no build).
const APELIDOS = { HXXIII: 'HJXXIII', HJ23: 'HJXXIII' };

// Sinônimos do cabeçalho da fonte, já normalizados (sem acento, espaço nem pontuação).
const SINONIMOS = {
  UNIDADE: ['UNIDADE', 'SIGLA', 'SIGLAUNIDADE'],
  NOME: ['NOME', 'NOMEPROFISSIONAL', 'PROFISSIONAL'],
  CNS: ['CNS', 'CNSPROFISSIONAL', 'CARTAOSUS'],
  CBO: ['CBO', 'CODIGOCBO', 'CODCBO'],
  DESCRICAO: ['DESCRICAO', 'DESCRICAOCBO', 'OCUPACAO', 'DESCRICAODOCBO'],
  VINCULO: ['VINCULACAO', 'VINCULO', 'TIPOVINCULO'],
  CH_OUTROS: ['CHOUTRO', 'CHOUTROS', 'OUTROS'],
  CH_AMB: ['CHAMB', 'CHAMBULATORIAL', 'AMB', 'AMBULATORIAL'],
  CH_HOSP: ['CHHOSP', 'CHHOSPITALAR', 'HOSP', 'HOSPITALAR'],
  CODIGO: ['CODIGO', 'COD', 'HABILITACAO', 'CODIGOHABILITACAO'],
  SERVICO: ['SERVICO', 'NOMESERVICO'],
  CLASSIFICACAO: ['CLASSIFICACAO', 'NOMECLASSIFICACAO'],
  TERCEIRO: ['TERCEIRO', 'TERCEIRIZADO'],
  CNES: ['CNES', 'CNESTERCEIRO', 'CNESEXECUTANTE'],
  ORIGEM: ['ORIGEM', 'TIPO'],
  INICIO: ['COMPETENCIAINICIAL', 'COMPINICIAL', 'VIGENCIAINICIO', 'INICIO'],
  FIM: ['COMPETENCIAFINAL', 'COMPFINAL', 'VIGENCIAFIM', 'FIM'],
  PORTARIA: ['PORTARIA'],
};

const chave = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const texto = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').replace(/\s+/g, ' ').trim());
/** Competência como MM/AAAA (a célula pode vir como texto "07/2000" ou como data). */
const competencia = (v) => (v instanceof Date ? `${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}` : texto(v));

/** CSV com aspas e quebras de linha dentro do campo (o relatório do CNES quebra cabeçalhos e vínculos). */
export function lerCsv(txt) {
  const primeira = txt.split(/\r?\n/, 1)[0];
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"') {
        if (txt[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/** UTF-8 quando válido; senão Windows-1252 (o Excel em português salva CSV assim). */
function decodificar(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Abas da fonte: [{ nome, linhas }]. */
async function abasDaFonte(caminho) {
  const bytes = readFileSync(caminho);
  if (/\.csv$/i.test(caminho)) return [{ nome: basename(caminho), linhas: lerCsv(decodificar(bytes)) }];
  const { lerPlanilha } = await import('../src/engine/comum/planilha.js');
  return (await lerPlanilha(new Uint8Array(bytes), basename(caminho))).abas;
}

/** Índices das colunas conhecidas numa linha. */
function indices(linha) {
  const chaves = linha.map(chave);
  const ind = {};
  for (const [col, sins] of Object.entries(SINONIMOS)) {
    const i = chaves.findIndex((k) => sins.includes(k));
    if (i >= 0) ind[col] = i;
  }
  return ind;
}

/** Tipo da tabela pelo cabeçalho (ou null se a linha não for cabeçalho de nenhuma). */
function tipoDoCabecalho(ind) {
  if ('UNIDADE' in ind && 'CNS' in ind && 'CBO' in ind) return 'profissionais';
  if ('UNIDADE' in ind && 'CODIGO' in ind && ('INICIO' in ind || 'FIM' in ind)) return 'habilitacao';
  if ('UNIDADE' in ind && 'CODIGO' in ind && ('TERCEIRO' in ind || 'SERVICO' in ind || 'CLASSIFICACAO' in ind)) return 'servico';
  if (!('UNIDADE' in ind) && 'CBO' in ind && 'DESCRICAO' in ind && !('CNS' in ind)) return 'cbo';
  return null;
}

/**
 * Lê e limpa a base geral. siglas: siglas válidas do catálogo de unidades.
 * Devolve { tabelas: {profissionais?, servico?, habilitacao?: {colunas, linhas}}, cbosAssistenciais: [[cbo, descricao]] | null,
 *           porUnidade: {tabela: {SIGLA: n}}, temCarga, avisos }.
 */
export async function lerBaseGeral(caminho, siglas) {
  const nome = basename(caminho);
  const avisos = [];
  const porSigla = new Map(siglas.map((s) => [s.toUpperCase(), s]));
  const apelidosUsados = new Map();
  const desconhecidas = new Map();
  const resolverSigla = (v) => {
    const bruta = texto(v).toUpperCase();
    if (porSigla.has(bruta)) return porSigla.get(bruta);
    if (APELIDOS[bruta] && porSigla.has(APELIDOS[bruta])) {
      apelidosUsados.set(bruta, APELIDOS[bruta]);
      return APELIDOS[bruta];
    }
    desconhecidas.set(bruta || '(vazia)', (desconhecidas.get(bruta || '(vazia)') || 0) + 1);
    return null;
  };

  const tabelas = {};
  const porUnidade = {};
  let cbosAssistenciais = null;
  let temCarga = false;
  for (const aba of await abasDaFonte(caminho)) {
    let achou = null;
    for (let i = 0; i < Math.min(20, aba.linhas.length) && !achou; i++) {
      const ind = indices(aba.linhas[i]);
      const tipo = tipoDoCabecalho(ind);
      if (tipo) achou = { tipo, ind, corpo: aba.linhas.slice(i + 1) };
    }
    if (!achou) {
      avisos.push(`${nome}, aba "${aba.nome}": cabeçalho não reconhecido; aba ignorada.`);
      continue;
    }
    const { tipo, ind, corpo } = achou;
    if (tabelas[tipo] || (tipo === 'cbo' && cbosAssistenciais)) {
      avisos.push(`${nome}, aba "${aba.nome}": segunda aba de ${tipo === 'cbo' ? 'CBOs assistenciais' : NOME_TABELA[tipo]}; ignorada.`);
      continue;
    }
    const v = (l, col) => (ind[col] === undefined ? null : l[ind[col]] ?? null);
    const descartadas = { n: 0 };

    if (tipo === 'cbo') {
      const vistos = new Map();
      for (const l of corpo) {
        const cbo = chave(v(l, 'CBO'));
        if (cbo.length === 6 && !vistos.has(cbo)) vistos.set(cbo, texto(v(l, 'DESCRICAO')));
      }
      cbosAssistenciais = [...vistos].sort();
      continue;
    }

    const linhas = [];
    const contagem = {};
    for (const l of corpo) {
      if (l.every((x) => x === null || String(x).trim() === '')) continue;
      let linha = null;
      if (tipo === 'profissionais') {
        const cns = String(v(l, 'CNS') ?? '').replace(/\D/g, '');
        let cbo = chave(v(l, 'CBO'));
        if (/^\d{1,5}$/.test(cbo)) cbo = cbo.padStart(6, '0');
        // Linhas de continuação do relatório (só um pedaço do texto do vínculo) caem aqui.
        if (cns.length === 15 && cbo.length === 6) {
          const horas = (col) => {
            const n = Number.parseFloat(String(v(l, col) ?? '').replace(',', '.'));
            return Number.isFinite(n) ? n : 0;
          };
          linha = [texto(v(l, 'NOME')), cns, cbo, texto(v(l, 'DESCRICAO')), texto(v(l, 'VINCULO')), horas('CH_OUTROS'), horas('CH_AMB'), horas('CH_HOSP')];
        }
      } else if (tipo === 'servico') {
        const codigo = texto(v(l, 'CODIGO'));
        const partes = codigo.match(/\d{1,3}/g) || [];
        if (partes.length >= 2) {
          linha = [`${partes[0].padStart(3, '0')} - ${partes[1].padStart(3, '0')}`, texto(v(l, 'SERVICO')), texto(v(l, 'CLASSIFICACAO')),
            texto(v(l, 'TERCEIRO')), texto(v(l, 'CNES'))];
        }
      } else if (tipo === 'habilitacao') {
        const digitos = String(v(l, 'CODIGO') ?? '').match(/\d{1,4}/);
        if (digitos) {
          const codigo = digitos[0].padStart(4, '0');
          const desc = texto(v(l, 'DESCRICAO'));
          linha = [desc ? `${codigo} - ${desc}` : codigo, desc, texto(v(l, 'ORIGEM')), competencia(v(l, 'INICIO')), competencia(v(l, 'FIM')), texto(v(l, 'PORTARIA'))];
        }
      }
      if (!linha) {
        descartadas.n += 1;
        continue;
      }
      const sigla = resolverSigla(v(l, 'UNIDADE'));
      if (!sigla) continue;
      contagem[sigla] = (contagem[sigla] || 0) + 1;
      linhas.push([sigla, ...linha]);
    }
    if (!linhas.length) {
      avisos.push(`${nome}, aba "${aba.nome}" (${NOME_TABELA[tipo]}): nenhuma linha válida; aba ignorada.`);
      continue;
    }
    if (descartadas.n) avisos.push(`${nome}, aba "${aba.nome}" (${NOME_TABELA[tipo]}): ${descartadas.n} linha(s) sem código no formato esperado descartada(s).`);
    if (tipo === 'profissionais') temCarga = 'CH_AMB' in ind;
    tabelas[tipo] = { colunas: COLUNAS[tipo], linhas };
    porUnidade[tipo] = contagem;
  }

  for (const [de, para] of apelidosUsados) avisos.push(`${nome}: unidade "${de}" lida como ${para}.`);
  for (const [s, n] of desconhecidas) avisos.push(`${nome}: unidade "${s}" não está no catálogo; ${n} linha(s) ignorada(s).`);
  if (tabelas.profissionais && !temCarga) avisos.push(`${nome}: Profissionais sem a coluna CH Amb.; a Carga horária continua vindo das planilhas por unidade.`);
  if (!Object.keys(tabelas).length && !cbosAssistenciais) throw new Error(`${nome}: nenhuma aba reconhecida (Serviço/Classificação, Habilitações, Profissionais ou CBOs assistenciais).`);
  return { tabelas, cbosAssistenciais, porUnidade, temCarga, avisos };
}
