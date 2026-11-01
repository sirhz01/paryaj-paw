import { uint32Stream, uniformInt } from '../fairness/provably-fair';

export const GRID_SIZE = 80;
export const DRAW_SIZE = 20;

/**
 * Tirage vérifiable : 20 numéros distincts de 1 à 80, dans l'ordre de sortie.
 * Pour la position i, avec n = 80 − i numéros restants, i + uniformInt(n) désigne
 * le numéro échangé avec la position i (mélange de Fisher-Yates partiel).
 */
export function drawNumbers(serverSeed: string, clientSeed: string, nonce: number): number[] {
  const pool = Array.from({ length: GRID_SIZE }, (_, i) => i + 1);
  const next = uint32Stream(serverSeed, clientSeed, nonce);
  for (let i = 0; i < DRAW_SIZE; i++) {
    const j = i + uniformInt(next, GRID_SIZE - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, DRAW_SIZE);
}

export function countHits(picks: readonly number[], drawn: readonly number[]): number {
  const drawnSet = new Set(drawn);
  return picks.filter((n) => drawnSet.has(n)).length;
}
