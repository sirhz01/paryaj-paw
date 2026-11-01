import { cycleSeconds, dayKeyOf, dayStartMs, nextDayKey, roundWindow, roundsInDay, stateAt } from './clock';

// Haïti : UTC−5 en hiver (EST), UTC−4 en été (EDT).
describe('jour d\'Haïti', () => {
  it('minuit à Port-au-Prince', () => {
    expect(dayStartMs('2026-01-15')).toBe(Date.UTC(2026, 0, 15, 5));
    expect(dayStartMs('2026-07-15')).toBe(Date.UTC(2026, 6, 15, 4));
  });

  it('change de jour à minuit local, pas à minuit UTC', () => {
    expect(dayKeyOf(Date.UTC(2026, 0, 15, 4, 59, 59))).toBe('2026-01-14');
    expect(dayKeyOf(Date.UTC(2026, 0, 15, 5, 0, 0))).toBe('2026-01-15');
  });

  it('nextDayKey passe les fins de mois et d\'année', () => {
    expect(nextDayKey('2026-01-31')).toBe('2026-02-01');
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01');
  });

  it('un jour qui change d\'heure a 23 ou 25 heures', () => {
    const hours = (day: string) => (dayStartMs(nextDayKey(day)) - dayStartMs(day)) / 3_600_000;
    expect(hours('2026-01-15')).toBe(24);
    expect([23, 24, 25]).toContain(hours('2026-03-08'));
  });
});

describe('tours', () => {
  const midnight = dayStartMs('2026-11-02');

  it('découpe le jour en cycles : mises, tirage, résultat', () => {
    // Roulette : 25 s de mises, 11 s de tirage, 8 s de résultat, soit 44 s.
    expect(cycleSeconds('roulette')).toBe(44);
    const at = (s: number) => stateAt('roulette', midnight + s * 1000);
    expect(at(0)).toMatchObject({ round: 1, phase: 'bet', t: 0, left: 25 });
    expect(at(24.9)).toMatchObject({ round: 1, phase: 'bet' });
    expect(at(25)).toMatchObject({ round: 1, phase: 'draw' });
    expect(at(36)).toMatchObject({ round: 1, phase: 'result', left: 8 });
    expect(at(44)).toMatchObject({ round: 2, phase: 'bet', t: 0 });
    expect(at(44 * 99 + 30)).toMatchObject({ round: 100, phase: 'draw' });
  });

  it('le dernier tour du jour garde son résultat jusqu\'à minuit', () => {
    const n = roundsInDay('roulette', '2026-11-02');
    expect(n).toBe(Math.floor(86400 / 44));
    const end = dayStartMs('2026-11-03');
    const last = stateAt('roulette', end - 1);
    expect(last).toMatchObject({ day: '2026-11-02', round: n, phase: 'result' });
    expect(last.nextStartMs).toBe(end);
    expect(stateAt('roulette', end)).toMatchObject({ day: '2026-11-03', round: 1, phase: 'bet' });
  });

  it('roundWindow est cohérent avec stateAt', () => {
    const w = roundWindow('keno', '2026-11-02', 10);
    const s = stateAt('keno', w.drawStartMs);
    expect(s).toMatchObject({ day: '2026-11-02', round: 10, phase: 'draw', startMs: w.startMs, drawEndMs: w.drawEndMs });
  });
});
