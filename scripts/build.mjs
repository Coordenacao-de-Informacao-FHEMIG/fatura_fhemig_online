// Build de producao em um dos dois modos.
//   node scripts/build.mjs netlify  -> dist/      (so dados sinteticos + modo demonstracao)
//   node scripts/build.mjs vm       -> dist-vm/   (bases reais das unidades; nao publicar fora da rede do Estado)
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

const modo = process.argv[2] || 'netlify';
if (!['netlify', 'vm'].includes(modo)) throw new Error('Use: node scripts/build.mjs netlify|vm');
execFileSync(process.execPath, ['scripts/preparar-dados.mjs', modo], { stdio: 'inherit' });
process.env.FATURA_MODO = modo;
await build({ build: { outDir: modo === 'vm' ? 'dist-vm' : 'dist', emptyOutDir: true } });
console.log(`Build ${modo} concluído em ${modo === 'vm' ? 'dist-vm' : 'dist'}/.`);
