/* Formulaire de contact : validation côté navigateur, puis POST /site/contact.
   Anti-spam : champ piège « website » (caché) et durée de remplissage, contrôlés aussi par le serveur ; limite de débit côté API. */
(function () {
  let base = '/api/v1';
  try { base = localStorage.getItem('pp.api') || base; } catch (e) { /* stockage bloqué */ }
  if (base === 'off') base = '/api/v1';
  const shownAt = Date.now();
  const form = document.getElementById('contact'), status = document.getElementById('status'), send = document.getElementById('send');
  const say = (text, kind) => { status.textContent = text; status.className = kind || ''; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value.trim();
    if (v('name').length < 2) return say('Indiquez votre nom.', 'err');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('email'))) return say('Adresse e-mail invalide.', 'err');
    if (v('message').length < 10) return say('Le message est trop court (10 caractères minimum).', 'err');
    send.disabled = true;
    say('Envoi…');
    try {
      const res = await fetch(base.replace(/\/$/, '') + '/site/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: v('name'), email: v('email'), message: v('message'), website: v('website'), elapsedMs: Date.now() - shownAt }),
      });
      if (res.status === 429) say('Trop d’envois, réessayez dans une minute.', 'err');
      else if (!res.ok) say('Envoi impossible, vérifiez les champs.', 'err');
      else { form.reset(); say('Merci, votre message a bien été envoyé.', 'ok'); }
    } catch (err) {
      say('Serveur injoignable, réessayez plus tard.', 'err');
    } finally { send.disabled = false; }
  });
})();
