import { useEffect } from 'react';

const SITE = 'Paryaj Paw';

/** Titre de l'onglet propre à chaque page (référencement, historique, lecteurs d'écran). */
export function usePageTitle(title?: string, { noindex = false }: { noindex?: boolean } = {}) {
  useEffect(() => {
    document.title = title ? `${title} — ${SITE}` : `${SITE} — Jwe an liy`;
    if (!noindex) return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [title, noindex]);
}
