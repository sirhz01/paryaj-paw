import { readFileSync } from 'fs';
import { join } from 'path';
import { luckyxRank, lineWin, numbersLine, rtpReport, validatePaytables, ShopPaytables, TicketLine } from './games';

/** Barème Lucky X de la migration 027 (écran de référence). */
function ladders(): Record<string, number[]> {
  const sql = readFileSync(join(__dirname, '..', '..', 'migrations', '027_luckyx_position_ladders.sql'), 'utf8');
  const m = sql.match(/'(\{"ladders"[\s\S]*?\})'::jsonb/);
  if (!m) throw new Error('barème Lucky X introuvable dans 027_luckyx_position_ladders.sql');
  return (JSON.parse(m[1]) as { ladders: Record<string, number[]> }).ladders;
}

const tables = (): ShopPaytables => ({
  keno: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), { '1': 0.1 }])), luckysix: new Array(30).fill(1), luckyx: { ladders: ladders() },
});
const line = (picks: number[], stakeCents = 10000): TicketLine => ({ label: 'x', picks, odds: 1, stakeCents, possibleCents: 0 });

describe('Lucky X : gain selon le rang de la dernière boule choisie', () => {
  it('chaque nombre de boules rend 90 % en moyenne (loi exacte)', () => {
    const rows = rtpReport(tables(), true).filter((r) => r.game === 'luckyx');
    expect(rows).toHaveLength(10);
    for (const r of rows) expect(Math.abs(r.rtpPercent - 90)).toBeLessThan(0.3);
  });

  it('le barème a la forme attendue : 1 boule 9 → 1 sur 9 rangs, 10 boules 100 000 → 10 sur 27 rangs', () => {
    const l = ladders();
    expect(l['1']).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(l['10'][0]).toBe(100000);
    expect(l['10']).toHaveLength(27);
    for (let n = 1; n <= 10; n++) {
      expect(l[String(n)].length).toBeLessThanOrEqual(36 - n + 1);
      // jamais de hausse quand le rang s'éloigne
      for (let i = 1; i < l[String(n)].length; i++) expect(l[String(n)][i]).toBeLessThanOrEqual(l[String(n)][i - 1]);
    }
  });

  it('valeurs lues sur l\'écran de référence', () => {
    const l = ladders();
    // rang 6 : 4, 13, 70, 80, 1K, 10K pour 1 à 6 boules ; rang 11 : 8, 15, 25, 100, 700, 2K, 4K, 10K, 50K pour 2 à 10 boules
    expect([1, 2, 3, 4, 5, 6].map((n) => l[String(n)][6 - n])).toEqual([4, 13, 70, 80, 1000, 10000]);
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => l[String(n)][11 - n])).toEqual([8, 15, 25, 100, 700, 2000, 4000, 10000, 50000]);
    // rang 36 : 6 boules 1, 7 → 2, 8 → 3, 9 → 4, 10 → 10
    expect([6, 7, 8, 9, 10].map((n) => l[String(n)][36 - n])).toEqual([1, 2, 3, 4, 10]);
  });

  it('luckyxRank donne le rang de la dernière boule choisie', () => {
    expect(luckyxRank([7], [3, 7, 9])).toBe(2);
    expect(luckyxRank([9, 3], [3, 7, 9])).toBe(3);
    expect(luckyxRank([3, 99], [3, 7, 9])).toBeNull();
  });

  it('règle un ticket selon le rang', () => {
    const p = tables();
    // 1 numéro sorti à la 1re boule : ×9 ; à la 9e : ×1 ; à la 10e : rien
    expect(lineWin('luckyx', line([20]), { draw: [20, 1, 2] }, p)).toBe(90000);
    expect(lineWin('luckyx', line([20]), { draw: [1, 2, 3, 4, 5, 6, 7, 8, 20] }, p)).toBe(10000);
    expect(lineWin('luckyx', line([20]), { draw: [1, 2, 3, 4, 5, 6, 7, 8, 9, 20] }, p)).toBe(0);
    // 2 numéros : les deux dans les 2 premières boules ×100 ; le dernier au rang 3 ×40
    expect(lineWin('luckyx', line([20, 10]), { draw: [20, 10, 7] }, p)).toBe(1_000_000);
    expect(lineWin('luckyx', line([20, 10]), { draw: [20, 7, 10] }, p)).toBe(400_000);
    expect(lineWin('luckyx', line([20, 10]), { draw: [20, 7, 8] }, p)).toBe(0);
    // le même ticket, rang 18 : ×1, rang 19 : rien
    const late = (rank: number) => [...Array.from({ length: rank - 1 }, (_, i) => 30 + i), 10].map((n, i) => (i === 0 ? 20 : n));
    expect(lineWin('luckyx', line([20, 10]), { draw: late(18) }, p)).toBe(10000);
    expect(lineWin('luckyx', line([20, 10]), { draw: late(19) }, p)).toBe(0);
  });

  it('la cote affichée sur le ticket est le gain maximum de la ligne', () => {
    const p = tables();
    expect(numbersLine('luckyx', [5], 100, p)?.odds).toBe(9);
    expect(numbersLine('luckyx', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 100, p)?.odds).toBe(100000);
  });

  it('validatePaytables accepte ce barème et refuse un barème trop long', () => {
    expect(validatePaytables(tables())).toEqual([]);
    const bad = tables();
    bad.luckyx.ladders!['10'] = new Array(28).fill(1);
    expect(validatePaytables(bad)).not.toEqual([]);
  });
});
