// Paridade com os aplicativos originais (Python): o motor JS precisa produzir
// exatamente o que os backends do Hospitalar 14.3, do Ambulatorial 1.0 e do
// ChecaProfissionais 2.0 produzem sobre a massa sintetica de "arquivos de teste".
// Referencias: tests/referencia/*.json (scripts/paridade/gerar_referencia.py).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { processarHospitalar } from '../src/engine/hospitalar/processar.js';
import { extrairEspelhoPdf } from '../src/engine/hospitalar/entrada.js';
import { buildAlertRecords, resumoAihTipoCti } from '../src/engine/hospitalar/regras.js';
import { processarAmbulatorial } from '../src/engine/ambulatorial/processar.js';
import { processarChecaProfissionais } from '../src/engine/checa/processar.js';
import { lerPlanilha } from '../src/engine/comum/planilha.js';
import { RAIZ, bytes, planilha, pdfjsNode, sigtapHospitalar, sigtapAmbPlanilha } from './apoio.mjs';

const ref = (nome) => JSON.parse(readFileSync(join(RAIZ, 'tests', 'referencia', nome), 'utf8'));
const vazio = (v) => (v === undefined || v === '' ? null : v);
// O openpyxl (read_only) corta as celulas vazias do fim de cada linha; o leitor JS completa ate a ultima coluna.
const semCaudaVazia = (linhas) => linhas.map((l) => {
  const c = l.map(vazio);
  while (c.length && c[c.length - 1] === null) c.pop();
  return c;
});

describe('Fatura Hospitalar 14.3', async () => {
  const H = 'teste Hospitalar';
  const sig = sigtapHospitalar();
  const bases = {
    servico: await planilha(H, 'Serviço e Classificação HJXXIII (TESTE).xlsx'),
    habilitacao: await planilha(H, 'Habilitações HJXXIII (TESTE).xlsx'),
    profissionais: await planilha(H, 'Profissionais HJXXIII (TESTE).xlsx'),
  };
  for (const [formato, nome] of [['txt', 'SISAIH01_HJXXIII_202609_TESTE.txt'], ['pdf', 'Espelho_AIH_HJXXIII_202609_TESTE.pdf']]) {
    it(`${formato.toUpperCase()}: mesmas linhas, alertas e contagens do Python`, async () => {
      const entrada = formato === 'txt'
        ? { formato, nome, bytes: bytes(H, nome) }
        : { formato, nome, espelho: await extrairEspelhoPdf(await pdfjsNode(), bytes(H, nome)) };
      const r = await processarHospitalar({ entrada, bases, unidade: 'HJXXIII', obterSigtap: async () => sig });
      const esperado = ref(`hospitalar_${formato}.json`);
      expect(r.rows.map((x) => ({
        aih: x.AIH, linha: x['Linha do procedimento'], codigo: x['Codigo do procedimento'], alertas: x.ALERTAS,
        diarias_maior: x['DIARIAS DE PERMANENCIA A MAIOR'], reinternou: x['REINTERNOU (REAPARECE NA LISTAGEM DO PDF)?'],
        reinternou72: x['REINTERNOU COM MENOS DE 72H (SEGUNDA ENTRADA MENOS PRIMEIRA SAIDA)?'], idade: x['IDADE COMPLETA'],
        cbo: x['CBO E O MESMO DO SIGTAP?'], profissional: x['PROFISSIONAL E CBO CADASTRADOS?'],
      }))).toEqual(esperado.linhas);
      const { records, counts } = buildAlertRecords(r.rows);
      expect(records.map((x) => x.Detalhe)).toEqual(esperado.detalhes);
      expect(counts.map((c) => [c.label, c.aihs, c.procedimentos])).toEqual(esperado.contagens);
      expect(resumoAihTipoCti(r.rows)).toEqual(esperado.cti);
    });
  }
});

describe('Fatura Ambulatorial 1.0', async () => {
  const A = 'teste Ambulatorial';
  const base = async (n) => ({ ...(await planilha(A, n)), origem: 'seleção manual' });
  const bases = {
    profissionais: await base('Profissionais HRBJA (TESTE).xlsx'),
    carga_horaria: await base('Carga Horária HRBJA (TESTE).xlsx'),
    servico_classificacao: await base('Serviço Classificação HRBJA (TESTE).xlsx'),
    habilitacao: await base('Habilitações HRBJA (TESTE).xlsx'),
  };
  const sig = sigtapAmbPlanilha();
  for (const [chave, nome] of [['teste', 'BPA_HRBJA_202610_TESTE.txt'], ['cabecalho', 'BPA_HRBJA_202610_CABECALHO_INCONSISTENTE.txt']]) {
    it(`${nome}: abas Alertas e Producao e avisos iguais ao Python`, async () => {
      const r = await processarAmbulatorial({
        entrada: { nome, bytes: bytes(A, nome) }, bases, unidade: 'HRBJA',
        obterSigtap: async () => ({ base: sig, rotulo: 'Planilha SIGTAP102026.xlsx', tipo: 'xlsx', motivo: 'mesma competência da produção' }),
      });
      const lido = await lerPlanilha(r.arquivos.xlsx.bytes);
      const aba = (n) => semCaudaVazia(lido.abas.find((a) => a.nome === n).linhas);
      const esperado = ref(`ambulatorial_${chave}.json`);
      expect(aba('Alertas')).toEqual(semCaudaVazia(esperado.alertas));
      expect(aba('Producao')).toEqual(semCaudaVazia(esperado.producao));
      expect(r.avisos.join('\n') || 'nenhum').toEqual(esperado.avisos);
    });
  }
});

describe('ChecaProfissionais 2.0', () => {
  const C = 'teste ChecaProfissionais';
  const arq = (nome, origem) => ({ nome, bytes: bytes(C, nome), origem });
  const comum = { tasy: arq('Tasy Profissionais HIJPII (TESTE).xlsx'), adc: arq('Profissionais ADC (TESTE).xlsx', 'LOCAL'), cbo: arq('CBO_assistencial (TESTE).xlsx', 'LOCAL'), unidade: 'HIJPII' };
  const esperado = ref('checa.json');

  it('alertas, matriz e indicadores iguais ao Python', async () => {
    const { res } = await processarChecaProfissionais({ ...comum, cnes: arq('CNES Profissionais HIJPII (TESTE).xlsx') });
    expect(res.alertas.map((a) => [a.codigo, a.nome, a.cpf, a.cns, a.cbo, a.mensagem, a.valor_tasy, a.valor_cnes, a.linhas_tasy, a.linhas_cnes])).toEqual(esperado.alertas);
    expect(res.matriz).toEqual(esperado.matriz);
    const ind = { ...res.indicadores, alertas_por_codigo: Object.fromEntries(res.indicadores.alertas_por_codigo), alertas_por_severidade: Object.fromEntries(res.indicadores.alertas_por_severidade) };
    expect(ind).toEqual(esperado.indicadores);
  });

  it('CNES de outra unidade interrompe com E002 e a mesma mensagem', async () => {
    await expect(processarChecaProfissionais({ ...comum, cnes: arq('CNES Profissionais HAC - UNIDADE ERRADA (TESTE).xlsx') }))
      .rejects.toMatchObject({ codigo: 'E002', message: esperado.erro_unidade });
  });
});
