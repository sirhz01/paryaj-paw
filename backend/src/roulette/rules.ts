import { uint32Stream, uniformInt } from '../fairness/provably-fair';

/** Roulette européenne : 37 cases, de 0 à 36. */
export const POCKETS = 37;

/** Ordre des cases sur la roue, dans le sens horaire à partir du zéro. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29,
  7, 28, 12, 35, 3, 26,
];

export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

export type InsideBetType = 'straight' | 'split' | 'street' | 'corner' | 'line';
export type OutsideBetType = 'dozen' | 'column' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';
export type BetType = InsideBetType | OutsideBetType;
export type RacetrackBetType = 'voisins_du_zero' | 'tiers' | 'orphelins' | 'neighbors';

export const INSIDE_BET_TYPES: InsideBetType[] = ['straight', 'split', 'street', 'corner', 'line'];
export const OUTSIDE_BET_TYPES: OutsideBetType[] = ['dozen', 'column', 'red', 'black', 'even', 'odd', 'low', 'high'];
export const BET_TYPES: BetType[] = [...INSIDE_BET_TYPES, ...OUTSIDE_BET_TYPES];
export const RACETRACK_BET_TYPES: RacetrackBetType[] = ['voisins_du_zero', 'tiers', 'orphelins', 'neighbors'];

/** Gain net pour 1 misé (table européenne standard). */
export const PAYOUTS: Record<BetType, number> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
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

/** Mises simples, concernées par La Partage. */
export const EVEN_MONEY_BET_TYPES: BetType[] = ['red', 'black', 'even', 'odd', 'low', 'high'];

/** Mise telle qu'envoyée par le client : une position du tapis ou une annonce de la piste. */
export interface BetRequest {
  type: BetType | RacetrackBetType;
  /** Numéros de la position (mises intérieures) ou numéro central (`neighbors`). */
  numbers?: number[];
  /** 1, 2 ou 3 pour une douzaine ou une colonne. */
  index?: number;
  /** Montant sur la position ; pour une annonce de la piste, valeur d'un jeton. */
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
const isPocket = (n: number) => Number.isInteger(n) && n >= 0 && n < POCKETS;
const RED = new Set(RED_NUMBERS);
const EVEN_MONEY = new Set<BetType>(EVEN_MONEY_BET_TYPES);

/** Deux cases voisines sur le tapis : côte à côte dans une rangée, l'une sous l'autre, ou le zéro avec 1, 2 ou 3. */
function isSplit(low: number, high: number): boolean {
  if (low === 0) return high >= 1 && high <= 3;
  return isPocket(high) && (high === low + 3 || (high === low + 1 && low % 3 !== 0));
}

const SPLITS: number[][] = range(0, 35).flatMap((a) => range(a + 1, 36).filter((b) => isSplit(a, b)).map((b) => [a, b]));
const STREETS: number[][] = [...range(0, 11).map((k) => range(3 * k + 1, 3 * k + 3)), [0, 1, 2], [0, 2, 3]];
const CORNERS: number[][] = [
  [0, 1, 2, 3],
  ...range(1, 32)
    .filter((n) => n % 3 !== 0)
    .map((n) => [n, n + 1, n + 3, n + 4]),
];
const LINES: number[][] = range(0, 10).map((k) => range(3 * k + 1, 3 * k + 6));

/** Toutes les positions possibles d'une mise intérieure. */
export function insidePositions(type: InsideBetType): number[][] {
  switch (type) {
    case 'straight':
      return range(0, 36).map((n) => [n]);
    case 'split':
      return SPLITS;
    case 'street':
      return STREETS;
    case 'corner':
      return CORNERS;
    case 'line':
      return LINES;
  }
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

/** Annonces de la piste : [type, numéros, nombre de jetons]. */
type Announce = [BetType, number[], number][];

const VOISINS_DU_ZERO: Announce = [
  ['street', [0, 2, 3], 2],
  ['split', [4, 7], 1],
  ['split', [12, 15], 1],
  ['split', [18, 21], 1],
  ['split', [19, 22], 1],
  ['corner', [25, 26, 28, 29], 2],
  ['split', [32, 35], 1],
];
const TIERS: Announce = [
  ['split', [5, 8], 1],
  ['split', [10, 11], 1],
  ['split', [13, 16], 1],
  ['split', [23, 24], 1],
  ['split', [27, 30], 1],
  ['split', [33, 36], 1],
];
const ORPHELINS: Announce = [
  ['straight', [1], 1],
  ['split', [6, 9], 1],
  ['split', [14, 17], 1],
  ['split', [17, 20], 1],
  ['split', [31, 34], 1],
];

/** Déplie une annonce de la piste en mises du tapis ; `chipCents` est la valeur d'un jeton. */
export function expandRacetrack(type: RacetrackBetType, chipCents: number, center?: number): Bet[] {
  if (type === 'neighbors') {
    if (center === undefined || !isPocket(center)) throw new InvalidBetError('neighbors');
    const at = WHEEL_ORDER.indexOf(center);
    return [-2, -1, 0, 1, 2].map((offset) => ({
      type: 'straight' as const,
      numbers: [WHEEL_ORDER[(at + offset + POCKETS) % POCKETS]],
      amountCents: chipCents,
    }));
  }
  const announce = { voisins_du_zero: VOISINS_DU_ZERO, tiers: TIERS, orphelins: ORPHELINS }[type];
  return announce.map(([betType, numbers, chips]) => ({ type: betType, numbers, amountCents: chips * chipCents }));
}

function isRacetrack(type: string): type is RacetrackBetType {
  return (RACETRACK_BET_TYPES as string[]).includes(type);
}

/** Mises du tapis prêtes à jouer : annonces dépliées, positions identiques additionnées. */
export function normalizeBets(requests: readonly BetRequest[]): Bet[] {
  const merged = new Map<string, Bet>();
  const add = (bet: Bet) => {
    const key = `${bet.type}:${bet.numbers.join('-')}`;
    const existing = merged.get(key);
    if (existing) existing.amountCents += bet.amountCents;
    else merged.set(key, { ...bet, numbers: [...bet.numbers] });
  };

  for (const request of requests) {
    if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) {
      throw new InvalidBetError(request.type);
    }
    if (isRacetrack(request.type)) {
      const numbers = request.numbers ?? [];
      const expected = request.type === 'neighbors' ? 1 : 0;
      if (numbers.length !== expected || request.index !== undefined) throw new InvalidBetError(request.type);
      expandRacetrack(request.type, request.amountCents, numbers[0]).forEach(add);
      continue;
    }
    if (!(BET_TYPES as string[]).includes(request.type)) throw new InvalidBetError(request.type);
    const numbers = coverage(request.type, request.numbers, request.index);
    if (!numbers) throw new InvalidBetError(request.type);
    add({ type: request.type, numbers, amountCents: request.amountCents });
  }
  return [...merged.values()];
}

/** Montant rendu pour une mise : mise + gain si elle gagne, moitié de la mise simple sur le zéro avec La Partage. */
export function betReturn(bet: Bet, number: number, laPartage: boolean): number {
  if (bet.numbers.includes(number)) return bet.amountCents * (PAYOUTS[bet.type] + 1);
  if (number === 0 && laPartage && EVEN_MONEY.has(bet.type)) return Math.floor(bet.amountCents / 2);
  return 0;
}

/** Vrai si les mises couvrent les 37 cases (signal anti-blanchiment). */
export function coversAllPockets(bets: readonly Bet[]): boolean {
  return new Set(bets.flatMap((b) => b.numbers)).size === POCKETS;
}

export function colorOf(number: number): 'green' | 'red' | 'black' {
  if (number === 0) return 'green';
  return RED.has(number) ? 'red' : 'black';
}

/** Numéro tiré, uniforme sur 0–36, à partir des mêmes graines que le Keno (HMAC-SHA256). */
export function spinNumber(serverSeed: string, clientSeed: string, nonce: number): number {
  return uniformInt(uint32Stream(serverSeed, clientSeed, nonce), POCKETS);
}

const COVERAGE_SIZE: Record<BetType, number> = {
  straight: 1,
  split: 2,
  street: 3,
  corner: 4,
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

/** RTP théorique en % d'une mise de ce type : 97,30 %, 98,65 % pour une mise simple avec La Partage. */
export function rtpPercent(type: BetType, laPartage: boolean): number {
  const win = (COVERAGE_SIZE[type] / POCKETS) * (PAYOUTS[type] + 1);
  const partage = laPartage && EVEN_MONEY.has(type) ? 0.5 / POCKETS : 0;
  return 100 * (win + partage);
}
