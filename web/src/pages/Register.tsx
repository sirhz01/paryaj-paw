import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { message } from '../api/messages';
import { useAuth } from '../auth/AuthContext';
import { usePageTitle } from '../seo';

export default function Register() {
  usePageTitle('Créer un compte');
  const { register } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await api.requestOtp(email.trim(), 'register');
      setInfo('Un code à 6 chiffres a été envoyé par e-mail.');
      setStep(2);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register({
        email: email.trim(),
        otp,
        password,
        birthDate,
        fullName: fullName.trim() || undefined,
        phone: phone.trim() || undefined,
        language: 'ht',
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      {step === 1 ? (
        <form className="card form" onSubmit={sendOtp}>
          <h1>Créer un compte</h1>
          <label>
            E-mail
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="vous@exemple.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn big" type="submit" disabled={busy}>
            {busy ? 'Envoi…' : 'Recevoir le code'}
          </button>
          <p className="muted center">
            Déjà un compte ? <Link to="/login">Se connecter</Link>
          </p>
        </form>
      ) : (
        <form className="card form" onSubmit={finish}>
          <h1>Finaliser l’inscription</h1>
          {info && <p className="info">{info}</p>}
          <label>
            Code reçu par e-mail
            <input inputMode="numeric" maxLength={6} placeholder="6 chiffres" value={otp} onChange={(e) => setOtp(e.target.value)} required />
          </label>
          <label>
            Nom complet (facultatif)
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} />
          </label>
          <label>
            Téléphone (facultatif — pour les dépôts / retraits MonCash / NatCash)
            <input type="tel" inputMode="tel" placeholder="+509 ..." value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            Date de naissance
            <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="8 caractères minimum"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn big" type="submit" disabled={busy}>
            {busy ? 'Création…' : 'Créer mon compte'}
          </button>
          <button type="button" className="btn ghost" onClick={() => setStep(1)}>
            ← Changer d’adresse
          </button>
        </form>
      )}
    </div>
  );
}
