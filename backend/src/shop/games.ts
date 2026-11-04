/**
 * Règles des quatre jeux de la boutique. Fonctions pures : le front (js/bets.js, js/roulette-core.js)
 * en a une copie pour l'affichage, mais seul ce fichier fait foi pour les cotes, les gains et les résultats.
 */

export const SHOP_GAMES = ['roulette', 'keno', 'luckysix', 'luckyx'] as const;
export type ShopGame = (typeof SHOP_GAMES)[number];

/** Durées en secondes. Un cycle = mises + tirage + résultat. */
export type Timings = Record<ShopGame, { bet: number; draw: number; result: number }>;

export const TIMINGS: Timings = {
  roulette: { bet: 25, draw: 11, result: 8 },
  keno: { bet: 20, draw: 30, result: 8 },
  luckysix: { bet: 30, draw: 32, result: 12 },
  luckyx: { bet: 20, draw: 24, result: 8 },
};

/** Avant la fermeture des mises, la caisse bascule sur le tour suivant. */
export const CLOSE_MARGIN_SECONDS = 2;

export type NumberGame = 'keno' | 'luckysix' | 'luckyx';

/** Grilles de numéros : `drawn` boules tirées sur `max`, le joueur en choisit de `min` à `maxPick`. */
export const NUMBER_GAMES: Record<NumberGame, { max: number; min: number; maxPick: number; drawn: number }> = {
  keno: { max: 80, min: 1, maxPick: 10, drawn: 20 },
  luckysix: { max: 48, min: 6, maxPick: 6, drawn: 35 },
  luckyx: { max: 50, min: 1, maxPick: 10, drawn: 36 },
};

export interface ShopPaytables {
  /** keno[numéros choisis][numéros trouvés] = coefficient × la mise. */
  keno: Record<string, Record<string, number>>;
  /** Coefficient de la boule n° 6 à n° 35 qui complète les 6 numéros du joueur (30 valeurs). */
  luckysix: number[];
  luckyx: { single: number; tiers: Record<string, number> };
  /**
   * Cotes de la roulette, calculées à partir du RTP visé réglé dans l'administration (voir rouletteOddsForRtp).
   * Absent dans les anciennes versions : DEFAULT_ROULETTE_ODDS s'applique alors.
   */
  roulette?: { targetRtp: number; odds: Record<string, number> };
}

export const LUCKYSIX_LADDER_SIZE = 30;

// Roulette américaine ---------------------------------------------------------

/** Ordre des cases sur la roue. */
export const WHEEL_ORDER = [
  '0', '28', '9', '26', '30', '11', '7', '20', '32', '17', '5', '22', '34', '15', '3', '24', '36', '13', '1',
  '00', '27', '10', '25', '29', '12', '8', '19', '31', '18', '6', '21', '33', '16', '4', '23', '35', '14', '2',
];

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type RouletteColor = 'green' | 'red' | 'black';

export function rouletteColor(n: string): RouletteColor {
  if (n === '0' || n === '00') return 'green';
  return REDS.has(Number(n)) ? 'red' : 'black';
}

const range = (a: number, b: number): string[] => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const ALL = range(1, 36);

/** Nombre de cases couvertes par type de mise (roulette américaine : 38 cases). */
export const ROULETTE_COVERED: Record<string, number> = {
  n: 1, sp: 2, st: 3, co: 4, six: 6, col: 12, doz: 12, red: 18, black: 18, even: 18, odd: 18, low: 18, high: 18, basket: 5,
};
const POCKETS = 38;

/**
 * Cotes (multiplicateur total de la mise) pour un RTP visé : cote = RTP × 38 / cases couvertes, arrondie au centième.
 * Le tirage reste équiprobable (1/38 par case) ; seul ce que le jeu paie change, comme dans toute loterie réglementée.
 */
export function rouletteOddsForRtp(targetRtpPercent: number): Record<string, number> {
  const odds: Record<string, number> = {};
  for (const [kind, covered] of Object.entries(ROULETTE_COVERED)) {
    odds[kind] = Math.round(((targetRtpPercent / 100) * POCKETS / covered) * 100) / 100;
  }
  return odds;
}

/** Cotes d'avant la configuration par RTP visé (versions de réglages sans table roulette) : elles restent valables pour ces versions. */
export const DEFAULT_ROULETTE_ODDS: Record<string, number> = {
  n: 36, sp: 7.6, st: 5.07, co: 3.8, six: 2.53, col: 1.27, doz: 1.27, red: 0.84, black: 0.84, even: 0.84, odd: 0.84, low: 0.84, high: 0.84, basket: 3.04,
};

const ROULETTE_LABELS: Record<string, string> = {
  n: 'Pari simple', sp: 'Cheval', st: 'Street', co: 'Carré', six: 'Six lignes', red: 'Rouge', black: 'Noir',
  even: 'Pair', odd: 'Impair', low: 'Manque 1-18', high: 'Passe 19-36', basket: 'Top line',
};

/**
 * Chevaux valides (deux cases voisines), 0 et 00 compris : horizontaux a/a+3, verticaux a/a+1 hors
 * haut de colonne, et les chevaux du zéro. Clé canonique « petit-grand » (00 en dernier).
 */
export const ROULETTE_SPLITS: ReadonlySet<string> = (() => {
  const splits = new Set(['0-1', '0-2', '0-00', '2-00', '3-00']);
  for (let a = 1; a <= 35; a++) for (const b of [a + 1, a + 3]) if (b <= 36 && (b === a + 3 || a % 3 !== 0)) splits.add(`${a}-${b}`);
  return splits;
})();

/**
 * Clés de mise : n:17 n:0 n:00, sp:17-20 (cheval), st:19 (début de la rue : 1, 4 … 34), co:17 (carré,
 * coin bas-gauche : 1, 2, 4, 5 … 32), six:31 (1, 4 … 31), col:1-3, doz:1-3, red, black, even, odd, low,
 * high, basket (0, 00, 1, 2, 3). Renvoie null si la clé n'existe pas sur le tapis.
 */
export function rouletteKeyNumbers(key: string): string[] | null {
  const [kind, value] = key.split(':');
  const x = Number(value);
  switch (kind) {
    case 'n':
      return value === '0' || value === '00' || (/^[1-9]\d?$/.test(value ?? '') && x <= 36) ? [value] : null;
    case 'sp':
      return ROULETTE_SPLITS.has(value ?? '') ? (value as string).split('-') : null;
    case 'st':
      return Number.isInteger(x) && x >= 1 && x <= 34 && x % 3 === 1 && value === String(x) ? range(x, x + 2) : null;
    case 'co':
      return Number.isInteger(x) && x >= 1 && x <= 32 && x % 3 !== 0 && value === String(x)
        ? [x, x + 1, x + 3, x + 4].map(String)
        : null;
    case 'six':
      return Number.isInteger(x) && x >= 1 && x <= 31 && x % 3 === 1 && value === String(x) ? range(x, x + 5) : null;
    case 'col':
      return value === '1' || value === '2' || value === '3' ? ALL.filter((n) => Number(n) % 3 === x % 3) : null;
    case 'doz':
      return value === '1' || value === '2' || value === '3' ? range((x - 1) * 12 + 1, x * 12) : null;
    case 'red':
    case 'black':
      return value === undefined ? ALL.filter((n) => rouletteColor(n) === kind) : null;
    case 'even':
      return value === undefined ? ALL.filter((n) => Number(n) % 2 === 0) : null;
    case 'odd':
      return value === undefined ? ALL.filter((n) => Number(n) % 2 === 1) : null;
    case 'low':
      return value === undefined ? range(1, 18) : null;
    case 'high':
      return value === undefined ? range(19, 36) : null;
    case 'basket':
      return value === undefined ? ['0', '00', '1', '2', '3'] : null;
    default:
      return null;
  }
}

export interface TicketLine {
  /** Roulette : clé de mise ; absente pour les jeux de numéros. */
  key?: string;
  label: string;
  /** Ce qui est imprimé sur le ticket : numéros joués, ou nom de la mise pour une chance simple. */
  picks: (number | string)[];
  odds: number;
  stakeCents: number;
  possibleCents: number;
}

export interface LineSelection {
  key?: string;
  picks?: number[];
  stakeCents: number;
}

function newLine(partial: Omit<TicketLine, 'possibleCents'>): TicketLine {
  return { ...partial, possibleCents: Math.round(partial.stakeCents * partial.odds) };
}

/** Ligne de ticket pour la roulette, ou null si la clé est inconnue (ou le top line désactivé). */
export function rouletteLine(
  key: string,
  stakeCents: number,
  topLineEnabled: boolean,
  odds: Record<string, number> = DEFAULT_ROULETTE_ODDS,
): TicketLine | null {
  const numbers = rouletteKeyNumbers(key);
  if (!numbers || (key === 'basket' && !topLineEnabled)) return null;
  const kind = key.split(':')[0];
  const value = key.split(':')[1];
  const label =
    kind === 'col' ? `Colonne ${value}` : kind === 'doz' ? `Douzaine ${value}` : ROULETTE_LABELS[kind];
  const picks = ['n', 'sp', 'st', 'co', 'six', 'basket'].includes(kind) ? numbers : [label.toUpperCase()];
  return newLine({ key, label, picks, odds: odds[kind] ?? DEFAULT_ROULETTE_ODDS[kind], stakeCents });
}

/** Cote maximale d'une combinaison, affichée sur le ticket. null si la table n'a pas cette ligne. */
export function numbersOdds(game: NumberGame, count: number, paytables: ShopPaytables): number | null {
  if (game === 'keno') {
    const row = paytables.keno[String(count)];
    return row ? Math.max(...Object.values(row)) : null;
  }
  if (game === 'luckysix') return paytables.luckysix[0];
  if (count === 1) return paytables.luckyx.single;
  return paytables.luckyx.tiers[String(count)] ?? null;
}

/** Ligne de ticket pour Keno, Lucky Six et Lucky X ; null si le nombre de numéros n'a pas de cote. */
export function numbersLine(
  game: NumberGame,
  picks: readonly number[],
  stakeCents: number,
  paytables: ShopPaytables,
): TicketLine | null {
  const n = picks.length;
  const odds = numbersOdds(game, n, paytables);
  if (odds === null) return null;
  const label = {
    keno: `Keno ${n} numéros`,
    luckysix: '6 numéros',
    luckyx: n === 1 ? 'Pari simple' : `${n} boules`,
  }[game];
  return newLine({ label, picks: [...picks].sort((a, b) => a - b), odds, stakeCents });
}

/** Message d'erreur si la combinaison ne respecte pas la grille du jeu. */
export function checkPicks(game: NumberGame, picks: readonly number[]): string | null {
  const grid = NUMBER_GAMES[game];
  if (picks.length < grid.min || picks.length > grid.maxPick) return `${grid.min} à ${grid.maxPick} numéros attendus`;
  if (new Set(picks).size !== picks.length) return 'numéros en double';
  if (picks.some((n) => !Number.isInteger(n) || n < 1 || n > grid.max)) return `numéros de 1 à ${grid.max}`;
  return null;
}

// Résultats et règlement ------------------------------------------------------

export type ShopResult = { n: string } | { draw: number[] };

/** Gain (centimes) d'une ligne pour un résultat donné. */
export function lineWin(game: ShopGame, line: TicketLine, result: ShopResult, paytables: ShopPaytables): number {
  if (game === 'roulette') {
    const n = (result as { n: string }).n;
    return line.key && rouletteKeyNumbers(line.key)?.includes(n) ? Math.round(line.stakeCents * line.odds) : 0;
  }
  const draw = (result as { draw: number[] }).draw;
  const picks = line.picks as number[];
  if (game === 'keno') {
    const hits = picks.filter((p) => draw.includes(p)).length;
    return Math.round(line.stakeCents * (paytables.keno[String(picks.length)]?.[String(hits)] ?? 0));
  }
  if (game === 'luckysix') {
    let found = 0;
    for (let i = 0; i < draw.length; i++) {
      if (picks.includes(draw[i])) found++;
      if (found === picks.length) {
        const position = i + 1;
        return position >= 6 ? Math.round(line.stakeCents * (paytables.luckysix[position - 6] ?? 0)) : 0;
      }
    }
    return 0;
  }
  if (picks.length === 1) {
    return draw.includes(picks[0]) ? Math.round(line.stakeCents * paytables.luckyx.single) : 0;
  }
  return picks.every((p) => draw.includes(p))
    ? Math.round(line.stakeCents * (paytables.luckyx.tiers[String(picks.length)] ?? 0))
    : 0;
}

/** Gain d'un ticket, plafonné par le gain maximum. */
export function ticketWin(
  game: ShopGame,
  lines: readonly TicketLine[],
  result: ShopResult,
  paytables: ShopPaytables,
  maxPayoutCents: number,
): number {
  const total = lines.reduce((sum, line) => sum + lineWin(game, line, result, paytables), 0);
  return Math.min(total, maxPayoutCents);
}

// RTP -------------------------------------------------------------------------

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

export interface RtpLine {
  game: ShopGame;
  line: string;
  rtpPercent: number;
}

/** Retour au joueur de chaque ligne de gains, calculé exactement (lois hypergéométriques). */
export function rtpReport(paytables: ShopPaytables, topLineEnabled: boolean): RtpLine[] {
  const out: RtpLine[] = [];
  const add = (game: ShopGame, line: string, rtp: number) =>
    out.push({ game, line, rtpPercent: Math.round(rtp * 10000) / 100 });

  const table = paytables.roulette?.odds ?? DEFAULT_ROULETTE_ODDS;
  for (const [type, kind] of [
    ['straight', 'n'], ['split', 'sp'], ['street', 'st'], ['corner', 'co'], ['six', 'six'], ['column/douzaine', 'col'], ['column/douzaine', 'doz'],
    ['chance simple', 'red'], ['chance simple', 'black'], ['chance simple', 'even'], ['chance simple', 'odd'], ['chance simple', 'low'], ['chance simple', 'high'],
    ['top line', 'basket'],
  ] as const) {
    if (type === 'top line' && !topLineEnabled) continue;
    // Une ligne par type de mise : le RTP le plus élevé parmi les mises de même type est affiché (le plus défavorable pour la boutique).
    const rtp = ((table[kind] ?? DEFAULT_ROULETTE_ODDS[kind]) * ROULETTE_COVERED[kind]) / POCKETS;
    const existing = out.find((o) => o.game === 'roulette' && o.line === type);
    if (existing) existing.rtpPercent = Math.max(existing.rtpPercent, Math.round(rtp * 10000) / 100);
    else add('roulette', type, rtp);
  }
  for (const [n, row] of Object.entries(paytables.keno)) {
    const picks = Number(n);
    let rtp = 0;
    for (const [hits, coefficient] of Object.entries(row)) {
      rtp += (coefficient * choose(20, Number(hits)) * choose(60, picks - Number(hits))) / choose(80, picks);
    }
    add('keno', `${n} numéros`, rtp);
  }
  let six = 0;
  for (let position = 6; position <= 35; position++) {
    six += ((paytables.luckysix[position - 6] ?? 0) * choose(position - 1, 5)) / choose(48, 6);
  }
  add('luckysix', '6 numéros', six);
  add('luckyx', '1 numéro', (paytables.luckyx.single * NUMBER_GAMES.luckyx.drawn) / NUMBER_GAMES.luckyx.max);
  for (const [n, coefficient] of Object.entries(paytables.luckyx.tiers)) {
    add('luckyx', `${n} boules`, (coefficient * choose(NUMBER_GAMES.luckyx.drawn, Number(n))) / choose(NUMBER_GAMES.luckyx.max, Number(n)));
  }
  return out;
}

/** Erreurs de structure et de RTP (aucune ligne ne doit rendre plus que la mise). */
export function validatePaytables(paytables: ShopPaytables): string[] {
  const errors: string[] = [];
  const coefficient = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

  for (let picks = 1; picks <= NUMBER_GAMES.keno.maxPick; picks++) {
    const row = paytables.keno?.[String(picks)];
    if (!row) {
      errors.push(`keno : ligne ${picks} manquante`);
      continue;
    }
    for (const [hits, c] of Object.entries(row)) {
      if (!/^\d+$/.test(hits) || Number(hits) > picks || !coefficient(c)) errors.push(`keno ${picks} numéros : « ${hits} » invalide`);
    }
  }
  if (!Array.isArray(paytables.luckysix) || paytables.luckysix.length !== LUCKYSIX_LADDER_SIZE || !paytables.luckysix.every(coefficient)) {
    errors.push(`luckysix : ${LUCKYSIX_LADDER_SIZE} coefficients positifs attendus`);
  }
  if (!coefficient(paytables.luckyx?.single)) errors.push('luckyx : coefficient du pari simple invalide');
  for (let n = 2; n <= NUMBER_GAMES.luckyx.maxPick; n++) {
    if (!coefficient(paytables.luckyx?.tiers?.[String(n)])) errors.push(`luckyx : palier ${n} boules manquant`);
  }
  if (paytables.roulette !== undefined) {
    const r = paytables.roulette;
    if (typeof r.targetRtp !== 'number' || !Number.isFinite(r.targetRtp) || r.targetRtp < 1 || r.targetRtp > 100) errors.push('roulette : RTP visé entre 1 et 100 %');
    for (const kind of Object.keys(ROULETTE_COVERED)) {
      if (!coefficient(r.odds?.[kind]) || r.odds[kind] <= 0) errors.push(`roulette : cote « ${kind} » invalide`);
    }
  }
  if (errors.length > 0) return errors;

  for (const { game, line, rtpPercent } of rtpReport(paytables, true)) {
    if (rtpPercent > 100) errors.push(`${game} ${line} : RTP de ${rtpPercent} % (plus de 100 %)`);
  }
  return errors;
}

/**
 * Contrôle les durées saisies : entiers en secondes. Le tirage ne peut pas être plus court que l'animation de l'écran TV
 * (valeur par défaut), les mises et le résultat ont des bornes raisonnables.
 */
export function validateTimings(t: unknown): string[] {
  const errors: string[] = [];
  if (typeof t !== 'object' || t === null) return ['durées invalides'];
  for (const game of SHOP_GAMES) {
    const g = (t as Record<string, { bet?: unknown; draw?: unknown; result?: unknown }>)[game];
    if (!g) {
      errors.push(`${game} : durées manquantes`);
      continue;
    }
    const check = (name: 'bet' | 'draw' | 'result', min: number, max: number, label: string) => {
      const v = g[name];
      if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) errors.push(`${game} : ${label} entre ${min} et ${max} secondes`);
    };
    check('bet', 10, 1800, 'mises');
    check('draw', TIMINGS[game].draw, 120, 'tirage');
    check('result', 5, 120, 'résultat');
  }
  return errors;
}
