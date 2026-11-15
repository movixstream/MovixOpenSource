// Touches d'une liste d'onglets (motif ARIA « tabs ») : flèches gauche et
// droite en boucle, Début et Fin. Partagé par les onglets de la page profil
// et le sélecteur de statut de l'historique. Module pur, testé par node --test.

/** Index de l'onglet à activer pour cette touche, ou -1 si la touche n'est pas gérée. */
export function nextTabIndex(key: string, index: number, count: number): number {
  if (count <= 0) return -1;
  const last = count - 1;
  switch (key) {
    case 'ArrowRight':
      return index >= last ? 0 : index + 1;
    case 'ArrowLeft':
      return index <= 0 ? last : index - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return -1;
  }
}
