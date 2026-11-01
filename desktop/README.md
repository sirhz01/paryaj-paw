# Application desktop — boutique Paryaj Paw (Windows)

Terminal de la boutique pour Windows 10 et 11 : **une seule application** qui ouvre la **caisse** et les
**écrans TV** (Roulette, Keno, Lucky Six, Lucky X). C'est un **client léger** — il ne contient ni jeu ni
base de données : il charge le front-end servi par le serveur et tout le calcul (tirage, gain, solde)
reste sur le serveur. Au premier lancement, l'application demande l'adresse du serveur de la boutique
(ex. `192.168.1.10`) et la garde.

Deux versions sont fournies, au choix :

| Version | Installateur | Avantage | À savoir |
| --- | --- | --- | --- |
| **Tauri 2** (`tauri/`) | ~5–10 Mo | Léger, utilise le WebView2 déjà présent sur Windows 10/11 ; c'est le choix du cahier des charges | Se construit sous Windows (Rust) |
| **Electron** (`electron/`) | ~75 Mo | Se construit aussi depuis Linux ; très simple | Installateur plus gros |

## Obtenir l'installateur `.exe` Electron

Deux chemins, au choix :

**A. Depuis Linux, sans machine Windows ni wine** — un script emballe le `.exe` avec le `makensis`
fourni par electron-builder :

```bash
cd desktop/electron
npm install
./build-win-installer.sh   # → desktop/electron/release/ParyajPawBoutik-0.1.0-setup.exe
```

L'installateur ainsi produit n'est **pas signé** (avertissement SmartScreen à la première ouverture ;
cliquer « Informations complémentaires → Exécuter quand même »). Pour un `.exe` signé, utiliser le chemin B.

**B. Via GitHub Actions (runner Windows)** — construit *aussi* la version Tauri et permet la signature :

0. Mettre le workflow en place une fois : copier `desktop/ci/desktop.yml` dans `.github/workflows/desktop.yml`
   (depuis le site GitHub : **Add file → Create new file**, nom `.github/workflows/desktop.yml`, coller le contenu).
   Il n'est pas versionné à cet emplacement car le jeton de ligne de commande n'a pas le droit d'écrire dans `.github/workflows/`.
1. Sur GitHub : onglet **Actions → « Application desktop (Windows) » → Run workflow** (ou pousser un tag `desktop-v0.1.0`).
2. À la fin, télécharger les artefacts `boutik-tauri-windows` et/ou `boutik-electron-windows` : ils contiennent le `…-setup.exe`.

## Construire soi-même

### Electron (Windows ou macOS)

```bash
cd desktop/electron
npm install
npm run dist          # → desktop/electron/release/ParyajPawBoutik-0.1.0-setup.exe
```

Sous **Linux**, `npm run dist` échoue (electron-builder réclame wine pour signer) : utiliser
`./build-win-installer.sh` ci-dessus, qui saute l'étape de signature et emballe avec makensis.

### Tauri 2 (sous Windows)

Prérequis : [Rust](https://rustup.rs), les outils de build Visual Studio C++, et Node.js.

```bash
cd desktop/tauri
npm install
npm run build         # → desktop/tauri/src-tauri/target/release/bundle/nsis/*.exe
```

Pour régénérer les icônes à partir d'une image : `npm run icon` (utilise `icon-source.png`).

## Utilisation

1. Lancer l'application ; saisir l'adresse du serveur de la boutique (le port par défaut est 3000), puis **Enregistrer**.
2. Menu **Boutique** : Accueil, Caisse, Changer de serveur. Menu **Écrans TV** : Roulette, Keno, Lucky Six, Lucky X.
3. Raccourcis : `F` ou `F11` plein écran, `Ctrl+1` caisse, `Ctrl+2..5` écrans TV, `Ctrl+Shift+S` changer de serveur.
4. Écran TV sur un second écran (HDMI en mode « Étendre ») : menu **Écrans TV → … sur le 2e écran**. La caisse reste sur le portable ; **Fermer l’écran TV** ferme cette fenêtre.

Le même serveur sert tous les terminaux de la boutique : installer l'application sur chaque poste et pointer
chacun vers la même adresse.

## Mise à jour automatique

- **Electron** : prête via `electron-updater`. Publier une version signée avec `npm run release` (nécessite un
  jeton GitHub `GH_TOKEN`), et l'application installée propose la mise à jour au lancement.
- **Tauri** : le plugin `updater` demande une paire de clés de signature (`npx tauri signer generate`). Non activé
  par défaut pour que le projet se construise sans configuration ; voir la documentation Tauri pour l'activer.

## Signature de l'installateur (Windows)

Pour éviter l'avertissement SmartScreen, signer le `.exe` avec un certificat de signature de code
(Authenticode). Avec Electron : variables `CSC_LINK` / `CSC_KEY_PASSWORD`. Avec Tauri : options de signature
dans `tauri.conf.json`. Le certificat est à obtenir auprès d'une autorité (coût annuel), comme prévu au budget.

## Limites connues

- Les installateurs ne sont pas encore signés : Windows affichera un avertissement SmartScreen tant qu'un
  certificat n'est pas configuré.
- La version Tauri n'a pas pu être compilée sur la machine de développement (Linux) ; elle se construit sur
  Windows via le workflow ci-dessus. La version Electron, elle, est construite et vérifiée : l'installateur
  `release/ParyajPawBoutik-0.1.0-setup.exe` (~81 Mo) est produit par `./build-win-installer.sh`. Il n'est
  pas versionné (dossier `release/` ignoré par git) ; le copier sur une clé USB / le réseau pour l'installer
  sur les postes Windows de la boutique.
