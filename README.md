# paryaj-paw

Plateforme de jeux en ligne en HTG (Keno et roulette européenne) : web, Android et desktop Windows. Cahiers des charges : [Keno](Cahier_des_charges_Keno.pdf), [Roulette](Cahier_des_charges_Roulette.pdf).

| Dossier | Contenu | État |
| --- | --- | --- |
| [backend/](backend/) | API NestJS + PostgreSQL : comptes, portefeuille, Keno, roulette, paiements, back-office | Premier jalon |
| [index.html](index.html) | Front-end boutique (HTML/JS pur) : écrans TV Roulette, Keno, Lucky Six, Lucky X et caisse | Démo |
| `web/` | Site web React | À venir |
| `desktop/` | Application Windows (Tauri) | À venir |
| `mobile/` | Application Android | À venir |

## Front-end boutique

Ouvrir `index.html` (aucun build). Touche **F** = plein écran sur les écrans TV, `?shift=30` décale l'horloge (démo).
Le logo (`assets/logo.jpg`) est en tête de chaque écran et de chaque ticket (`js/ticket.js`).

À remplacer avant la production : `PP.result()` (`js/common.js`) simule les tirages dans le navigateur, à brancher sur le back-end ;
les tickets sont dans `localStorage` ; tables de gains Keno 6/7/8/10 et règles Lucky X = valeurs DEMO (`js/config.js`).
L'écran affiche la roulette américaine (0 et 00), le back-end la roulette européenne : à harmoniser.
