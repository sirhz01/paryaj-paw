#!/usr/bin/env bash
# Mise à jour depuis GitHub : sudo bash /opt/paryaj-paw/deploy/update.sh
set -euo pipefail
cd /opt/paryaj-paw
sudo -u paryaj git pull --ff-only
cd backend
sudo -u paryaj npm ci
sudo -u paryaj npm run build
sudo -u paryaj npm run migrate
systemctl restart paryaj-paw
