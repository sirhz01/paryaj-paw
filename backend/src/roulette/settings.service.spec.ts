import { BET_TYPES } from './rules';
import { RouletteSettingsInput, validateRouletteSettings } from './settings.service';

const valid: RouletteSettingsInput = {
  chipValuesCents: [1000, 2500, 5000],
  betLimits: Object.fromEntries(BET_TYPES.map((t) => [t, { minCents: 1000, maxCents: 50000 }])) as RouletteSettingsInput['betLimits'],
  maxTotalStakeCents: 5_000_000,
  maxPayoutCents: 100_000_000,
  topLineEnabled: true,
};

describe('validateRouletteSettings', () => {
  it('accepte des paramètres complets', () => {
    expect(validateRouletteSettings(valid)).toEqual([]);
    expect(validateRouletteSettings({ ...valid, topLineEnabled: false })).toEqual([]);
  });

  it('refuse des jetons vides, non croissants ou non entiers', () => {
    expect(validateRouletteSettings({ ...valid, chipValuesCents: [] })).toHaveLength(1);
    expect(validateRouletteSettings({ ...valid, chipValuesCents: [2500, 1000] })[0]).toMatch(/croissants/);
    expect(validateRouletteSettings({ ...valid, chipValuesCents: [10.5] })).toHaveLength(1);
  });

  it('exige une limite valide pour chaque type de mise, top line comprise, et seulement eux', () => {
    const { top_line: _, ...withoutTopLine } = valid.betLimits;
    expect(validateRouletteSettings({ ...valid, betLimits: withoutTopLine as never })[0]).toMatch(/^top_line/);
    expect(
      validateRouletteSettings({ ...valid, betLimits: { ...valid.betLimits, split: { minCents: 5000, maxCents: 1000 } } })[0],
    ).toMatch(/^split/);
    expect(
      validateRouletteSettings({ ...valid, betLimits: { ...valid.betLimits, jackpot: { minCents: 1, maxCents: 2 } } as never })[0],
    ).toMatch(/inconnue/);
  });

  it('refuse des plafonds absents et une top line non booléenne', () => {
    const errors = validateRouletteSettings({ ...valid, maxTotalStakeCents: 0, maxPayoutCents: -1, topLineEnabled: 'oui' as never });
    expect(errors).toHaveLength(3);
  });
});
