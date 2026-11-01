import { robotsTxt, sitemapXml } from './front';

describe('référencement', () => {
  it('robots.txt ferme l’API et la caisse et pointe vers le sitemap', () => {
    const txt = robotsTxt('https://paryaj.ht');
    expect(txt).toContain('Disallow: /api/');
    expect(txt).toContain('Disallow: /caisse.html');
    expect(txt).toContain('Disallow: /admin.html');
    expect(txt).toContain('Sitemap: https://paryaj.ht/sitemap.xml');
  });

  it('sitemap.xml ne liste que les pages publiques, en URL absolues', () => {
    const xml = sitemapXml('https://paryaj.ht');
    expect(xml).toContain('<loc>https://paryaj.ht/</loc>');
    expect(xml).toContain('<loc>https://paryaj.ht/cgu.html</loc>');
    expect(xml).toContain('<loc>https://paryaj.ht/rgpd.html</loc>');
    expect(xml).toContain('<loc>https://paryaj.ht/contact.html</loc>');
    expect(xml).not.toContain('caisse');
  });
});
