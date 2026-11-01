import { parseArgs } from 'node:util';
import {
  DEFAULT_LUCKY_SIX_CONFIG,
  DEFAULT_LUCKY_TEN_CONFIG,
  DRAW_GAMES,
  DrawGame,
  GAME_RULES,
  LUCKY_SIX_FIRST_POSITION,
  TicketBet,
  betMultiplier,
  drawBalls,
  luckySixPositionProbability,
  luckySixRtpPercent,
  luckyTenRtpPercent,
  sideBetProbability,
} from '../draws/games';
import { newServerSeed } from '../fairness/provably-fair';
import { hitProbability } from '../keno/paytable';

/**
 * Critères d'acceptation du cahier des 4 jeux : RTP mesuré à ± 0,5 point du RTP théorique sur
 * 10 millions de tirages et fréquence uniforme de chaque boule (khi-deux). Configuration par défaut.
 * npm run simulate:draws -- --game lucky_six --draws 10000000
 */
function main() {
  const { values } = parseArgs({
    options: { game: { type: 'string', default: 'lucky_six' }, draws: { type: 'string', default: '10000000' } },
  });
  if (!(DRAW_GAMES as string[]).includes(values.game!)) throw new Error(`--game : ${DRAW_GAMES.join(' ou ')}`);
  const game = values.game as DrawGame;
  const draws = Number(values.draws);
  if (!Number.isSafeInteger(draws) || draws <= 0) throw new Error('--draws doit être un entier positif');

  const rules = GAME_RULES[game];
  const config = game === 'lucky_six' ? DEFAULT_LUCKY_SIX_CONFIG : DEFAULT_LUCKY_TEN_CONFIG;

  // Paris suivis, avec leur RTP et leur espérance du carré du coefficient (loi exacte) pour l'erreur type.
  const tracked: { label: string; bet: TicketBet; rtp: number; meanSquare: number }[] = [];
  if (game === 'lucky_six') {
    const coefficients = DEFAULT_LUCKY_SIX_CONFIG.positionCoefficients;
    tracked.push({
      label: 'six',
      bet: { type: 'six', numbers: [1, 2, 3, 4, 5, 6] },
      rtp: luckySixRtpPercent(coefficients),
      meanSquare: coefficients.reduce((s, c, i) => s + c * c * luckySixPositionProbability(i + LUCKY_SIX_FIRST_POSITION), 0),
    });
  } else {
    const bonus = DEFAULT_LUCKY_TEN_CONFIG.luckyNumberMultiplier;
    for (const [picks, row] of Object.entries(DEFAULT_LUCKY_TEN_CONFIG.paytable)) {
      const k = Number(picks);
      tracked.push({
        label: `${k} numéros`,
        bet: { type: 'numbers', numbers: Array.from({ length: k }, (_, i) => i + 1) },
        rtp: luckyTenRtpPercent(row, bonus),
        // Avec h numéros trouvés, le bonus s'applique avec la probabilité h/20 : m² devient m²·b².
        meanSquare: row.reduce((s, m, h) => s + m * m * hitProbability(k, h) * (1 + ((bonus * bonus - 1) * h) / rules.drawn), 0),
      });
    }
  }
  for (const type of Object.keys(rules.sideBets)) {
    const p = sideBetProbability(game, type);
    const c = config.sideBets[type];
    tracked.push({ label: type, bet: { type, color: 'red' }, rtp: 100 * c * p, meanSquare: c * c * p });
  }

  const seed = newServerSeed();
  const returned = new Float64Array(tracked.length);
  const frequency = new Float64Array(rules.balls + 1);
  const started = Date.now();
  for (let id = 1; id <= draws; id++) {
    const balls = drawBalls(game, seed, id);
    for (const n of balls) frequency[n]++;
    for (let i = 0; i < tracked.length; i++) returned[i] += betMultiplier(game, tracked[i].bet, balls, config);
  }
  const seconds = (Date.now() - started) / 1000;

  console.log(`${game} : ${draws.toLocaleString('fr-FR')} tirages en ${seconds.toFixed(1)} s\n`);
  console.log('Pari          | RTP théorique | RTP mesuré | Écart   | Erreur type | ≤ 0,5 pt | ≤ 3 erreurs types');
  tracked.forEach((t, i) => {
    const measured = (100 * returned[i]) / draws;
    const gap = measured - t.rtp;
    const stdError = (100 * Math.sqrt(t.meanSquare - (t.rtp / 100) ** 2)) / Math.sqrt(draws);
    console.log(
      [
        t.label.padEnd(13),
        `${t.rtp.toFixed(3)} %`.padStart(13),
        `${measured.toFixed(3)} %`.padStart(10),
        `${gap >= 0 ? '+' : ''}${gap.toFixed(3)}`.padStart(7),
        stdError.toFixed(3).padStart(11),
        (Math.abs(gap) <= 0.5 ? 'oui' : 'non').padStart(8),
        Math.abs(gap) <= 3 * stdError ? 'oui' : 'NON',
      ].join(' | '),
    );
  });

  const expected = (draws * rules.drawn) / rules.balls;
  let chiSquare = 0;
  for (let n = 1; n <= rules.balls; n++) chiSquare += (frequency[n] - expected) ** 2 / expected;
  const df = rules.balls - 1;
  // Seuil à 99 % par l'approximation de Wilson-Hilferty.
  const critical = df * (1 - 2 / (9 * df) + 2.3263 * Math.sqrt(2 / (9 * df))) ** 3;
  console.log(
    `\nUniformité des ${rules.balls} boules : khi-deux = ${chiSquare.toFixed(1)} (${df} ddl, seuil 99 % ≈ ${critical.toFixed(1)}) → ${
      chiSquare <= critical ? 'uniforme' : 'NON UNIFORME'
    }`,
  );
}

main();
