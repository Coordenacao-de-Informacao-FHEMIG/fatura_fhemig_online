// Servidor de desenvolvimento em um dos dois modos.
//   node scripts/dev.mjs          -> modo netlify (bases sinteticas de teste + modo demonstracao)
//   node scripts/dev.mjs vm       -> modo vm (bases REAIS de dados/vm, so neste computador)
import { existsSync } from 'node:fs';
import { createServer } from 'vite';

const modo = process.argv[2] || 'netlify';
if (!['netlify', 'vm'].includes(modo)) throw new Error('Use: node scripts/dev.mjs netlify|vm');
if (modo === 'vm' && !existsSync('dados/vm/bases/manifest.json')) {
  throw new Error('dados/vm não existe neste computador. Copie a pasta dados/vm (fora do git) ou rode: node scripts/preparar-dados.mjs vm');
}
process.env.FATURA_MODO = modo;
const servidor = await createServer();
await servidor.listen();
servidor.printUrls();
console.log(`Modo ${modo}${modo === 'vm' ? ': bases REAIS das unidades (não publique este modo fora da rede do Estado).' : '.'}`);
