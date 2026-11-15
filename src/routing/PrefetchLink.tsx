import { Link, matchPath, type LinkProps } from 'react-router-dom';
import { useCallback, type FC, type MouseEvent, type FocusEvent, type PointerEvent } from 'react';
import { ROUTES } from './registry';
import { useLightMode } from '@/context/LightModeContext';

const prefetched = new Set<string>();

const findLoader = (to: string): ((opts?: { silent?: boolean }) => Promise<unknown>) | null => {
  for (const r of ROUTES) {
    if (matchPath(r.path, to)) return r.loader;
  }
  return null;
};

const compose = <T,>(...fns: (((e: T) => void) | undefined)[]) =>
  (e: T) => fns.forEach(f => f?.(e));

/**
 * <Link> wrapper that prefetches the destination route's chunk on hover,
 * focus, and pointerdown. Idempotent — each path is prefetched at most once.
 *
 * Caller-supplied handlers compose with prefetch (both fire), so passing
 * onMouseEnter/onFocus/onPointerDown in props does not disable prefetch.
 *
 * Migration: replace `import { Link } from 'react-router-dom'` with
 *            `import { PrefetchLink as Link } from '@/routing/PrefetchLink'`.
 */
export const PrefetchLink: FC<LinkProps> = ({ to, onMouseEnter, onFocus, onPointerDown, ...rest }) => {
  const { isLightMode } = useLightMode();
  const path = typeof to === 'string' ? to : to?.pathname || '';
  const prefetch = useCallback(() => {
    if (isLightMode || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    if (!path || prefetched.has(path)) return;
    const loader = findLoader(path);
    if (!loader) return;
    prefetched.add(path);
    loader({ silent: true }).catch(() => prefetched.delete(path));
  }, [path, isLightMode]);
  return (
    <Link
      to={to}
      {...rest}
      onMouseEnter={isLightMode ? onMouseEnter : compose<MouseEvent<HTMLAnchorElement>>(onMouseEnter, prefetch)}
      onFocus={isLightMode ? onFocus : compose<FocusEvent<HTMLAnchorElement>>(onFocus, prefetch)}
      onPointerDown={isLightMode ? onPointerDown : compose<PointerEvent<HTMLAnchorElement>>(onPointerDown, prefetch)}
    />
  );
};
