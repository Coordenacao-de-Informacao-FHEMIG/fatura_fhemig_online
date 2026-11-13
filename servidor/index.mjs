// Inicia a API da Área do gestor.  Uso: npm run api   (ou npm run api:dev, sem cookie Secure, para testes locais)
import { abrirBanco } from './banco.mjs';
import { construirApp } from './app.mjs';
import { lerConfig } from './config.mjs';

const cfg = lerConfig();
if (process.argv.includes('--dev')) cfg.cookieSeguro = false; // http://localhost em testes
const banco = abrirBanco(cfg.banco);
const app = construirApp({ banco, config: cfg });

const encerrar = async () => {
  await app.close();
  banco.fechar();
  process.exit(0);
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

await app.listen({ host: cfg.host, port: cfg.porta });
app.log.info(`Banco: ${cfg.banco} · cookie Secure: ${cfg.cookieSeguro ? 'sim' : 'NÃO (só para testes locais)'}`);
