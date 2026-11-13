// Configuracao da API por variaveis de ambiente (ver docs/IMPLANTACAO_VM.md).
import { resolve } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const lista = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export function lerConfig(env = process.env) {
  return {
    banco: env.FATURA_DB || resolve(RAIZ, 'dados-api', 'fatura.db'),
    host: env.FATURA_HOST || '127.0.0.1',
    porta: Number(env.FATURA_PORTA || 3001),
    cookieSeguro: env.FATURA_COOKIE_SEGURO !== '0',
    horasSessao: Number(env.FATURA_HORAS_SESSAO || 8),
    origens: lista(env.FATURA_ORIGENS),
    confiarProxy: env.FATURA_CONFIAR_PROXY === '1',
    log: env.FATURA_LOG !== '0',
  };
}
