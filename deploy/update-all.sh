#!/usr/bin/env bash
# Met à jour le code une fois, puis migre et redémarre chaque exploitant l'un après l'autre :
#   sudo bash /opt/paryaj-paw/deploy/update-all.sh
# Un exploitant suspendu est migré mais pas relancé. S'arrête à la première erreur : les suivants gardent l'ancien schéma
# et leur service continue de tourner sur l'ancien code chargé en mémoire jusqu'à la relance.
set -euo pipefail
. "$(dirname "$0")/tenant-lib.sh"
require_root

cd "$APP"
sudo -u paryaj git pull --ff-only
cd backend
sudo -u paryaj npm ci
sudo -u paryaj npm run build

if [ -f "$APP/backend/.env" ] && systemctl is-enabled --quiet paryaj-paw 2>/dev/null; then
  sudo -u paryaj npm run migrate
  systemctl restart paryaj-paw
  echo "instance d'origine : à jour"
fi

for name in $(tenant_names); do
  run_tenant "$name" node dist/scripts/migrate.js
  if systemctl is-enabled --quiet "paryaj-paw@$name" 2>/dev/null; then
    systemctl restart "paryaj-paw@$name"
    echo "$name : à jour"
  else
    echo "$name : migré, laissé suspendu"
  fi
done
