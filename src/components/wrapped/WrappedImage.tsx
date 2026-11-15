import { useState } from 'react';
import { Film } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WRAPPED_POSTER_BORDER_RADIUS } from '@/utils/wrappedPosterGeometry';

export default function WrappedImage({ src, alt, className = '', backdrop = false }: {
    src: string | null;
    alt: string;
    className?: string;
    backdrop?: boolean;
}) {
    const { t } = useTranslation();
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const missing = !src || failedSrc === src;
    return (
        <div className={`relative overflow-hidden ${backdrop ? '' : 'bg-[#282131]'} ${className}`} style={backdrop ? undefined : { borderRadius: WRAPPED_POSTER_BORDER_RADIUS }}>
            {!missing ? (
                <img src={src} alt={alt} draggable={false} decoding="async" onError={() => setFailedSrc(src)}
                    className={`h-full w-full ${backdrop ? 'object-cover' : 'object-contain'}`} />
            ) : !backdrop ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center text-white/80" role="img" aria-label={alt || t('wrappedStory.imageUnavailable')}>
                    <Film aria-hidden="true" className="h-8 w-8 shrink-0 text-white opacity-80" />
                    <span className="line-clamp-3 text-xs">{alt || t('wrappedStory.imageUnavailable')}</span>
                </div>
            ) : null}
        </div>
    );
}
