import React, { startTransition, useRef, useState, useEffect } from 'react';
import ContentRowSkeleton from './skeletons/ContentRowSkeleton';
import { scheduleSectionLoad } from '@/utils/sectionLoadScheduler';

/**
 * Props pour le composant LazySection
 */
interface LazySectionProps {
    /**
     * Index de la section (pour déterminer la priorité de chargement)
     */
    index: number;

    /**
     * Nombre de sections à charger immédiatement au montage
     * Les sections avec index < immediateLoadCount seront affichées immédiatement
     */
    immediateLoadCount?: number;

    /**
     * Contenu à afficher une fois la section chargée
     */
    children: React.ReactNode;

    /**
     * Composant de placeholder pendant le chargement (défaut: ContentRowSkeleton)
     */
    placeholder?: React.ReactNode;

    /**
     * Marge avant l'intersection (défaut: '800px')
     * Plus grand = préchargement plus tôt
     */
    rootMargin?: string;

    /**
     * Hauteur minimum du conteneur (pour éviter les sauts de layout)
     */
    minHeight?: string;

    /**
     * Callback optionnel quand la section devient visible
     */
    onVisible?: () => void;

    /**
     * Callback optionnel pour charger des données (sera appelé quand visible)
     */
    onLoad?: () => Promise<void>;

    /**
     * Si true, affiche un état de chargement personnalisé pendant onLoad
     */
    showLoadingDuringFetch?: boolean;

    /**
     * Classe CSS additionnelle
     */
    className?: string;
}

/**
 * Composant de lazy loading optimisé pour les sections de contenu
 * 
 * Utilise IntersectionObserver pour différer le rendu des sections
 * qui ne sont pas dans le viewport initial.
 * 
 * @example
 * ```tsx
 * // Les 2 premières sections sont chargées immédiatement
 * {sections.map((section, index) => (
 *   <LazySection key={section.id} index={index} immediateLoadCount={2}>
 *     <ContentRow items={section.items} />
 *   </LazySection>
 * ))}
 * ```
 */
const LazySection: React.FC<LazySectionProps> = ({
    index,
    immediateLoadCount = 2,
    children,
    placeholder,
    rootMargin = '800px',
    minHeight = '200px',
    onVisible,
    onLoad,
    showLoadingDuringFetch = false,
    className = ''
}) => {
    // Performance mode reduces effects, not the time available to prepare a
    // row. A 100px margin made TV/mobile mount each carousel during the swipe.
    const isImmediate = index < immediateLoadCount;
    const [isVisible, setIsVisible] = useState(isImmediate);
    const [isFetching, setIsFetching] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const loadStartedRef = useRef(false);
    const mountedRef = useRef(false);
    const callbacksRef = useRef({ onVisible, onLoad });
    callbacksRef.current = { onVisible, onLoad };

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (loadStartedRef.current) return;
        const triggerLoad = () => {
            if (loadStartedRef.current || !mountedRef.current) return;
            loadStartedRef.current = true;
            const callbacks = callbacksRef.current;
            startTransition(() => {
                setIsVisible(true);
                setIsFetching(Boolean(callbacks.onLoad));
                callbacks.onVisible?.();
            });
            if (callbacks.onLoad) {
                void Promise.resolve().then(callbacks.onLoad)
                    .catch(error => console.error('Error loading section:', error))
                    .finally(() => {
                        if (mountedRef.current) setIsFetching(false);
                    });
            }
        };

        if (isImmediate) {
            triggerLoad();
            return;
        }
        const element = containerRef.current;
        if (!element) return;
        let cancelLoad: (() => void) | undefined;
        if (typeof IntersectionObserver === 'undefined') {
            return scheduleSectionLoad(triggerLoad);
        }
        const observer = new IntersectionObserver(entries => {
            if (cancelLoad || !entries.some(entry => entry.isIntersecting)) return;
            observer.disconnect();
            cancelLoad = scheduleSectionLoad(triggerLoad);
        }, { rootMargin, threshold: 0 });
        observer.observe(element);
        return () => {
            observer.disconnect();
            cancelLoad?.();
        };
    }, [isImmediate, rootMargin]);

    // Déterminer ce qu'il faut afficher
    const shouldShowPlaceholder = !isVisible || (showLoadingDuringFetch && isFetching);
    // Ne pas monter les skeletons de tout le catalogue avant l'intersection.
    // Le gabarit conserve la hauteur ; le skeleton détaillé sert à l'attente réseau.
    const loadingPlaceholder = placeholder === undefined
        ? <ContentRowSkeleton reserveSpaceOnly={!isVisible} />
        : placeholder;

    return (
        <div
            ref={containerRef}
            className={className}
            style={{
                minHeight: shouldShowPlaceholder ? minHeight : undefined,
                contain: 'layout style',
            }}
        >
            {shouldShowPlaceholder ? loadingPlaceholder : children}
        </div>
    );
};

/**
 * Composant pour le lazy loading de sections sur clic/interaction
 * 
 * Utilisé pour les sections qui ne doivent charger leurs données
 * que lorsque l'utilisateur interagit (ex: onglets, modales)
 */
interface ClickToLoadSectionProps {
    /**
     * true si la section est active/ouverte
     */
    isActive: boolean;

    /**
     * Contenu à afficher une fois chargé
     */
    children: React.ReactNode;

    /**
     * Placeholder pendant le chargement
     */
    placeholder?: React.ReactNode;

    /**
     * Fonction de chargement des données
     */
    onLoad?: () => Promise<void>;

    /**
     * Classe CSS additionnelle
     */
    className?: string;
}

const ClickToLoadSection: React.FC<ClickToLoadSectionProps> = ({
    isActive,
    children,
    placeholder = <ContentRowSkeleton />,
    onLoad,
    className = ''
}) => {
    const [hasLoaded, setHasLoaded] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isActive && !hasLoaded) {
            if (onLoad) {
                setIsLoading(true);
                onLoad()
                    .then(() => setHasLoaded(true))
                    .finally(() => setIsLoading(false));
            } else {
                setHasLoaded(true);
            }
        }
    }, [isActive, hasLoaded, onLoad]);

    if (!isActive) {
        return null;
    }

    if (isLoading || !hasLoaded) {
        return <div className={className}>{placeholder}</div>;
    }

    return <div className={className}>{children}</div>;
};

export { LazySection, ClickToLoadSection };
export default LazySection;
