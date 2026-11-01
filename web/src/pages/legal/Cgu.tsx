import { usePageTitle } from '../../seo';

/* Contenu repris de cgu.html (les champs entre crochets restent à compléter par l'exploitant). */
export default function Cgu() {
  usePageTitle('Conditions générales d’utilisation');
  return (
    <div className="page legal">

    <h1>Conditions générales d’utilisation</h1>
    <p className="meta">Version 1 · Mise à jour : <span className="todo">[date]</span></p>

    <h2>1. Éditeur</h2>
    <p><span className="todo">[Raison sociale, forme juridique, adresse, numéro d’immatriculation, autorisation de jeux n° …]</span> (« l’Éditeur »).</p>

    <h2>2. Objet</h2>
    <p>Les présentes conditions régissent l’accès et l’utilisation des jeux en ligne et en point de vente de La Référence Paryaj Paw
    (roulette américaine, Keno 20/80, Lucky Six, Lucky 10). En créant un compte ou en jouant, vous les acceptez.</p>

    <h2>3. Conditions pour jouer</h2>
    <ul>
      <li>Être âgé d’au moins <span className="todo">[18]</span> ans et capable juridiquement.</li>
      <li>Jouer depuis un territoire où les jeux d’argent en ligne sont autorisés.</li>
      <li>Un seul compte par personne, avec des informations exactes. L’Éditeur peut demander une vérification d’identité (KYC).</li>
    </ul>

    <h2>4. Compte et sécurité</h2>
    <p>Vous êtes responsable de la confidentialité de votre mot de passe et de votre téléphone. Toute activité sur le compte est présumée faite par vous.
    Signalez sans délai toute utilisation suspecte.</p>

    <h2>5. Portefeuille, dépôts et retraits</h2>
    <ul>
      <li>Les montants sont en gourdes haïtiennes (HTG).</li>
      <li>Les mises sont débitées du portefeuille au moment de la participation ; les gains y sont crédités après règlement du tirage.</li>
      <li>Les retraits peuvent exiger une vérification d’identité et, au-delà d’un seuil, une validation manuelle.</li>
      <li>Aucun intérêt n’est versé sur le solde.</li>
    </ul>

    <h2>6. Règles des jeux et équité</h2>
    <p>Chaque jeu a ses règles et sa table de gains, publiées sur le site et au point de vente. Les tirages utilisent un aléa vérifiable :
    l’empreinte de la graine est publiée avant le tirage et la graine après, pour vous permettre de vérifier le résultat.
    Les limites de mise, de gain et de ticket en vigueur s’appliquent ; en cas de dépassement, le gain peut être soumis à validation.</p>

    <h2>7. Tickets en point de vente</h2>
    <p>Le ticket est au porteur : conservez-le. Il est payé une seule fois, sur présentation, dans le délai de validité indiqué <span className="todo">[x jours]</span>.
    Un ticket perdu, illisible ou périmé ne peut être remboursé.</p>

    <h2>8. Jeu responsable</h2>
    <p>Le jeu comporte des risques de perte et peut créer une dépendance. Vous pouvez fixer des limites de perte, vous bloquer temporairement ou
    définitivement en contactant le support. Ne jouez jamais de l’argent dont vous avez besoin. Aide : <span className="todo">[coordonnées d’un organisme d’aide]</span>.</p>

    <h2>9. Comportements interdits</h2>
    <p>Fraude, collusion, usage de logiciels automatisés, comptes multiples, blanchiment, mineurs. L’Éditeur peut suspendre le compte, annuler les gains
    obtenus de façon frauduleuse et informer les autorités.</p>

    <h2>10. Disponibilité et incidents</h2>
    <p>L’Éditeur s’efforce d’assurer le service sans garantir une disponibilité continue. En cas d’incident technique, un tirage peut être annulé
    et les mises remboursées.</p>

    <h2>11. Données personnelles</h2>
    <p>Voir la <a href="/rgpd">politique de confidentialité</a>.</p>

    <h2>12. Responsabilité</h2>
    <p>Dans les limites permises par la loi, l’Éditeur ne répond pas des pertes de jeu ni des dommages indirects.</p>

    <h2>13. Modification, droit applicable et litiges</h2>
    <p>Les conditions peuvent être modifiées ; la version en vigueur est celle publiée. Elles sont régies par le droit <span className="todo">[haïtien]</span>.
    Réclamation d’abord auprès du support : <span className="todo">[contact]</span> ; à défaut, tribunaux compétents de <span className="todo">[ville]</span>.</p>
  
    </div>
  );
}
