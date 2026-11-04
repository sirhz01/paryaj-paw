import { uint32Stream, uniformInt } from '../fairness/provably-fair';
import { NUMBER_GAMES, NumberGame, ShopGame, ShopResult, WHEEL_ORDER } from './games';

/**
 * Tirage d'un tour, vérifiable : même flux HMAC que les jeux en ligne, avec
 * graine client = « jeu:jour » et nonce = numéro du tour.
 * Roulette : une case parmi 38. Autres jeux : Fisher-Yates partiel, boules dans l'ordre de sortie.
 * Lucky X : même principe, les 36 boules sortent dans un ordre aléatoire (la 50 peut sortir en premier).
 */
export function drawRound(game: ShopGame, serverSeed: string, day: string, round: number): ShopResult {
  const next = uint32Stream(serverSeed, `${game}:${day}`, round);
  if (game === 'roulette') return { n: WHEEL_ORDER[uniformInt(next, WHEEL_ORDER.length)] };

  const { max, drawn } = NUMBER_GAMES[game as NumberGame];
  const pool = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = 0; i < drawn; i++) {
    const j = i + uniformInt(next, max - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const draw = pool.slice(0, drawn);
  return { draw };
}
