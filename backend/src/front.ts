import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import { NextFunction, Request, Response } from 'express';

const PAGES = ['index', 'caisse', 'admin', 'roulette', 'keno', 'luckysix', 'luckyx', 'rgpd', 'cgu', 'contact'];
const ASSET_DIRS = ['css', 'js', 'assets'];
/** Pages publiques référencées dans le sitemap ; la caisse et les écrans TV restent hors des moteurs de recherche. */
const INDEXED = ['index', 'cgu', 'rgpd', 'contact'];
const ORIGIN_TOKEN = /%ORIGIN%/g;
const ONE_DAY = 24 * 3600 * 1000;

/** Adresse publique du site, pour les URL absolues (image de partage, sitemap) : celle de la requête. */
export const originOf = (req: Request): string => `${req.protocol}://${req.get('host')}`;

export function robotsTxt(origin: string): string {
  return ['User-agent: *', 'Disallow: /api/', 'Disallow: /caisse.html', 'Disallow: /admin.html', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

export function sitemapXml(origin: string): string {
  const urls = INDEXED.map((p) => `  <url><loc>${origin}${p === 'index' ? '/' : `/${p}.html`}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * Sert le front-end de la boutique (pages HTML, css, js, assets) depuis le même serveur que l'API :
 * pas de CORS, et les écrans appellent `/api/v1` directement. Seuls ces fichiers sont exposés,
 * jamais le reste du dépôt (code du back-end, .env). Sans FRONT_DIR, l'API tourne seule.
 */
export function serveFront(app: NestExpressApplication, dir: string): void {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) throw new Error(`FRONT_DIR : index.html introuvable dans ${root}`);

  app.use(compression());
  for (const sub of ASSET_DIRS) {
    app.useStaticAssets(join(root, sub), { prefix: `/${sub}`, dotfiles: 'deny', index: false, maxAge: ONE_DAY });
  }

  const html = (name: string, req: Request): string =>
    readFileSync(join(root, `${name}.html`), 'utf8').replace(ORIGIN_TOKEN, originOf(req));
  const pages = new Map<string, string>([['/', 'index'], ...PAGES.map((p): [string, string] => [`/${p}.html`, p])]);

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();
    if (req.path === '/robots.txt') return void res.type('text/plain').send(robotsTxt(originOf(req)));
    if (req.path === '/sitemap.xml') return void res.type('application/xml').send(sitemapXml(originOf(req)));
    if (req.path === '/favicon.ico') return void res.redirect(301, '/assets/icon-32.png');
    const page = pages.get(req.path);
    if (page) return void res.type('html').send(html(page, req));
    // Tout le reste hors de l'API est une page introuvable (l'API, sous /api/, garde ses réponses JSON).
    if (!req.path.startsWith('/api/') && existsSync(join(root, '404.html'))) {
      return void res.status(404).type('html').send(html('404', req));
    }
    next();
  });
}
