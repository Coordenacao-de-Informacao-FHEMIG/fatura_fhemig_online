import { describe, expect, it } from 'vitest';
import { calcularAlarmes } from '../src/gestao/alarmes.js';
import { montarPainel } from '../src/gestao/painel.js';
import { gerarResumosFicticios, MESES_FICTICIOS } from '../src/gestao/ficticio.js';

const mes = (x = {}) => ({
  aihs: 0, comAlerta: 0, diariasMaior: 0, linhasBpa: 0, bpaComAlerta: 0, alertas: {}, procs: [], checa: null,
  envios: { hospitalar: null, ambulatorial: null, checa: null }, ...x,
});
const enviado = { hospitalar: 'x', ambulatorial: 'x', checa: 'x' };
const painel = (ant, atual) => ({ competencias: ['202609', '202610'], dados: { U: [mes(ant), mes(atual)] } });
const tipos = (p) => calcularAlarmes(p, ['U'], 1).map((a) => `${a.nivel}:${a.tipo}`);

describe('alarmes do gestor', () => {
  it('sem alarme quando tudo está dentro dos limites', () => {
    expect(tipos(painel({ aihs: 100, comAlerta: 5, envios: enviado }, { aihs: 100, comAlerta: 5, envios: enviado }))).toEqual([]);
  });

  it('taxa de AIHs com alerta acima de 10% é crítica', () => {
    expect(tipos(painel({ aihs: 100, comAlerta: 11, envios: enviado }, { aihs: 100, comAlerta: 11, envios: enviado }))).toEqual(['critico:taxa_alta']);
  });

  it('envio que faltou, alta da taxa, queda de produção e diárias', () => {
    const t = tipos(painel(
      { aihs: 200, comAlerta: 4, diariasMaior: 10, envios: enviado },
      { aihs: 100, comAlerta: 5, diariasMaior: 20, envios: { hospitalar: 'x', ambulatorial: null, checa: 'x' } },
    ));
    expect(t).toEqual(expect.arrayContaining(['atencao:sem_envio', 'atencao:taxa_subiu', 'atencao:queda_producao', 'atencao:diarias']));
  });

  it('críticos vêm primeiro', () => {
    const a = calcularAlarmes(painel(
      { aihs: 100, comAlerta: 2, envios: enviado },
      { aihs: 100, comAlerta: 12, linhasBpa: 100, bpaComAlerta: 9, envios: enviado },
    ), ['U'], 1);
    expect(a[0].nivel).toBe('critico');
    expect(a.at(-1).nivel).toBe('atencao');
  });

  it('nos dados fictícios, o HCM sem envio do Hospitalar gera alarme crítico', () => {
    const p = montarPainel({ competencias: MESES_FICTICIOS, unidades: [{ sigla: 'HCM', nome: 'HCM' }, { sigla: 'IRS', nome: 'IRS' }], processamentos: gerarResumosFicticios() });
    const a = calcularAlarmes(p, ['HCM', 'IRS'], MESES_FICTICIOS.length - 1);
    expect(a.some((x) => x.sigla === 'HCM' && x.tipo === 'sem_envio' && x.nivel === 'critico')).toBe(true);
  });
});
