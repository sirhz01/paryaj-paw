'use strict';
/*
 * Terminal de la boutique Paryaj Paw pour Windows (Electron).
 * C'est un client léger : il charge le front-end servi par le serveur (caisse et écrans TV),
 * il ne contient ni jeu ni base de données. Par défaut il ouvre le serveur local (localhost:3000) ;
 * l'adresse peut être changée via le menu « Boutique → Changer de serveur… ». Tout le calcul reste sur le serveur.
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
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

/** Normalise « 192.168.1.10 » ou « 192.168.1.10:3000 » en « http://192.168.1.10:3000 » (sans / final). */
function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  if (!/:\d+(\/|$)/.test(s.replace(/^https?:\/\//i, ''))) s = s.replace(/\/+$/, '') + ':3000';
  return s.replace(/\/+$/, '');
}

// Serveur par défaut : l'application s'ouvre directement sur la boutique, sans demander d'adresse.
// Convient quand le serveur tourne sur le même poste. Pour pointer un autre serveur (écran TV sur un
// autre PC), utiliser « Boutique → Changer de serveur… ».
const DEFAULT_SERVER = 'http://localhost:3000';

let win;

function serverUrl() {
  return readConfig().server || DEFAULT_SERVER;
}

function loadServerPage(page = '') {
  return win.loadURL(`${serverUrl()}/${page}`);
}

function setFullScreen(on) {
  if (win) win.setFullScreen(on);
}

function buildMenu() {
  const template = [
    {
      label: 'Boutique',
      submenu: [
        { label: 'Accueil', accelerator: 'CmdOrCtrl+H', click: () => { setFullScreen(false); loadServerPage(''); } },
        { label: 'Caisse', accelerator: 'CmdOrCtrl+1', click: () => { setFullScreen(false); loadServerPage('caisse.html'); } },
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
        click: () => { loadServerPage(t.page); setFullScreen(true); },
      })),
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

  // F = plein écran (comme les écrans TV du front) ; F11 géré par Electron.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F' || input.key === 'f') && !input.control && !input.meta) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  // Les liens « ouvrir ailleurs » partent dans le navigateur par défaut, pas dans une fenêtre sans menu.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Si le serveur est injoignable, revenir à l'écran de configuration.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3 || !url.startsWith('http')) return; // -3 = chargement annulé (navigation normale)
    win.loadFile('config.html');
  });

  buildMenu();
  loadServerPage('');
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
  loadServerPage('');
  return { ok: true, server };
});

app.whenReady().then(() => {
  createWindow();
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
