/* Service worker de l'administration : rend l'app installable sur téléphone, mais ne met RIEN en cache.
   Toutes les données (ventes, caisses, rapports) viennent du serveur en ligne ; hors connexion, rien d'admin n'est affiché. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
