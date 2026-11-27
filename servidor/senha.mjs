// Hash de senha com scrypt (node:crypto, sem dependencia nativa).
// Formato: scrypt$N$r$p$salt(base64)$hash(base64)
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const TAMANHO = 64;
const maxmem = 128 * PARAMS.N * PARAMS.r * 2;

export async function gerarHash(senha) {
  const salt = randomBytes(16);
  const hash = await scrypt(senha.normalize('NFKC'), salt, TAMANHO, { ...PARAMS, maxmem });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Hash descartavel para gastar o mesmo tempo quando o usuario nao existe (evita descobrir e-mails pelo tempo).
let hashFalso = null;

export async function conferirSenha(senha, armazenado) {
  if (!armazenado) {
    hashFalso ??= await gerarHash('senha-inexistente');
    await conferirSenha(senha, hashFalso);
    return false;
  }
  const [alg, N, r, p, salt, hash] = armazenado.split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const obtido = await scrypt(String(senha).normalize('NFKC'), Buffer.from(salt, 'base64'), esperado.length, { N: +N, r: +r, p: +p, maxmem: 128 * +N * +r * 2 });
  return timingSafeEqual(esperado, obtido);
}

// Sem caracteres que se confundem ao ditar ou copiar (0/O, 1/l/I).
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Senha provisoria legivel, no formato xxxx-xxxx-xxxx, sempre com letra e numero. */
export function gerarSenhaTemporaria() {
  for (;;) {
    const blocos = [0, 1, 2].map(() => Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join(''));
    const senha = blocos.join('-');
    if (!senhaFraca(senha)) return senha;
  }
}

/** Regra minima para senhas locais (quando nao houver AD/SSO). */
export function senhaFraca(senha) {
  if (typeof senha !== 'string' || senha.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) return 'A senha precisa ter letras e números.';
  return null;
}
