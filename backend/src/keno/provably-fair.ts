import { drawWithoutReplacement, uint32Stream } from '../fairness/provably-fair';

export const GRID_SIZE = 80;
export const DRAW_SIZE = 20;

/** Tirage vérifiable : 20 numéros distincts de 1 à 80, dans l'ordre de sortie. */
export function drawNumbers(serverSeed: string, clientSeed: string, nonce: number): number[] {
  return drawWithoutReplacement(uint32Stream(serverSeed, clientSeed, nonce), GRID_SIZE, DRAW_SIZE);
}

export function countHits(picks: readonly number[], drawn: readonly number[]): number {
  const drawnSet = new Set(drawn);
  return picks.filter((n) => drawnSet.has(n)).length;
}
