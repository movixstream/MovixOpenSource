import ghostUrl from '@/assets/halloween/ghost.webp';
import '@/styles/halloween-ghost.css';

/**
 * Fantôme de la page 404 (thème Halloween), qui remplace le « 0 » : une
 * apparition de brume translucide, dans le style du décor (texture générée
 * par scripts/generate-halloween-assets.py). Chargé à la demande, seulement
 * sur la 404 et thème actif. Sa taille suit la police du titre (unités em).
 *
 * L'image est fixe ; seul son conteneur HTML bouge (`transform` et
 * `opacity`), que la carte graphique anime seule (voir halloween-ghost.css).
 */
const HalloweenGhost = ({ animated }: { animated: boolean }) => (
  <span className="halloween-ghost" data-animated={animated} aria-hidden="true">
    <span className="halloween-ghost-float">
      <img className="halloween-ghost-body" src={ghostUrl} alt="" draggable={false} decoding="async" />
    </span>
  </span>
);

export default HalloweenGhost;
