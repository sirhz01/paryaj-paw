import { usePageTitle } from '../../seo';

/* Contenu repris de rgpd.html (les champs entre crochets restent à compléter par l'exploitant). */
export default function Rgpd() {
  usePageTitle('Politique de confidentialité');
  return (
    <div className="page legal">

    <h1>Politique de confidentialité</h1>
    <p className="meta">Protection des données personnelles (RGPD) · Version 1 · Mise à jour : <span className="todo">[date]</span></p>

    <h2>1. Responsable du traitement</h2>
    <p><span className="todo">[Raison sociale]</span>, exploitant « La Référence Paryaj Paw », <span className="todo">[adresse]</span>.
    Contact données personnelles : <span className="todo">[adresse e-mail du DPO / référent]</span>.</p>

    <h2>2. Données collectées</h2>
    <div className="table-wrap"><table><tbody>
      <tr><th>Donnée</th><th>Finalité</th><th>Base légale</th><th>Durée de conservation</th></tr>
      <tr><td>Numéro de téléphone, mot de passe (haché)</td><td>Création et sécurisation du compte, code de vérification par SMS</td><td>Exécution du contrat</td><td>Durée du compte, puis <span className="todo">[x]</span> ans</td></tr>
      <tr><td>Identité et pièce d’identité (vérification KYC)</td><td>Contrôle de l’âge, lutte contre la fraude et le blanchiment</td><td>Obligation légale</td><td><span className="todo">[5]</span> ans après la fin de la relation</td></tr>
      <tr><td>Mises, tirages, gains, mouvements du portefeuille, dépôts et retraits</td><td>Fonctionnement du jeu, preuve d’équité, comptabilité, litiges</td><td>Contrat et obligation légale</td><td><span className="todo">[10]</span> ans (obligations comptables)</td></tr>
      <tr><td>Adresse IP, journaux de connexion et de sécurité</td><td>Sécurité, prévention des abus</td><td>Intérêt légitime</td><td><span className="todo">[12]</span> mois</td></tr>
      <tr><td>Nom, e-mail et message du <a href="/contact">formulaire de contact</a></td><td>Répondre à votre demande</td><td>Intérêt légitime</td><td><span className="todo">[12]</span> mois</td></tr>
      <tr><td>Nombre de visites par page (sans cookie, sans IP, sans identifiant)</td><td>Mesure d’audience anonyme, uniquement si vous l’acceptez</td><td>Consentement</td><td>Statistiques agrégées par jour</td></tr>
      <tr><td>Limites de jeu, blocage volontaire</td><td>Jeu responsable</td><td>Contrat et obligation légale</td><td>Durée du compte</td></tr>
    </tbody></table></div>
    <p>Aucune donnée n’est utilisée pour de la prospection sans votre accord, ni vendue à des tiers.</p>

    <h2>3. Destinataires</h2>
    <p>Les données sont accessibles au personnel habilité (support, finance, audit) selon son rôle, aux prestataires techniques
    (hébergement, envoi de SMS, paiement mobile) liés par contrat, et aux autorités compétentes sur demande légale.</p>

    <h2>4. Transferts hors Union européenne</h2>
    <p>L’hébergement est situé à <span className="todo">[pays / hébergeur]</span>. Lorsqu’un transfert hors de l’Union européenne a lieu, il est encadré par
    des clauses contractuelles types ou une décision d’adéquation.</p>

    <h2>5. Vos droits</h2>
    <p>Vous pouvez demander l’accès, la rectification, l’effacement, la limitation, l’opposition et la portabilité de vos données,
    et retirer un consentement à tout moment, en écrivant à l’adresse ci-dessus. Nous répondons sous un mois. L’effacement peut être refusé
    pour les données que la loi nous oblige à conserver. En cas de désaccord, vous pouvez saisir l’autorité de contrôle compétente (en France : la CNIL).</p>

    <h2>6. Sécurité</h2>
    <p>Connexion chiffrée (HTTPS), mots de passe hachés, accès du personnel protégé par double authentification, journal d’audit des actions sensibles.</p>

    <h2>7. Cookies et stockage local</h2>
    <p>Le site utilise uniquement le stockage nécessaire à son fonctionnement (session, préférences). Aucun traceur publicitaire et aucun service d’analyse tiers : la mesure d’audience, si vous l’acceptez, est un simple compteur de pages sur notre serveur. Vous pouvez changer d’avis à tout moment via « Gérer les cookies » sur la page d’accueil.</p>

    <h2>8. Modifications</h2>
    <p>Cette politique peut évoluer ; la date de mise à jour figure en haut de page.</p>
  
    </div>
  );
}
