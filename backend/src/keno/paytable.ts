import { DRAW_SIZE, GRID_SIZE } from './provably-fair';

/** Coefficients par nombre de numéros choisis ("1" à "15") ; l'indice du tableau = numéros trouvés. */
export type Paytable = Record<string, number[]>;

/** Le cahier des charges autorise un plafond jusqu'à 15 ; la table par défaut s'arrête à 10. */
export const MAX_PICKS_LIMIT = 15;
export const RTP_MIN_PERCENT = 90;
export const RTP_MAX_PERCENT = 95;

/** Identique à la table insérée par migrations/001_init.sql. */
export const DEFAULT_PAYTABLE: Paytable = {
  '1': [0, 3.7],
  '2': [0, 1, 9.1],
  '3': [0, 0, 3, 37],
  '4': [0, 0, 1.4, 6.8, 110],
  '5': [0, 0, 0.6, 3.3, 17, 440],
  '6': [0, 0, 0, 2, 7.9, 79, 1500],
  '7': [0, 0, 0, 1.1, 4.5, 23, 225, 5650],
  '8': [0, 0, 0, 0.5, 2.2, 11, 88, 1100, 10000],
  '9': [0, 0, 0, 0.5, 1.6, 5.4, 33, 270, 2700, 10000],
  '10': [1.1, 0, 0, 0, 1.1, 3.3, 16, 110, 1100, 5400, 10000],
};

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

/** Probabilité de trouver `hits` numéros sur `picks` choisis (loi hypergéométrique). */
export function hitProbability(picks: number, hits: number): number {
  return (binomial(DRAW_SIZE, hits) * binomial(GRID_SIZE - DRAW_SIZE, picks - hits)) / binomial(GRID_SIZE, picks);
}

/** RTP théorique en %, hors plafond de gain. */
export function rtpPercent(multipliers: readonly number[]): number {
  const picks = multipliers.length - 1;
  return 100 * multipliers.reduce((sum, m, hits) => sum + m * hitProbability(picks, hits), 0);
}

export function rtpByPicks(table: Paytable): Record<string, number> {
  return Object.fromEntries(Object.entries(table).map(([picks, row]) => [picks, rtpPercent(row)]));
}

/** Liste des problèmes ; vide si la table est utilisable avec `maxPicks`. */
export function validatePaytable(table: unknown, maxPicks: number): string[] {
  if (typeof table !== 'object' || table === null || Array.isArray(table)) return ['paytable doit être un objet'];
  const errors: string[] = [];
  const rows = table as Record<string, unknown>;
  for (const key of Object.keys(rows)) {
    const picks = Number(key);
    if (!Number.isInteger(picks) || picks < 1 || picks > maxPicks) errors.push(`clé inattendue : ${key}`);
  }
  for (let picks = 1; picks <= maxPicks; picks++) {
    const row = rows[String(picks)];
    if (!Array.isArray(row) || row.length !== picks + 1) {
      errors.push(`${picks} numéros : ${picks + 1} coefficients attendus`);
      continue;
    }
    if (!row.every((m) => typeof m === 'number' && Number.isFinite(m) && m >= 0 && hasAtMostTwoDecimals(m))) {
      errors.push(`${picks} numéros : coefficients positifs à 2 décimales maximum`);
      continue;
    }
    const rtp = rtpPercent(row);
    if (rtp < RTP_MIN_PERCENT || rtp > RTP_MAX_PERCENT) {
      errors.push(`${picks} numéros : RTP ${rtp.toFixed(2)} % hors de ${RTP_MIN_PERCENT}–${RTP_MAX_PERCENT} %`);
    }
  }
  return errors;
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
}

/** Mise × coefficient, arrondi au centime inférieur, plafonné à `maxPayoutCents`. */
export function payoutCents(stakeCents: number, multiplier: number, maxPayoutCents: number): number {
  const raw = Number((BigInt(stakeCents) * BigInt(Math.round(multiplier * 100))) / 100n);
  return Math.min(raw, maxPayoutCents);
}
