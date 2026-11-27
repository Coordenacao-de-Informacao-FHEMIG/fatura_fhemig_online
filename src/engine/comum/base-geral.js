// Base geral das unidades (bases/geral/base-geral.json, gerada por scripts/base-geral.mjs):
// tabelas com todas as unidades (profissionais, servico, habilitacao). Para a análise, cada
// tabela vira uma "planilha" só com as linhas da unidade, no mesmo formato de lerPlanilha
// (abas/linhas, cabeçalho na primeira linha), e os motores leem como se fosse a planilha da unidade.

/**
 * base: { tabelas: { [tabela]: { colunas, linhas } } }; tabela: 'profissionais' | 'servico' | 'habilitacao'.
 * Devolve { abas: [{ nome, linhas }], ativa: 0 }.
 */
export function planilhaDaBaseGeral(base, sigla, tabela = 'profissionais') {
  const t = base.tabelas?.[tabela];
  if (!t) throw new Error(`A base geral não tem a tabela "${tabela}".`);
  const iUnidade = t.colunas.indexOf('UNIDADE');
  if (iUnidade < 0) throw new Error(`Tabela "${tabela}" da base geral sem a coluna UNIDADE.`);
  const linhas = t.linhas.filter((l) => l[iUnidade] === sigla);
  if (!linhas.length) throw new Error(`A base geral não tem linhas de ${sigla} na tabela "${tabela}".`);
  return { abas: [{ nome: `${tabela} ${sigla}`, linhas: [t.colunas, ...linhas] }], ativa: 0 };
}
