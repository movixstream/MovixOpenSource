/**
 * Wrapper around HTMLMediaElement.play() qui garantit un Promise<void> en
 * retour, même si .play() retourne undefined (vieux Safari, edge cases iOS,
 * éléments détachés). Évite le crash récurrent
 * "undefined is not an object (evaluating 'e.play().catch')" remonté par
 * iOS Safari 17.2 sur /watch/movie/...
 */
export const safePlay = (
  el: HTMLMediaElement | null | undefined,
): Promise<void> => {
  if (!el) return Promise.resolve();
  try {
    const result = el.play();
    return Promise.resolve(result);
  } catch (err) {
    return Promise.reject(err);
  }
};
