#!/usr/bin/env bash
# Suspend ou rétablit un exploitant sans toucher à ses données (abonnement impayé, par exemple). Usage :
#   sudo bash tenant-access.sh <nom> off     arrête son service ; son adresse affiche « Service suspendu »
#   sudo bash tenant-access.sh <nom> on      le relance
#   sudo bash tenant-access.sh list          état de chaque exploitant
set -euo pipefail
. "$(dirname "$0")/tenant-lib.sh"
require_root

if [ "${1:-}" = list ]; then
  for name in $(tenant_names); do
    printf '%-20s %-10s https://%s\n' "$name" "$(systemctl is-active "paryaj-paw@$name" || true)" "$(tenant_value "$name" TENANT_DOMAIN)"
  done
  exit 0
fi

NAME="${1:?Usage : tenant-access.sh <nom> on|off  (ou : list)}"
check_name "$NAME"
[ -f "$TENANTS/$NAME.env" ] || { echo "Exploitant inconnu : $NAME" >&2; exit 1; }
case "${2:-}" in
  off)
    systemctl disable --now "paryaj-paw@$NAME"
    write_caddy_site "$NAME" suspendu
    echo "$NAME suspendu (données conservées)."
    ;;
  on)
    systemctl enable --now "paryaj-paw@$NAME"
    write_caddy_site "$NAME" actif
    echo "$NAME rétabli."
    ;;
  *)
    echo "Usage : tenant-access.sh <nom> on|off  (ou : list)" >&2
    exit 1
    ;;
esac
