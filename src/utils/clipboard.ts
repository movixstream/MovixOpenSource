/**
 * Copie un texte dans le presse-papiers sans jamais lever d'exception.
 *
 * L'API Clipboard manque sur certains navigateurs (PS4, anciens Safari, page
 * hors contexte sécurisé) : `navigator.clipboard.writeText` y lève une
 * TypeError synchrone, qui faisait planter le bouton de copie (GlitchTip
 * FRONTEND-F2, Watch Party sur PS4). Repli sur une zone de texte temporaire
 * et `document.execCommand('copy')`.
 *
 * Renvoie `true` si la copie a réussi. Appeler directement depuis le
 * gestionnaire du clic : l'API Clipboard est sollicitée avant le premier
 * `await`, pendant l'activation utilisateur.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refusée, document sans focus… : tenter le repli.
  }
  return copyWithTextarea(text);
};

const copyWithTextarea = (text: string): boolean => {
  if (typeof document === 'undefined' || !document.body) return false;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // Hors écran, sans défilement de la page ni zoom iOS (police de 16 px).
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.fontSize = '16px';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    try {
      previousFocus?.focus({ preventScroll: true });
    } catch {
      // Élément retiré entre-temps : rien à restaurer.
    }
  }
};
