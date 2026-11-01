import {
  DEFAULT_PAYTABLE,
  RTP_MAX_PERCENT,
  RTP_MIN_PERCENT,
  hitProbability,
  payoutCents,
  rtpPercent,
  validatePaytable,
} from './paytable';

describe('hitProbability', () => {
  it('somme à 1 pour chaque nombre de numéros choisis', () => {
    for (let picks = 1; picks <= 10; picks++) {
      let total = 0;
      for (let hits = 0; hits <= picks; hits++) total += hitProbability(picks, hits);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('vaut 20/80 pour un seul numéro trouvé', () => {
    expect(hitProbability(1, 1)).toBeCloseTo(0.25, 12);
  });
});

describe('rtpPercent', () => {
  it("donne 75 % pour l'exemple du cahier des charges à 1 numéro (3×)", () => {
    expect(rtpPercent([0, 3])).toBeCloseTo(75, 10);
  });

  it('place la table par défaut entre 90 et 95 % pour 1 à 10 numéros', () => {
    for (const row of Object.values(DEFAULT_PAYTABLE)) {
      const rtp = rtpPercent(row);
      expect(rtp).toBeGreaterThanOrEqual(RTP_MIN_PERCENT);
      expect(rtp).toBeLessThanOrEqual(RTP_MAX_PERCENT);
    }
  });
});

describe('validatePaytable', () => {
  it('accepte la table par défaut', () => {
    expect(validatePaytable(DEFAULT_PAYTABLE, 10)).toEqual([]);
  });

  it('refuse un RTP hors plage, une ligne de mauvaise longueur ou plus de 2 décimales', () => {
    expect(validatePaytable({ '1': [0, 3] }, 1)[0]).toMatch(/RTP 75\.00/);
    expect(validatePaytable({ '1': [0, 3.7, 1] }, 1)[0]).toMatch(/2 coefficients/);
    expect(validatePaytable({ '1': [0, 3.701] }, 1)[0]).toMatch(/2 décimales/);
    expect(validatePaytable({ '1': [0, 3.7], '2': [0, 1, 9.1] }, 1)[0]).toMatch(/clé inattendue/);
  });
});

describe('payoutCents', () => {
  it('arrondit au centime inférieur et applique le plafond', () => {
    expect(payoutCents(1000, 3.7, 1_000_000)).toBe(3700);
    expect(payoutCents(333, 1.1, 1_000_000)).toBe(366);
    expect(payoutCents(500_000, 10_000, 100_000_000)).toBe(100_000_000);
    expect(payoutCents(1000, 0, 1_000_000)).toBe(0);
  });
});
