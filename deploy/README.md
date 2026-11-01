# Déploiement sur un VPS

1. Louer un VPS Ubuntu 22.04/24.04 (1 Go de RAM suffit pour commencer) et un nom de domaine ; créer un enregistrement DNS **A** vers l'IP du VPS.
2. Se connecter en SSH, puis :
   ```bash
   git clone https://github.com/sirhz01/paryaj-paw && cd paryaj-paw/deploy
   sudo DOMAIN=jeu.exemple.com bash setup-vps.sh
   ```
   Le script installe Node 22, PostgreSQL et Caddy (certificat HTTPS automatique), génère les secrets dans `backend/.env`, applique le schéma et lance le service `paryaj-paw`.
3. Créer le compte de la caisse : `cd /opt/paryaj-paw/backend && sudo -u paryaj npm run staff:create -- --email vous@exemple.com --role cashier`
4. Mises à jour depuis GitHub : `sudo bash /opt/paryaj-paw/deploy/update.sh`

Notes : `PAYMENTS_FAKE=false` (le faux fournisseur est refusé en production) ; un vrai fournisseur de paiement reste à brancher avant d'accepter des dépôts réels. Les journaux : `journalctl -u paryaj-paw -f`.
