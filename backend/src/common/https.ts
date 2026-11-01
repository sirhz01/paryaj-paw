import { NextFunction, Request, Response } from 'express';

/** Sonde de santé des répartiteurs de charge : reste joignable en HTTP. */
const HEALTH_PATH = '/api/v1/health';

/** Renvoie en 308 toute requête non sécurisée vers la même adresse en HTTPS (méthode et corps conservés). */
export function forceHttps(req: Request, res: Response, next: NextFunction): void {
  if (req.secure || req.path === HEALTH_PATH) return next();
  const host = req.headers.host;
  if (!host) {
    res.status(400).end();
    return;
  }
  res.redirect(308, `https://${host}${req.originalUrl}`);
}
