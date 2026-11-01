export const CLOCK = Symbol('CLOCK');

/** Heure courante ; remplacée dans les tests pour faire avancer les tirages programmés. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
