'use strict';
/*
 * Terminal de la boutique Paryaj Paw pour Windows (Electron).
 * C'est un client léger : il charge le front-end servi par le serveur (caisse et écrans TV),
 * il ne contient ni jeu ni base de données. Par défaut il ouvre le serveur local (localhost:3000) ;
 * l'adresse peut être changée via le menu « Boutique → Changer de serveur… ». Tout le calcul reste sur le serveur.
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Une seule instance : un second lancement ramène la fenêtre existante au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const TV_PAGES = [
  { label: 'Roulette', page: 'roulette.html' },
  { label: 'Keno', page: 'keno.html' },
  { label: 'Lucky Six', page: 'luckysix.html' },
  { label: 'Lucky X', page: 'luckyx.html' },
];

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

/**
 * Normalise l'adresse du serveur (sans / final) :
 *  - « 192.168.1.10 »        → « http://192.168.1.10:3000 »  (serveur local, port 3000 par défaut)
 *  - « https://paryajpaw.online » → inchangé (HTTPS = port 443 par défaut ; ne jamais forcer :3000)
 */
function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  const isHttps = /^https:\/\//i.test(s);
  const hostAndPath = s.replace(/^https?:\/\//i, '');
  // Port 3000 ajouté seulement pour un serveur local en http sans port ; en https on garde le port par défaut (443).
  if (!isHttps && !/:\d+(\/|$)/.test(hostAndPath)) s = s.replace(/\/+$/, '') + ':3000';
  return s.replace(/\/+$/, '');
}

// Serveur par défaut : le système en ligne (Vercel + base Neon). La caisse et le back-office travaillent
// ainsi sur les mêmes comptes, paris et caisses que le site des joueurs. Pour pointer un serveur local
// (démo sur ce poste), utiliser « Boutique → Changer de serveur… ».
const DEFAULT_SERVER = 'https://paryajpaw.online';

let win;

function serverUrl() {
  return readConfig().server || DEFAULT_SERVER;
}

function loadServerPage(page = '') {
  return win.loadURL(`${serverUrl()}/${page}`);
}

/**
 * Écran TV dans sa propre fenêtre, sur le 2e écran (HDMI en mode « Étendre ») : la caisse reste sur le portable.
 * Avec un seul écran, la fenêtre s'ouvre normalement (pas de plein écran qui cacherait la caisse).
 */
let tvWin;
const hasExternalDisplay = () => screen.getAllDisplays().length > 1;
/** Écran TV ouvert automatiquement au démarrage et au branchement du 2e écran : le dernier choisi, sinon Keno. */
const tvPageSaved = () => readConfig().tvPage || TV_PAGES[1].page;
function autoOpenTv() {
  if (readConfig().tvAuto !== false && hasExternalDisplay()) openTvWindow(tvPageSaved(), false);
}

function openTvWindow(page, remember = true) {
  if (remember) writeConfig({ tvPage: page });
  const url = `${serverUrl()}/${page}`;
  if (tvWin && !tvWin.isDestroyed()) {
    tvWin.loadURL(url);
    tvWin.focus();
    return;
  }
  const primary = screen.getPrimaryDisplay();
  const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const target = external || primary;
  tvWin = new BrowserWindow({
    x: target.bounds.x + (external ? 0 : 60),
    y: target.bounds.y + (external ? 0 : 60),
    width: external ? target.bounds.width : 1100,
    height: external ? target.bounds.height : 650,
    backgroundColor: '#0c1016',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  if (external) tvWin.setFullScreen(true);
  // F = plein écran, comme sur les écrans TV du front.
  tvWin.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F' || input.key === 'f') && !input.control && !input.meta) {
      tvWin.setFullScreen(!tvWin.isFullScreen());
      event.preventDefault();
    }
  });
  tvWin.on('closed', () => { tvWin = null; });
  tvWin.loadURL(url);
}

function setFullScreen(on) {
  if (win) win.setFullScreen(on);
}

function buildMenu() {
  const template = [
    {
      label: 'Boutique',
      submenu: [
        { label: 'Caisse', accelerator: 'CmdOrCtrl+1', click: () => { setFullScreen(false); loadServerPage('caisse.html'); } },
        { label: 'Administration', accelerator: 'CmdOrCtrl+Shift+A', click: () => { setFullScreen(false); loadServerPage('admin.html'); } },
        { label: 'Site des joueurs', accelerator: 'CmdOrCtrl+H', click: () => { setFullScreen(false); loadServerPage(''); } },
        { type: 'separator' },
        { label: 'Changer de serveur…', accelerator: 'CmdOrCtrl+Shift+S', click: () => win.loadFile('config.html') },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' },
      ],
    },
    {
      label: 'Écrans TV',
      submenu: TV_PAGES.map((t, i) => ({
        label: t.label,
        accelerator: `CmdOrCtrl+${i + 2}`,
        // Avec un 2e écran (TV en HDMI « Étendre »), l'écran TV s'ouvre directement dessus ; la caisse reste sur le portable.
        click: () => {
          if (hasExternalDisplay()) return openTvWindow(t.page);
          loadServerPage(t.page);
          setFullScreen(true);
        },
      })).concat([
        { type: 'separator' },
        {
          label: 'Ouvrir l’écran TV automatiquement',
          type: 'checkbox',
          checked: readConfig().tvAuto !== false,
          click: (item) => {
            writeConfig({ tvAuto: item.checked });
            if (item.checked) autoOpenTv();
          },
        },
        { label: 'Fermer l’écran TV', click: () => { if (tvWin && !tvWin.isDestroyed()) tvWin.close(); } },
      ]),
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { type: 'separator' },
        { role: 'resetzoom', label: 'Zoom normal' },
        { role: 'zoomin', label: 'Agrandir' },
        { role: 'zoomout', label: 'Réduire' },
        { type: 'separator' },
        { role: 'toggledevtools', label: 'Outils de développement' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'Paryaj Paw Boutik',
              message: 'Paryaj Paw Boutik',
              detail: `Version ${app.getVersion()}\nServeur : ${readConfig().server || DEFAULT_SERVER + ' (par défaut)'}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    backgroundColor: '#0c1016',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // F11 géré par Electron ; la touche F est gérée par les pages TV elles-mêmes (js/common.js). On ne l'intercepte
  // pas ici : le scanner de la caisse « tape » les codes de tickets, qui peuvent contenir un F.

  // Les liens « ouvrir ailleurs » partent dans le navigateur par défaut, pas dans une fenêtre sans menu.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Serveur injoignable : avec le serveur par défaut (en ligne), on ne demande JAMAIS l'adresse — simple message qui réessaie
  // tout seul. L'écran de configuration ne s'ouvre automatiquement que si une adresse personnalisée a été saisie.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3 || !url.startsWith('http')) return; // -3 = chargement annulé (navigation normale)
    if (readConfig().server) return win.loadFile('config.html');
    const page = '<meta charset="utf-8"><body style="font:20px Segoe UI,sans-serif;background:#14285f;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center">'
      + '<div><h2>Pas de connexion à Internet</h2><p>Nouvel essai automatique dans quelques secondes…</p><p style="opacity:.6;font-size:14px">' + desc + '</p></div>'
      + '<script>setTimeout(function(){location.href=' + JSON.stringify(serverUrl() + '/caisse.html') + '},5000)</script>';
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  });

  buildMenu();
  // L'app boutique s'ouvre sur la caisse ; le back-office est dans le menu « Boutique → Administration ».
  loadServerPage('caisse.html');
}

// L'écran de configuration enregistre l'adresse du serveur et ouvre l'accueil.
ipcMain.handle('config:get', () => ({ server: readConfig().server || '', version: app.getVersion() }));
ipcMain.handle('config:test', async (_e, raw) => {
  const server = normalizeServer(raw);
  if (!server) return { ok: false, error: 'Adresse vide' };
  try {
    const res = await fetch(`${server}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? { ok: true, server } : { ok: false, error: `Réponse ${res.status}` };
  } catch (e) {
    return { ok: false, error: 'Serveur injoignable' };
  }
});
ipcMain.handle('config:save', (_e, raw) => {
  const server = normalizeServer(raw);
  if (!server) return { ok: false };
  writeConfig({ server });
  loadServerPage('caisse.html');
  return { ok: true, server };
});

app.whenReady().then(() => {
  createWindow();
  // Écran TV automatique : au démarrage, puis dès que la TV (HDMI) est branchée ; fermé si elle est débranchée.
  win.webContents.once('did-finish-load', () => setTimeout(autoOpenTv, 800));
  screen.on('display-added', () => setTimeout(autoOpenTv, 1500));
  screen.on('display-removed', () => {
    if (!hasExternalDisplay() && tvWin && !tvWin.isDestroyed()) tvWin.close();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Mise à jour automatique (uniquement dans l'application installée, pas en développement).
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch {
      /* electron-updater absent en développement */
    }
  }
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
