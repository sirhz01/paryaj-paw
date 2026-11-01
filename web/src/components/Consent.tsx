import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

/* Bannière cookies + mesure d'audience anonyme (même principe que le site public : js/consent.js).
   Rien n'est envoyé avant « Accepter ». La mesure est un compteur par page et par jour sur notre API
   (POST /site/pageview), sans cookie, sans adresse IP, sans identifiant, sans service tiers. */
const KEY = 'pp.consent';
export const CONSENT_RESET = 'pp:consent-reset';

type Choice = 'yes' | 'no' | null;

const read = (): Choice => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
};

/** Rouvre la bannière (bouton « Cookies » du pied de page). */
export function openCookiePrefs() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* stockage bloqué */
  }
  window.dispatchEvent(new Event(CONSENT_RESET));
}

export default function Consent() {
  const [choice, setChoice] = useState<Choice>(read);
  const { pathname } = useLocation();

  useEffect(() => {
    const reset = () => setChoice(null);
    window.addEventListener(CONSENT_RESET, reset);
    return () => window.removeEventListener(CONSENT_RESET, reset);
  }, []);

  // Une seule mesure par page et par visite, uniquement si le visiteur a accepté.
  useEffect(() => {
    if (choice !== 'yes') return;
    try {
      if (sessionStorage.getItem('pp.counted') === pathname) return;
    } catch {
      /* stockage bloqué */
    }
    fetch('/api/v1/site/pageview', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathname }),
    })
      .then(() => {
        try {
          sessionStorage.setItem('pp.counted', pathname);
        } catch {
          /* stockage bloqué */
        }
      })
      .catch(() => undefined);
  }, [choice, pathname]);

  function decide(v: 'yes' | 'no') {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* stockage bloqué */
    }
    setChoice(v);
  }

  if (choice) return null;
  return (
    <div className="consent" role="dialog" aria-label="Cookies">
      <p>
        Nous utilisons uniquement le stockage nécessaire au site. Avec votre accord, nous comptons aussi les visites de façon
        anonyme (sans cookie ni adresse IP). <Link to="/rgpd">En savoir plus</Link>
      </p>
      <div className="consent-actions">
        <button type="button" className="btn" onClick={() => decide('yes')} autoFocus>
          Accepter
        </button>
        <button type="button" className="btn ghost" onClick={() => decide('no')}>
          Refuser
        </button>
      </div>
    </div>
  );
}
