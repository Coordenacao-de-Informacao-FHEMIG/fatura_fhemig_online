// Montagem do painel gerencial a partir dos resumos vigentes (mesmo codigo na API e no prototipo).

/** Competencias AAAAMM: as `n` ultimas terminando em `ate`, em ordem crescente. */
export function janelaCompetencias(ate, n = 6) {
  let ano = +ate.slice(0, 4);
  let mes = +ate.slice(4);
  const lista = [];
  for (let i = 0; i < n; i++) {
    lista.unshift(`${ano}${String(mes).padStart(2, '0')}`);
    mes -= 1;
    if (!mes) {
      mes = 12;
      ano -= 1;
    }
  }
  return lista;
}

const vazio = (competencia) => ({
  competencia, aihs: 0, comAlerta: 0, diariasMaior: 0, linhasBpa: 0, bpaComAlerta: 0,
  alertas: {}, procs: [], checa: null, envios: { hospitalar: null, ambulatorial: null, checa: null },
});

/**
 * processamentos: [{ ferramenta, sigla, competencia, criado_em, indicadores: {chave: valor},
 *   alertas: [{tipo, ocorrencias, contas}], procedimentos: [{codigo, descricao, quantidade}] }] (so vigentes)
 * Devolve { competencias, unidades, dados: { SIGLA: [mes...] } } com as unidades que tem algum envio.
 */
export function montarPainel({ competencias, unidades, processamentos }) {
  const dados = {};
  const nomes = new Map(unidades.map((u) => [u.sigla, u.nome]));
  for (const p of processamentos) {
    const i = competencias.indexOf(p.competencia);
    if (i < 0 || !nomes.has(p.sigla)) continue;
    if (!dados[p.sigla]) dados[p.sigla] = competencias.map(vazio);
    const m = dados[p.sigla][i];
    const ind = p.indicadores || {};
    m.envios[p.ferramenta] = p.criado_em || null;
    if (p.ferramenta === 'hospitalar') {
      m.aihs = ind.aihs_distintas || 0;
      m.comAlerta = ind.aihs_com_alerta || 0;
      m.diariasMaior = ind.diarias_de_perm_a_maior || 0;
      for (const a of p.alertas || []) m.alertas[a.tipo] = (m.alertas[a.tipo] || 0) + a.contas;
      const procs = new Map(m.procs.map((x) => [x[0], x]));
      for (const r of p.procedimentos || []) {
        const atual = procs.get(r.codigo) || [r.codigo, r.descricao || '', 0];
        atual[2] += r.quantidade;
        procs.set(r.codigo, atual);
      }
      m.procs = [...procs.values()].sort((a, b) => b[2] - a[2]);
    } else if (p.ferramenta === 'ambulatorial') {
      m.linhasBpa = ind.linhas_de_atendimento || 0;
      m.bpaComAlerta = ind.linhas_com_alerta || 0;
      for (const a of p.alertas || []) {
        const tipo = `${a.tipo} (BPA)`;
        m.alertas[tipo] = (m.alertas[tipo] || 0) + a.contas;
      }
    } else if (p.ferramenta === 'checa') {
      m.checa = {
        naoCnes: ind.nao_encontrados_no_cnes || 0,
        naoTasy: ind.nao_encontrados_no_tasy || 0,
        cboDiv: ind.pessoas_com_cbos_diferentes || 0,
      };
    }
  }
  return {
    competencias,
    unidades: unidades.map((u) => ({ sigla: u.sigla, nome: u.nome })),
    dados,
  };
}
