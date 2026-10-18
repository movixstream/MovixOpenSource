import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import axios from 'axios';
import { Candy, Ghost, Skull, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import EmblaCarousel from '../EmblaCarousel';
import ContentRowSkeleton from '../skeletons/ContentRowSkeleton';
import { useLightMode } from '@/context/LightModeContext';
import { readLocalStorage, writeLocalStorage } from '@/utils/browserStorage';
import {
  DEFAULT_HALLOWEEN_MOOD,
  HALLOWEEN_MOODS,
  daysUntilHalloween,
  halloweenQuery,
  isHalloweenMood,
  isoDay,
  releaseCutoff,
  seededShuffle,
  toHalloweenMovies,
  type HalloweenMood,
  type HalloweenMovie,
} from '@/utils/halloweenSpecial';
import HalloweenFlashlight from './HalloweenFlashlight';
import { Pumpkin } from './HalloweenIcons';
import '@/styles/halloween-special.css';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
const MOOD_STORAGE_KEY = 'halloween_special_mood';
const MAX_MOVIES = 30;
const MOOD_ICONS: Record<HalloweenMood, LucideIcon> = { soft: Candy, chills: Ghost, terror: Skull };
// Obscurité de la lampe torche : aucune pour le frisson doux, presque noire
// pour la terreur (où la lampe vacille aussi).
const DARKNESS: Record<HalloweenMood, number> = { soft: 0, chills: 0.62, terror: 0.8 };

// La lampe torche suit une souris : rien sur écran tactile.
const canHover = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;

const readMood = (): HalloweenMood => {
  const stored = readLocalStorage(MOOD_STORAGE_KEY);
  return isHalloweenMood(stored) ? stored : DEFAULT_HALLOWEEN_MOOD;
};

interface DayCache {
  day: string;
  items: HalloweenMovie[];
}

/**
 * Rangée « Spécial Halloween » de l'accueil (thème Halloween actif). Le
 * frissomètre choisit l'humeur : frisson doux (Halloween en famille), chair
 * de poule (soirs d'Halloween, maisons hantées, slashers) ou terreur (les
 * grands films d'horreur). Seulement des films sortis depuis au moins trois
 * mois, tirés dans un ordre qui change chaque nuit. Compte à rebours jusqu'au
 * 31 octobre, et lampe torche au survol des cartes.
 *
 * Affichée en octobre pour tout le monde, thème ou non, et toute l'année
 * thème actif (Home.tsx). Elle a son propre style : sans le thème, seules
 * les cartes gardent leur aspect habituel. Le filtre d'âge du profil
 * s'applique comme partout (EmblaCarousel).
 */
const HalloweenSpecialRow = ({ language }: { language: string }) => {
  const { t } = useTranslation();
  const { effectivePrefs } = useLightMode();
  const [mood, setMood] = useState<HalloweenMood>(readMood);
  const [lists, setLists] = useState<Record<string, HalloweenMovie[]>>({});
  const lastShown = useRef<HalloweenMovie[] | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const [flashlightReady] = useState(canHover);

  const today = isoDay(new Date());
  const listKey = `halloween_special_${mood}_${language}`;
  const current = lists[listKey];
  // Pendant le chargement d'une autre humeur (ou si elle échoue), la
  // rangée garde les films affichés : le frissomètre reste accessible.
  if (current && current.length > 0) lastShown.current = current;
  const items = current && current.length > 0 ? current : lastShown.current;

  useEffect(() => {
    if (lists[listKey]) return;
    try {
      const cached = JSON.parse(readLocalStorage(listKey) ?? 'null') as DayCache | null;
      if (cached?.day === today && Array.isArray(cached.items)) {
        setLists((previous) => ({ ...previous, [listKey]: cached.items }));
        return;
      }
    } catch {
      // Cache illisible : on recharge.
    }

    const controller = new AbortController();
    Promise.all([1, 2].map((page) => axios.get('https://api.themoviedb.org/3/discover/movie', {
      params: { api_key: TMDB_API_KEY, ...halloweenQuery(mood, language, page) },
      signal: controller.signal,
    })))
      .then((responses) => {
        const movies = toHalloweenMovies(responses.flatMap((response) => response.data?.results ?? []), releaseCutoff());
        // Ordre tiré une fois par jour et par humeur.
        const picked = seededShuffle(movies, `${today}:${mood}`).slice(0, MAX_MOVIES);
        setLists((previous) => ({ ...previous, [listKey]: picked }));
        writeLocalStorage(listKey, JSON.stringify({ day: today, items: picked } satisfies DayCache));
      })
      .catch((error) => {
        if (axios.isCancel(error)) return;
        console.error('[HalloweenSpecialRow] TMDB', error);
        setLists((previous) => ({ ...previous, [listKey]: [] }));
      });
    return () => controller.abort();
    // `lists` ne sert qu'à éviter un rechargement inutile : pas une dépendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, mood, language, today]);

  const chooseMood = useCallback((next: HalloweenMood, focus = false) => {
    setMood(next);
    writeLocalStorage(MOOD_STORAGE_KEY, next);
    if (focus) radios.current[HALLOWEEN_MOODS.indexOf(next)]?.focus();
  }, []);

  // Groupe de boutons radio : une seule tabulation, les flèches changent
  // d'humeur.
  const onMeterKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (HALLOWEEN_MOODS.indexOf(mood) + step + HALLOWEEN_MOODS.length) % HALLOWEEN_MOODS.length;
    chooseMood(HALLOWEEN_MOODS[index], true);
  };

  if (!items) return current ? null : <ContentRowSkeleton />;

  const days = daysUntilHalloween();
  const CaptionIcon = MOOD_ICONS[mood];
  const loading = !current;
  const tools = (
    <div className="halloween-special-tools">
      {days >= 0 && days <= 31 && (
        <span className="halloween-countdown">
          <Pumpkin className="h-3.5 w-[17px] shrink-0" />
          {days === 0 ? t('home.halloween.tonight') : (
            <>
              {/* Version courte sur mobile : l'humeur tient sur la même ligne. */}
              <span className="hidden sm:inline">{t('home.halloween.countdown', { count: days })}</span>
              <span className="sm:hidden">{t('home.halloween.countdownShort', { count: days })}</span>
            </>
          )}
        </span>
      )}
      <div
        role="radiogroup"
        aria-label={t('home.halloween.meter')}
        className="halloween-meter"
        data-mood={mood}
        onKeyDown={onMeterKeyDown}
      >
        <span className="halloween-meter-thumb" aria-hidden="true" />
        {HALLOWEEN_MOODS.map((value, index) => {
          const Icon = MOOD_ICONS[value];
          const checked = value === mood;
          return (
            <button
              key={value}
              ref={(element) => { radios.current[index] = element; }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={t(`home.halloween.moods.${value}.label`)}
              tabIndex={checked ? 0 : -1}
              title={t(`home.halloween.moods.${value}.hint`)}
              className="halloween-meter-option"
              onClick={() => chooseMood(value)}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="halloween-meter-label">{t(`home.halloween.moods.${value}.label`)}</span>
            </button>
          );
        })}
      </div>
      {/* Petits écrans : le frissomètre n'a que ses icônes, l'humeur est
          écrite à côté. */}
      <span className="halloween-meter-caption" aria-hidden="true">
        <CaptionIcon className="h-3.5 w-3.5 shrink-0" />
        {t(`home.halloween.moods.${mood}.label`)}
      </span>
    </div>
  );

  return (
    <section className="halloween-special" data-mood={mood} data-loading={loading || undefined} aria-busy={loading}>
      <div className="halloween-special-glow" aria-hidden="true" />
      <EmblaCarousel
        title={t('home.halloween.title')}
        items={items}
        mediaType="halloweenSpecial"
        headerExtra={tools}
        overlay={flashlightReady && effectivePrefs.bgAnimations && DARKNESS[mood] > 0
          ? <HalloweenFlashlight key={mood} darkness={DARKNESS[mood]} flicker={mood === 'terror'} />
          : undefined}
      />
    </section>
  );
};

export default HalloweenSpecialRow;
