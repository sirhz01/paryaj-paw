'use strict';
// Pont minimal et sûr entre l'écran de configuration et le processus principal.
// Aucune autre page (caisse, écrans TV servis par le serveur) ne reçoit d'accès système.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boutik', {
  get: () => ipcRenderer.invoke('config:get'),
  test: (server) => ipcRenderer.invoke('config:test', server),
  save: (server) => ipcRenderer.invoke('config:save', server),
});
