# Site web des joueurs — Paryaj Paw (React + Vite)

Application web pour les joueurs en ligne : compte, portefeuille (dépôts / retraits MonCash & NatCash) et
jeux (roulette américaine, Keno, Lucky Six, Lucky X). C'est un **client léger** : tout le calcul (tirages,
gains, solde) reste sur le back-end NestJS, appelé via `/api/v1`.

## Démarrer en développement

```bash
# 1) le back-end (dans un autre terminal)
cd ../backend && npm install && npm run build && npm run demo   # API sur http://localhost:3000

# 2) le site web
cd web && npm install
npm run dev        # http://localhost:5173
```

Le serveur Vite relaie `/api` vers `http://localhost:3000` (voir `vite.config.ts`) : **pas de CORS à
configurer** en développement. Pour pointer une autre API : `API_URL=http://192.168.1.10:3000 npm run dev`.

## Construire pour la production

```bash
npm run build      # → web/dist (fichiers statiques)
npm run preview    # prévisualise le build
```

En production, servir `web/dist` sur la même origine que l'API (ou derrière un reverse-proxy qui envoie
`/api` vers le back-end), pour que `/api/v1` fonctionne sans CORS.

## Structure

```
src/
  api/        client HTTP typé (jetons + rafraîchissement auto), types, messages d'erreur
  auth/       contexte d'authentification (connexion, inscription OTP, déconnexion)
  components/ Layout (barre + solde), ProtectedRoute
  pages/      Lobby, Login, Register, Wallet, Account, (jeux : à venir)
```

## État

- ✅ Compte : inscription par téléphone + code SMS, connexion, déconnexion, rafraîchissement de session.
- ✅ Portefeuille : solde, mouvements, dépôt et retrait (MonCash / NatCash).
- ✅ Lobby et navigation.
- ⏳ Interfaces de jeu (mises, tirage animé, résultat, historique) — prochaine étape.
