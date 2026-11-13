// Alarmes para o gestor: situações da competência que pedem ação, calculadas sobre os
// mesmos totais do painel (painel.js). Os limites ficam aqui para a gestão ajustar.

export const LIMITES_ALARME = {
  taxaAihCritica: 10, // % de AIHs com alerta
  altaTaxaPp: 2, // aumento da taxa em pontos percentuais
  quedaProducao: 20, // queda de AIHs em %
  altaDiarias: 30, // aumento de diárias de permanência a maior em %
  diariasMinimas: 10,
  taxaBpaAtencao: 8, // % de linhas BPA com alerta
  pendenciasAtencao: 25, // divergências Tasy x CNES
};

const pct = (a, b) => (b ? (100 * a) / b : 0);
const fmt = (v, casas = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const pendencias = (c) => (c ? c.naoCnes + c.naoTasy + c.cboDiv : 0);
const ORDEM = { critico: 0, atencao: 1 };

/**
 * painel: { competencias, dados: { SIGLA: [mes...] } }; siglas: unidades consideradas; i: índice da competência.
 * Devolve [{ nivel: 'critico'|'atencao', tipo, sigla, titulo, detalhe }], críticos primeiro.
 */
export function calcularAlarmes(painel, siglas, i, limites = LIMITES_ALARME) {
  const L = { ...LIMITES_ALARME, ...limites };
  const alarmes = [];
  const add = (nivel, tipo, sigla, titulo, detalhe) => alarmes.push({ nivel, tipo, sigla, titulo, detalhe });
  for (const sigla of siglas) {
    const meses = painel.dados[sigla];
    if (!meses) continue;
    const m = meses[i];
    const ant = i > 0 ? meses[i - 1] : null;

    // Envio: a unidade mandou no mês anterior e ainda não mandou neste.
    if (ant?.envios.hospitalar && !m.envios.hospitalar) add('critico', 'sem_envio', sigla, 'Hospitalar sem envio', 'A unidade enviou a análise do Hospitalar no mês anterior, mas ainda não enviou a desta competência.');
    if (ant?.envios.ambulatorial && !m.envios.ambulatorial) add('atencao', 'sem_envio', sigla, 'Ambulatorial sem envio', 'A análise do BPA desta competência ainda não foi enviada.');
    if (ant?.envios.checa && !m.envios.checa) add('atencao', 'sem_envio', sigla, 'Conferência de profissionais sem envio', 'O ChecaProfissionais desta competência ainda não foi enviado.');

    if (m.aihs) {
      const taxa = pct(m.comAlerta, m.aihs);
      if (taxa >= L.taxaAihCritica) add('critico', 'taxa_alta', sigla, `${fmt(taxa)}% das AIHs com alerta`, `Acima do limite de ${L.taxaAihCritica}%. ${m.comAlerta} AIHs precisam de revisão antes do envio ao SUS.`);
      if (ant?.aihs) {
        const taxaAnt = pct(ant.comAlerta, ant.aihs);
        if (taxa - taxaAnt >= L.altaTaxaPp) add('atencao', 'taxa_subiu', sigla, `Taxa de alerta subiu ${fmt(taxa - taxaAnt)} p.p.`, `Passou de ${fmt(taxaAnt)}% para ${fmt(taxa)}% em relação ao mês anterior.`);
        const queda = pct(ant.aihs - m.aihs, ant.aihs);
        if (queda >= L.quedaProducao) add('atencao', 'queda_producao', sigla, `Produção caiu ${fmt(queda, 0)}%`, `${ant.aihs} AIHs no mês anterior e ${m.aihs} agora. Confira se toda a produção foi apresentada.`);
        const altaDiarias = pct(m.diariasMaior - ant.diariasMaior, ant.diariasMaior);
        if (m.diariasMaior >= L.diariasMinimas && ant.diariasMaior && altaDiarias >= L.altaDiarias) add('atencao', 'diarias', sigla, `Diárias de permanência a maior +${fmt(altaDiarias, 0)}%`, `${m.diariasMaior} diárias nesta competência, contra ${ant.diariasMaior} no mês anterior.`);
      }
    }
    if (m.linhasBpa) {
      const taxaBpa = pct(m.bpaComAlerta, m.linhasBpa);
      if (taxaBpa >= L.taxaBpaAtencao) add('atencao', 'bpa', sigla, `${fmt(taxaBpa)}% das linhas BPA com alerta`, `${m.bpaComAlerta} de ${m.linhasBpa} linhas. Limite de atenção: ${L.taxaBpaAtencao}%.`);
    }
    const pend = pendencias(m.checa);
    if (pend >= L.pendenciasAtencao) {
      const subiu = ant?.checa && pend > pendencias(ant.checa);
      add('atencao', 'cadastro', sigla, `${pend} pendências no cadastro de profissionais`, `Divergências entre Tasy e CNES${subiu ? ', em alta em relação ao mês anterior' : ''}. Geram alertas de CBO e de profissional não cadastrado.`);
    }
  }
  return alarmes.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel] || a.sigla.localeCompare(b.sigla));
}
