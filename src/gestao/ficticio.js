// Resumos FICTICIOS para o prototipo do painel (Netlify) e para o comando de demonstracao
// da API (`npm run api:demo`). Deterministicos: o mesmo painel a cada abertura.
// Mesmo formato que o navegador envia a API (ver resumo.js).

function rng(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MESES_FICTICIOS = ['202605', '202606', '202607', '202608', '202609', '202610'];

const PROCEDIMENTOS = {
  '0415030013': 'Tratamento cirúrgico em politraumatizado',
  '0303040149': 'Tratamento de AVC (isquêmico ou hemorrágico agudo)',
  '0303140151': 'Tratamento de pneumonias ou influenza',
  '0408050896': 'Tratamento cirúrgico de rotura do menisco',
  '0408060352': 'Retirada de fio ou pino intra-ósseo',
  '0303060212': 'Tratamento de insuficiência cardíaca',
  '0303060107': 'Tratamento de crise hipertensiva',
  '0303010037': 'Tratamento de outras doenças bacterianas',
  '0303070102': 'Tratamento de outras doenças do aparelho digestivo',
  '0303150050': 'Tratamento de outras doenças do aparelho urinário',
  '0303160055': 'Transtornos da duração da gestação e do crescimento fetal',
  '0310010039': 'Parto normal',
  '0411010034': 'Operação cesariana',
  '0411010026': 'Operação cesariana em gestação de alto risco',
  '0303100044': 'Intercorrências clínicas na gravidez',
  '0303170131': 'Tratamento clínico em saúde mental (risco elevado de suicídio)',
};

const ALERTAS = [
  'Profissional/CBO não cadastrado', 'CBO incompatível', 'Sem habilitação', 'Quantidade acima da máxima',
  'Serviço não apresentado', 'Estabelecimento sem serviço/classificação', 'Admite permanência à maior',
  'Idade incompatível', 'Sexo incompatível', 'CBO não informado',
];

const ALERTAS_BPA = ['Sem carga horária ambulatorial', 'CBO não vinculado ao profissional', 'Unidade sem a habilitação exigida', 'CPF obrigatório ausente ou inválido'];

const PERFIS = [
  { sigla: 'HJXXIII', aihs: 1850, taxa: 0.11, bpa: 9000, procs: ['0415030013', '0303040149', '0408060352', '0408050896', '0303140151'], foco: [0, 3, 4] },
  { sigla: 'MOV', aihs: 980, taxa: 0.06, bpa: 6500, procs: ['0310010039', '0411010034', '0411010026', '0303100044', '0303160055'], foco: [7, 1, 0] },
  { sigla: 'HIJPII', aihs: 720, taxa: 0.09, bpa: 7800, procs: ['0303140151', '0303160055', '0303070102', '0303010037', '0303150050'], foco: [7, 2, 0] },
  { sigla: 'HJK', aihs: 690, taxa: 0.08, bpa: 8200, procs: ['0303060212', '0303140151', '0310010039', '0411010034', '0303150050'], foco: [1, 5, 0] },
  { sigla: 'HRBJA', aihs: 610, taxa: 0.13, bpa: 31000, procs: ['0303140151', '0310010039', '0303060212', '0303060107', '0408060352'], foco: [0, 2, 6] },
  { sigla: 'HAC', aihs: 520, taxa: 0.07, bpa: 9800, procs: ['0303060212', '0303070102', '0303150050', '0303140151', '0303010037'], foco: [5, 1, 4] },
  { sigla: 'HRJP', aihs: 470, taxa: 0.1, bpa: 5400, procs: ['0303140151', '0303060212', '0303040149', '0303010037', '0303060107'], foco: [6, 0, 3] },
  { sigla: 'HEM', aihs: 380, taxa: 0.05, bpa: 4100, procs: ['0303010037', '0303140151', '0303070102', '0303150050', '0303060107'], foco: [3, 1, 9] },
  { sigla: 'HCM', aihs: 310, taxa: 0.12, bpa: 2600, procs: ['0303140151', '0303060212', '0303070102', '0303150050', '0303010037'], foco: [0, 8, 2] },
  { sigla: 'IRS', aihs: 260, taxa: 0.04, bpa: 3300, procs: ['0303170131', '0303070102', '0303140151', '0303150050', '0303010037'], foco: [1, 9, 0] },
];

const hashFicticio = (texto) => {
  let h = 2166136261;
  for (const c of texto) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(8);
};

/** Lista de resumos (um por unidade, competencia e ferramenta). */
export function gerarResumosFicticios() {
  const r = rng(20261112);
  const lista = [];
  for (const u of PERFIS) {
    MESES_FICTICIOS.forEach((competencia, i) => {
      const sazonal = 1 + 0.06 * Math.sin((i / 6) * Math.PI * 2) + (r() - 0.5) * 0.08;
      const aihs = Math.round(u.aihs * sazonal);
      const melhora = 1 - i * 0.03; // efeito da conferencia: alerta cai ao longo dos meses
      const taxa = Math.max(0.015, u.taxa * melhora * (0.85 + r() * 0.3));
      const comAlerta = Math.round(aihs * taxa);
      const pesos = ALERTAS.map((_, k) => (u.foco.includes(k) ? 6 - u.foco.indexOf(k) * 1.5 : 0.5 + r()));
      const soma = pesos.reduce((a, b) => a + b, 0);
      const ocorrencias = Math.round(comAlerta * 1.35);
      const linhasBpa = Math.round(u.bpa * sazonal);
      const bpaComAlerta = Math.round(linhasBpa * Math.max(0.02, taxa * 0.55));
      const base = { sigla: u.sigla, competencia, criado_em: `${competencia.slice(0, 4)}-${competencia.slice(4)}-28T12:00:00.000Z`, versao_regras: 'demonstração' };
      lista.push({
        ...base, ferramenta: 'hospitalar', arquivo_nome: `SISAIH01_${u.sigla}_${competencia}_DEMO.txt`, arquivo_sha256: hashFicticio(`h${u.sigla}${competencia}`),
        sigtap_competencia: competencia,
        indicadores: { aihs_distintas: aihs, aihs_com_alerta: comAlerta, diarias_de_perm_a_maior: Math.round(aihs * 0.012 * (0.6 + r() * 0.8)) },
        alertas: pesos.map((p, k) => {
          const contas = Math.round((p / soma) * ocorrencias);
          return { tipo: ALERTAS[k], ocorrencias: Math.round(contas * 1.2), contas };
        }).filter((a) => a.contas),
        procedimentos: u.procs.map((c, k) => ({ codigo: c, descricao: PROCEDIMENTOS[c], quantidade: Math.round(aihs * (0.24 - k * 0.035) * (0.9 + r() * 0.2)) })),
      });
      lista.push({
        ...base, ferramenta: 'ambulatorial', arquivo_nome: `BPA_${u.sigla}_${competencia}_DEMO.txt`, arquivo_sha256: hashFicticio(`a${u.sigla}${competencia}`),
        sigtap_competencia: competencia,
        indicadores: { linhas_de_atendimento: linhasBpa, linhas_com_alerta: bpaComAlerta },
        alertas: ALERTAS_BPA.map((tipo, k) => {
          const contas = Math.round(bpaComAlerta * [0.45, 0.25, 0.2, 0.1][k]);
          return { tipo, ocorrencias: contas, contas };
        }).filter((a) => a.contas),
        procedimentos: [],
      });
      const checa = { nao_encontrados_no_cnes: Math.round(2 + r() * 14 * melhora), nao_encontrados_no_tasy: Math.round(1 + r() * 9 * melhora), pessoas_com_cbos_diferentes: Math.round(3 + r() * 20 * melhora) };
      lista.push({
        ...base, ferramenta: 'checa', arquivo_nome: `Tasy_CNES_${u.sigla}_DEMO`, arquivo_sha256: hashFicticio(`c${u.sigla}${competencia}`),
        indicadores: checa, alertas: [], procedimentos: [],
      });
    });
  }
  return lista;
}
