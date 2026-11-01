# Back-end Paryaj Paw — Keno

API NestJS + PostgreSQL pour le web, l'Android et l'application desktop. Tout le calcul (tirage, gains, solde) se fait ici ; les clients n'affichent que le résultat.

## Démarrer en local

Prérequis : Node.js 22 ou plus, PostgreSQL 14 ou plus.

```bash
# 1. Base de données (une seule fois)
sudo -u postgres createuser -P keno        # mot de passe : keno
sudo -u postgres createdb -O keno keno

# 2. Configuration
cp .env.example .env

# 3. Installation, schéma, compte back-office, serveur
npm install
npm run build
npm run migrate
npm run staff:create -- --email admin@paryajpaw.ht --role super_admin
npm run dev                                 # http://localhost:3000/api/v1
```

En développement, les codes SMS s'affichent dans la console et le fournisseur de paiement `fake` valide tout dépôt et tout retrait.

## Tests et simulation

```bash
npm test                                   # 43 tests, dont le parcours complet sur un PostgreSQL en mémoire
npm run build && npm run simulate -- --rounds 10000000
```

La simulation mesure le RTP de chaque nombre de numéros et l'uniformité des 80 numéros (khi-deux), les deux premiers critères d'acceptation du cahier des charges.

## Choix techniques

| Sujet | Choix |
| --- | --- |
| Montants | Entiers en centimes de gourde (`amountCents`, 100 = 1 HTG) |
| Solde | Écrit uniquement par `WalletService` ; chaque mouvement ajoute une ligne au journal `ledger_entries`, qui est append-only |
| Mise | Débit, tirage, gain et journal dans une seule transaction, sous verrou du portefeuille |
| Coupure réseau | Chaque mise et chaque paiement porte une `idempotencyKey` : un renvoi rend le même résultat, jamais un double débit |
| Tirage | HMAC-SHA256 (graine serveur, graine client, nonce) puis Fisher-Yates sans biais ; le hash de la graine serveur est publié avant la mise |
| Paramètres | Versionnés dans `game_settings` ; refus si le RTP d'une ligne sort de 90–95 % |
| Back-office | Comptes séparés, mot de passe + TOTP, rôles `super_admin`, `finance`, `support`, `auditor`, journal d'audit |
| Dates | Journées comptées en heure d'Haïti (`America/Port-au-Prince`) |

Les erreurs ont la forme `{ "code": "INSUFFICIENT_FUNDS", ... }` : les clients traduisent le code en kreyòl, français ou anglais.

## Routes

Préfixe : `/api/v1`. 🔒 = jeton joueur (`Authorization: Bearer …`), 🛡️ = jeton back-office.

| Méthode | Route | Rôle |
| --- | --- | --- |
| POST | `/auth/otp` | Envoie un code SMS (`register` ou `reset_password`) |
| POST | `/auth/register` | Inscription : téléphone, code, mot de passe, date de naissance (18 ans) |
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/reset-password` | Session |
| GET, PATCH | `/me` 🔒 | Profil, langue |
| PUT | `/me/limits` 🔒 | Limites de perte et de dépôt par jour |
| POST | `/me/self-exclusion` 🔒 | Auto-exclusion de 7 à 365 jours |
| GET | `/wallet`, `/wallet/transactions` 🔒 | Solde et historique filtrable par date |
| POST | `/payments/deposits`, `/payments/deposits/:id/check`, `/payments/withdrawals` 🔒 | Dépôts et retraits |
| GET | `/keno/config` | Table de gains, mises, RTP (public) |
| POST | `/keno/bets`, `/keno/autoplay` 🔒 | Mise unique, série de 5 à 100 mises |
| GET | `/keno/bets`, `/keno/stats` 🔒 | 50 derniers tirages, numéros chauds et froids |
| GET, POST | `/keno/seeds`, `/keno/seeds/rotate`, `/keno/seeds/revealed` 🔒 | Graines du tirage vérifiable |
| POST | `/keno/verify` | Recalcule un tirage à partir des graines (public) |
| POST | `/admin/auth/login` | Connexion back-office (mot de passe + TOTP) |
| GET | `/admin/dashboard` 🛡️ | Mises, gains, GGR, joueurs actifs par jour |
| GET, PUT | `/admin/settings` 🛡️ | Paramètres du jeu (modification : `super_admin`) |
| GET, PATCH | `/admin/players` 🛡️ | Recherche, blocage, KYC, limites |
| GET, POST | `/admin/withdrawals`, `…/:id/approve`, `…/:id/reject` 🛡️ | Validation des retraits au-dessus du seuil |
| GET | `/admin/exports/{bets,ledger,payments}` 🛡️ | Exports CSV |

## Reste à faire

- Connecteurs MonCash et NatCash (interface prête dans `src/payments/providers/provider.ts`) et fournisseur SMS réel.
- Envoi des pièces KYC (aujourd'hui le statut est changé par le support).
- Dépôts et retraits en point de vente (F-07), notifications push (F-24), bonus (F-23).
- WebSocket pour pousser le solde en temps réel ; Redis si plusieurs instances.
