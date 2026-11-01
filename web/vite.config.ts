import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, le serveur Vite (http://localhost:5173) relaie /api vers le back-end NestJS
// (http://localhost:3000) : pas de CORS à configurer. En production, le build est servi sur la même
// origine que l'API (ou derrière un reverse-proxy), donc /api/v1 fonctionne aussi tel quel.

/** Pages publiques à référencer ; les pages du compte (portefeuille, jeux) restent hors du sitemap. */
const PUBLIC_PAGES = ['/', '/register', '/login', '/contact', '/rgpd', '/cgu'];

/**
 * Référencement : SITE_URL (ex. https://paryajpaw.com) complète les liens absolus (canonical, image de partage)
 * et génère robots.txt + sitemap.xml au build. Sans SITE_URL, les liens restent relatifs et il n'y a pas de sitemap.
 */
function seoFiles(): Plugin {
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  return {
    name: 'seo-files',
    transformIndexHtml: (html) => html.replace(/__SITE_URL__/g, site),
    generateBundle() {
      const robots = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /wallet',
        'Disallow: /account',
        'Disallow: /play/',
        ...(site ? [`Sitemap: ${site}/sitemap.xml`] : []),
      ];
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots.join('\n') + '\n' });
      if (!site) return;
      const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${site}${p}</loc></url>`).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), seoFiles()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
