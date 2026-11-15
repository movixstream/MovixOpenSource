import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';

const VIDEO_WEBM = '/videos/tv-app/movix-tv-demo.webm';
const VIDEO_MP4 = '/videos/tv-app/movix-tv-demo.mp4';
const VIDEO_POSTER = '/videos/tv-app/movix-tv-demo-poster.jpg';
// Vraie capture de l'appli : affiche de secours si la vidéo ou son affiche manquent.
const FALLBACK_IMAGE = '/help/tv/accueil.webp';

interface TvDemoVideoProps {
  /** Mouvement réduit : pas de lecture auto, affiche et bouton lecture. */
  calm: boolean;
}

/**
 * Vidéo de présentation de l'appli (vrais enregistrements, avec musique).
 * Démarre sans le son ; le visiteur l'active avec le bouton. Pause hors de
 * l'écran, bouton pause toujours présent (contenu animé de plus de 5 s).
 */
export function TvDemoVideo({ calm }: TvDemoVideoProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [poster, setPoster] = useState(VIDEO_POSTER);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  // Le choix du visiteur prime : une pause demandée n'est pas relancée au défilement.
  const [userChoice, setUserChoice] = useState<'play' | 'pause' | null>(null);
  const [inView, setInView] = useState(true);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node) node.muted = true;
  }, []);

  // Affiche absente : on passe sur la capture de l'accueil.
  useEffect(() => {
    let alive = true;
    const image = new Image();
    image.onerror = () => {
      if (alive) setPoster(FALLBACK_IMAGE);
    };
    image.src = VIDEO_POSTER;
    return () => {
      alive = false;
      image.onerror = null;
    };
  }, []);

  // Lecture seulement quand la vidéo est visible.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), {
      threshold: 0.25,
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [failed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    const wantsPlay = userChoice === 'play' || (userChoice === null && !calm);
    if (wantsPlay && inView) {
      video.play().catch(() => setPlaying(false));
    } else if (!video.paused) {
      video.pause();
    }
  }, [calm, failed, inView, userChoice]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setUserChoice('play');
      video.play().catch(() => setPlaying(false));
    } else {
      setUserChoice('pause');
      video.pause();
    }
  };

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted && video.paused) {
      setUserChoice('play');
      video.play().catch(() => setPlaying(false));
    }
  };

  const showBigPlay = !failed && !playing && (calm || userChoice === 'pause');
  const smallButton =
    'flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500';

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/10">
      {failed ? (
        <img
          src={FALLBACK_IMAGE}
          alt={t('tvApp.video.fallbackAlt')}
          width={1600}
          height={900}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          <video
            ref={attachVideo}
            className="h-full w-full object-cover"
            autoPlay={!calm}
            muted
            loop
            playsInline
            preload="metadata"
            poster={poster}
            aria-label={t('tvApp.video.label')}
            disablePictureInPicture
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
            onError={() => setFailed(true)}
          >
            <source src={VIDEO_WEBM} type="video/webm" />
            <source src={VIDEO_MP4} type="video/mp4" onError={() => setFailed(true)} />
          </video>

          {showBigPlay && (
            <button
              type="button"
              onClick={togglePlay}
              aria-label={t('tvApp.video.play')}
              className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-zinc-950 shadow-lg shadow-black/40 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-95 sm:h-20 sm:w-20"
            >
              <Play className="ml-1 h-7 w-7 fill-current sm:h-8 sm:w-8" aria-hidden="true" />
            </button>
          )}

          <div className="absolute bottom-3 right-3 flex gap-2 sm:bottom-4 sm:right-4">
            <button
              type="button"
              onClick={toggleSound}
              aria-label={muted ? t('tvApp.video.unmute') : t('tvApp.video.mute')}
              aria-pressed={!muted}
              className={smallButton}
            >
              {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
            </button>
            {!showBigPlay && (
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? t('tvApp.video.pause') : t('tvApp.video.play')}
                className={smallButton}
              >
                {playing ? (
                  <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default TvDemoVideo;
