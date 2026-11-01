import { FormEvent, useRef, useState } from 'react';
import { usePageTitle } from '../seo';

/* Formulaire de contact : validation côté navigateur, puis POST /site/contact.
   Anti-spam : champ piège « website » (caché) et durée de remplissage, contrôlés aussi par le serveur ;
   limite de débit côté API. */
export default function Contact() {
  usePageTitle('Contact');
  const shownAt = useRef(Date.now());
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');
  const [trap, setTrap] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string }>({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setStatus({ kind: 'err', text: 'Indiquez votre nom.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setStatus({ kind: 'err', text: 'Adresse e-mail invalide.' });
    if (text.trim().length < 10) return setStatus({ kind: 'err', text: 'Le message est trop court (10 caractères minimum).' });
    setBusy(true);
    setStatus({ kind: '', text: 'Envoi…' });
    try {
      const res = await fetch('/api/v1/site/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: text.trim(),
          website: trap,
          elapsedMs: Date.now() - shownAt.current,
        }),
      });
      if (res.status === 429) setStatus({ kind: 'err', text: 'Trop d’envois, réessayez dans une minute.' });
      else if (!res.ok) setStatus({ kind: 'err', text: 'Envoi impossible, vérifiez les champs.' });
      else {
        setName('');
        setEmail('');
        setText('');
        setStatus({ kind: 'ok', text: 'Merci, votre message a bien été envoyé.' });
      }
    } catch {
      setStatus({ kind: 'err', text: 'Serveur injoignable, réessayez plus tard.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <form className="card form" onSubmit={onSubmit} noValidate>
        <h1>Contact</h1>
        <label>
          Nom
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={80} />
        </label>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={160} />
        </label>
        <label>
          Message
          <textarea value={text} onChange={(e) => setText(e.target.value)} required minLength={10} maxLength={2000} rows={6} />
        </label>
        <div className="hp" aria-hidden="true">
          <label>
            Ne pas remplir
            <input value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {status.text && (
          <p className={status.kind === 'err' ? 'error' : status.kind === 'ok' ? 'success' : 'muted'} role="status" aria-live="polite">
            {status.text}
          </p>
        )}
        <button className="btn big" type="submit" disabled={busy}>
          Envoyer
        </button>
      </form>
    </div>
  );
}
