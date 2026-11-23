// Modo vm: as pastas de dados/vm sao a fonte das planilhas reais.
//
//   dados/vm/geral/                       BASE GERAL: uma planilha com TODAS as unidades (abas Servico/Classificacao,
//                                         Habilitacoes, Profissionais e CBOs assistenciais). Vale para toda unidade
//                                         que aparece nela e tem precedencia sobre as planilhas por unidade.
//   dados/vm/bases/hospitalar/<SIGLA>/    planilhas por unidade (so para o que a base geral nao cobrir)
//   dados/vm/bases/ambulatorial/<SIGLA>/  idem
//   dados/vm/bases/checa/                 Profissionais ADC, CBO assistencial
//
// O tipo de cada planilha sai do nome do arquivo e a unidade, do nome da pasta.
// Escreve bases/manifest.json e, havendo base geral, bases/geral/base-geral.json (ja limpo)
// e bases/geral/CBO_assistencial.xlsx.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNIDADES } from '../src/engine/unidades.js';
import { lerBaseGeral, NOME_TABELA } from './base-geral.mjs';

// Ordem importa: o primeiro padrao que casar define o tipo
// ("Carga Horaria Profissionais HRBJA" e carga horaria, nao profissionais).
const TIPOS = {
  hospitalar: [
    ['servico', /servi/, 'Serviço e Classificação'],
    ['habilitacao', /habilita/, 'Habilitações'],
    ['profissionais', /profissiona/, 'Profissionais'],
  ],
  ambulatorial: [
    ['carga_horaria', /carga/, 'Carga horária'],
    ['servico_classificacao', /servi/, 'Serviço/Classificação'],
    ['habilitacao', /habilita/, 'Habilitações'],
    ['profissionais', /profissiona/, 'Profissionais'],
  ],
  checa: [
    ['adc', /\badc\b/, 'Profissionais ADC'],
    ['cbo', /\bcbo\b/, 'CBO assistencial'],
  ],
};
// Slot de cada ferramenta -> tabela da base geral que o preenche.
const DA_BASE_GERAL = {
  hospitalar: { servico: 'servico', habilitacao: 'habilitacao', profissionais: 'profissionais' },
  ambulatorial: { servico_classificacao: 'servico', habilitacao: 'habilitacao', profissionais: 'profissionais', carga_horaria: 'profissionais' },
};
const EXTENSOES = /\.(xlsx|xlsm)$/i;
const EXTENSOES_GERAL = /\.(csv|xlsx|xlsm)$/i;
const SIGLAS = UNIDADES.map((u) => u.sigla).filter((s) => s !== 'ADC');
const CAMINHO_GERAL = 'bases/geral/base-geral.json';
const CAMINHO_CBO = 'bases/geral/CBO_assistencial.xlsx';

/** CBO_assistencial.xlsx no formato que o ChecaProfissionais lê (CBO, DESCRICAO, FHEMIG ASSISTENCIAL). */
async function gravarCboAssistencial(destino, cbos) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CBO GERAL');
  ws.addRow(['CBO', 'DESCRICAO', 'FHEMIG ASSISTENCIAL']);
  for (const [cbo, desc] of cbos) ws.addRow([cbo, desc, 'SIM']);
  writeFileSync(destino, Buffer.from(await wb.xlsx.writeBuffer()));
}

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ehPasta = (p) => statSync(p).isDirectory();
const ignorado = (nome) => nome.startsWith('~$') || nome.startsWith('.');

/** Monta dados/vm/bases/manifest.json. Devolve false se houver erro que impeca o build. */
export async function prepararVm(destino) {
  const bases = join(destino, 'bases');
  const erros = [];
  const avisos = [];
  const manifest = { modo: 'vm', gerado_em: new Date().toISOString(), hospitalar: {}, ambulatorial: {}, checa: {} };

  if (!existsSync(bases)) {
    console.error(`Pasta ${bases} não existe. Crie-a e coloque as planilhas das unidades (ver dados/vm/LEIA-ME.md).`);
    return false;
  }

  /** Classifica as planilhas de uma pasta. sigla = null para o Checa. */
  const lerPasta = (ferramenta, pasta, rel, sigla) => {
    const achados = {};
    for (const nome of readdirSync(pasta).sort()) {
      if (ignorado(nome)) continue;
      const local = `${rel}/${nome}`;
      if (ehPasta(join(pasta, nome))) {
        avisos.push(`${local}/: subpasta ignorada.`);
        continue;
      }
      if (!EXTENSOES.test(nome)) {
        avisos.push(`${local}: não é planilha .xlsx; ignorado.`);
        continue;
      }
      const chave = normalizar(nome.replace(EXTENSOES, ''));
      const tipo = TIPOS[ferramenta].find(([, re]) => re.test(chave));
      if (!tipo) {
        const esperados = TIPOS[ferramenta].map(([, , d]) => d).join(', ');
        avisos.push(`${local}: nome não indica o tipo da planilha (${esperados}); ignorado.`);
        continue;
      }
      if (sigla) {
        const tokens = new Set(chave.toUpperCase().split(' '));
        const outra = SIGLAS.find((s) => s !== sigla && tokens.has(s));
        if (outra && !tokens.has(sigla)) {
          erros.push(`${local}: o nome indica a unidade ${outra}, mas o arquivo está na pasta ${sigla}.`);
          continue;
        }
      }
      const [id, , descricao] = tipo;
      if (achados[id]) {
        erros.push(`${rel}: duas planilhas de ${descricao} ("${achados[id].nome}" e "${nome}"). Deixe só a atual.`);
        continue;
      }
      achados[id] = { nome, caminho: `bases/${local}` };
    }
    return achados;
  };

  for (const ferramenta of ['hospitalar', 'ambulatorial']) {
    const pastaFerr = join(bases, ferramenta);
    if (!existsSync(pastaFerr)) continue;
    for (const nome of readdirSync(pastaFerr).sort()) {
      if (ignorado(nome)) continue;
      const rel = `${ferramenta}/${nome}`;
      if (!ehPasta(join(pastaFerr, nome))) {
        avisos.push(`${rel}: arquivo solto; coloque-o na pasta da unidade (${ferramenta}/<SIGLA>/). Ignorado.`);
        continue;
      }
      const sigla = SIGLAS.find((s) => s.toUpperCase() === nome.toUpperCase());
      if (!sigla) {
        erros.push(`${rel}/: "${nome}" não é sigla de unidade conhecida (${SIGLAS.join(', ')}).`);
        continue;
      }
      const achados = lerPasta(ferramenta, join(pastaFerr, nome), rel, sigla);
      if (Object.keys(achados).length) manifest[ferramenta][sigla] = achados;
    }
  }

  // ---- Base geral (dados/vm/geral): substitui as planilhas por unidade no que ela cobrir.
  const pastaGeral = join(destino, 'geral');
  const saidaGeral = join(destino, CAMINHO_GERAL);
  const saidaCbo = join(destino, CAMINHO_CBO);
  const fontes = existsSync(pastaGeral) ? readdirSync(pastaGeral).filter((n) => !ignorado(n) && EXTENSOES_GERAL.test(n)).sort() : [];
  let geral = null;
  if (fontes.length > 1) erros.push(`geral/: há ${fontes.length} arquivos (${fontes.join(', ')}). Deixe só a base geral atual.`);
  else if (fontes.length === 1) {
    try {
      geral = await lerBaseGeral(join(pastaGeral, fontes[0]), SIGLAS);
      avisos.push(...geral.avisos);
      geral.fonte = fontes[0];
    } catch (e) {
      erros.push(`geral/${e.message}`);
    }
  }
  if (geral) {
    for (const [ferramenta, slots] of Object.entries(DA_BASE_GERAL)) {
      for (const [slot, tabela] of Object.entries(slots)) {
        if (!geral.tabelas[tabela] || (slot === 'carga_horaria' && !geral.temCarga)) continue;
        for (const sigla of Object.keys(geral.porUnidade[tabela])) {
          manifest[ferramenta][sigla] ??= {};
          const local = manifest[ferramenta][sigla][slot];
          if (local) avisos.push(`${local.caminho.replace(/^bases\//, '')}: ignorada; vale a base geral (${geral.fonte}).`);
          manifest[ferramenta][sigla][slot] = {
            nome: `${slot === 'carga_horaria' ? 'Carga horária' : NOME_TABELA[tabela]} ${sigla} · ${geral.fonte}`,
            caminho: CAMINHO_GERAL, unidade: sigla, tabela,
          };
        }
      }
    }
  }

  if (existsSync(join(bases, 'checa'))) manifest.checa = lerPasta('checa', join(bases, 'checa'), 'checa', null);
  if (geral?.cbosAssistenciais?.length) {
    if (manifest.checa.cbo) avisos.push(`${manifest.checa.cbo.caminho.replace(/^bases\//, '')}: ignorada; vale a lista de CBOs assistenciais da base geral.`);
    manifest.checa.cbo = { nome: `CBO assistencial · ${geral.fonte}`, caminho: CAMINHO_CBO };
  }
  if (TIPOS.checa.some(([id]) => !manifest.checa[id])) {
    const faltam = TIPOS.checa.filter(([id]) => !manifest.checa[id]).map(([, , d]) => d);
    avisos.push(`checa/: falta ${faltam.join(', ')}. O ChecaProfissionais fica bloqueado.`);
  }

  // Resumo do que falta, agrupado por tipo (a ferramenta fica bloqueada para a unidade).
  for (const ferramenta of ['hospitalar', 'ambulatorial']) {
    for (const [id, , descricao] of TIPOS[ferramenta]) {
      const sem = Object.keys(manifest[ferramenta]).filter((s) => !manifest[ferramenta][s][id]).sort();
      if (sem.length) avisos.push(`${ferramenta}: sem ${descricao} em ${sem.join(', ')} (ferramenta bloqueada nessas unidades).`);
    }
  }

  for (const a of avisos) console.warn(`  aviso: ${a}`);
  if (erros.length) {
    for (const e of erros) console.error(`  ERRO: ${e}`);
    console.error('Corrija os erros acima em dados/vm e rode de novo.');
    return false;
  }

  // Saídas antigas ou de uma base geral removida não podem sobrar.
  rmSync(join(bases, 'geral'), { recursive: true, force: true });
  if (geral) {
    mkdirSync(join(bases, 'geral'), { recursive: true });
    if (Object.keys(geral.tabelas).length) {
      writeFileSync(saidaGeral, JSON.stringify({ fonte: geral.fonte, gerado_em: manifest.gerado_em, tabelas: geral.tabelas }));
    }
    console.log(`Base geral: ${geral.fonte}`);
    for (const [tabela, t] of Object.entries(geral.tabelas)) {
      const porUnidade = Object.entries(geral.porUnidade[tabela]).sort().map(([s, n]) => `${s} ${n}`).join(', ');
      console.log(`  ${NOME_TABELA[tabela]}: ${t.linhas.length} linhas (${porUnidade})`);
    }
    if (geral.cbosAssistenciais?.length) {
      await gravarCboAssistencial(saidaCbo, geral.cbosAssistenciais);
      console.log(`  CBOs assistenciais: ${geral.cbosAssistenciais.length} (→ ${CAMINHO_CBO})`);
    }
  }
  writeFileSync(join(bases, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const resumo = (f) => Object.entries(manifest[f]).sort()
    .map(([s, t]) => `${s} ${TIPOS[f].every(([id]) => t[id]) ? 'completa' : `${Object.keys(t).length}/${TIPOS[f].length}`}`).join(', ') || 'nenhuma unidade';
  console.log(`Hospitalar: ${resumo('hospitalar')}`);
  console.log(`Ambulatorial: ${resumo('ambulatorial')}`);
  console.log(`ChecaProfissionais: ${Object.keys(manifest.checa).length}/${TIPOS.checa.length} bases`);
  console.log('dados/vm/bases/manifest.json pronto.');
  return true;
}
