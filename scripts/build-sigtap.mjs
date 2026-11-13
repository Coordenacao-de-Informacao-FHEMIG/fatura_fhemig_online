// Gera as bases SIGTAP embutidas no site (public/sigtap/).
//
//   node scripts/build-sigtap.mjs [pastaTXT] [planilha.xlsx ...]
//
// - Pasta TXT do DATASUS -> sigtap_AAAAMM.dat (gzip de JSON compacto, so com as
//   colunas usadas pelo Hospitalar e pelo Ambulatorial).
// - Planilha SIGTAP*.xlsx -> sigtap_AAAAMM_planilha.dat (bases ja montadas para
//   o Hospitalar e o Ambulatorial).
// - indice.json lista as bases disponiveis.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'fflate';
import {
  fonteDatasus, compactar, fonteCompacta, competenciaDaFonte, lerPlanilhaSigtap, competenciaNoNome, serializar,
  montarSigtapHospitalarPlanilha,
} from '../src/engine/sigtap/sigtap.js';
import { lerPlanilha } from '../src/engine/comum/planilha.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'public', 'sigtap');
const PADRAO_TXT = resolve(RAIZ, '..', 'Fatura Fhemig 14.3', 'Sigtap');
const PADRAO_XLSX = resolve(RAIZ, '..', 'Fatura Fhemig Ambulatorial', 'Fatura Fhemig Ambulatorial 1.0', 'SIGTAP102026.xlsx');
const MAPEAMENTO = JSON.parse(readFileSync(join(RAIZ, 'src', 'engine', 'ambulatorial', 'config', 'mapeamento_colunas.json'), 'utf8'));

const args = process.argv.slice(2);
const pastas = args.filter((a) => !a.toLowerCase().endsWith('.xlsx'));
const planilhas = args.filter((a) => a.toLowerCase().endsWith('.xlsx'));
if (!args.length) {
  pastas.push(PADRAO_TXT);
  planilhas.push(PADRAO_XLSX);
}

mkdirSync(DESTINO, { recursive: true });
const indicePath = join(DESTINO, 'indice.json');
const indice = existsSync(indicePath) ? JSON.parse(readFileSync(indicePath, 'utf8')) : { bases: [] };
const registrar = (item) => {
  indice.bases = indice.bases.filter((b) => b.arquivo !== item.arquivo);
  indice.bases.push(item);
  indice.bases.sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
};

for (const pasta of pastas) {
  const arquivos = new Map();
  for (const nome of readdirSync(pasta)) {
    if (nome.toLowerCase().endsWith('.txt')) arquivos.set(nome.toLowerCase(), new Uint8Array(readFileSync(join(pasta, nome))));
  }
  const compacta = compactar(fonteDatasus(arquivos));
  const competencia = competenciaDaFonte(fonteCompacta(compacta));
  compacta.competencia = competencia;
  compacta.origem = `Tabela SIGTAP DATASUS (TXT) ${competencia.slice(4)}/${competencia.slice(0, 4)}`;
  const nome = `sigtap_${competencia}.dat`;
  const dados = gzipSync(new TextEncoder().encode(JSON.stringify(compacta)), { level: 9 });
  writeFileSync(join(DESTINO, nome), dados);
  registrar({ arquivo: nome, tipo: 'txt', competencia, rotulo: compacta.origem, usos: ['hospitalar', 'ambulatorial'] });
  console.log(`${pasta} -> ${nome} (${(dados.length / 1024 / 1024).toFixed(2)} MB)`);
}

for (const arquivo of planilhas) {
  const planilha = await lerPlanilha(readFileSync(arquivo), basename(arquivo));
  const base = lerPlanilhaSigtap(planilha.abas, MAPEAMENTO.sigtap, basename(arquivo));
  base.competencia = competenciaNoNome(basename(arquivo));
  base.caminho = basename(arquivo);
  const hosp = montarSigtapHospitalarPlanilha(planilha, basename(arquivo));
  const rotulo = `Planilha ${basename(arquivo)}`;
  const nome = `sigtap_${base.competencia}_planilha.dat`;
  const json = { formato: 'sigtap-planilha-1', competencia: base.competencia, origem: rotulo, amb: serializar(base), hosp: serializar(hosp) };
  const dados = gzipSync(new TextEncoder().encode(JSON.stringify(json)), { level: 9 });
  writeFileSync(join(DESTINO, nome), dados);
  registrar({ arquivo: nome, tipo: 'xlsx', competencia: base.competencia, rotulo, usos: ['hospitalar', 'ambulatorial'] });
  console.log(`${arquivo} -> ${nome} (${(dados.length / 1024 / 1024).toFixed(2)} MB)`);
}
writeFileSync(indicePath, `${JSON.stringify(indice, null, 2)}\n`);
console.log('indice.json atualizado.');
