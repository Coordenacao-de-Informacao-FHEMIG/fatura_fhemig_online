// Build do Fatura Fhemig Online.
//   FATURA_MODO=netlify (padrao): publica so as bases sinteticas de teste e o modo demonstracao.
//   FATURA_MODO=vm: publica as bases reais das unidades (dados/vm), sem exemplos.
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { cpSync, existsSync, createReadStream, statSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, normalize, dirname } from 'node:path';
import { CABECALHOS_SEGURANCA } from './seguranca.js';

const RAIZ = import.meta.dirname;
const MODO = process.env.FATURA_MODO || 'netlify';
const DADOS = resolve(RAIZ, 'dados', MODO);

/** Todos os "caminho" do bases/manifest.json (hospitalar, ambulatorial e checa). */
function caminhosDoManifest(no) {
  if (!no || typeof no !== 'object') return [];
  if (typeof no.caminho === 'string') return [no.caminho];
  return Object.values(no).flatMap(caminhosDoManifest);
}

/** Serve /bases e /exemplos de dados/<modo> no dev e copia para a saida no build. */
function dadosDoModo() {
  let saida = resolve(RAIZ, 'dist');
  return {
    name: 'fatura-dados-do-modo',
    configResolved(config) {
      saida = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0]);
        if (!url.startsWith('/bases/') && !url.startsWith('/exemplos/')) return next();
        const arquivo = normalize(join(DADOS, url));
        if (!arquivo.startsWith(DADOS) || !existsSync(arquivo) || !statSync(arquivo).isFile()) return next();
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(arquivo).pipe(res);
      });
    },
    closeBundle() {
      const manifesto = join(DADOS, 'bases', 'manifest.json');
      if (!existsSync(manifesto)) throw new Error(`dados/${MODO}/bases/manifest.json não existe. Rode: node scripts/preparar-dados.mjs ${MODO}`);
      // Das bases, vai para o build so o que o manifest lista: um arquivo solto
      // em dados/<modo>/bases (planilha antiga, copia) nunca e publicado.
      const caminhos = ['bases/manifest.json', ...caminhosDoManifest(JSON.parse(readFileSync(manifesto, 'utf8')))];
      for (const rel of caminhos) {
        const destino = join(saida, rel);
        mkdirSync(dirname(destino), { recursive: true });
        cpSync(join(DADOS, rel), destino);
      }
      if (existsSync(join(DADOS, 'exemplos'))) cpSync(join(DADOS, 'exemplos'), join(saida, 'exemplos'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), dadosDoModo()],
  define: {
    __MODO__: JSON.stringify(MODO),
    __VERSAO__: JSON.stringify('1.0.0'),
  },
  worker: { format: 'es' },
  // assetsInlineLimit 0: nada vira data: URI (a CSP so aceita fontes e imagens do proprio site).
  build: { target: 'es2022', chunkSizeWarningLimit: 2500, sourcemap: false, assetsInlineLimit: 0 },
  // /api vai para a API local (npm run api:dev). Mesmo dominio: a CSP continua connect-src 'self'.
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } } },
  // O preview usa os mesmos cabecalhos de seguranca do Netlify e da VM.
  preview: { port: 4173, headers: CABECALHOS_SEGURANCA, proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } } },
});
