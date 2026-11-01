import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { ReactNode } from 'react';

/** Réserve une page aux joueurs connectés ; sinon renvoie vers la connexion. */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { authed, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Chargement…</div>;
  if (!authed) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
