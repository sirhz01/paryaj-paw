import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShopPaytables, rtpReport, validatePaytables } from './games';

/** Tables insérées par la migration 024 (avantage maison 85 % : le joueur récupère 15 % de ses mises). */
function paytables(): ShopPaytables {
  const sql = readFileSync(join(__dirname, '..', '..', 'migrations', '024_house_edge_85.sql'), 'utf8');
  const match = sql.match(/'(\{[\s\S]*\})'::jsonb/);
  if (!match) throw new Error('paytables introuvables dans 024_house_edge_85.sql');
  return JSON.parse(match[1]) as ShopPaytables;
}

describe('migration 024 : avantage maison 85 %', () => {
  const tables = paytables();

  it('passe la validation de structure et de RTP', () => {
    expect(validatePaytables(tables)).toEqual([]);
  });

  it('donne un RTP de 15 % (à 0,6 point près) sur chaque ligne de gains', () => {
    const lines = rtpReport(tables, true);
    expect(lines.length).toBeGreaterThan(20);
    for (const { game, line, rtpPercent } of lines) {
      expect({ game, line, ok: Math.abs(rtpPercent - 15) <= 0.6 }).toEqual({ game, line, ok: true });
    }
  });
});
