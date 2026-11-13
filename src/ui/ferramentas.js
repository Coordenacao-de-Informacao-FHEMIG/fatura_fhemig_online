// Configuracao das tres ferramentas: entradas, bases da unidade e textos.
import { ICONES } from './util.js';

export const FERRAMENTAS = [
  {
    id: 'hospitalar',
    titulo: 'Fatura Hospitalar',
    subtitulo: 'AIH · SISAIH01 (TXT) ou espelho (PDF)',
    versao: 'regras da versão 14.3',
    icone: ICONES.hospital,
    descricao: 'Lê o movimento TXT do SISAIH01 ou o espelho da AIH em PDF (com texto selecionável), cruza com o SIGTAP e com as planilhas da unidade e aponta os procedimentos que precisam de conferência.',
    entradas: [
      { id: 'entrada', rotulo: 'Produção hospitalar', ajuda: 'TXT posicional do SISAIH01 ou PDF do espelho da AIH', aceita: '.txt,.pdf' },
    ],
    bases: [
      { id: 'servico', rotulo: 'Serviço e Classificação', ajuda: 'Colunas Código, Terceiro e CNES' },
      { id: 'habilitacao', rotulo: 'Habilitações', ajuda: 'Coluna Habilitação' },
      { id: 'profissionais', rotulo: 'Profissionais', ajuda: 'Colunas CNS e CBO (CPF opcional)' },
    ],
    sigtap: true,
    tituloBases: 'Planilhas da unidade',
  },
  {
    id: 'ambulatorial',
    titulo: 'Fatura Ambulatorial',
    subtitulo: 'BPA-I e BPA-C · regras R01 a R11',
    versao: 'regras da versão 1.0',
    icone: ICONES.ambulatorio,
    descricao: 'Audita o TXT de produção BPA (individualizado e consolidado) contra o SIGTAP e as quatro planilhas da unidade: profissionais, carga horária, serviço/classificação e habilitação.',
    entradas: [{ id: 'entrada', rotulo: 'Produção BPA', ajuda: 'TXT de produção BPA (cabeçalho #BPA#)', aceita: '' }],
    bases: [
      { id: 'profissionais', rotulo: 'Profissionais', ajuda: 'Colunas CNS, nome e CBO' },
      { id: 'carga_horaria', rotulo: 'Carga horária', ajuda: 'Colunas CNS, CBO e carga ambulatorial (Amb.)' },
      { id: 'servico_classificacao', rotulo: 'Serviço/Classificação', ajuda: 'Código (serviço - classificação), Terceiro e CNES' },
      { id: 'habilitacao', rotulo: 'Habilitação', ajuda: 'Habilitação e vigência (comp. inicial/final)' },
    ],
    sigtap: true,
    tituloBases: 'Planilhas da unidade',
  },
  {
    id: 'checa',
    titulo: 'ChecaProfissionais',
    subtitulo: 'Tasy × CNES · ADC e CBO assistencial',
    versao: 'regras da versão 2.0',
    icone: ICONES.pessoas,
    descricao: 'Compara o cadastro de profissionais do Tasy com o CNES da unidade, retira a ADC, consolida cada pessoa por CPF e aponta ausências, divergências de CBO e CNS e problemas de qualidade do cadastro.',
    entradas: [
      { id: 'tasy', rotulo: 'Relatório do Tasy', ajuda: 'Planilha de profissionais do Tasy da unidade (.xlsx)', aceita: '.xlsx,.xlsm' },
      { id: 'cnes', rotulo: 'Planilha do CNES', ajuda: 'Título "CNES : 0000000 - NOME" e colunas CPF, CNS, nome e CBO', aceita: '.xlsx,.xlsm' },
    ],
    bases: [
      { id: 'adc', rotulo: 'Profissionais da ADC', ajuda: 'Base padrão do servidor ou outra planilha' },
      { id: 'cbo', rotulo: 'CBO assistencial', ajuda: 'Colunas CBO e FHEMIG ASSISTENCIAL' },
    ],
    sigtap: false,
    tituloBases: 'Bases de apoio',
  },
];

export const porId = (id) => FERRAMENTAS.find((f) => f.id === id);
