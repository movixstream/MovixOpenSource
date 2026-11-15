import { useEffect } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';

/**
 * Nombre qui monte jusqu'à sa valeur exacte, comme dans le film. La largeur finale est
 * réservée : les chiffres grandissent vers la gauche sans déplacer l'unité qui suit.
 * Purement visuel : la valeur lisible par les lecteurs d'écran est portée par le parent.
 */
export default function WrappedCountUp({ value, format, delay = 0.25, duration = 1.4 }: {
    value: number; format: (value: number) => string; delay?: number; duration?: number;
}) {
    const reduced = useReducedMotion();
    const current = useMotionValue(reduced ? value : 0);
    const text = useTransform(current, latest => format(Math.round(latest)));

    useEffect(() => {
        if (reduced) { current.set(value); return; }
        current.set(0);
        const controls = animate(current, value, { delay, duration, ease: [0.16, 1, 0.3, 1] });
        return () => controls.stop();
    }, [current, delay, duration, reduced, value]);

    return <span className="relative inline-block" aria-hidden="true">
        <span className="invisible">{format(value)}</span>
        <motion.span className="absolute inset-0 text-right">{text}</motion.span>
    </span>;
}
