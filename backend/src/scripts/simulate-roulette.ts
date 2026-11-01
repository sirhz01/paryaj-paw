import { parseArgs } from 'node:util';
import { newClientSeed, newServerSeed } from '../fairness/provably-fair';
import { Bet, DOUBLE_ZERO, PAYOUTS, VARIANTS, Variant, betReturn, coverage, pocketCount, rtpPercent, spinNumber } from '../roulette/rules';

/**
 * Critères d'acceptation : RTP mesuré proche du RTP théorique (97,30 % en européenne, 94,74 % en américaine)
 * sur 10 millions de tours et fréquence uniforme de chaque case (khi-deux).
 * npm run simulate:roulette -- --spins 10000000 --variant american
 */
function main() {
  const { values } = parseArgs({
    options: { spins: { type: 'string', default: '10000000' }, variant: { type: 'string', default: 'european' } },
  });
  const spins = Number(values.spins);
  if (!Number.isSafeInteger(spins) || spins <= 0) throw new Error('--spins doit être un entier positif');
  if (!(VARIANTS as string[]).includes(values.variant!)) throw new Error(`--variant : ${VARIANTS.join(' ou ')}`);
  const variant = values.variant as Variant;
  const pockets = pocketCount(variant);
  // Tolérance du cahier des charges : ± 0,2 pt (roulette européenne), ± 0,5 pt (cahier des 4 jeux).
  const tolerance = variant === 'european' ? 0.2 : 0.5;

  // Une mise de chaque famille : le RTP théorique est le même, la variance non.
  const bets: Bet[] = [
    { type: 'straight', numbers: [17], amountCents: 1 },
    { type: 'split', numbers: [17, 20], amountCents: 1 },
    { type: 'corner', numbers: [25, 26, 28, 29], amountCents: 1 },
    { type: 'dozen', numbers: coverage('dozen', [], 2)!, amountCents: 1 },
    { type: 'red', numbers: coverage('red')!, amountCents: 1 },
    ...(variant === 'american' ? [{ type: 'top_line' as const, numbers: [0, 1, 2, 3, DOUBLE_ZERO], amountCents: 1 }] : []),
  ];

  const serverSeed = newServerSeed();
  const clientSeed = newClientSeed();
  const frequency = new Float64Array(pockets);
  const returned = new Float64Array(bets.length);

  const started = Date.now();
  for (let nonce = 0; nonce < spins; nonce++) {
    const number = spinNumber(serverSeed, clientSeed, nonce, variant);
    frequency[number]++;
    for (let i = 0; i < bets.length; i++) returned[i] += betReturn(bets[i], number, false);
  }
  const seconds = (Date.now() - started) / 1000;

  console.log(`Roulette ${variant} : ${spins.toLocaleString('fr-FR')} tours en ${seconds.toFixed(1)} s\n`);
  console.log(`Mise     | RTP théorique | RTP mesuré | Écart  | Erreur type | ≤ ${String(tolerance).replace('.', ',')} pt | ≤ 3 erreurs types`);
  bets.forEach((bet, i) => {
    const theory = rtpPercent(bet.type, false, variant);
    // Erreur type exacte : la mise rend `multiple` fois la mise avec la probabilité p, sinon rien.
    const p = bet.numbers.length / pockets;
    const multiple = PAYOUTS[bet.type] + 1;
    const stdError = (100 * Math.sqrt(p * multiple ** 2 - (p * multiple) ** 2)) / Math.sqrt(spins);
    const measured = (100 * returned[i]) / spins;
    const gap = measured - theory;
    console.log(
      [
        bet.type.padEnd(8),
        `${theory.toFixed(3)} %`.padStart(13),
        `${measured.toFixed(3)} %`.padStart(10),
        `${gap >= 0 ? '+' : ''}${gap.toFixed(3)}`.padStart(6),
        stdError.toFixed(3).padStart(11),
        (Math.abs(gap) <= tolerance ? 'oui' : 'non').padStart(8),
        Math.abs(gap) <= 3 * stdError ? 'oui' : 'NON',
      ].join(' | '),
    );
  });
  console.log(
    '\nSur un numéro plein, l’erreur type à 10 millions de tours approche la tolérance :' +
      '\nun écart supérieur y reste possible avec un tirage parfait. Le test qui compte est l’écart ≤ 3 erreurs types.',
  );

  const expected = spins / pockets;
  let chiSquare = 0;
  for (let n = 0; n < pockets; n++) chiSquare += (frequency[n] - expected) ** 2 / expected;
  const df = pockets - 1;
  // Seuil à 99 % par l'approximation de Wilson-Hilferty.
  const critical = df * (1 - 2 / (9 * df) + 2.3263 * Math.sqrt(2 / (9 * df))) ** 3;
  console.log(
    `\nUniformité des ${pockets} cases : khi-deux = ${chiSquare.toFixed(1)} (${df} ddl, seuil 99 % ≈ ${critical.toFixed(1)}) → ${
      chiSquare <= critical ? 'uniforme' : 'NON UNIFORME'
    }`,
  );
}

main();
