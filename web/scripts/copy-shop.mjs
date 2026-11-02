// Copie les pages de la boutique (caisse, back-office, écrans TV) du dépôt racine vers le build du site,
// pour qu'elles soient servies par le même domaine que l'app joueurs (et appellent /api/v1 en même origine).
// Source unique : les fichiers restent à la racine ; ils sont copiés ici au build, jamais dupliqués dans les sources.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..'); // racine du dépôt
const dist = join(here, '..', 'dist');
const site = (process.env.SITE_URL || 'https://paryajpaw.online').replace(/\/$/, '');
const version = Date.now().toString(36);

// index.html (joueurs) et les pages légales viennent de l'app React ; on ne copie que la boutique interne + écrans TV.
const PAGES = ['caisse', 'admin', 'roulette', 'keno', 'luckysix', 'luckyx', '404'];
const DIRS = ['js', 'css', 'assets'];

if (!existsSync(dist)) { console.error('copy-shop: dist introuvable, lancer après vite build'); process.exit(1); }

for (const dir of DIRS) {
  const src = join(repo, dir);
  if (existsSync(src)) cpSync(src, join(dist, dir), { recursive: true });
}

for (const name of PAGES) {
  const src = join(repo, `${name}.html`);
  if (!existsSync(src)) continue;
  const html = readFileSync(src, 'utf8')
    .replace(/%ORIGIN%/g, site)
    // suffixe de version sur js/css pour éviter un ancien script en cache après mise à jour
    .replace(/\b(src|href)="((?:js|css)\/[^"?]+)"/g, `$1="$2?v=${version}"`);
  mkdirSync(dirname(join(dist, `${name}.html`)), { recursive: true });
  writeFileSync(join(dist, `${name}.html`), html);
}

console.log(`copy-shop: ${PAGES.length} pages + ${DIRS.join(', ')} copiés dans dist (site=${site}, v=${version})`);
