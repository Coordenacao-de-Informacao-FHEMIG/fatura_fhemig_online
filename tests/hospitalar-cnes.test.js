// Serviço executado por terceiro: o CNES da AIH (0026921) e o da planilha da
// unidade guardado como número (26921) são o mesmo estabelecimento.
import { describe, expect, it } from 'vitest';
import { formatarCnes, loadUnitServiceClassifications, mesmoCnes, servicoEstabelecimentoPendente } from '../src/engine/hospitalar/regras.js';

// Planilha sintética no formato da base geral: CNES como número, sem os zeros.
const planilha = {
  ativa: 0,
  abas: [{
    nome: 'servico TESTE',
    linhas: [
      ['UNIDADE', 'CODIGO', 'SERVICO', 'CLASSIFICACAO', 'TERCEIRO', 'CNES'],
      ['HJXXIII', '145 - 001', 'SERVICO DE DIAGNOSTICO POR LABORATORIO CLINICO', 'EXAMES BIOQUIMICOS', 'SIM', 26921],
      ['HJXXIII', '121 - 003', 'SERVICO DE DIAGNOSTICO POR IMAGEM', 'TOMOGRAFIA', 'SIM', '0027022'],
    ],
  }],
};

describe('CNES do serviço executado por terceiro', () => {
  const servicos = loadUnitServiceClassifications(planilha);

  it('devolve os 7 dígitos ao CNES lido como número', () => {
    expect(servicos.get('145-001')[0].cnes).toBe('0026921');
    expect(formatarCnes('26921')).toBe('0026921');
    expect(formatarCnes('12345678000190')).toBe('12345678000190');
  });

  it('trata 0026921 e 26921 como o mesmo estabelecimento', () => {
    expect(mesmoCnes('0026921', '26921')).toBe(true);
    expect(mesmoCnes('0026921', '0027022')).toBe(false);
    expect(mesmoCnes('', '0000000')).toBe(false);
  });

  it('não alerta quando a AIH traz o CNES do terceiro com zeros à esquerda', () => {
    expect(servicoEstabelecimentoPendente(['145-001'], servicos, '0026921')).toBe('NAO');
    expect(servicoEstabelecimentoPendente(['145-001'], servicos, '26921')).toBe('NAO');
  });

  it('continua alertando quando o CNES da AIH é de outro estabelecimento', () => {
    expect(servicoEstabelecimentoPendente(['145-001'], servicos, '0027022')).toBe('SIM (TERCEIRO CNES DIFERENTE)');
  });
});
