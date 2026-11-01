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

**Avec le back-end** (tirages, tickets et paiements viennent du serveur) :

## Site public, SEO et HTTPS

- Pages légales : [cgu.html](cgu.html) et [rgpd.html](rgpd.html) (les champs jaunes `[...]` sont à compléter par l'exploitant et à faire valider par un juriste).
- Bannière cookies : `js/consent.js`. L'analytics (`ANALYTICS` en tête du fichier, vide par défaut) ne se charge qu'après « Accepter ».
- L'API tourne seule par défaut ; `FRONT_DIR` (voir `backend/.env.example`) lui fait servir aussi le front. Les URL absolues (image de partage, canonical, sitemap) viennent de l'hôte de la requête.
- Le serveur génère `/robots.txt` et `/sitemap.xml`, sert `404.html` pour toute page inconnue, compresse (gzip) et met en cache les css/js/images.
- HTTPS : en production, tout HTTP est redirigé en 308 vers HTTPS et HSTS est envoyé (`FORCE_HTTPS`, et `TRUST_PROXY=true` derrière un proxy TLS).

```bash
cd backend && npm install && npm run build
npm run demo        # sans PostgreSQL : base PGlite locale, comptes de démo affichés dans la console
```

Puis ouvrir http://localhost:3000/ — ou http://<adresse IP de la machine>:3000/ sur les écrans TV et les caisses du réseau local.
En production, `npm start` avec `FRONT_DIR=..` sert les mêmes pages. La caisse se connecte avec un compte du back-office de rôle
`cashier` (`npm run staff:create -- --email … --role cashier`) : mot de passe + code TOTP.

**Sans serveur** : ouvrir `index.html` directement ; les pages passent en mode démo (tirages simulés dans le navigateur, tickets dans
`localStorage`, bandeau « démo » sur la caisse). Ouvertes ainsi pendant que `npm run demo` tourne, elles se connectent quand même au serveur.

Touche **F** = plein écran sur les écrans TV, `?shift=30` décale l'horloge (démo), `?api=…` choisit une autre adresse d'API.
Le logo (`assets/logo.jpg`) est en tête de chaque écran et de chaque ticket (`js/ticket.js`).
L'écran et le back-end utilisent tous deux la roulette américaine (0 et 00).

À remplacer avant la production : tables de gains Keno 6/7/8/10 et règles Lucky X = valeurs DEMO, dont le RTP s'éloigne de 90–95 %
(voir `GET /api/v1/admin/shop/settings`).
