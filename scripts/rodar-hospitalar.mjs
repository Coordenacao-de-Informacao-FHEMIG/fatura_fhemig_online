// Roda o motor Hospitalar sobre os arquivos de teste e imprime os alertas por AIH.
import { writeFileSync } from 'node:fs';
import { processarHospitalar } from '../src/engine/hospitalar/processar.js';
import { extrairEspelhoPdf } from '../src/engine/hospitalar/entrada.js';
import { sigtapHospitalar, bytes, planilha, pdfjsNode } from '../tests/apoio.mjs';

const H = 'teste Hospitalar';
const sig = sigtapHospitalar();
const bases = {
  servico: await planilha(H, 'Serviço e Classificação HJXXIII (TESTE).xlsx'),
  habilitacao: await planilha(H, 'Habilitações HJXXIII (TESTE).xlsx'),
  profissionais: await planilha(H, 'Profissionais HJXXIII (TESTE).xlsx'),
};
const pdfjs = await pdfjsNode();
for (const [formato, nome] of [['txt', 'SISAIH01_HJXXIII_202609_TESTE.txt'], ['pdf', 'Espelho_AIH_HJXXIII_202609_TESTE.pdf']]) {
  const entrada = formato === 'txt' ? { formato, nome, bytes: bytes(H, nome) } : { formato, nome, espelho: await extrairEspelhoPdf(pdfjs, bytes(H, nome)) };
  const r = await processarHospitalar({ entrada, obterSigtap: async () => sig, bases, unidade: 'HJXXIII', notify: () => {} });
  console.log('=====', nome, '| avisos:', r.avisos.length);
  const por = new Map();
  for (const row of r.rows) {
    if (!por.has(row.AIH)) por.set(row.AIH, []);
    let s = `L${row['Linha do procedimento']} ${row['Codigo do procedimento']}: ${row.ALERTAS || '-'}`;
    if (row['LINHA BASE DO CALCULO DA AIH?'] === 'SIM' && row['DIARIAS DE PERMANENCIA A MAIOR']) s += ` [perm+ ${row['DIARIAS DE PERMANENCIA A MAIOR']}]`;
    if (row['REINTERNOU (REAPARECE NA LISTAGEM DO PDF)?'] === 'SIM') s += ` [reint SIM/${row['REINTERNOU COM MENOS DE 72H (SEGUNDA ENTRADA MENOS PRIMEIRA SAIDA)?']}]`;
    por.get(row.AIH).push(s);
  }
  let i = 0;
  for (const [aih, ls] of por) {
    i += 1;
    console.log(`H${String(i).padStart(2, '0')} ${aih}`);
    for (const l of ls) console.log(`      ${l}`);
  }
  console.log('KPIs:', r.resumo.kpis.map((k) => `${k.rotulo}=${k.valor}`).join('; '));
  if (process.argv[2]) writeFileSync(`${process.argv[2]}/${r.arquivos.xlsx.nome}`, r.arquivos.xlsx.bytes);
}
