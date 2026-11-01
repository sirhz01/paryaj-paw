import { cycleSeconds, dayStartMs, roundWindow, roundsInDay, setTimingsProvider, stateAt } from './clock';
import { TIMINGS, Timings, validateTimings } from './games';

describe('durées des tours', () => {
  afterEach(() => setTimingsProvider(() => TIMINGS));

  const custom: Timings = { ...TIMINGS, keno: { bet: 40, draw: 30, result: 10 } };

  it('accepte les valeurs par défaut et des durées raisonnables', () => {
    expect(validateTimings(TIMINGS)).toEqual([]);
    expect(validateTimings(custom)).toEqual([]);
  });

  it('refuse un tirage plus court que l’animation, des mises trop courtes, des valeurs non entières', () => {
    expect(validateTimings({ ...TIMINGS, keno: { bet: 20, draw: 10, result: 8 } })).not.toEqual([]);
    expect(validateTimings({ ...TIMINGS, roulette: { bet: 3, draw: 11, result: 8 } })).not.toEqual([]);
    expect(validateTimings({ ...TIMINGS, luckyx: { bet: 20.5, draw: 24, result: 8 } })).not.toEqual([]);
    expect(validateTimings({ roulette: TIMINGS.roulette })).not.toEqual([]);
    expect(validateTimings(null)).not.toEqual([]);
  });

  it('chaque jour utilise ses propres durées : le jour en cours ne bouge pas quand le lendemain change', () => {
    const today = '2026-11-02';
    const tomorrow = '2026-11-03';
    setTimingsProvider((day) => (day >= tomorrow ? custom : TIMINGS));

    expect(cycleSeconds('keno', today)).toBe(58);
    expect(cycleSeconds('keno', tomorrow)).toBe(80);
    // Aujourd'hui : 58 s par tour comme avant.
    expect(roundWindow('keno', today, 3).startMs).toBe(dayStartMs(today) + 2 * 58_000);
    // Demain : 80 s par tour, et les tours de la veille restent calculés avec les durées de la veille.
    expect(roundWindow('keno', tomorrow, 3).startMs).toBe(dayStartMs(tomorrow) + 2 * 80_000);
    expect(roundsInDay('keno', today)).not.toBe(roundsInDay('keno', tomorrow));
    expect(stateAt('keno', dayStartMs(tomorrow) + 30_000)).toMatchObject({ day: tomorrow, round: 1, phase: 'bet' });
    expect(stateAt('keno', dayStartMs(tomorrow) - 1_000)).toMatchObject({ day: today, phase: 'result' });
  });
});
