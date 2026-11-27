// Servidor de desenvolvimento em um dos dois modos.
//   node scripts/dev.mjs          -> modo netlify (bases sinteticas de teste + modo demonstracao)
//   node scripts/dev.mjs vm       -> modo vm (bases REAIS de dados/vm, so neste computador)
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const modo = process.argv[2] || 'netlify';
if (!['netlify', 'vm'].includes(modo)) throw new Error('Use: node scripts/dev.mjs netlify|vm');
// No modo vm o manifest e refeito a cada inicio, a partir do que estiver em dados/vm/bases.
if (modo === 'vm') execFileSync(process.execPath, ['scripts/preparar-dados.mjs', 'vm'], { stdio: 'inherit' });
process.env.FATURA_MODO = modo;
const servidor = await createServer();
await servidor.listen();
servidor.printUrls();
console.log(`Modo ${modo}${modo === 'vm' ? ': bases REAIS das unidades (não publique este modo fora da rede do Estado).' : '.'}`);
