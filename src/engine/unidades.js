// Catalogo unico das unidades FHEMIG (sigla, CNES, codigo Tasy, nome).
// Fonte: config/unidades.json do ChecaProfissionais 2.0, que e o cadastro mais
// completo (o Ambulatorial conhecia so 4 unidades e o Hospitalar 2).
import checaUnidades from './checa/config/unidades.json' with { type: 'json' };

export const UNIDADES = checaUnidades.unidades.map((u) => ({
  sigla: u.sigla,
  cnes: u.cnes || '',
  codigo_tasy: u.codigo_tasy,
  nome: u.nome,
  apelidos: u.apelidos || [],
}));

export const ADC = checaUnidades.adc;

export function unidadePorSigla(sigla) {
  return UNIDADES.find((u) => u.sigla === sigla) || null;
}

/** Unidades com regras proprias no Hospitalar 14.3. */
export const UNIDADES_REGRA_HOSPITALAR = ['HJXXIII', 'HIJPII'];
