import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';

const PAGES = ['index', 'caisse', 'roulette', 'keno', 'luckysix', 'luckyx'];
const ASSET_DIRS = ['css', 'js', 'assets'];

/**
 * Sert le front-end de la boutique (pages HTML, css, js, assets) depuis le même serveur que l'API :
 * pas de CORS, et les écrans appellent `/api/v1` directement. Seuls ces fichiers sont exposés,
 * jamais le reste du dépôt (code du back-end, .env).
 */
export function serveFront(app: NestExpressApplication, dir: string): void {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) throw new Error(`FRONT_DIR : index.html introuvable dans ${root}`);
  for (const sub of ASSET_DIRS) {
    app.useStaticAssets(join(root, sub), { prefix: `/${sub}`, dotfiles: 'deny', index: false });
  }
  const pages = new Map<string, string>([['/', 'index'], ...PAGES.map((p): [string, string] => [`/${p}.html`, p])]);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const page = req.method === 'GET' ? pages.get(req.path) : undefined;
    if (page) res.sendFile(join(root, `${page}.html`));
    else next();
  });
}
