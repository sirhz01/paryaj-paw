#!/usr/bin/env bash
# Sauvegarde la base de chaque exploitant dans /var/backups/paryaj-paw et supprime celles de plus de 14 jours.
# Chaque nuit à 3 h :  echo '0 3 * * * root bash /opt/paryaj-paw/deploy/backup-all.sh' | sudo tee /etc/cron.d/paryaj-paw-backup
# Ces fichiers restent sur le même serveur : les copier ailleurs pour survivre à la perte du VPS.
set -euo pipefail
. "$(dirname "$0")/tenant-lib.sh"
require_root

DEST=/var/backups/paryaj-paw
mkdir -p "$DEST"
chmod 700 "$DEST"
STAMP="$(date +%Y%m%d-%H%M)"
for name in $(tenant_names); do
  sudo -u postgres pg_dump "pp_$name" | gzip > "$DEST/$name-$STAMP.sql.gz"
  echo "$name : $DEST/$name-$STAMP.sql.gz"
done
find "$DEST" -name '*.sql.gz' -mtime +14 -delete
