#!/usr/bin/env bash
# Déploiement sur un VPS Ubuntu 22.04/24.04 (root). Usage :
#   sudo DOMAIN=jeu.exemple.com bash setup-vps.sh
# Installe Node 22, PostgreSQL, Caddy (HTTPS automatique), clone le dépôt GitHub, construit et lance le service.
set -euo pipefail
: "${DOMAIN:?Indiquer DOMAIN=votre.domaine (son DNS A doit pointer vers ce VPS)}"
REPO="${REPO:-https://github.com/sirhz01/paryaj-paw}"
APP=/opt/paryaj-paw
DBPASS="$(openssl rand -hex 16)"

apt-get update
apt-get install -y curl git ca-certificates gnupg openssl postgresql debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs build-essential
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy.list
apt-get update && apt-get install -y caddy

id paryaj >/dev/null 2>&1 || useradd -r -m -d "$APP" -s /usr/sbin/nologin paryaj
if [ ! -d "$APP/.git" ]; then git clone "$REPO" "$APP"; fi
chown -R paryaj:paryaj "$APP"

if [ ! -f "$APP/backend/.env" ]; then
  sudo -u postgres psql -c "CREATE USER keno WITH PASSWORD '$DBPASS';" || true
  sudo -u postgres psql -c "CREATE DATABASE keno OWNER keno;" || true
  cat > "$APP/backend/.env" <<ENV
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://keno:$DBPASS@localhost:5432/keno
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
ENV
  chown paryaj:paryaj "$APP/backend/.env"; chmod 600 "$APP/backend/.env"
fi

cd "$APP/backend"
sudo -u paryaj npm ci
sudo -u paryaj npm run build
sudo -u paryaj npm run migrate

cat > /etc/systemd/system/paryaj-paw.service <<UNIT
[Unit]
Description=Paryaj Paw (API + front)
After=network.target postgresql.service
[Service]
User=paryaj
WorkingDirectory=$APP/backend
ExecStart=/usr/bin/node dist/main.js
Restart=always
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
CADDY

systemctl daemon-reload
systemctl enable --now paryaj-paw
systemctl restart caddy
echo "OK : https://$DOMAIN  (créer un compte caisse : cd $APP/backend && sudo -u paryaj npm run staff:create -- --email … --role cashier)"
