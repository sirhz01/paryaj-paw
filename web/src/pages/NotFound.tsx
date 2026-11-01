import { Link } from 'react-router-dom';
import { usePageTitle } from '../seo';

export default function NotFound() {
  usePageTitle('Page introuvable', { noindex: true });
  return (
    <div className="page narrow notfound">
      <h1>404</h1>
      <p>Cette page n’existe pas ou a été déplacée.</p>
      <Link to="/" className="btn big">
        Retour à l’accueil
      </Link>
    </div>
  );
}
