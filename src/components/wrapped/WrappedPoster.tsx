import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties } from 'react';
import type { WrappedTopContent } from '@/services/wrappedService';
import { wrappedImageUrl, wrappedMediaKey } from '@/utils/wrappedPresentation';
import { WRAPPED_FRAME_ANIMATION } from '@/utils/wrappedMotion';
import { WRAPPED_POSTER_BORDER_RADIUS } from '@/utils/wrappedPosterGeometry';
import WrappedImage from './WrappedImage';
import { cn } from '@/lib/utils';

/** La même identité visuelle peut changer de taille et de composition entre deux scènes. */
export default function WrappedPoster({ item, className = '', style, shared = true, settle = false }: {
    item: WrappedTopContent; className?: string; style?: CSSProperties; shared?: boolean; settle?: boolean;
}) {
    const reduced = useReducedMotion();
    return <motion.div {...WRAPPED_FRAME_ANIMATION} data-wrapped-poster={wrappedMediaKey(item)} data-wrapped-shared={shared ? 'true' : undefined}
        animate={{ opacity: settle ? 0 : 1 }}
        transition={{ opacity: { duration: reduced ? 0 : 0.16, delay: settle && !reduced ? 0.9 : 0 } }}
        className={cn('relative overflow-hidden data-[wrapped-flight=true]:invisible', className)} style={{ borderRadius: WRAPPED_POSTER_BORDER_RADIUS, ...style }}>
        <WrappedImage src={wrappedImageUrl(item.poster_path)} alt={item.title} className="aspect-[2/3] h-full w-full" />
    </motion.div>;
}
