import { Link, useParams } from 'react-router-dom';

const NAMES: Record<string, string> = {
  'american-roulette': 'Roulette Américaine',
  keno: 'Keno 20/80',
  'lucky-six': 'Lucky Six',
  'lucky-x': 'Lucky X',
};

/** Page de jeu temporaire : l'interface de jeu (mises, tirage, résultat) arrive à la prochaine étape. */
export default function GamePlaceholder() {
  const { game = '' } = useParams();
  const name = NAMES[game] || 'Jeu';
  return (
    <div className="page narrow">
      <div className="card center">
        <h1>{name}</h1>
        <p className="muted">L’interface de jeu arrive bientôt. Le compte, le portefeuille et les paiements sont déjà en place.</p>
        <Link to="/" className="btn ghost">
          ← Retour au lobby
        </Link>
      </div>
    </div>
  );
}
