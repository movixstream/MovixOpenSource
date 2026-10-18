import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface CarouselTitleProps {
  icon?: LucideIcon;
  iconClass?: string;
  label: string;
}

// Icône Lucide plutôt qu'un emoji : le trait suit la couleur de `iconClass`
// (currentColor) et garde la même allure sur tous les systèmes.
const CarouselTitle: React.FC<CarouselTitleProps> = ({ icon: Icon, iconClass, label }) => (
  <span>
    {Icon && (
      <Icon
        aria-hidden="true"
        strokeWidth={2.25}
        className={`mr-2 inline-block h-[1em] w-[1em] -translate-y-[0.1em] align-middle ${iconClass ?? ''}`}
      />
    )}
    <span>{label}</span>
  </span>
);

export default React.memo(CarouselTitle);
