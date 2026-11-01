import { uint32Stream, uniformInt } from '../fairness/provably-fair';

/** Roulette américaine : 38 cases, de 0 à 36 plus le 00, représenté par la case 37. */
export const POCKETS = 38;
export const DOUBLE_ZERO = 37;

/** Ordre des cases sur la roue, dans le sens horaire à partir du zéro. */
export const WHEEL_ORDER = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, DOUBLE_ZERO, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6,
  21, 33, 16, 4, 23, 35, 14, 2,
];

export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

export type InsideBetType = 'straight' | 'split' | 'street' | 'corner' | 'top_line' | 'line';
export type OutsideBetType = 'dozen' | 'column' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';
export type BetType = InsideBetType | OutsideBetType;

export const INSIDE_BET_TYPES: InsideBetType[] = ['straight', 'split', 'street', 'corner', 'top_line', 'line'];
export const OUTSIDE_BET_TYPES: OutsideBetType[] = ['dozen', 'column', 'red', 'black', 'even', 'odd', 'low', 'high'];
export const BET_TYPES: BetType[] = [...INSIDE_BET_TYPES, ...OUTSIDE_BET_TYPES];

/** Gain net pour 1 misé (table américaine standard). */
export const PAYOUTS: Record<BetType, number> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  top_line: 6,
  line: 5,
  dozen: 2,
  column: 2,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
};

/** Mise telle qu'envoyée par le client : une position du tapis. */
export interface BetRequest {
  type: BetType;
  /** Numéros de la position (mises intérieures, 37 = 00). */
  numbers?: number[];
  /** 1, 2 ou 3 pour une douzaine ou une colonne. */
  index?: number;
  amountCents: number;
}

/** Mise sur une position du tapis, avec les numéros qu'elle couvre. */
export interface Bet {
  type: BetType;
  numbers: number[];
  amountCents: number;
}

export class InvalidBetError extends Error {}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const RED = new Set(RED_NUMBERS);

/** Chevaux entre deux numéros de 1 à 36 : côte à côte dans une rangée ou l'un sous l'autre. */
const TABLE_SPLITS: number[][] = range(1, 35).flatMap((a) =>
  [a + 1, a + 3].filter((b) => b <= 36 && (b === a + 3 || a % 3 !== 0)).map((b) => [a, b]),
);

const POSITIONS: Record<InsideBetType, number[][]> = {
  straight: range(0, 37).map((n) => [n]),
  // 0 touche 1 et 2, 00 touche 2 et 3, et 0-00 se jouent à cheval.
  split: [[0, 1], [0, 2], [0, DOUBLE_ZERO], [2, DOUBLE_ZERO], [3, DOUBLE_ZERO], ...TABLE_SPLITS],
  street: [...range(0, 11).map((k) => range(3 * k + 1, 3 * k + 3)), [0, 1, 2], [2, 3, DOUBLE_ZERO]],
  corner: range(1, 32)
    .filter((n) => n % 3 !== 0)
    .map((n) => [n, n + 1, n + 3, n + 4]),
  top_line: [[0, 1, 2, 3, DOUBLE_ZERO]],
  line: range(0, 10).map((k) => range(3 * k + 1, 3 * k + 6)),
};

/** Toutes les positions possibles d'une mise intérieure. */
export function insidePositions(type: InsideBetType): number[][] {
  return POSITIONS[type];
}

/** Numéros couverts par une mise du tapis ; null si la combinaison n'existe pas. */
export function coverage(type: BetType, numbers: readonly number[] = [], index?: number): number[] | null {
  const isInside = (INSIDE_BET_TYPES as string[]).includes(type);
  const usesIndex = type === 'dozen' || type === 'column';
  if ((!isInside && numbers.length > 0) || (!usesIndex && index !== undefined)) return null;

  if (isInside) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const same = (position: number[]) => position.length === sorted.length && position.every((n, i) => n === sorted[i]);
    return insidePositions(type as InsideBetType).some(same) ? sorted : null;
  }
  if (usesIndex && (index === undefined || ![1, 2, 3].includes(index))) return null;

  const all = range(1, 36);
  switch (type as OutsideBetType) {
    case 'dozen':
      return range(12 * (index! - 1) + 1, 12 * index!);
    case 'column':
      return all.filter((n) => n % 3 === index! % 3);
    case 'red':
      return all.filter((n) => RED.has(n));
    case 'black':
      return all.filter((n) => !RED.has(n));
    case 'even':
      return all.filter((n) => n % 2 === 0);
    case 'odd':
      return all.filter((n) => n % 2 === 1);
    case 'low':
      return range(1, 18);
    case 'high':
      return range(19, 36);
  }
}

/** Mises du tapis prêtes à jouer, les positions identiques additionnées. */
export function normalizeBets(requests: readonly BetRequest[]): Bet[] {
  const merged = new Map<string, Bet>();
  for (const request of requests) {
    if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) throw new InvalidBetError(request.type);
    if (!(BET_TYPES as string[]).includes(request.type)) throw new InvalidBetError(request.type);
    const numbers = coverage(request.type, request.numbers, request.index);
    if (!numbers) throw new InvalidBetError(request.type);

    const key = `${request.type}:${numbers.join('-')}`;
    const existing = merged.get(key);
    if (existing) existing.amountCents += request.amountCents;
    else merged.set(key, { type: request.type, numbers, amountCents: request.amountCents });
  }
  return [...merged.values()];
}

/** Montant rendu pour une mise : mise + gain si elle gagne, rien sinon (pas de La Partage ni d'En Prison). */
export function betReturn(bet: Bet, number: number): number {
  return bet.numbers.includes(number) ? bet.amountCents * (PAYOUTS[bet.type] + 1) : 0;
}

/** Vrai si les mises couvrent les 38 cases (signal anti-blanchiment). */
export function coversAllPockets(bets: readonly Bet[]): boolean {
  return new Set(bets.flatMap((b) => b.numbers)).size === POCKETS;
}

export function colorOf(number: number): 'green' | 'red' | 'black' {
  if (number === 0 || number === DOUBLE_ZERO) return 'green';
  return RED.has(number) ? 'red' : 'black';
}

/** Libellé affiché : « 00 » pour la case 37. */
export function pocketLabel(number: number): string {
  return number === DOUBLE_ZERO ? '00' : String(number);
}

/** Case tirée, uniforme sur les 38 cases, à partir des graines du joueur (HMAC-SHA256). */
export function spinNumber(serverSeed: string, clientSeed: string, nonce: number): number {
  return uniformInt(uint32Stream(serverSeed, clientSeed, nonce), POCKETS);
}

const COVERAGE_SIZE: Record<BetType, number> = {
  straight: 1,
  split: 2,
  street: 3,
  corner: 4,
  top_line: 5,
  line: 6,
  dozen: 12,
  column: 12,
  red: 18,
  black: 18,
  even: 18,
  odd: 18,
  low: 18,
  high: 18,
};

/** RTP théorique en % d'une mise : 94,74 % (36/38), et 92,11 % pour la top line (35/38). */
export function rtpPercent(type: BetType): number {
  return (100 * COVERAGE_SIZE[type] * (PAYOUTS[type] + 1)) / POCKETS;
}
