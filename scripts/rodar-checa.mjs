// Roda o motor do ChecaProfissionais sobre os arquivos de teste.
import { writeFileSync } from 'node:fs';
import { processarChecaProfissionais } from '../src/engine/checa/processar.js';
import { bytes } from '../tests/apoio.mjs';

const C = 'teste ChecaProfissionais';
const arq = (nome, origem) => ({ nome, bytes: bytes(C, nome), origem });
const comum = { tasy: arq('Tasy Profissionais HIJPII (TESTE).xlsx'), adc: arq('Profissionais ADC (TESTE).xlsx', 'LOCAL'), cbo: arq('CBO_assistencial (TESTE).xlsx', 'LOCAL'), unidade: 'HIJPII' };
const r = await processarChecaProfissionais({ ...comum, cnes: arq('CNES Profissionais HIJPII (TESTE).xlsx') });
for (const a of r.resumo.alertas) console.log(String(a.quantidade).padStart(4), a.rotulo, `[${a.severidade}]`);
console.log('trilhas', JSON.stringify(r.resumo.trilhas));
if (process.argv[2]) writeFileSync(`${process.argv[2]}/${r.arquivos.xlsx.nome}`, r.arquivos.xlsx.bytes);
try {
  await processarChecaProfissionais({ ...comum, cnes: arq('CNES Profissionais HAC - UNIDADE ERRADA (TESTE).xlsx') });
} catch (e) {
  console.log('Unidade errada ->', e.codigo, e.message);
}
