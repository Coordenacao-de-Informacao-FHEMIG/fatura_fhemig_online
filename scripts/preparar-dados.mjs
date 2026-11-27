// Monta as bases das unidades e os exemplos servidos pelo site.
//
//   node scripts/preparar-dados.mjs netlify   -> dados/netlify (SO dados sinteticos de "arquivos de teste")
//   node scripts/preparar-dados.mjs vm        -> dados/vm (planilhas reais colocadas em dados/vm/bases; ver preparar-vm.mjs)
//
// Cada modo gera bases/manifest.json, que o site le para carregar sozinho as
// planilhas da unidade selecionada (o equivalente as planilhas ao lado do .exe).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepararVm } from './preparar-vm.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAI = resolve(RAIZ, '..');
// Massa sintetica de teste: dentro do repositorio (ou, no layout antigo, na pasta-mae).
const TESTE = existsSync(join(RAIZ, 'arquivos de teste')) ? join(RAIZ, 'arquivos de teste') : join(PAI, 'arquivos de teste');
// Planilhas reais SEM dados pessoais, versionadas no git (ver .gitignore).
const REAIS = join(RAIZ, 'dados', 'vm', 'bases');
const modo = process.argv[2] || 'netlify';

if (modo === 'vm') process.exit((await prepararVm(join(RAIZ, 'dados', 'vm'))) ? 0 : 1);

const FONTES = {
  netlify: {
    // Habilitação e Serviço/Classificação REAIS (versionadas em dados/vm; sem dados pessoais).
    // Profissionais continua simulado: a planilha real tem nome, CPF e CNS e nunca vai para o Netlify.
    hospitalar: {
      HJXXIII: {
        servico: join(REAIS, 'hospitalar', 'HJXXIII', 'Serviço e Classificação HJXXIII.xlsx'),
        habilitacao: join(REAIS, 'hospitalar', 'HJXXIII', 'Habilitações HJXXIII.xlsx'),
        profissionais: join(TESTE, 'teste Hospitalar', 'Profissionais HJXXIII (TESTE).xlsx'),
      },
      HIJPII: {
        servico: join(REAIS, 'hospitalar', 'HIJPII', 'Serviço Classificação HIJPII 1 (1).xlsx'),
        habilitacao: join(REAIS, 'hospitalar', 'HIJPII', 'Habilitacao HIJPII 1 (1).xlsx'),
      },
    },
    ambulatorial: {
      HRBJA: {
        profissionais: join(TESTE, 'teste Ambulatorial', 'Profissionais HRBJA (TESTE).xlsx'),
        carga_horaria: join(TESTE, 'teste Ambulatorial', 'Carga Horária HRBJA (TESTE).xlsx'),
        servico_classificacao: join(TESTE, 'teste Ambulatorial', 'Serviço Classificação HRBJA (TESTE).xlsx'),
        habilitacao: join(TESTE, 'teste Ambulatorial', 'Habilitações HRBJA (TESTE).xlsx'),
      },
    },
    checa: {
      adc: join(TESTE, 'teste ChecaProfissionais', 'Profissionais ADC (TESTE).xlsx'),
      cbo: join(TESTE, 'teste ChecaProfissionais', 'CBO_assistencial (TESTE).xlsx'),
    },
    exemplos: {
      hospitalar: [
        { papel: 'entrada_txt', arquivo: join(TESTE, 'teste Hospitalar', 'SISAIH01_HJXXIII_202609_TESTE.txt'), unidade: 'HJXXIII' },
        { papel: 'entrada_pdf', arquivo: join(TESTE, 'teste Hospitalar', 'Espelho_AIH_HJXXIII_202609_TESTE.pdf'), unidade: 'HJXXIII' },
      ],
      ambulatorial: [
        { papel: 'entrada', arquivo: join(TESTE, 'teste Ambulatorial', 'BPA_HRBJA_202610_TESTE.txt'), unidade: 'HRBJA' },
        { papel: 'entrada_alternativa', arquivo: join(TESTE, 'teste Ambulatorial', 'BPA_HRBJA_202610_CABECALHO_INCONSISTENTE.txt'), unidade: 'HRBJA' },
      ],
      checa: [
        { papel: 'tasy', arquivo: join(TESTE, 'teste ChecaProfissionais', 'Tasy Profissionais HIJPII (TESTE).xlsx'), unidade: 'HIJPII' },
        { papel: 'cnes', arquivo: join(TESTE, 'teste ChecaProfissionais', 'CNES Profissionais HIJPII (TESTE).xlsx'), unidade: 'HIJPII' },
        { papel: 'cnes_alternativo', arquivo: join(TESTE, 'teste ChecaProfissionais', 'CNES Profissionais HAC - UNIDADE ERRADA (TESTE).xlsx'), unidade: 'HIJPII' },
      ],
    },
  },
};

const cfg = FONTES[modo];
if (!cfg) throw new Error(`Modo desconhecido: ${modo} (use netlify ou vm)`);
const destino = join(RAIZ, 'dados', modo);

// No servidor de build (Netlify) as pastas vizinhas nao existem: usa o que ja
// esta versionado em dados/<modo>.
const fontes = [
  ...Object.values(cfg.hospitalar).flatMap(Object.values), ...Object.values(cfg.ambulatorial).flatMap(Object.values),
  ...Object.values(cfg.checa), ...Object.values(cfg.exemplos).flat().map((x) => x.arquivo),
];
if (!fontes.some((f) => existsSync(f))) {
  if (existsSync(join(destino, 'bases', 'manifest.json'))) {
    console.log(`Fontes de dados/${modo} não encontradas nesta máquina; mantendo os arquivos já preparados.`);
    process.exit(0);
  }
  throw new Error(`Nenhuma fonte encontrada para dados/${modo} e a pasta ainda não foi preparada.`);
}
rmSync(destino, { recursive: true, force: true });
mkdirSync(join(destino, 'bases'), { recursive: true });

const copiar = (origem, pastaRel) => {
  if (!existsSync(origem)) {
    console.warn(`  (ausente, ignorado) ${origem}`);
    return null;
  }
  // No site, os nomes saem sem a marca de teste: "Profissionais HJXXIII (TESTE).xlsx" -> "Profissionais HJXXIII.xlsx".
  const nome = basename(origem).replace(/\s*\(TESTE\)/gi, '').replace(/_TESTE(?=\.)/gi, '');
  const rel = `${pastaRel}/${nome}`;
  mkdirSync(join(destino, dirname(rel)), { recursive: true });
  cpSync(origem, join(destino, rel));
  return { nome, caminho: rel };
};

const manifest = { modo, gerado_em: new Date().toISOString(), hospitalar: {}, ambulatorial: {}, checa: {} };
for (const ferramenta of ['hospitalar', 'ambulatorial']) {
  for (const [sigla, bases] of Object.entries(cfg[ferramenta])) {
    manifest[ferramenta][sigla] = {};
    for (const [tipo, origem] of Object.entries(bases)) {
      const r = copiar(origem, `bases/${ferramenta}/${sigla}`);
      if (r) manifest[ferramenta][sigla][tipo] = r;
    }
  }
}
for (const [tipo, origem] of Object.entries(cfg.checa)) {
  const r = copiar(origem, 'bases/checa');
  if (r) manifest.checa[tipo] = r;
}
writeFileSync(join(destino, 'bases', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const exemplos = {};
for (const [ferramenta, itens] of Object.entries(cfg.exemplos)) {
  exemplos[ferramenta] = [];
  for (const item of itens) {
    const r = copiar(item.arquivo, `exemplos/${ferramenta}`);
    if (r) exemplos[ferramenta].push({ papel: item.papel, unidade: item.unidade, ...r });
  }
}
if (Object.keys(exemplos).length) writeFileSync(join(destino, 'exemplos', 'exemplos.json'), `${JSON.stringify(exemplos, null, 2)}\n`);
console.log(`dados/${modo} pronto.`);
