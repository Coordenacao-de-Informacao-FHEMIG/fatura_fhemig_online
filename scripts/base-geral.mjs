// Base geral de profissionais (todas as unidades numa planilha só), enviada pelo faturamento.
//
// Fonte: dados/vm/geral/<arquivo>.csv ou .xlsx, com uma linha por profissional/CBO e as colunas
// UNIDADE, Nome, CNS, CBO, Descrição, Vinculação, CH Outro, CH Amb., CH Hosp. (relatório do CNES).
// Saída: dados/vm/bases/geral/profissionais.json, já limpa, que o site filtra pela unidade
// selecionada e usa como planilha de Profissionais (Hospitalar e Ambulatorial) e de Carga horária
// (Ambulatorial). Ver src/engine/comum/base-geral.js.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Cabeçalho da saída. Os nomes casam com os sinônimos de config/mapeamento_colunas.json e com o Hospitalar. */
export const COLUNAS_SAIDA = ['UNIDADE', 'NOME', 'CNS', 'CBO', 'DESCRICAO CBO', 'VINCULO', 'CH OUTROS', 'CH AMBULATORIAL', 'CH HOSPITALAR'];

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
};
const OBRIGATORIAS = ['UNIDADE', 'CNS', 'CBO'];

const chave = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** CSV com aspas e quebras de linha dentro do campo (o relatório do CNES quebra cabeçalhos e vínculos). */
export function lerCsv(txt) {
  const sep = (txt.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (txt.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : ',';
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

/** UTF-8 quando válido; senão Latin-1 (o Excel em português salva CSV em Windows-1252). */
function decodificar(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Índices das colunas na linha de cabeçalho, ou null se faltar alguma obrigatória. */
function indicesDoCabecalho(linha) {
  const chaves = linha.map(chave);
  const ind = {};
  for (const [col, sins] of Object.entries(SINONIMOS)) {
    const i = chaves.findIndex((k) => sins.includes(k));
    if (i >= 0) ind[col] = i;
  }
  return OBRIGATORIAS.every((c) => c in ind) ? ind : null;
}

async function linhasDaFonte(caminho) {
  const bytes = readFileSync(caminho);
  if (/\.csv$/i.test(caminho)) return [lerCsv(decodificar(bytes))];
  const { lerPlanilha } = await import('../src/engine/comum/planilha.js');
  const planilha = await lerPlanilha(new Uint8Array(bytes), basename(caminho));
  return planilha.abas.map((a) => a.linhas);
}

/**
 * Lê e limpa a base geral. siglas: siglas válidas do catálogo de unidades.
 * Devolve { colunas, linhas, porUnidade, avisos } ou lança erro se não achar o cabeçalho.
 */
export async function lerBaseGeral(caminho, siglas) {
  const nome = basename(caminho);
  let tabela = null;
  for (const linhas of await linhasDaFonte(caminho)) {
    for (let i = 0; i < Math.min(20, linhas.length); i++) {
      const ind = indicesDoCabecalho(linhas[i]);
      if (ind) {
        tabela = { ind, corpo: linhas.slice(i + 1) };
        break;
      }
    }
    if (tabela) break;
  }
  if (!tabela) throw new Error(`${nome}: não achei o cabeçalho com as colunas UNIDADE, CNS e CBO nas 20 primeiras linhas.`);

  const { ind, corpo } = tabela;
  const valor = (l, col) => (ind[col] === undefined ? '' : l[ind[col]] ?? '');
  const horas = (l, col) => {
    const n = Number.parseFloat(String(valor(l, col)).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const porSigla = new Map(siglas.map((s) => [s.toUpperCase(), s]));
  const desconhecidas = new Map();
  const porUnidade = {};
  const linhas = [];
  let semCodigo = 0;
  for (const l of corpo) {
    const cns = String(valor(l, 'CNS')).replace(/\D/g, '');
    let cbo = chave(valor(l, 'CBO'));
    if (/^\d{1,5}$/.test(cbo)) cbo = cbo.padStart(6, '0');
    if (cns.length !== 15 || cbo.length !== 6) {
      // Linhas de continuação do relatório (só um pedaço do texto do vínculo) caem aqui.
      if (cns || cbo) semCodigo += 1;
      continue;
    }
    const bruta = texto(valor(l, 'UNIDADE')).toUpperCase();
    const sigla = porSigla.get(bruta);
    if (!sigla) {
      desconhecidas.set(bruta, (desconhecidas.get(bruta) || 0) + 1);
      continue;
    }
    porUnidade[sigla] = (porUnidade[sigla] || 0) + 1;
    linhas.push([sigla, texto(valor(l, 'NOME')), cns, cbo, texto(valor(l, 'DESCRICAO')), texto(valor(l, 'VINCULO')),
      horas(l, 'CH_OUTROS'), horas(l, 'CH_AMB'), horas(l, 'CH_HOSP')]);
  }
  const avisos = [];
  for (const [s, n] of desconhecidas) avisos.push(`${nome}: unidade "${s || '(vazia)'}" não está no catálogo; ${n} linha(s) ignorada(s).`);
  if (semCodigo) avisos.push(`${nome}: ${semCodigo} linha(s) com CNS ou CBO fora do formato (15 dígitos / 6 caracteres) ignorada(s).`);
  const temCarga = 'CH_AMB' in ind;
  if (!temCarga) avisos.push(`${nome}: sem coluna de carga horária ambulatorial (CH Amb.); a Carga horária continua vindo das planilhas por unidade.`);
  if (!linhas.length) throw new Error(`${nome}: nenhuma linha válida (UNIDADE do catálogo, CNS com 15 dígitos e CBO com 6 caracteres).`);
  return { colunas: COLUNAS_SAIDA, linhas, porUnidade, avisos, temCarga };
}
