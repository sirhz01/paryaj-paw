#!/usr/bin/env bash
# Démarre en local, et garde en marche, le back-end (démo) et le site web des joueurs.
# À lancer depuis votre terminal : les serveurs restent actifs tant que votre session est ouverte.
#
#   Usage :  bash scripts/serve-local.sh
#
# Ensuite, pour mettre le site EN LIGNE, ouvrez le tunnel (commande fournie dans le chat) :
#     cloudflared tunnel --url http://localhost:5173
#
# ATTENTION : mode démo (comptes et mots de passe publics, paiements factices). Test court uniquement.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

listening() { ss -ltn 2>/dev/null | grep -q ":$1 "; }
wait_up() { for _ in $(seq 1 60); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done; return 1; }

if listening 3000; then
  echo "→ Back-end déjà en marche (:3000)."
else
  echo "→ Démarrage du back-end (démo) sur http://localhost:3000 …"
  ( cd "$ROOT/backend" && STAFF_TOTP=off nohup npm run demo >/tmp/paryaj-demo.log 2>&1 & )
fi

if listening 5173; then
  echo "→ Site web déjà en marche (:5173)."
else
  echo "→ Démarrage du site web (Vite) sur http://localhost:5173 …"
  # --host : écoute sur toutes les interfaces (IPv4 comprise), nécessaire pour que le tunnel (cloudflared,
  # qui joint 127.0.0.1) atteigne Vite ; sans lui, Vite n'écoute que sur [::1] (IPv6) et le tunnel renvoie 404.
  ( cd "$ROOT/web" && nohup npx vite --host --port 5173 >/tmp/paryaj-vite.log 2>&1 & )
fi

echo "→ Attente des serveurs …"
wait_up http://localhost:3000/ || { echo "Back-end injoignable (voir /tmp/paryaj-demo.log)" >&2; exit 1; }
wait_up http://localhost:5173/ || { echo "Site web injoignable (voir /tmp/paryaj-vite.log)" >&2; exit 1; }

echo
echo "✓ Prêts : back-end http://localhost:3000  ·  site web http://localhost:5173"
echo "  Les serveurs tournent en arrière-plan. Laissez ce terminal ouvert."
echo "  Prochaine étape (vous) : ouvrir le tunnel pour la mise en ligne (voir le chat)."
