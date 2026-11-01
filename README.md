# paryaj-paw

Plateforme de jeux en ligne en HTG (roulette américaine, Keno 20/80, Lucky Six, Lucky 10) : web, Android et desktop Windows. Cahiers des charges : [Keno](Cahier_des_charges_Keno.pdf), [4 jeux](Cahier_des_charges_4_jeux.pdf).

| Dossier | Contenu | État |
| --- | --- | --- |
| [backend/](backend/) | API NestJS + PostgreSQL : comptes, portefeuille, 4 jeux, tirages programmés, points de vente (agents), boutique (tours, tickets, caisse), paiements, back-office | Premier jalon |
| [index.html](index.html) | Front-end boutique (HTML/JS pur) : écrans TV Roulette, Keno, Lucky Six, Lucky X et caisse | Démo |
| `web/` | Site web React | À venir |
| `desktop/` | Application Windows (Tauri) | À venir |
| `mobile/` | Application Android | À venir |

## Front-end boutique

Ouvrir `index.html` (aucun build). Touche **F** = plein écran sur les écrans TV, `?shift=30` décale l'horloge (démo).
Le logo (`assets/logo.jpg`) est en tête de chaque écran et de chaque ticket (`js/ticket.js`).

À remplacer avant la production : `PP.result()` (`js/common.js`) simule les tirages dans le navigateur, à brancher sur le back-end ;
les tickets sont dans `localStorage` ; tables de gains Keno 6/7/8/10 et règles Lucky X = valeurs DEMO (`js/config.js`).
L'écran et le back-end utilisent tous deux la roulette américaine (0 et 00) ; la roulette européenne a été retirée.

## Site public, SEO et HTTPS

- Pages légales : [cgu.html](cgu.html) et [rgpd.html](rgpd.html) (les champs jaunes `[...]` sont à compléter par l'exploitant et à faire valider par un juriste).
- Bannière cookies : `js/consent.js`. L'analytics (`ANALYTICS` en tête du fichier, vide par défaut) ne se charge qu'après « Accepter ».
- L'API tourne seule par défaut ; `FRONT_DIR` (voir `backend/.env.example`) lui fait servir aussi le front. Les URL absolues (image de partage, canonical, sitemap) viennent de l'hôte de la requête.
- Le serveur génère `/robots.txt` et `/sitemap.xml`, sert `404.html` pour toute page inconnue, compresse (gzip) et met en cache les css/js/images.
- HTTPS : en production, tout HTTP est redirigé en 308 vers HTTPS et HSTS est envoyé (`FORCE_HTTPS`, et `TRUST_PROXY=true` derrière un proxy TLS).
- Développement local sans PostgreSQL : `cd backend && npm run dev:local` (comptes dans `backend/.dev-data/credentials.txt`).
