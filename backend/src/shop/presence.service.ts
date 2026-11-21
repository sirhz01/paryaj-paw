import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../database/db';
import { SHOP_CLOCK, ShopClock } from './clock';

/**
 * Présence des caissiers. Tant qu'aucun caissier n'est connecté, aucun nouveau tour n'est créé : pas de tirage la
 * nuit, quand personne n'est à la caisse. Dès qu'un caissier se connecte, les tours reprennent au tour suivant.
 * L'état est en base (le serveur peut tourner sur plusieurs instances ou redémarrer).
 */
@Injectable()
export class CashierPresence {
  /** Un caissier sans signal depuis ce délai est considéré déconnecté (la caisse envoie un signal chaque minute). */
  static readonly TTL_MS = 3 * 60 * 1000;
  /** Écritures espacées : un signal de moins de 15 s après le précédent n'écrit rien. */
  private static readonly TOUCH_EVERY_MS = 15 * 1000;
  private static readonly CACHE_MS = 1000;

  private readonly lastTouch = new Map<number, number>();
  private cache?: { at: number; active: boolean };

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SHOP_CLOCK) private readonly clock: ShopClock,
  ) {}

  /** Signal d'un caissier connecté (sans effet pour les autres rôles). */
  async touch(staff: { id: number; role: string }): Promise<void> {
    if (staff.role !== 'cashier') return;
    const now = this.clock.now();
    const last = this.lastTouch.get(staff.id);
    if (last !== undefined && now >= last && now - last < CashierPresence.TOUCH_EVERY_MS) return;
    await this.db.query(
      `INSERT INTO cashier_presence (staff_id, seen_at) VALUES ($1, to_timestamp($2::double precision / 1000))
       ON CONFLICT (staff_id) DO UPDATE SET seen_at = EXCLUDED.seen_at`,
      [staff.id, now],
    );
    this.lastTouch.set(staff.id, now);
    this.cache = undefined;
  }

  /** Déconnexion : ce caissier ne compte plus. */
  async clear(staffId: number): Promise<void> {
    await this.db.query('DELETE FROM cashier_presence WHERE staff_id = $1', [staffId]);
    this.lastTouch.delete(staffId);
    this.cache = undefined;
  }

  /** Vrai si au moins un caissier actif est connecté. */
  async anyActive(): Promise<boolean> {
    const now = this.clock.now();
    if (this.cache && Math.abs(now - this.cache.at) < CashierPresence.CACHE_MS) return this.cache.active;
    const { rows } = await this.db.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM cashier_presence p JOIN staff s ON s.id = p.staff_id
          WHERE s.active AND p.seen_at > to_timestamp($1::double precision / 1000)
       ) AS active`,
      [now - CashierPresence.TTL_MS],
    );
    const active = rows[0]?.active === true;
    this.cache = { at: now, active };
    return active;
  }
}
