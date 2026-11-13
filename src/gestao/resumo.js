// Resumo de uma analise para o painel gerencial: SOMENTE totais.
// Nenhum nome, CPF, CNS, prontuario, numero de AIH ou linha de paciente entra aqui.
// O mesmo formato e validado pela API (servidor/app.mjs) e usado pelos dados ficticios.

export const LIMITES = { indicadores: 40, alertas: 80, procedimentos: 20, texto: 200 };

/** "AIHs com alerta" -> "aihs_com_alerta"; "% de linhas com alerta" -> "pct_de_linhas_com_alerta". */
export function chaveIndicador(rotulo) {
  return String(rotulo)
    .replace(/%/g, ' pct ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const curto = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITES.texto);
const inteiro = (v) => Math.max(0, Math.round(Number(v) || 0));

/** "0301010072 - CONSULTA ..." -> { codigo, descricao } (so codigos SIGTAP de 10 digitos). */
function procedimento(rotulo) {
  const m = /^\s*(\d{10})\s*-?\s*(.*)$/.exec(String(rotulo ?? ''));
  return m ? { codigo: m[1], descricao: curto(m[2]) } : null;
}

export function competenciaAtual(data = new Date()) {
  return `${data.getFullYear()}${String(data.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * resultado: retorno de processarHospitalar/Ambulatorial/ChecaProfissionais (campo resumo).
 * extra: { arquivoNome, arquivoSha256, versaoRegras, competencia (para o Checa, que nao tem competencia propria) }
 */
export function montarResumoGestao(resultado, extra) {
  const r = resultado.resumo || {};
  const indicadores = {};
  for (const k of r.kpis || []) {
    const v = Number(k.valor);
    const chave = chaveIndicador(k.rotulo);
    if (chave && Number.isFinite(v) && Object.keys(indicadores).length < LIMITES.indicadores) indicadores[chave] = v;
  }
  let alertas = [];
  let procedimentos = [];
  if (resultado.ferramenta === 'hospitalar') {
    alertas = (r.alertas || []).map((a) => ({ tipo: curto(a.rotulo), ocorrencias: inteiro(a.procedimentos), contas: inteiro(a.aihs) }));
  } else if (resultado.ferramenta === 'ambulatorial') {
    alertas = (r.alertas || []).map((a) => ({ tipo: curto(a.rotulo), ocorrencias: inteiro(a.procedimentos), contas: inteiro(a.linhas) }));
  } else {
    alertas = (r.alertas || []).map((a) => ({ tipo: curto(a.rotulo), ocorrencias: inteiro(a.quantidade), contas: inteiro(a.quantidade) }));
  }
  alertas = alertas.filter((a) => a.tipo && (a.ocorrencias || a.contas)).slice(0, LIMITES.alertas);
  if (resultado.ferramenta !== 'checa') {
    const porCodigo = new Map();
    for (const [rotulo, q] of r.top || []) {
      const p = procedimento(rotulo);
      if (!p) continue;
      const atual = porCodigo.get(p.codigo) || { ...p, quantidade: 0 };
      atual.quantidade += inteiro(q);
      porCodigo.set(p.codigo, atual);
    }
    procedimentos = [...porCodigo.values()].slice(0, LIMITES.procedimentos);
  }
  const competencia = resultado.competencia || extra.competencia || competenciaAtual();
  return {
    ferramenta: resultado.ferramenta,
    sigla: resultado.unidade,
    competencia,
    arquivo_nome: curto(extra.arquivoNome),
    arquivo_sha256: extra.arquivoSha256,
    sigtap_competencia: resultado.sigtap?.competencia || undefined,
    versao_regras: extra.versaoRegras ? curto(extra.versaoRegras) : undefined,
    indicadores,
    alertas,
    procedimentos,
  };
}
