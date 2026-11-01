# paryaj-paw

Plateforme de jeux en ligne en HTG (roulette américaine, Keno 20/80, Lucky Six, Lucky 10) : web, Android et desktop Windows. Cahiers des charges : [Keno](Cahier_des_charges_Keno.pdf), [4 jeux](Cahier_des_charges_4_jeux.pdf).

| Dossier | Contenu | État |
| --- | --- | --- |
| [backend/](backend/) | API NestJS + PostgreSQL : comptes, portefeuille, 4 jeux, tirages programmés, points de vente (agents), boutique (tours, tickets, caisse), paiements, back-office | Premier jalon |
| [index.html](index.html) | Front-end boutique (HTML/JS pur) : écrans TV Roulette, Keno, Lucky Six, Lucky X et caisse | Démo |
| `web/` | Site web React | À venir |
| [desktop/](desktop/) | Application Windows de la boutique (caisse + écrans TV), en Tauri 2 et Electron | Premier jalon |
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

Page **Administration** ([admin.html](admin.html)) : rapport de fin de journée par caisse, rapport par période (export CSV), réglages (nom, caisses, mises, limites) et taux de gain avec RTP. Connexion avec un compte du back-office ; seul le `super_admin` modifie (`finance` et `auditor` consultent).

Touche **F** = plein écran sur les écrans TV, `?shift=30` décale l'horloge (démo), `?api=…` choisit une autre adresse d'API.
Le logo (`assets/logo.jpg`) est en tête de chaque écran et de chaque ticket (`js/ticket.js`).
L'écran et le back-end utilisent tous deux la roulette américaine (0 et 00), avec le jeu de mises standard complet :
pari simple, cheval (17:1), street, carré (8:1), six lignes, colonne, douzaine, chances simples et top line.

Tables de gains au **format international, RTP ~92 %** (`migrations/008_shop_paytables_rtp.sql`, vérifiées par
`src/shop/certified-paytables.spec.ts`) : Keno 20/80 identique au moteur en ligne, Lucky Six 35/48 à l'échelle certifiée,
Lucky X 50/20 recalculé. Taux de gain de chaque ligne : `GET /api/v1/admin/shop/settings`.
