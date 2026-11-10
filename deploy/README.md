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

## Plusieurs exploitants sur le même serveur

Chaque exploitant (une entreprise indépendante, avec ses points de vente) reçoit **sa propre instance** : sa base PostgreSQL `pp_<nom>`, son service `paryaj-paw@<nom>`, son sous-domaine `<nom>.<domaine>` et ses secrets dans `/etc/paryaj-paw/tenants/<nom>.env`. Le code est partagé ; aucune donnée ne l'est.

Prérequis : l'étape 2 ci-dessus a tourné, et un enregistrement DNS **A** générique `*.<domaine>` pointe vers le VPS.

| Besoin | Commande (dans `/opt/paryaj-paw/deploy`) |
|---|---|
| Créer un exploitant (la 1ʳᵉ fois, avec le domaine et votre adresse) | `sudo BASE_DOMAIN=paryajpaw.online PLATFORM_EMAIL=vous@exemple.com bash add-tenant.sh bank1 patron@bank1.ht` |
| Créer les suivants | `sudo bash add-tenant.sh bank2 patron@bank2.ht` |
| Voir l'état de chacun | `sudo bash tenant-access.sh list` |
| Suspendre / rétablir (données conservées) | `sudo bash tenant-access.sh bank1 off` / `on` |
| Mettre à jour tout le monde | `sudo bash update-all.sh` |
| Sauvegarder toutes les bases | `sudo bash backup-all.sh` |

`add-tenant.sh` affiche une seule fois deux comptes `super_admin` : celui du **propriétaire**, à lui transmettre, et **le vôtre** (éditeur). Le vôtre est désigné par `PLATFORM_ADMIN_EMAIL` : il n'apparaît pas dans la liste des administrateurs de l'exploitant, qui ne peut ni le bloquer, ni changer son mot de passe, ni le supprimer. Le propriétaire crée ensuite lui-même ses caissiers (un par PC) depuis `https://<nom>.<domaine>/admin.html`.

Compter environ 150 Mo de mémoire par instance (ordre de grandeur, non mesuré) : prévoir 2 Go de RAM pour 5 exploitants.

Notes : `PAYMENTS_FAKE=false` (le faux fournisseur est refusé en production) ; un vrai fournisseur de paiement reste à brancher avant d'accepter des dépôts réels. Les journaux : `journalctl -u paryaj-paw -f`.
