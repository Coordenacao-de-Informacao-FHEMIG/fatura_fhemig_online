// Roda o motor Ambulatorial sobre os arquivos de teste e imprime os alertas por linha.
import { writeFileSync } from 'node:fs';
import { processarAmbulatorial } from '../src/engine/ambulatorial/processar.js';
import { sigtapAmbPlanilha, bytes, planilha } from '../tests/apoio.mjs';

const A = 'teste Ambulatorial';
const sig = sigtapAmbPlanilha();
const base = (nome) => planilha(A, nome).then((p) => ({ ...p, origem: 'seleção manual' }));
const bases = {
  profissionais: await base('Profissionais HRBJA (TESTE).xlsx'),
  carga_horaria: await base('Carga Horária HRBJA (TESTE).xlsx'),
  servico_classificacao: await base('Serviço Classificação HRBJA (TESTE).xlsx'),
  habilitacao: await base('Habilitações HRBJA (TESTE).xlsx'),
};
for (const nome of ['BPA_HRBJA_202610_TESTE.txt', 'BPA_HRBJA_202610_CABECALHO_INCONSISTENTE.txt']) {
  const r = await processarAmbulatorial({
    entrada: { nome, bytes: bytes(A, nome) }, bases, unidade: 'HRBJA',
    obterSigtap: async () => ({ base: sig, rotulo: 'Planilha SIGTAP102026.xlsx', tipo: 'xlsx', motivo: 'mesma competência da produção' }),
  });
  console.log('=====', nome);
  console.log('avisos:', r.avisos);
  for (const reg of r.registros) console.log(`  L${reg.linha_txt} ${reg.tipo} ${reg.procedimento ?? '-'}: ${(reg.alertas || []).map((a) => a[0]).join(' | ') || '-'}`);
  console.log('KPIs:', r.resumo.kpis.map((k) => `${k.rotulo}=${k.valor}`).join('; '));
  if (process.argv[2]) writeFileSync(`${process.argv[2]}/${nome}.xlsx`, r.arquivos.xlsx.bytes);
}
