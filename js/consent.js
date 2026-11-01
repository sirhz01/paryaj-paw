/* Bannière cookies + analytics soumis au consentement (pages publiques).
   Aucun traceur n'est chargé avant « Accepter ». Les écrans TV et la caisse n'utilisent que le stockage nécessaire à leur fonctionnement.
   Analytics : renseigner src (et domain) ci-dessous, par exemple Plausible :
   { src: 'https://plausible.io/js/script.js', domain: 'votre-domaine.ht' } ; vide = désactivé. */
(function () {
  const ANALYTICS = { src: '', domain: '' };
  const KEY = 'pp.consent';

  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* stockage bloqué */ } };

  function loadAnalytics() {
    if (!ANALYTICS.src || document.querySelector('script[data-pp-analytics]')) return;
    const s = document.createElement('script');
    s.defer = true;
    s.src = ANALYTICS.src;
    if (ANALYTICS.domain) s.setAttribute('data-domain', ANALYTICS.domain);
    s.setAttribute('data-pp-analytics', '');
    document.head.appendChild(s);
  }

  function banner() {
    const css = document.createElement('style');
    css.textContent = '#pp-consent{position:fixed;left:0;right:0;bottom:0;z-index:50;background:#14285f;color:#fff;padding:1rem;display:flex;flex-wrap:wrap;gap:.8rem 1.2rem;align-items:center;justify-content:center;font:15px/1.4 system-ui,Arial,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.3)}'
      + '#pp-consent p{max-width:46rem;margin:0}#pp-consent a{color:#fff;text-decoration:underline}'
      + '#pp-consent button{font:inherit;font-weight:600;padding:.55rem 1.1rem;border-radius:8px;border:2px solid #fff;cursor:pointer;background:transparent;color:#fff}'
      + '#pp-consent button.yes{background:#fff;color:#14285f}#pp-consent button:focus-visible{outline:3px solid #ffd54a;outline-offset:2px}';
    const el = document.createElement('div');
    el.id = 'pp-consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookies');
    el.innerHTML = '<p>Nous utilisons uniquement le stockage nécessaire au site. Avec votre accord, nous mesurons aussi l’audience de façon anonyme. '
      + '<a href="rgpd.html">En savoir plus</a></p>'
      + '<span><button type="button" class="yes">Accepter</button> <button type="button" class="no">Refuser</button></span>';
    const choose = (v) => { write(v); el.remove(); css.remove(); if (v === 'yes') loadAnalytics(); };
    el.querySelector('.yes').addEventListener('click', () => choose('yes'));
    el.querySelector('.no').addEventListener('click', () => choose('no'));
    document.head.appendChild(css);
    document.body.appendChild(el);
    el.querySelector('.yes').focus();
  }

  window.PPConsent = { reset() { try { localStorage.removeItem(KEY); } catch (e) { /* stockage bloqué */ } banner(); } };
  const saved = read();
  if (saved === 'yes') loadAnalytics();
  else if (saved !== 'no') banner();
})();
