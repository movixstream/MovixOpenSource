export const getPlayerNavigationKey = (event: KeyboardEvent): string => {
  if (event.key && event.key !== 'Unidentified') return event.key;
  if (event.code && event.code !== 'Unidentified') return event.code;
  // Certaines WebView Android ne renseignent que le code historique.
  return ({
    13: 'Enter', 27: 'Escape', 37: 'ArrowLeft', 38: 'ArrowUp',
    39: 'ArrowRight', 40: 'ArrowDown',
  } as Record<number, string>)[event.keyCode] || '';
};

/** Déplace le focus entre les commandes visibles, sans dépendre du modèle de TV. */
export const focusPlayerControl = (container: HTMLElement, direction?: string): void => {
  const candidates = Array.from(container.querySelectorAll<HTMLButtonElement>(
    '[data-player-chrome] button, button[data-player-chrome]',
  )).filter(button => {
    if (button.disabled || button.tabIndex < 0 || button.closest('[aria-hidden="true"]')) return false;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < window.innerHeight
      && rect.right > 0 && rect.left < window.innerWidth
      && window.getComputedStyle(button).visibility !== 'hidden';
  });

  const active = candidates.find(button => button === document.activeElement);
  let next = candidates.find(button => button.hasAttribute('data-player-primary-control')) || candidates[0];

  if (active && direction) {
    const rect = active.getBoundingClientRect();
    const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
    const sign = direction === 'ArrowLeft' || direction === 'ArrowUp' ? -1 : 1;
    let bestScore = Infinity;
    next = active;
    for (const candidate of candidates) {
      if (candidate === active) continue;
      const other = candidate.getBoundingClientRect();
      const dx = (other.left + other.right - rect.left - rect.right) / 2;
      const dy = (other.top + other.bottom - rect.top - rect.bottom) / 2;
      const distance = (horizontal ? dx : dy) * sign;
      if (distance <= 1) continue;
      const score = distance + Math.abs(horizontal ? dy : dx) * 3;
      if (score < bestScore) {
        bestScore = score;
        next = candidate;
      }
    }
  }

  next?.focus({ preventScroll: true });
};
