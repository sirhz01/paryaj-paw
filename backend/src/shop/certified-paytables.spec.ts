import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShopPaytables, rtpReport, validatePaytables } from './games';

/** Tables de gains réellement insérées par la migration, extraites du SQL pour verrouiller leurs valeurs. */
function certifiedPaytables(): ShopPaytables {
  const sql = readFileSync(join(__dirname, '..', '..', 'migrations', '009_shop_paytables_rtp.sql'), 'utf8');
  const match = sql.match(/'(\{[\s\S]*?\})'::jsonb/);
  if (!match) throw new Error('paytables introuvables dans 009_shop_paytables_rtp.sql');
  const base = JSON.parse(match[1]) as ShopPaytables;
  // Lucky X (36 boules sur 50) : table de la migration 015, qui remplace celle de 009.
  const luckyx = readFileSync(join(__dirname, '..', '..', 'migrations', '015_luckyx_36_of_50.sql'), 'utf8').match(/'(\{\s*"single"[\s\S]*?\})'::jsonb/);
  if (!luckyx) throw new Error('table Lucky X introuvable dans 015_luckyx_36_of_50.sql');
  return { ...base, luckyx: JSON.parse(luckyx[1]) as ShopPaytables['luckyx'] };
}

describe('tables de gains certifiées (migration 008)', () => {
  const paytables = certifiedPaytables();

  it('passent la validation de structure et de RTP (≤ 100 %)', () => {
    expect(validatePaytables(paytables)).toEqual([]);
  });

  it('chaque pari de numéros a un RTP entre 90 et 95 %', () => {
    const lines = rtpReport(paytables, true).filter((r) => r.game !== 'roulette');
    expect(lines.length).toBeGreaterThan(0);
    for (const { game, line, rtpPercent } of lines) {
      expect({ game, line, rtpPercent }).toMatchObject({ rtpPercent: expect.any(Number) });
      expect(rtpPercent).toBeGreaterThanOrEqual(90);
      expect(rtpPercent).toBeLessThanOrEqual(95);
    }
  });
});
