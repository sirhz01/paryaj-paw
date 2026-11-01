import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Account() {
  const { profile } = useAuth();
  if (!profile) return <div className="center muted">Chargement…</div>;
  return (
    <div className="page narrow">
      <h1>Mon compte</h1>
      <div className="card">
        <dl className="details">
          <dt>Téléphone</dt>
          <dd>{profile.phone}</dd>
          {profile.fullName && (
            <>
              <dt>Nom</dt>
              <dd>{profile.fullName}</dd>
            </>
          )}
          {profile.status && (
            <>
              <dt>Statut du compte</dt>
              <dd>{profile.status}</dd>
            </>
          )}
          {profile.kycStatus && (
            <>
              <dt>Vérification (KYC)</dt>
              <dd>{profile.kycStatus}</dd>
            </>
          )}
        </dl>
      </div>
      <Link to="/wallet" className="btn">
        Mon portefeuille
      </Link>
    </div>
  );
}
