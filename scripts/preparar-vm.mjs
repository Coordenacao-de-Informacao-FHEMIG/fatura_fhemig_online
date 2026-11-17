// Modo vm: a propria pasta dados/vm/bases e a fonte das planilhas reais.
//
//   dados/vm/bases/hospitalar/<SIGLA>/    Servico e Classificacao, Habilitacoes, Profissionais
//   dados/vm/bases/ambulatorial/<SIGLA>/  Servico/Classificacao, Habilitacoes, Profissionais, Carga horaria
//   dados/vm/bases/checa/                 Profissionais ADC, CBO assistencial
//
// O tipo de cada planilha sai do nome do arquivo e a unidade, do nome da pasta.
// Nada e copiado nem apagado: so o bases/manifest.json e (re)escrito.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNIDADES } from '../src/engine/unidades.js';

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
const EXTENSOES = /\.(xlsx|xlsm)$/i;
const SIGLAS = UNIDADES.map((u) => u.sigla).filter((s) => s !== 'ADC');

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ehPasta = (p) => statSync(p).isDirectory();
const ignorado = (nome) => nome.startsWith('~$') || nome.startsWith('.');

/** Monta dados/vm/bases/manifest.json. Devolve false se houver erro que impeca o build. */
export function prepararVm(destino) {
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
    const faltam = TIPOS[ferramenta].filter(([id]) => !achados[id]).map(([, , d]) => d);
    if (faltam.length) avisos.push(`${rel}: falta ${faltam.join(', ')}. ${sigla ? `A ferramenta fica bloqueada para ${sigla}.` : 'O ChecaProfissionais fica bloqueado.'}`);
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
  if (existsSync(join(bases, 'checa'))) manifest.checa = lerPasta('checa', join(bases, 'checa'), 'checa', null);
  else avisos.push('checa/: pasta ausente. O ChecaProfissionais fica bloqueado.');

  for (const a of avisos) console.warn(`  aviso: ${a}`);
  if (erros.length) {
    for (const e of erros) console.error(`  ERRO: ${e}`);
    console.error('Corrija os erros acima em dados/vm/bases e rode de novo.');
    return false;
  }
  writeFileSync(join(bases, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const resumo = (f) => Object.entries(manifest[f]).map(([s, t]) => `${s} (${Object.keys(t).length}/${TIPOS[f].length})`).join(', ') || 'nenhuma unidade';
  console.log(`Hospitalar: ${resumo('hospitalar')}`);
  console.log(`Ambulatorial: ${resumo('ambulatorial')}`);
  console.log(`ChecaProfissionais: ${Object.keys(manifest.checa).length}/${TIPOS.checa.length} bases`);
  console.log('dados/vm/bases/manifest.json pronto.');
  return true;
}
