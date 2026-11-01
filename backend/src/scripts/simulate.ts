import { parseArgs } from 'node:util';
import { DEFAULT_PAYTABLE, hitProbability, rtpPercent } from '../keno/paytable';
import { DRAW_SIZE, GRID_SIZE, drawNumbers, newClientSeed, newServerSeed } from '../keno/provably-fair';

/**
 * Critères d'acceptation : RTP mesuré proche du RTP théorique (± 0,5 point dans le cahier
 * des charges, ± 3 erreurs types statistiquement) et fréquence uniforme de chaque numéro (khi-deux).
 * npm run simulate -- --rounds 10000000
 */
function main() {
  const { values } = parseArgs({ options: { rounds: { type: 'string', default: '1000000' } } });
  const rounds = Number(values.rounds);
  if (!Number.isSafeInteger(rounds) || rounds <= 0) throw new Error('--rounds doit être un entier positif');

  const serverSeed = newServerSeed();
  const clientSeed = newClientSeed();
  const maxPicks = Object.keys(DEFAULT_PAYTABLE).length;
  const sum = new Float64Array(maxPicks + 1);
  const frequency = new Float64Array(GRID_SIZE + 1);

  const started = Date.now();
  for (let nonce = 0; nonce < rounds; nonce++) {
    const drawn = drawNumbers(serverSeed, clientSeed, nonce);
    const isDrawn = new Uint8Array(GRID_SIZE + 1);
    for (const n of drawn) {
      isDrawn[n] = 1;
      frequency[n]++;
    }
    // Le joueur qui choisit k numéros prend 1…k : avec un tirage uniforme, le choix ne change rien.
    let hits = 0;
    for (let picks = 1; picks <= maxPicks; picks++) {
      hits += isDrawn[picks];
      const multiplier = DEFAULT_PAYTABLE[String(picks)][hits];
      sum[picks] += multiplier;
    }
  }
  const seconds = (Date.now() - started) / 1000;

  console.log(`${rounds.toLocaleString('fr-FR')} tirages en ${seconds.toFixed(1)} s\n`);
  console.log('Numéros | RTP théorique | RTP mesuré | Écart | Erreur type | ≤ 0,5 pt | ≤ 3 erreurs types');
  for (let picks = 1; picks <= maxPicks; picks++) {
    const row = DEFAULT_PAYTABLE[String(picks)];
    const theory = rtpPercent(row);
    // Erreur type tirée de la loi exacte : l'estimer sur l'échantillon la sous-évalue tant que le gros lot n'est pas sorti.
    const meanSquare = row.reduce((s, m, hits) => s + m * m * hitProbability(picks, hits), 0);
    const stdError = (100 * Math.sqrt(meanSquare - (theory / 100) ** 2)) / Math.sqrt(rounds);
    const measured = (100 * sum[picks]) / rounds;
    const gap = measured - theory;
    console.log(
      [
        String(picks).padStart(7),
        `${theory.toFixed(3)} %`.padStart(13),
        `${measured.toFixed(3)} %`.padStart(10),
        `${gap >= 0 ? '+' : ''}${gap.toFixed(3)}`.padStart(6),
        `${stdError.toFixed(3)}`.padStart(11),
        (Math.abs(gap) <= 0.5 ? 'oui' : 'non').padStart(8),
        Math.abs(gap) <= 3 * stdError ? 'oui' : 'NON',
      ].join(' | '),
    );
  }
  console.log(
    "\nLes gros lots rares rendent l'erreur type élevée à 6 numéros et plus : un écart supérieur à 0,5 pt" +
      "\ny est attendu même avec un tirage parfait. Le test qui compte est l'écart ≤ 3 erreurs types.",
  );

  const expected = (rounds * DRAW_SIZE) / GRID_SIZE;
  let chiSquare = 0;
  for (let n = 1; n <= GRID_SIZE; n++) chiSquare += (frequency[n] - expected) ** 2 / expected;
  const df = GRID_SIZE - 1;
  // Seuil à 99 % par l'approximation de Wilson-Hilferty.
  const critical = df * (1 - 2 / (9 * df) + 2.3263 * Math.sqrt(2 / (9 * df))) ** 3;
  console.log(
    `\nUniformité des 80 numéros : khi-deux = ${chiSquare.toFixed(1)} (${df} ddl, seuil 99 % ≈ ${critical.toFixed(1)}) → ${
      chiSquare <= critical ? 'uniforme' : 'NON UNIFORME'
    }`,
  );
}

main();
