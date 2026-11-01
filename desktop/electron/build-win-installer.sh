#!/usr/bin/env bash
# Construit l'installateur Windows .exe DEPUIS LINUX, sans wine.
#
#   1. electron-builder --dir  →  release/win-unpacked/  (l'application décompressée)
#   2. makensis installer.nsi  →  release/ParyajPawBoutik-0.1.0-setup.exe
#
# electron-builder refuse de produire le .exe final sous Linux (il réclame wine à l'étape
# de signature). On contourne : on lui demande seulement le dossier décompressé (--dir),
# puis on emballe nous-mêmes avec makensis (fourni par electron-builder, 100 % Linux).
#
# Usage :  cd desktop/electron && npm install && ./build-win-installer.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 1/2  Application décompressée (electron-builder --dir)"
if [ ! -f "release/win-unpacked/Paryaj Paw Boutik.exe" ]; then
  # Gourmand en mémoire : si la machine a < 2 Go libres, l'étape peut être tuée (OOM).
  # Dans ce cas, construire sur une machine mieux dotée ou via le workflow GitHub Actions.
  npx --no-install electron-builder --win --dir
else
  echo "    release/win-unpacked/ existe déjà — on le réutilise (supprimer pour reconstruire)."
fi

echo "==> 2/2  Installateur (makensis installer.nsi)"
MAKENSIS="$(command -v makensis || true)"
if [ -z "$MAKENSIS" ]; then
  # makensis livré avec electron-builder (téléchargé au premier build) — version Linux.
  MAKENSIS="$(ls "$HOME"/.cache/electron-builder/nsis/nsis-*/linux/makensis 2>/dev/null | head -1 || true)"
fi
if [ -z "$MAKENSIS" ]; then
  echo "makensis introuvable. Installer 'nsis' (apt install nsis) ou lancer 'npm install' d'abord." >&2
  exit 1
fi

"$MAKENSIS" installer.nsi
echo
echo "OK  →  release/ParyajPawBoutik-0.1.0-setup.exe"
