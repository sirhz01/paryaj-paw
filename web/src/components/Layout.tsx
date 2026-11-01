import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { htg } from '../money';

export default function Layout() {
  const { authed, logout } = useAuth();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!authed) {
      setBalance(null);
      return;
    }
    let active = true;
    api
      .wallet()
      .then((w) => active && setBalance(w.balanceCents))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authed]);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Paryaj<span>Paw</span>
        </Link>
        <div className="spacer" />
        {authed ? (
          <>
            <Link to="/wallet" className="balance" title="Portefeuille">
              {balance === null ? '…' : htg(balance)}
            </Link>
            <Link to="/account" className="btn ghost">
              Mon compte
            </Link>
            <button
              className="btn ghost"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Déconnexion
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="btn ghost">
              Connexion
            </Link>
            <Link to="/register" className="btn">
              Créer un compte
            </Link>
          </>
        )}
      </header>

      <main className="content">
        <Outlet />
      </main>

      <footer className="foot">
        <span>© {new Date().getFullYear()} Paryaj Paw — jouer comporte des risques. Interdit aux moins de 18 ans.</span>
      </footer>
    </div>
  );
}
