// Base geral de profissionais (bases/geral/profissionais.json, gerada por scripts/base-geral.mjs):
// uma tabela com todas as unidades. Para a análise, vira uma "planilha" só com as linhas da
// unidade, no mesmo formato de lerPlanilha (abas/linhas), e serve como Profissionais
// (Hospitalar e Ambulatorial) e Carga horária (Ambulatorial).

/**
 * base: { colunas: [...], linhas: [[UNIDADE, ...], ...] }; sigla: unidade selecionada.
 * Devolve { abas: [{ nome, linhas }], ativa: 0 } com o cabeçalho na primeira linha.
 */
export function planilhaDaBaseGeral(base, sigla) {
  const iUnidade = base.colunas.indexOf('UNIDADE');
  if (iUnidade < 0) throw new Error('Base geral de profissionais sem a coluna UNIDADE.');
  const linhas = base.linhas.filter((l) => l[iUnidade] === sigla);
  if (!linhas.length) throw new Error(`A base geral de profissionais não tem linhas de ${sigla}.`);
  return { abas: [{ nome: `Profissionais ${sigla}`, linhas: [base.colunas, ...linhas] }], ativa: 0 };
}
