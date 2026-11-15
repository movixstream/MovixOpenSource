import React from 'react';
import RLSSkeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import { cn } from '@/lib/utils';
import { useLightMode } from '@/context/LightModeContext';

type Variant = 'default' | 'poster' | 'text' | 'circle' | 'pill' | 'button';

interface SkeletonProps {
  variant?: Variant;
  width?: string | number;
  height?: string | number;
  count?: number;
  className?: string;
  containerClassName?: string;
  inline?: boolean;
  baseColor?: string;
  highlightColor?: string;
}

const variantBorderRadius: Record<Variant, string | number | undefined> = {
  default: undefined,
  poster:  '0.5rem',
  text:    '0.25rem',
  circle:  '9999px',
  pill:    '9999px',
  button:  '0.75rem',
};

const variantStyle: Record<Variant, React.CSSProperties | undefined> = {
  default: undefined,
  poster:  { aspectRatio: '2 / 3' },
  text:    undefined,
  circle:  undefined,
  pill:    undefined,
  button:  undefined,
};

// Couleurs par défaut alignées sur le thème sombre du site (body bg = #000).
// Sans ça, react-loading-skeleton utilise #ebebeb / #f5f5f5 (presque blanc) →
// effet "flash blanc" pendant le scroll quand des sections se chargent.
// Override possible via les props baseColor / highlightColor au cas par cas.
const DARK_BASE = '#1a1a1a';
const DARK_HIGHLIGHT = '#2a2a2a';

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'default',
  width,
  height,
  count,
  className,
  containerClassName,
  inline,
  baseColor = DARK_BASE,
  highlightColor = DARK_HIGHLIGHT,
}) => {
  const { isLightMode, effectivePrefs } = useLightMode();
  // Un bloc, sans baseline ni <br> : les deux modes réservent la même place,
  // y compris lorsque le skeleton remplit un parent de hauteur fixe.
  const frameClassName = cn(
    inline ? 'inline-block align-middle' : 'block',
    height === '100%' && 'h-full',
    containerClassName,
  );
  const blockClassName = cn('h-[1em]', variant === 'poster' && 'h-auto', className);
  if (isLightMode) {
    const total = Math.max(0, count ?? 1);
    const blocks = Array.from({ length: Math.ceil(total) }, (_, index) => {
      const fraction = Math.min(1, total - index);
      const fullWidth = width ?? '100%';
      return (
        <span
          key={index}
          aria-hidden="true"
          data-static-skeleton
          className={blockClassName}
          style={{
            ...variantStyle[variant],
            display: inline ? 'inline-block' : 'block',
            width: fraction === 1 ? width : typeof fullWidth === 'number' ? fullWidth * fraction : `calc(${fullWidth} * ${fraction})`,
            height,
            borderRadius: variantBorderRadius[variant] ?? '0.25rem',
            backgroundColor: baseColor,
          }}
        />
      );
    });
    return <span aria-hidden="true" className={frameClassName}>{blocks}</span>;
  }
  return <RLSSkeleton
    width={width}
    height={height}
    count={count}
    inline
    className={blockClassName}
    containerClassName={frameClassName}
    borderRadius={variantBorderRadius[variant]}
    style={{ ...variantStyle[variant], display: inline ? 'inline-block' : 'block' }}
    baseColor={baseColor}
    highlightColor={highlightColor}
    enableAnimation={effectivePrefs.loadingAnimations}
  />;
};

export default Skeleton;
