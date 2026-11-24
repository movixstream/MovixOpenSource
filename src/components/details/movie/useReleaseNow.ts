import { useEffect, useState } from 'react';

/**
 * L'instant présent, rafraîchi chaque minute et au retour sur l'onglet : les
 * pastilles « Sorti » / « Pas encore sorti » basculent sans recharger.
 */
export function useReleaseNow(): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return now;
}
