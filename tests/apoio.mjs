// Apoio aos testes em Node: carrega as bases embutidas e os arquivos de teste.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, strFromU8 } from 'fflate';
import { fonteCompacta, montarSigtapHospitalar, montarSigtapAmbulatorial, baseAmbDeJson } from '../src/engine/sigtap/sigtap.js';
import { lerPlanilha } from '../src/engine/comum/planilha.js';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TESTE = existsSync(resolve(RAIZ, 'arquivos de teste')) ? resolve(RAIZ, 'arquivos de teste') : resolve(RAIZ, '..', 'arquivos de teste');

const lerDat = (nome) => JSON.parse(strFromU8(gunzipSync(new Uint8Array(readFileSync(join(RAIZ, 'public', 'sigtap', nome))))));

export function sigtapHospitalar() {
  const json = lerDat('sigtap_202609.dat');
  const base = montarSigtapHospitalar(fonteCompacta(json));
  return { ...base, rotulo: json.origem };
}

export function sigtapAmbTxt() {
  const json = lerDat('sigtap_202609.dat');
  const base = montarSigtapAmbulatorial(fonteCompacta(json));
  base.competencia = json.competencia;
  return base;
}

export function sigtapAmbPlanilha() {
  return baseAmbDeJson(lerDat("sigtap_202610_planilha.dat").amb);
}

export function bytes(...partes) {
  return new Uint8Array(readFileSync(join(TESTE, ...partes)));
}

export async function planilha(...partes) {
  return { nome: partes[partes.length - 1], bytes: bytes(...partes), planilha: await lerPlanilha(bytes(...partes), partes[partes.length - 1]) };
}

export async function pdfjsNode() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}
