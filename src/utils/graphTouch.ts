/**
 * force-graph stocke la position de départ sur le nœud, pas par doigt.
 * Deux touchstart sur le même nœud partagent donc __initialDragPos : le
 * premier touchend l'efface et le second plante. Avec accès à sa prop, couper
 * d3-drag pendant chaque touchstart laisse tous les gestes tactiles à d3-zoom
 * et conserve le drag souris. Le repli historique bloque seulement un second
 * doigt quand le consommateur ne peut pas piloter cette prop.
 */
export const bindSingleNodeTouchDrag = (
  canvas: HTMLCanvasElement,
  hitsNode: (clientX: number, clientY: number) => boolean,
  setNodeDragEnabled?: (enabled: boolean, immediate: boolean) => void,
): (() => void) => {
  let nodeDrag = false;
  let released = false;
  let restoreTimer: number | undefined;
  const onStart = (event: TouchEvent) => {
    if (setNodeDragEnabled) {
      // d3-drag et d3-zoom écoutent le même touchstart. force-graph conserve
      // l'état de drag sur le nœud lui-même : deux doigts sur ce nœud
      // l'écrasent puis le suppriment dans un ordre non défini. Désactiver le
      // subject pendant le seul dispatch tactile laisse d3-zoom gérer le geste
      // entier, puis rend dès la tâche suivante le drag souris des appareils
      // hybrides. L'API de force-graph ne permet pas de filtrer uniquement le
      // deuxième subject ni d'annuler proprement le premier drag tactile.
      setNodeDragEnabled(false, true);
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => {
        restoreTimer = undefined;
        if (!released) setNodeDragEnabled(true, true);
      }, 0);
      return;
    }

    // Un geste commencé sur le fond peut atteindre un nœud avec le doigt
    // suivant : réévaluer chaque touchstart avant de le transmettre à d3.
    nodeDrag ||= Array.from(event.touches).some(touch => hitsNode(touch.clientX, touch.clientY));
    if (nodeDrag && event.touches.length > 1) {
      // Repli pour les consommateurs qui ne peuvent pas piloter force-graph.
      event.stopImmediatePropagation();
    }
  };
  const onEnd = (event: TouchEvent) => {
    if (event.touches.length === 0) nodeDrag = false;
  };
  canvas.addEventListener('touchstart', onStart, { capture: true, passive: true });
  canvas.addEventListener('touchend', onEnd, { capture: true, passive: true });
  canvas.addEventListener('touchcancel', onEnd, { capture: true, passive: true });
  return () => {
    released = true;
    if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    setNodeDragEnabled?.(true, false);
    canvas.removeEventListener('touchstart', onStart, true);
    canvas.removeEventListener('touchend', onEnd, true);
    canvas.removeEventListener('touchcancel', onEnd, true);
  };
};
