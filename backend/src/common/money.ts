/**
 * Plafond de sécurité commun pour tout montant brut reçu d'un client (en centimes de gourde).
 * Les vraies limites (mises, dépôts, plafonds de gain) sont bien plus basses et vérifiées par chaque service ;
 * ce plafond ne sert qu'à rejeter d'emblée une valeur absurde ou un dépassement d'entier.
 * 1 milliard de HTG, très au-dessus de toute limite réelle et très en dessous des entiers sûrs (2^53).
 */
export const MAX_MONEY_CENTS = 100_000_000_000;
