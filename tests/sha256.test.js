// SHA-256 sem Web Crypto: a VM aberta por http:// não tem crypto.subtle e o Checa parava com
// "Cannot read properties of undefined (reading 'digest')".
import { createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Puro } from '../src/engine/comum/sha256.js';
import { sha256Hex } from '../src/engine/comum/planilha.js';

const hexNode = (b) => createHash('sha256').update(b).digest('hex');
const hex = (u8) => Buffer.from(u8).toString('hex');

describe('sha256Puro', () => {
  it('vetores conhecidos (FIPS 180-4)', () => {
    expect(hex(sha256Puro(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256Puro(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('igual ao Node em tamanhos nas bordas do bloco e em arquivo grande', () => {
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 3 * 1024 * 1024 + 7]) {
      const b = randomBytes(n);
      expect(hex(sha256Puro(new Uint8Array(b)))).toBe(hexNode(b));
    }
  });
});

describe('sha256Hex sem crypto.subtle (página em http://)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calcula em JS e dá o mesmo resultado do Web Crypto', async () => {
    const b = new Uint8Array(randomBytes(200000));
    const comSubtle = await sha256Hex(b);
    vi.stubGlobal('crypto', {});
    expect(globalThis.crypto.subtle).toBeUndefined();
    expect(await sha256Hex(b)).toBe(comSubtle);
    expect(comSubtle).toBe(hexNode(b));
  });
});
