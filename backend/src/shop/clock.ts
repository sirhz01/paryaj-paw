import { HAITI_TIME_ZONE } from '../common/haiti';
import { ShopGame, TIMINGS } from './games';

/** Horloge injectable : les tests la remplacent pour avancer dans les tours. */
export const SHOP_CLOCK = Symbol('SHOP_CLOCK');
export interface ShopClock {
  now(): number;
}
export const systemClock: ShopClock = { now: () => Date.now() };

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HAITI_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function haitiFields(ms: number): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const p = Object.fromEntries(formatter.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Jour d'Haïti (AAAA-MM-JJ) de l'instant `ms`. */
export function dayKeyOf(ms: number): string {
  const { y, m, d } = haitiFields(ms);
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function nextDayKey(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Instant (ms) de minuit, heure d'Haïti, au début du jour `day`. */
export function dayStartMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const f = haitiFields(guess);
    const shown = Date.UTC(f.y, f.m - 1, f.d, f.h, f.mi, f.s);
    guess += wall - shown;
  }
  return guess;
}

export type Phase = 'bet' | 'draw' | 'result';

export interface RoundState {
  game: ShopGame;
  day: string;
  round: number;
  phase: Phase;
  /** Secondes écoulées dans la phase, durée de la phase, secondes restantes. */
  t: number;
  dur: number;
  left: number;
  startMs: number;
  drawStartMs: number;
  drawEndMs: number;
  /** Début du tour suivant (minuit pour le dernier tour du jour). */
  nextStartMs: number;
}

export function cycleSeconds(game: ShopGame): number {
  const { bet, draw, result } = TIMINGS[game];
  return bet + draw + result;
}

/** Nombre de tours complets dans le jour ; le reste de la journée prolonge le dernier résultat. */
export function roundsInDay(game: ShopGame, day: string): number {
  return Math.floor((dayStartMs(nextDayKey(day)) - dayStartMs(day)) / (cycleSeconds(game) * 1000));
}

export function roundWindow(game: ShopGame, day: string, round: number) {
  const { bet, draw } = TIMINGS[game];
  const cycle = cycleSeconds(game) * 1000;
  const startMs = dayStartMs(day) + (round - 1) * cycle;
  return {
    startMs,
    drawStartMs: startMs + bet * 1000,
    drawEndMs: startMs + (bet + draw) * 1000,
    nextStartMs: round === roundsInDay(game, day) ? dayStartMs(nextDayKey(day)) : startMs + cycle,
  };
}

export function stateAt(game: ShopGame, ms: number): RoundState {
  const day = dayKeyOf(ms);
  const cycle = cycleSeconds(game) * 1000;
  const round = Math.min(Math.floor((ms - dayStartMs(day)) / cycle) + 1, roundsInDay(game, day));
  const w = roundWindow(game, day, round);
  const { bet, draw } = TIMINGS[game];
  const elapsed = ms - w.startMs;
  let phase: Phase, pt: number, dur: number;
  if (elapsed < bet * 1000) {
    phase = 'bet'; pt = elapsed; dur = bet * 1000;
  } else if (elapsed < (bet + draw) * 1000) {
    phase = 'draw'; pt = elapsed - bet * 1000; dur = draw * 1000;
  } else {
    phase = 'result'; pt = elapsed - (bet + draw) * 1000; dur = w.nextStartMs - w.drawEndMs;
  }
  return { game, day, round, phase, t: pt / 1000, dur: dur / 1000, left: (dur - pt) / 1000, ...w };
}
