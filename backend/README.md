# Back-end Paryaj Paw — 5 jeux

API NestJS + PostgreSQL pour le web, l'Android, l'application desktop et l'application des points de vente. Un seul compte, un seul portefeuille en HTG et un seul back-office pour :

| Jeu | Type | Tirage |
| --- | --- | --- |
| Roulette européenne (0) | Roulette | Instantané, propre à chaque joueur |
| Roulette américaine (0, 00) | Roulette | Instantané, propre à chaque joueur |
| Keno 20/80 (jusqu'à 15 numéros) | Loterie de numéros | Instantané, propre à chaque joueur |
| Lucky Six (35 sur 48) | Tirage programmé | Toutes les 5 min, commun à tous |
| Lucky 10 (20 sur 80) | Tirage programmé | Toutes les 5 min, commun à tous |

Tout le calcul (tirage, gains, solde) se fait ici ; les clients n'affichent que le résultat.

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

En développement, les codes SMS s'affichent dans la console et le fournisseur de paiement `fake` valide tout dépôt et tout retrait. Le planificateur des tirages Lucky Six et Lucky 10 démarre avec le serveur.

## Tests et simulation

```bash
npm test                                   # 153 tests, dont le parcours complet sur un PostgreSQL en mémoire
npm run build
npm run simulate:keno -- --rounds 10000000
npm run simulate:roulette -- --spins 10000000 --variant european   # ou american
npm run simulate:draws -- --game lucky_six --draws 10000000         # ou lucky_ten
```

Les simulations mesurent le RTP de chaque pari et l'uniformité des numéros (khi-deux), les deux premiers critères d'acceptation des cahiers des charges. Le moteur de règles de la roulette (`src/roulette/rules.ts`) est couvert à 100 % : chaque position du tapis est testée contre chaque case, en européenne et en américaine.

## Choix techniques

| Sujet | Choix |
| --- | --- |
| Montants | Entiers en centimes de gourde (`amountCents`, 100 = 1 HTG) |
| Solde | Écrit uniquement par `WalletService` ; chaque mouvement ajoute une ligne au journal `ledger_entries`, qui est append-only |
| Mise | Débit, tirage, gain et journal dans une seule transaction, sous verrou du portefeuille |
| Coupure réseau | Chaque mise, ticket et paiement porte une `idempotencyKey` : un renvoi rend le même résultat, jamais un double débit |
| Tirage instantané | HMAC-SHA256 (graine serveur, graine client, nonce), entiers tirés sans biais de modulo. Une paire de graines par joueur et par jeu ; le hash de la graine serveur est publié avant la mise |
| Tirage programmé | Graine tirée à la création du tirage, hash publié avant l'ouverture des mises, graine révélée après le tirage. Résultat = HMAC-SHA256(graine, « jeu:numéro du tirage »). Graine, horaire et résultat sont figés par un déclencheur SQL |
| Planificateur | Dans l'API, chaque seconde : crée les prochains créneaux, tire à l'heure, règle les tickets par lots. Plusieurs instances possibles (`FOR UPDATE SKIP LOCKED`). Un tirage en retard de plus de 60 s est annulé et remboursé |
| Gros gains | Au-dessus de `reviewThresholdCents`, un gain de ticket attend la validation de la finance avant d'être crédité |
| Points de vente | Chaque agent a un crédit de vente (« float ») avec son journal append-only : il baisse quand l'agent encaisse du liquide (ticket vendu, dépôt d'un joueur) et monte quand il en décaisse (gain payé, retrait) ou touche une commission. La finance le recharge quand l'agent verse son liquide ; une limite de crédit autorise un solde négatif |
| Commissions | En points de base, fixées par agent. Ventes : sur chaque mise réellement jouée, versée au règlement du tirage (rien sur une mise remboursée), au taux du jour de la vente. Dépôts : versée au moment du dépôt |
| Paramètres | Versionnés par jeu ; un ticket est réglé avec la version en vigueur à son achat. RTP de chaque pari exigé entre 90 et 95 % (Keno, Lucky Six, Lucky 10) |
| Jeu responsable | Compte bloqué, auto-exclusion et limite de perte du jour vérifiés avant chaque mise, tous jeux confondus |
| Back-office | Comptes séparés, mot de passe + TOTP, rôles `super_admin`, `finance`, `support`, `auditor`, journal d'audit |
| Direct | Server-Sent Events sur `/draws/stream` (résultats, annulations) pour l'écran TV et le lobby |
| Dates | Journées comptées en heure d'Haïti (`America/Port-au-Prince`) |

Les erreurs ont la forme `{ "code": "INSUFFICIENT_FUNDS", ... }` : les clients traduisent le code en kreyòl, français ou anglais.

## Routes

Préfixe : `/api/v1`. 🔒 = jeton joueur (`Authorization: Bearer …`), 🛡️ = jeton back-office, 🏪 = jeton agent. `{roulette}` = `roulette` (européenne) ou `american-roulette`.

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
| GET | `/lobby` | Les 5 jeux, prochain tirage et compte à rebours de Lucky Six et Lucky 10 (public) |
| GET | `/keno/config` | Table de gains, mises, RTP (public) |
| POST | `/keno/bets`, `/keno/autoplay` 🔒 | Mise unique, série de 5 à 100 mises |
| GET | `/keno/bets`, `/keno/stats` 🔒 | 50 derniers tirages, numéros chauds et froids |
| GET, POST | `/keno/seeds`, `/keno/seeds/rotate`, `/keno/seeds/revealed` 🔒 | Graines du tirage vérifiable |
| POST | `/keno/verify` | Recalcule un tirage à partir des graines (public) |
| GET | `/{roulette}/config` | Jetons, limites, table de paiement, RTP, roue, annonces de la piste (public) |
| POST | `/{roulette}/spins`, `/{roulette}/autoplay` 🔒 | Un tour avec toutes ses mises, série de 5 à 100 tours |
| GET | `/{roulette}/spins`, `/{roulette}/stats` 🔒 | 50 derniers tours, rouge/noir, zéros, douzaines, chauds et froids |
| GET, POST | `/{roulette}/seeds`, `…/seeds/rotate`, `…/seeds/revealed` 🔒 | Graines de la roulette |
| POST | `/{roulette}/verify` | Recalcule le numéro d'un tour (public) |
| GET | `/draws/{lucky_six,lucky_ten}/config` | Mises, coefficients, paris annexes et RTP de chacun (public) |
| GET | `/draws/:game/upcoming`, `/draws/:game/results?date=&drawId=`, `/draws/:game/:id` | Prochains tirages (hash publié), résultats par jour ou par numéro (public) |
| POST | `/draws/verify` | Recalcule les boules d'un tirage à partir de sa graine révélée (public) |
| GET | `/draws/stream` | Direct des résultats (Server-Sent Events, public) |
| POST | `/tickets` 🔒 | Achat d'un ticket sur 1 à N tirages consécutifs |
| GET | `/tickets`, `/tickets/:code` 🔒 | Historique par jeu (en attente, gagnant, perdant, remboursé), détail par code |
| POST | `/admin/auth/login` | Connexion back-office (mot de passe + TOTP) |
| GET | `/admin/dashboard` 🛡️ | Mises, gains, GGR et joueurs actifs par jour, au total et par jeu |
| GET, PUT | `/admin/keno/settings`, `/admin/roulette/{european,american}/settings`, `/admin/draws/:game/settings` 🛡️ | Paramètres des jeux (modification : `super_admin`) |
| GET | `/admin/roulette/alerts` 🛡️ | Tours dont les mises couvraient toute la roue (anti-blanchiment) |
| GET, POST | `/admin/draws/reviews`, `…/:entryId/approve`, `…/:entryId/reject` 🛡️ | Gros gains de tickets à valider |
| POST | `/admin/draws/:drawId/cancel` 🛡️ | Annulation d'un tirage à venir, mises rendues (`super_admin`) |
| GET, PATCH | `/admin/players` 🛡️ | Recherche, blocage, KYC, limites |
| GET, POST | `/admin/withdrawals`, `…/:id/approve`, `…/:id/reject` 🛡️ | Validation des retraits au-dessus du seuil |
| POST, GET, PATCH | `/admin/agents`, `/admin/agents/:id` 🛡️ | Création (code PV0001…), recherche, blocage, commissions, limite de crédit |
| POST | `/admin/agents/:id/float` 🛡️ | Versement de l'agent (`topup`) ou paiement de son crédit (`withdrawal`), finance |
| GET | `/admin/agents/:id/summary`, `/admin/agents/:id/ledger` 🛡️ | Activité d'un point de vente |
| GET | `/admin/exports/{bets,spins,tickets,draws,ledger,agent_ledger,payments}` 🛡️ | Exports CSV |
| POST | `/agent/auth/login` | Connexion d'un agent (téléphone + mot de passe, session de 12 h) |
| GET | `/agent/me`, `/agent/summary?from=&to=`, `/agent/ledger` 🏪 | Crédit, rapport du jour (ventes, gains payés, dépôts, retraits, commissions, liquide attendu) |
| POST | `/agent/tickets` 🏪 | Vente d'un ticket Lucky Six ou Lucky 10 (`customerIsAdult: true` obligatoire) ; renvoie le code et le contenu du QR |
| GET | `/agent/tickets`, `/agent/tickets/:code` 🏪 | Ventes de l'agent ; ticket présenté au guichet et montant dû |
| POST | `/agent/tickets/:code/redeem` 🏪 | Paiement d'un ticket gagnant, par n'importe quel agent, une seule fois |
| POST | `/agent/deposits` 🏪 | Dépôt en liquide sur le compte d'un joueur (par son téléphone) |
| POST | `/agent/withdrawals/pickup` 🏪 | Remise d'un retrait en liquide (téléphone + code du joueur) |
| GET | `/public/tickets/:code` | Résultat d'un ticket vendu au guichet, pour le porteur qui scanne le QR (public) |
| POST | `/payments/withdrawals/:id/pickup-code`, `/payments/withdrawals/:id/cancel` 🔒 | Retrait au guichet : code valable 24 h, annulation tant qu'il n'est pas touché |

## Mise de roulette

Un tour envoie toutes ses mises d'un coup ; le serveur additionne les jetons posés sur une même position puis vérifie les limites. En américaine, le 00 s'écrit **37**.

```json
{
  "idempotencyKey": "tour-7f3a9c21",
  "bets": [
    { "type": "straight", "numbers": [17], "amountCents": 1000 },
    { "type": "split", "numbers": [17, 20], "amountCents": 1000 },
    { "type": "dozen", "index": 2, "amountCents": 2500 },
    { "type": "red", "amountCents": 5000 },
    { "type": "voisins_du_zero", "amountCents": 1000 },
    { "type": "neighbors", "numbers": [26], "amountCents": 1000 }
  ]
}
```

Types : `straight`, `split`, `street`, `corner`, `top_line` (américaine : 0, 00, 1, 2, 3), `line` (avec `numbers`), `dozen`, `column` (avec `index` 1 à 3), `red`, `black`, `even`, `odd`, `low`, `high`, et en européenne les annonces de la piste `voisins_du_zero`, `tiers`, `orphelins`, `neighbors` (montant = valeur d'un jeton). « Rejouer », « Doubler » et « Annuler dernier jeton » se font côté client.

## Ticket Lucky Six / Lucky 10

```json
{ "game": "lucky_six", "bet": { "type": "six", "numbers": [3, 8, 15, 22, 40, 47] }, "stakeCents": 1000, "draws": 3, "idempotencyKey": "ticket-5d1e8a" }
```

| Jeu | Pari principal | Paris annexes |
| --- | --- | --- |
| Lucky Six | `six` : 6 numéros sur 48, payé selon la position (6 à 35) de la boule qui les complète | `first_even`, `first_odd`, `first_low`, `first_high`, `first_color` (+ `color`), `sum5_under`, `sum5_over`, `more_even5`, `more_odd5` |
| Lucky 10 | `numbers` : 1 à 10 numéros sur 80, table de gains, bonus si le dernier numéro tiré est trouvé | `more_even`, `more_odd`, `more_low`, `more_high` (10/10 perd), `sum_under`, `sum_over` (seuil 810,5), `first_even`, `first_odd`, `first_color` |

Couleurs : `red`, `green`, `blue`, `purple`, `brown`, `yellow`, `orange`, `black` ; le numéro n a la couleur (n − 1) mod 8.

## Point de vente

1. Vente : l'agent encaisse le liquide et appelle `POST /agent/tickets` ; il imprime le code et le QR (`qrPayload`, préfixé par `TICKET_QR_BASE_URL` si elle est définie).
2. Le porteur suit son ticket en scannant le QR (`GET /public/tickets/:code`), sans compte.
3. Paiement : dans n'importe quel point de vente, l'agent scanne le ticket ; une fois tous les tirages réglés, `POST /agent/tickets/:code/redeem` lui indique la somme à remettre (gains, plus les mises d'un tirage annulé ou d'un gros gain refusé) et la rend à son crédit.
4. Retrait d'un joueur : il demande un retrait `provider: "agent"` dans l'application, génère un code, et le donne au guichet avec son téléphone.

## Reste à faire

- Connecteurs MonCash et NatCash (interface prête dans `src/payments/providers/provider.ts`) et fournisseur SMS réel.
- Envoi des pièces KYC (aujourd'hui le statut est changé par le support).
- Notifications SMS et push (dépôt, retrait, ticket gagnant).
- Délai de péremption des tickets gagnants non réclamés au guichet (à fixer avec l'autorité).
- Relais Redis pour le direct et WebSocket du solde si plusieurs instances.
