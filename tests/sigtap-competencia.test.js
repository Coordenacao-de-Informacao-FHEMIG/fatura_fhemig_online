import { describe, expect, it } from 'vitest';
import { escolherSigtapPorCompetencia } from '../src/engine/sigtap/sigtap.js';

const bases = [
  { id: 'a', tipo: 'txt', competencia: '202609' },
  { id: 'b', tipo: 'xlsx', competencia: '202610' },
  { id: 'c', tipo: 'txt', competencia: '202610' },
  { id: 'd', tipo: 'txt', competencia: '202612' },
];

describe('escolha automática do SIGTAP', () => {
  it('usa a mesma competência, preferindo o TXT do DATASUS', () => {
    expect(escolherSigtapPorCompetencia(bases, '202610').id).toBe('c');
  });
  it('sem a mesma competência, usa a anterior mais próxima', () => {
    expect(escolherSigtapPorCompetencia(bases, '202611').id).toBe('c');
    expect(escolherSigtapPorCompetencia(bases, '202701').id).toBe('d');
  });
  it('sem anterior, usa a posterior mais antiga', () => {
    expect(escolherSigtapPorCompetencia(bases, '202601').id).toBe('a');
  });
  it('sem competência na produção, usa a mais recente', () => {
    expect(escolherSigtapPorCompetencia(bases, '').id).toBe('d');
  });
  it('sem bases, devolve null', () => {
    expect(escolherSigtapPorCompetencia([], '202610')).toBeNull();
  });
});
