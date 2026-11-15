// Cumul du temps passé sur un contenu (ou une page) pour le Wrapped, sans
// React ni DOM : l'horloge, le réglage de confidentialité et l'envoi sont
// fournis par l'appelant, ce qui permet de tester chaque cas à la main.
//
// Règles :
// - le temps ne compte que si le suivi est actif, l'onglet visible, une cible
//   connue et la collecte autorisée ; collecte coupée = rien n'est cumulé ni
//   envoyé, quel que soit le chemin (onglet masqué, démontage, changement) ;
// - le temps cumulé appartient à la cible en cours : un changement de contenu
//   envoie d'abord le reste à l'ancien ;
// - un envoi raté (réseau, 429, 5xx) garde son temps pour l'envoi suivant, dans
//   la limite acceptée par le serveur pour un envoi.

/** En dessous, un envoi périodique ne vaut pas une requête. */
export const WRAPPED_MIN_SECONDS_TO_SEND = 5;
/** Un trou aussi long entre deux relevés = onglet endormi : rien n'est compté. */
export const WRAPPED_MAX_GAP_SECONDS = 60;
/** Durée maximale d'un envoi côté serveur (POST /api/wrapped/track). */
export const WRAPPED_MAX_SECONDS_PER_SEND = 60;

export interface WrappedTrackerDeps<Target> {
    now: () => number;
    collectionEnabled: () => boolean;
    /** Résout à `false` quand l'envoi doit être retenté plus tard. */
    send: (target: Target, seconds: number) => Promise<boolean>;
}

export interface WrappedTracker<Target> {
    setTarget: (target: Target | null) => void;
    setActive: (active: boolean) => void;
    setVisible: (visible: boolean) => void;
    /**
     * Envoi périodique (toutes les 30 s côté hook). Résout à `true` quand
     * l'envoi a raté : le serveur ne crédite que le temps réel récent, donc un
     * nouvel essai n'est utile que dans les secondes qui suivent.
     */
    tick: () => Promise<boolean>;
    pendingSeconds: () => number;
}

export function createWrappedTracker<Target>(deps: WrappedTrackerDeps<Target>): WrappedTracker<Target> {
    let target: Target | null = null;
    let active = false;
    let visible = true;
    let pending = 0;
    // Début de la tranche en cours ; null tant que rien ne doit être compté.
    let since: number | null = null;
    let sending = false;

    const counting = () => active && visible && target !== null;

    // Verse la tranche écoulée dans le cumul, puis repart de maintenant.
    function harvest() {
        const now = deps.now();
        if (!deps.collectionEnabled()) {
            pending = 0;
            since = null;
            return;
        }
        if (since !== null) {
            const elapsed = (now - since) / 1000;
            if (elapsed > 0 && elapsed < WRAPPED_MAX_GAP_SECONDS) {
                pending = Math.min(WRAPPED_MAX_SECONDS_PER_SEND, pending + elapsed);
            }
        }
        since = counting() ? now : null;
    }

    async function flush(minSeconds: number): Promise<boolean> {
        harvest();
        if (sending || target === null || pending < minSeconds) return false;
        const seconds = Math.floor(pending);
        if (seconds < 1) return false;
        const sentTarget = target;
        pending -= seconds;
        sending = true;
        let delivered = false;
        try {
            delivered = await deps.send(sentTarget, seconds);
        } catch {
            delivered = false;
        }
        sending = false;
        // La cible a pu changer pendant l'envoi : ce temps ne lui appartient pas.
        if (!delivered && target === sentTarget) {
            pending = Math.min(WRAPPED_MAX_SECONDS_PER_SEND, pending + seconds);
        }
        return !delivered;
    }

    return {
        setTarget(next) {
            harvest();
            const previous = target;
            const seconds = Math.floor(pending);
            target = next;
            pending = 0;
            since = counting() && deps.collectionEnabled() ? deps.now() : null;
            if (previous !== null && seconds >= 1) {
                void deps.send(previous, seconds).catch(() => false);
            }
        },
        setActive(next) {
            if (next === active) return;
            harvest();
            active = next;
            since = counting() && deps.collectionEnabled() ? deps.now() : null;
        },
        setVisible(next) {
            if (next === visible) return;
            harvest();
            visible = next;
            since = counting() && deps.collectionEnabled() ? deps.now() : null;
            // Onglet masqué : il peut ne jamais revenir, on envoie ce qu'on a.
            if (!next) void flush(WRAPPED_MIN_SECONDS_TO_SEND);
        },
        tick() {
            return flush(WRAPPED_MIN_SECONDS_TO_SEND);
        },
        pendingSeconds() {
            return pending;
        },
    };
}
