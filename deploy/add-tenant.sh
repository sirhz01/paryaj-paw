#!/usr/bin/env bash
# Crée l'instance d'un exploitant : sa base, ses secrets, son service et son sous-domaine. Usage :
#   sudo bash add-tenant.sh <nom> <email-du-proprietaire>
# La première fois, indiquer aussi le domaine et votre adresse d'éditeur (retenus ensuite dans /etc/paryaj-paw/platform.conf) :
#   sudo BASE_DOMAIN=paryajpaw.online PLATFORM_EMAIL=vous@exemple.com bash add-tenant.sh bank1 patron@bank1.ht
# Prérequis : setup-vps.sh a déjà tourné sur ce serveur, et le DNS de <nom>.<domaine> (ou *.<domaine>) pointe vers lui.
set -euo pipefail
. "$(dirname "$0")/tenant-lib.sh"
require_root

NAME="${1:?Usage : add-tenant.sh <nom> <email-du-proprietaire>}"
OWNER_EMAIL="${2:?Usage : add-tenant.sh <nom> <email-du-proprietaire>}"
check_name "$NAME"
[ -f "$APP/backend/dist/main.js" ] || { echo "$APP n'est pas installé : lancer d'abord setup-vps.sh." >&2; exit 1; }
[ ! -e "$TENANTS/$NAME.env" ] || { echo "L'exploitant « $NAME » existe déjà." >&2; exit 1; }

mkdir -p "$TENANTS"
chown root:paryaj "$ETC" "$TENANTS"
chmod 750 "$ETC" "$TENANTS"
[ ! -f "$ETC/platform.conf" ] || . "$ETC/platform.conf"
: "${BASE_DOMAIN:?Première utilisation : indiquer BASE_DOMAIN=votre.domaine}"
: "${PLATFORM_EMAIL:?Première utilisation : indiquer PLATFORM_EMAIL=votre adresse (compte éditeur créé dans chaque instance)}"
PLATFORM_EMAIL="$(echo "$PLATFORM_EMAIL" | tr '[:upper:]' '[:lower:]')"
OWNER_EMAIL="$(echo "$OWNER_EMAIL" | tr '[:upper:]' '[:lower:]')"
[ "$OWNER_EMAIL" != "$PLATFORM_EMAIL" ] || { echo "Le propriétaire doit avoir une autre adresse que la vôtre." >&2; exit 1; }
printf 'BASE_DOMAIN=%s\nPLATFORM_EMAIL=%s\n' "$BASE_DOMAIN" "$PLATFORM_EMAIL" > "$ETC/platform.conf"

# Port : le suivant après le plus grand déjà attribué (3101, 3102…). Le 3000 reste à l'instance d'origine.
PORT=3101
for other in $(tenant_names); do
  used="$(tenant_value "$other" PORT)"
  [ "$used" -lt "$PORT" ] || PORT=$((used + 1))
done

DOMAIN="$NAME.$BASE_DOMAIN"
DB="pp_$NAME"
DBPASS="$(openssl rand -hex 16)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "CREATE USER $DB WITH PASSWORD '$DBPASS';"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $DB OWNER $DB;"
# Par défaut tout rôle peut se connecter à toute base : on réserve celle-ci à son exploitant.
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "REVOKE CONNECT ON DATABASE $DB FROM PUBLIC;"

cat > "$TENANTS/$NAME.env" <<ENV
NODE_ENV=production
PORT=$PORT
TENANT_DOMAIN=$DOMAIN
DATABASE_URL=postgres://$DB:$DBPASS@localhost:5432/$DB
JWT_SECRET=$(openssl rand -hex 32)
STAFF_JWT_SECRET=$(openssl rand -hex 32)
AGENT_JWT_SECRET=$(openssl rand -hex 32)
OTP_PEPPER=$(openssl rand -hex 32)
CORS_ORIGINS=https://$DOMAIN
TRUST_PROXY=true
FORCE_HTTPS=true
PAYMENTS_FAKE=false
STAFF_TOTP=on
FRONT_DIR=..
TICKET_QR_BASE_URL=https://$DOMAIN/t/
PLATFORM_ADMIN_EMAIL=$PLATFORM_EMAIL
ENV
chown root:paryaj "$TENANTS/$NAME.env"
chmod 640 "$TENANTS/$NAME.env"

cat > /etc/systemd/system/paryaj-paw@.service <<UNIT
[Unit]
Description=Paryaj Paw, exploitant %i
After=network.target postgresql.service
[Service]
User=paryaj
WorkingDirectory=$APP/backend
EnvironmentFile=$TENANTS/%i.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
[Install]
WantedBy=multi-user.target
UNIT

run_tenant "$NAME" node dist/scripts/migrate.js
echo
echo "=== Compte du propriétaire ($OWNER_EMAIL) : à lui transmettre ==="
run_tenant "$NAME" node dist/scripts/create-staff.js --email "$OWNER_EMAIL" --role super_admin
echo
echo "=== Votre compte éditeur ($PLATFORM_EMAIL) : à garder pour vous ==="
run_tenant "$NAME" node dist/scripts/create-staff.js --email "$PLATFORM_EMAIL" --role super_admin
echo

systemctl daemon-reload
systemctl enable --now "paryaj-paw@$NAME"
write_caddy_site "$NAME" actif
echo "OK : https://$DOMAIN/admin.html (port interne $PORT, base $DB). Les mots de passe ci-dessus ne seront plus affichés."
