#!/usr/bin/env bash
# Fonctions communes aux scripts « un exploitant = une instance » (add-tenant, tenant-access, update-all, backup-all).
# Chaque exploitant a sa base PostgreSQL, son service systemd paryaj-paw@<nom> et son sous-domaine ; le code est partagé.

APP=/opt/paryaj-paw
ETC=/etc/paryaj-paw
TENANTS="$ETC/tenants"
CADDY_TENANTS=/etc/caddy/tenants

require_root() {
  [ "$(id -u)" = 0 ] || { echo "À lancer avec sudo." >&2; exit 1; }
}

# Nom d'exploitant : sert de nom de base, de service et de sous-domaine, d'où les caractères limités.
check_name() {
  [[ "$1" =~ ^[a-z][a-z0-9]{1,19}$ ]] || { echo "Nom invalide « $1 » : 2 à 20 lettres minuscules ou chiffres, en commençant par une lettre." >&2; exit 1; }
}

tenant_names() {
  local f
  for f in "$TENANTS"/*.env; do
    [ -e "$f" ] && basename "$f" .env
  done
  return 0
}

tenant_value() { # tenant_value <nom> <VARIABLE>
  sed -n "s/^$2=//p" "$TENANTS/$1.env" | head -n 1
}

# Lance une commande dans backend/ avec l'environnement d'un exploitant, sous l'utilisateur du service.
run_tenant() { # run_tenant <nom> <commande…>
  local name="$1"
  shift
  sudo -u paryaj bash -c 'set -a; . "$1"; set +a; cd "$2"; shift 2; exec "$@"' _ "$TENANTS/$name.env" "$APP/backend" "$@"
}

write_caddy_site() { # write_caddy_site <nom> <actif|suspendu>
  local name="$1" domain port
  domain="$(tenant_value "$name" TENANT_DOMAIN)"
  port="$(tenant_value "$name" PORT)"
  mkdir -p "$CADDY_TENANTS"
  if [ "$2" = actif ]; then
    printf '%s {\n    reverse_proxy 127.0.0.1:%s\n}\n' "$domain" "$port" > "$CADDY_TENANTS/$name.caddy"
  else
    printf '%s {\n    respond "Service suspendu. Contactez votre fournisseur." 503\n}\n' "$domain" > "$CADDY_TENANTS/$name.caddy"
  fi
  grep -q "import $CADDY_TENANTS/\*.caddy" /etc/caddy/Caddyfile || printf '\nimport %s/*.caddy\n' "$CADDY_TENANTS" >> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl reload caddy
}
