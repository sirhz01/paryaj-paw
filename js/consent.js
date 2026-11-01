/* Bannière cookies + mesure d'audience anonyme (pages publiques).
   Rien n'est envoyé avant « Accepter ». La mesure est interne : un compteur par page et par jour sur notre API (POST /site/pageview),
   sans cookie, sans adresse IP, sans identifiant, sans service tiers. Les écrans TV et la caisse n'utilisent que le stockage nécessaire. */
(function () {
  const KEY = 'pp.consent';

  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* stockage bloqué */ } };
  const seen = () => { try { return sessionStorage.getItem('pp.counted'); } catch (e) { return null; } };

  function countView() {
    if (seen() === location.pathname) return; // une seule mesure par page et par visite
    let base = '/api/v1';
    try { base = localStorage.getItem('pp.api') || base; } catch (e) { /* stockage bloqué */ }
    if (base === 'off') base = '/api/v1';
    const path = location.pathname.endsWith('/index.html') ? '/' : location.pathname;
    fetch(base.replace(/\/$/, '') + '/site/pageview', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
    }).then(() => { try { sessionStorage.setItem('pp.counted', location.pathname); } catch (e) { /* stockage bloqué */ } }).catch(() => {});
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
    el.innerHTML = '<p>Nous utilisons uniquement le stockage nécessaire au site. Avec votre accord, nous comptons aussi les visites de façon anonyme (sans cookie ni adresse IP). '
      + '<a href="rgpd.html">En savoir plus</a></p>'
      + '<span><button type="button" class="yes">Accepter</button> <button type="button" class="no">Refuser</button></span>';
    const choose = (v) => { write(v); el.remove(); css.remove(); if (v === 'yes') countView(); };
    el.querySelector('.yes').addEventListener('click', () => choose('yes'));
    el.querySelector('.no').addEventListener('click', () => choose('no'));
    document.head.appendChild(css);
    document.body.appendChild(el);
    el.querySelector('.yes').focus();
  }

  window.PPConsent = { reset() { try { localStorage.removeItem(KEY); } catch (e) { /* stockage bloqué */ } banner(); } };
  /* La CSP interdit les gestionnaires onclick en ligne : le bouton du pied de page est relié ici. */
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#cookiePrefs')) window.PPConsent.reset(); });
  const saved = read();
  if (saved === 'yes') countView();
  else if (saved !== 'no') banner();
})();
