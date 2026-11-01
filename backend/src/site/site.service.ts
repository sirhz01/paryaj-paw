import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../database/db';

/** Pages publiques dont l'audience est mesurée ; tout autre chemin est ignoré (pas de saisie libre en base). */
export const TRACKED_PATHS = ['/', '/cgu.html', '/rgpd.html', '/contact.html'];

/** Un robot remplit tous les champs : un champ caché rempli, ou un envoi plus rapide que ce délai, n'est pas humain. */
export const MIN_FILL_MS = 3000;

@Injectable()
export class SiteService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async saveContact(input: { name: string; email: string; message: string }): Promise<void> {
    await this.db.query('INSERT INTO contact_messages (name, email, message) VALUES ($1, $2, $3)', [
      input.name.trim(),
      input.email.trim().toLowerCase(),
      input.message.trim(),
    ]);
  }

  async countView(path: string): Promise<void> {
    if (!TRACKED_PATHS.includes(path)) return;
    await this.db.query(
      `INSERT INTO site_pageviews (day, path, views) VALUES ((now() AT TIME ZONE 'America/Port-au-Prince')::date, $1, 1)
       ON CONFLICT (day, path) DO UPDATE SET views = site_pageviews.views + 1`,
      [path],
    );
  }

  async overview(from: string, to: string) {
    const [views, messages] = await Promise.all([
      this.db.query('SELECT day::text AS day, path, views FROM site_pageviews WHERE day BETWEEN $1 AND $2 ORDER BY day, path', [from, to]),
      this.db.query(
        `SELECT id, created_at, name, email, message, handled_at FROM contact_messages
          WHERE created_at >= $1::date AND created_at < ($2::date + 1) ORDER BY id DESC LIMIT 200`,
        [from, to],
      ),
    ]);
    return { pageviews: views.rows, messages: messages.rows };
  }
}
