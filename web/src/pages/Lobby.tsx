import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const GAMES = [
  { key: 'american-roulette', name: 'Roulette Américaine', tag: '0 et 00 · 38 cases', icon: '🎡' },
  { key: 'keno', name: 'Keno 20/80', tag: '20 boules tirées sur 80', icon: '🔢' },
  { key: 'lucky-six', name: 'Lucky Six', tag: '35 boules sur 48', icon: '🎱' },
  { key: 'lucky-x', name: 'Lucky X', tag: '20 boules sur 80', icon: '✨' },
];

export default function Lobby() {
  const { authed } = useAuth();
  return (
    <div className="page">
      <section className="hero">
        <h1>
          Jouez en ligne sur <span>Paryaj Paw</span>
        </h1>
        <p>Roulette américaine, Keno, Lucky Six et Lucky X — tirages vérifiables, dépôts et retraits MonCash / NatCash.</p>
        {!authed && (
          <div className="hero-cta">
            <Link to="/register" className="btn big">
              Créer un compte
            </Link>
            <Link to="/login" className="btn ghost big">
              J’ai déjà un compte
            </Link>
          </div>
        )}
      </section>

      <h2 className="section-title">Nos jeux</h2>
      <div className="games">
        {GAMES.map((g) => (
          <Link key={g.key} to={`/play/${g.key}`} className="game-card">
            <span className="game-icon" aria-hidden>
              {g.icon}
            </span>
            <span className="game-name">{g.name}</span>
            <span className="game-tag">{g.tag}</span>
            <span className="game-play">Jouer →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
