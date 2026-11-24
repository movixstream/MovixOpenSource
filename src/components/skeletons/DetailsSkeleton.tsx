import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { DETAILS_GRID, DETAILS_PHONE_SCROLL } from '@/components/details/layout';
import { useMovieReleaseWarnings } from '@/hooks/useMovieReleaseWarnings';
import { cn } from '@/lib/utils';

/*
 * Squelette des fiches film et série (nouveau style). Il reprend une à une les
 * classes de la page : `DetailsHero`, `DetailsSectionNav`, `DetailsSection`,
 * `DetailsFacts`, `DetailsPeopleRow`, `TvSeasonPills`, `TvEpisodeList`… pour
 * que rien ne bouge quand les données arrivent. Les libellés connus d'avance
 * (boutons, onglets, titres de section) sont écrits en invisible sous leur
 * bloc gris : le bloc a leur largeur exacte, dans la langue du site. Les
 * textes inconnus (synopsis, noms) gardent les classes de police de la page :
 * leurs lignes ont la même hauteur.
 *
 * `tests/detailsSkeleton.browser.mjs` compare ce squelette à la vraie page :
 * le relancer après avoir touché l'une ou l'autre.
 *
 * L'ancien style a son propre squelette (`pages/legacy/DetailsSkeletonLegacy`),
 * choisi par `DetailsRouteSkeleton` et par les anciennes fiches.
 */

interface DetailsSkeletonProps {
  mediaType?: 'movie' | 'tv';
}

/** Barre d'une ligne de texte : centrée dans sa ligne, aux trois quarts de la taille du texte. */
const TEXT_BAR = 'top-1/2 h-[0.75em] -translate-y-1/2';

/** Bloc gris aux dimensions données par ses classes. */
function Bone({ className, radius = '!rounded-lg' }: { className?: string; radius?: string }) {
  return (
    <span className={cn('block', className)}>
      <Skeleton height="100%" className={radius} />
    </span>
  );
}

/**
 * Contenu de la page en invisible, recouvert d'un bloc gris. `className` porte
 * les classes de l'élément d'origine (taille, marges, police) : le bloc en a
 * la boîte exacte (`bar="inset-y-0"`) ou une barre de texte centrée.
 */
function Ghost({ className, bar = TEXT_BAR, radius = '!rounded', children }: {
  className?: string;
  bar?: string;
  radius?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('relative', className)}>
      {/* `contents` : les enfants restent des éléments de la boîte d'origine (espacements compris). */}
      <span className="invisible contents">{children}</span>
      <span className={cn('absolute inset-x-0', bar)}>
        <Skeleton height="100%" className={radius} />
      </span>
    </span>
  );
}

/** Ligne de `Lines` : classes de sa barre (largeur), ou de sa barre et de la ligne (`md:hidden`). */
type Line = string | [bar: string, line: string];

/**
 * Lignes d'un texte dont on ne connaît pas la longueur. `className` porte les
 * classes de police du texte d'origine : chaque ligne, faite d'une espace
 * insécable, prend la hauteur de ligne que le navigateur lui calcule.
 */
function Lines({ className, lines }: { className?: string; lines: Line[] }) {
  return (
    <span className={cn('block', className)}>
      {lines.map((line, index) => {
        const [bar, extra] = typeof line === 'string' ? [line, undefined] : line;
        return (
          <span key={index} className={cn('relative block', extra)}>
            {' '}
            <span className={cn('absolute left-0 max-w-full', TEXT_BAR, bar)}>
              <Skeleton height="100%" className="!rounded" />
            </span>
          </span>
        );
      })}
    </span>
  );
}

// ── Image du haut (`DetailsHero`) ────────────────────────────────────────────

const PILL = 'inline-flex h-[26px] max-w-full items-center gap-[5px] rounded-full border border-transparent px-2.5 text-[11px] font-semibold md:h-7 md:gap-1.5 md:px-3 md:text-xs';
/** Pastille qui passe à la ligne (dates de sortie, diffusion d'une série). */
const WRAPPING_PILL = 'h-auto min-h-[26px] whitespace-normal rounded-xl py-1 md:h-auto md:min-h-7';
const PILL_ICON = <span className="size-3 flex-none md:size-[13px]" />;
const PILL_DOT = <span className="size-1.5 flex-none md:size-[7px]" />;

function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return <Ghost className={cn(PILL, className)} bar="inset-y-0" radius="!rounded-full">{children}</Ghost>;
}

const BUTTON = 'inline-flex items-center justify-center gap-[9px] whitespace-nowrap rounded-[14px] border border-transparent font-semibold md:gap-2.5';
const BUTTON_HERO = 'h-14 px-3 text-base md:h-[54px] md:px-[22px]';
const BUTTON_DEFAULT = 'h-12 px-3 text-[15px] md:h-[54px] md:px-[22px] md:text-base';

/** Bouton de l'image (`DetailsButton`) : icône et libellé invisibles sous le bloc. */
function HeroButton({ size, className, children }: { size: string; className?: string; children: ReactNode }) {
  return (
    <Ghost className={cn(BUTTON, size, className)} bar="inset-y-0" radius="!rounded-[14px]">
      <span className="size-5 flex-none" />
      {children}
    </Ghost>
  );
}

/** Bouton discret (`DetailsActionButton`) : l'icône et le libellé, sans fond. */
function ActionButton({ label, shortLabel }: { label: string; shortLabel?: string }) {
  return (
    <span className="flex min-h-[60px] min-w-0 flex-col items-center gap-1.5 py-2 text-xs font-medium md:inline-flex md:h-11 md:min-h-0 md:flex-row md:gap-2 md:px-3 md:py-0 md:text-sm">
      <Bone className="size-[22px] flex-none md:size-[18px]" radius="!rounded-md" />
      {shortLabel ? (
        <>
          <Ghost className="max-w-full whitespace-nowrap md:hidden">{shortLabel}</Ghost>
          <Ghost className="hidden whitespace-nowrap md:inline">{label}</Ghost>
        </>
      ) : <Ghost className="max-w-full whitespace-nowrap">{label}</Ghost>}
    </span>
  );
}

/** Ligne d'infos sous le titre (`DetailsMetaLine`), points médians compris. */
function MetaLine({ items }: { items: Array<{ content: string; desktopOnly?: boolean; phoneOnly?: boolean }> }) {
  return (
    <p className="text-[13px] font-medium md:text-[15px]">
      <Ghost>
        {items.map((item, index) => (
          <span key={index} className={item.desktopOnly ? 'hidden md:inline' : item.phoneOnly ? 'md:hidden' : undefined}>
            {index > 0 && <span className="mx-1.5 md:mx-2">·</span>}
            {item.content}
          </span>
        ))}
      </Ghost>
    </p>
  );
}

function Hero({ isTV }: { isTV: boolean }) {
  const { t } = useTranslation();
  const releaseWarnings = useMovieReleaseWarnings();

  const pills = isTV ? (
    <>
      <Pill className="uppercase tracking-[0.08em]">{t('search.serieLabel')}</Pill>
      <Pill>2008 – 2013</Pill>
      <Pill className="hidden sm:inline-flex">16+</Pill>
      <Pill>{PILL_ICON}8,9<span className="hidden md:inline">&nbsp;TMDB</span></Pill>
      <Pill className={WRAPPING_PILL}>{PILL_DOT}{t('details.ended')}</Pill>
    </>
  ) : (
    <>
      <Pill className="uppercase tracking-[0.08em]">{t('search.movieLabel')}</Pill>
      <Pill>2014</Pill>
      <Pill>{PILL_ICON}8,4<span className="hidden md:inline">&nbsp;TMDB</span></Pill>
      {releaseWarnings ? (
        <>
          <Pill className={WRAPPING_PILL}>{t('details.movieRelease.digitalDate', { date: '12 mars 2025', country: '' })}</Pill>
          {/* Film déjà sorti hors cinéma : pas de note CAM, comme la vraie fiche. */}
          <Pill className={WRAPPING_PILL}>{t('details.movieRelease.theatricalDate', { date: '5 févr. 2025', country: '' })}</Pill>
        </>
      ) : (
        <Pill>{PILL_DOT}{t('details.releasedBadge')}</Pill>
      )}
    </>
  );

  return (
    // Classes de `DetailsHero` : hauteur de l'image par largeur d'écran, contenu en bas à gauche.
    <section className="relative md:flex md:min-h-[560px] md:items-end xl:min-h-[680px] min-[1440px]:min-h-[760px] 2xl:min-h-[820px] min-[1700px]:min-h-[900px]">
      <div className={cn(DETAILS_GRID, 'relative flex w-full flex-col gap-2.5 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-8 md:pb-9 md:pt-[120px]')}>
        <div className="contents md:flex md:max-w-full md:flex-col md:gap-[18px] lg:max-w-[680px] 2xl:max-w-[720px] 2xl:gap-[22px]">
          <div className="mb-1.5 flex min-h-[520px] flex-col justify-end gap-3 pb-0.5 pt-20 md:order-1 md:mb-0 md:min-h-0 md:gap-[18px] md:p-0 2xl:gap-[22px]">
            <div className="flex flex-wrap gap-1.5 md:gap-2">{pills}</div>
            {/* Titre : un logo TMDB de forme courante (3 fois plus large que haut)
                touche les deux limites de `DetailsTitle`. */}
            <Bone className="h-[86px] w-[269px] md:h-[120px] md:w-[375px] 2xl:h-[150px] 2xl:w-[469px]" />
            <MetaLine
              items={isTV ? [
                { content: t('details.seasonsCount', { count: 5 }) },
                { content: t('details.episodesCount', { count: 62 }) },
                { content: 'Drame, Crime', desktopOnly: true },
                { content: 'AMC', desktopOnly: true },
                { content: t('details.ended'), phoneOnly: true },
              ] : [
                { content: '2 h 49' },
                { content: 'Aventure, Drame, Science-Fiction' },
                { content: 'Christopher Nolan', desktopOnly: true },
              ]}
            />
          </div>

          {/* Boutons principaux */}
          <div className="md:order-3 md:mt-1.5">
            <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:gap-3">
              <HeroButton size={BUTTON_HERO} className="w-full md:w-auto">{t('details.watchBtn')}</HeroButton>
              <div className="grid grid-cols-2 gap-2.5 md:contents">
                <HeroButton size={BUTTON_DEFAULT}>{t('details.bandeAnnonce')}</HeroButton>
                <HeroButton size={BUTTON_DEFAULT}>{t('details.downloadBtn')}</HeroButton>
              </div>
            </div>
          </div>

          {/* Boutons discrets (`DetailsActionRow`) */}
          <div className="mt-1.5 md:order-4 md:mt-0">
            <div className={cn('-mx-1.5 grid md:mx-0 md:-ml-3 md:flex md:flex-wrap md:items-center md:gap-0.5', isTV ? 'grid-cols-6' : 'grid-cols-5')}>
              <ActionButton label={t('details.toWatchBtn')} />
              <ActionButton label={t('details.favoritesBtn')} />
              <ActionButton label={t('details.watchedBtn')} />
              <ActionButton label={t(isTV ? 'details.addToAList' : 'lists.addToList')} shortLabel={t('details.listShort')} />
              {isTV && <ActionButton label={t('details.antiSpoil')} />}
              <ActionButton label={t('common.share')} />
            </div>
          </div>

          {/* Synopsis court (`DetailsSynopsis`) : quatre lignes et « Lire la suite » sous 768 px, trois au-delà. */}
          <div className="mt-2.5 md:order-2 md:mt-0">
            <Lines
              className="text-[15px] leading-[1.6] md:max-w-[58ch] md:text-[17px] md:leading-[1.55] 2xl:text-[19px]"
              lines={['w-full', 'w-[97%]', 'w-full md:w-[72%]', ['w-[64%]', 'md:hidden']]}
            />
            <Ghost className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold md:hidden">
              {t('details.readMore')}
              <span className="size-4" />
            </Ghost>
          </div>
        </div>

        {/* Pouces (`LikeDislikeButton`), en bas à droite dès 768 px. */}
        <div className="mt-1 md:mb-1 md:mt-0">
          <div className="flex items-center gap-3">
            {[0, 1].map((index) => (
              // Le compteur réserve 2ch à la taille du texte de la page (16 px).
              <Ghost key={index} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-transparent px-4 py-2" bar="inset-y-0" radius="!rounded-full">
                <span className="size-5" />
                <span className="min-w-[2ch]" />
              </Ghost>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Barre de sections (`DetailsSectionNav`) ──────────────────────────────────

function SectionNav({ isTV }: { isTV: boolean }) {
  const { t } = useTranslation();
  const labels: ReactNode[] = [
    ...(isTV ? [t('details.episodesLabel')] : []),
    t('details.overviewTab'),
    t('details.castTab'),
    <>
      <span className="md:hidden">{t('details.videosTab')}</span>
      <span className="hidden md:inline">{t('details.mediaSection')}</span>
    </>,
    t('details.detailsTab'),
    t('details.commentsTab'),
  ];
  return (
    <>
      {/* Espace au-dessus de la barre sous 768 px (repère de collage de la page). */}
      <div className="h-[22px] md:h-0" />
      <div className="border-b border-white/[.12]">
        <div className={cn(DETAILS_GRID, 'flex gap-[22px] overflow-hidden md:gap-6 lg:gap-8')}>
          {labels.map((label, index) => (
            <span key={index} className="inline-flex h-12 flex-none items-center whitespace-nowrap border-b-2 border-transparent text-sm font-medium md:h-14 md:text-[15px]">
              <Ghost>{label}</Ghost>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

/** Espace du haut d'une section (`DetailsSection`). */
const SECTION = 'pt-[34px] md:pt-16 2xl:pt-20';

/** En-tête de section (`DetailsSectionHeader`) : titre et lien « Tout voir ». */
function SectionHeader({ title, more, moreShort, className }: { title: string; more?: string; moreShort?: string; className?: string }) {
  return (
    <div className={cn('mb-3.5 flex items-center justify-between gap-3 md:mb-[22px] md:gap-4', className)}>
      <Ghost className="block min-w-0 text-xl font-bold leading-[1.2] tracking-[-0.01em] md:text-2xl 2xl:text-[28px]">{title}</Ghost>
      {more && (
        <Ghost className="-my-2 inline-flex min-h-11 flex-none items-center gap-1 whitespace-nowrap text-[13px] font-medium md:gap-1.5 md:text-sm">
          {moreShort && moreShort !== more ? (
            <>
              <span className="md:hidden">{moreShort}</span>
              <span className="hidden md:inline">{more}</span>
            </>
          ) : more}
          <span className="size-[15px] md:size-4" />
        </Ghost>
      )}
    </div>
  );
}

interface FactRow {
  label: string;
  /** Largeur de la valeur. */
  width: string;
  /** Classes de la ligne (`md:hidden`, `hidden md:flex`), comme dans la page. */
  className?: string;
}

/** Fiche de faits (`DetailsFacts`) : vrais libellés, valeurs en barres alignées à droite. */
function Facts({ rows }: { rows: FactRow[] }) {
  return (
    <div className="border-t border-white/[.12]">
      {rows.map((row) => (
        <div key={row.label} className={cn('flex justify-between gap-5 border-b border-white/[.12] py-3 text-sm md:gap-6 md:py-[13px] md:text-[15px]', row.className)}>
          <Ghost className="whitespace-nowrap">{row.label}</Ghost>
          <Lines className="min-w-0 flex-1" lines={[cn('left-auto right-0', row.width)]} />
        </div>
      ))}
    </div>
  );
}

/** Note « Les infos viennent de TMDB » (`DetailsTmdbNote`). */
function TmdbNote({ className }: { className?: string }) {
  return (
    <Lines
      className={cn('text-xs md:text-[13px]', className)}
      lines={['w-full md:w-[min(100%,33em)]', ['w-[42%]', 'md:hidden']]}
    />
  );
}

/** Aperçu : synopsis complet et note TMDB à gauche dès 768 px, fiche de faits à droite. */
function Overview({ isTV }: { isTV: boolean }) {
  const { t } = useTranslation();
  const facts: FactRow[] = isTV ? [
    { label: t('details.creationLabel'), width: 'w-[112px]' },
    { label: t('details.genresLabel'), width: 'w-[96px]', className: 'md:hidden' },
    { label: t('details.broadcasterLabel'), width: 'w-[56px]' },
    { label: t('details.firstAirDate'), width: 'w-[124px]' },
    { label: t('details.statusLabel'), width: 'w-[72px]' },
    { label: t('details.seasonsLabel'), width: 'w-[16px]' },
    { label: t('details.episodesLabel'), width: 'w-[24px]' },
    { label: t('details.classificationLabel'), width: 'w-[104px]' },
    { label: t('details.ratingLabel'), width: 'w-[150px]' },
  ] : [
    { label: t('details.directionLabel'), width: 'w-[124px]' },
    { label: t('details.screenplayLabel'), width: 'w-[190px]' },
    { label: t('details.genresLabel'), width: 'w-[150px]', className: 'md:hidden' },
    { label: t('details.durationLabel'), width: 'w-[132px]', className: 'hidden md:flex' },
    { label: t('details.releaseShort'), width: 'w-[118px]' },
    { label: t('details.classificationLabel'), width: 'w-[96px]' },
    { label: t('details.ratingLabel'), width: 'w-[150px]' },
  ];

  return (
    <div className={cn(SECTION, !isTV && 'pt-[22px]')}>
      <div className="grid gap-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start lg:gap-[72px]">
        <div className="hidden md:block">
          <SectionHeader title={t('details.synopsisTitle')} />
          <Lines className="max-w-[66ch] text-[17px] leading-[1.65] 2xl:text-[19px]" lines={['w-full', 'w-[98%]', 'w-full', 'w-[58%]']} />
          <TmdbNote className="mt-5" />
        </div>
        <div>
          {isTV && <SectionHeader title={t('details.overviewTab')} className="md:hidden" />}
          <Facts rows={facts} />
          <TmdbNote className="mt-3 md:hidden" />
        </div>
      </div>
    </div>
  );
}

/** Distribution : huit portraits, en rangée qui défile sous 768 px puis en grille. */
function Cast() {
  const { t } = useTranslation();
  const names = ['w-[82%]', 'w-[64%]', 'w-[74%]', 'w-[58%]', 'w-[86%]', 'w-[68%]', 'w-[60%]', 'w-[78%]'];
  return (
    <div className={SECTION}>
      <SectionHeader title={t('details.castTab')} more={t('details.castMore')} moreShort={t('details.viewAll', 'Tout voir')} />
      <ul className={cn(DETAILS_PHONE_SCROLL, 'md:grid md:grid-cols-4', 'grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:gap-x-4 md:gap-y-[22px] xl:grid-cols-8')}>
        {names.map((width, index) => (
          <li key={index} className="w-28 min-w-0 flex-none md:w-auto">
            <Bone className="aspect-[4/5] w-full" radius="!rounded-xl" />
            <Lines className="mt-2 text-[13px] font-semibold leading-[1.3] md:mt-2.5 md:text-sm" lines={[width]} />
            <Lines className="text-xs leading-snug md:text-[13px]" lines={[index % 2 ? 'w-[48%]' : 'w-[62%]']} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Bascule à icônes (`TvSegmented`) : grille, liste, menu. */
function Segmented({ count, className }: { count: number; className?: string }) {
  return (
    <Ghost className={cn('inline-flex flex-none rounded-[10px] border border-transparent p-[3px]', className)} bar="inset-y-0" radius="!rounded-[10px]">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="inline-flex h-[38px] min-w-[42px] items-center justify-center px-3 md:h-[34px] md:min-w-[38px]">
          <span className="size-4" />
        </span>
      ))}
    </Ghost>
  );
}

/** Icône d'action d'un épisode (`TV_EPISODE_ACTION_CLASS`) : coche, « à voir ». */
function EpisodeAction({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-11 flex-none items-center justify-center md:size-9', className)}>
      <Bone className="size-5 md:size-[17px]" radius="!rounded-md" />
    </span>
  );
}

const EPISODES = [0, 1, 2, 3, 4, 5, 6, 7];

/** Épisodes d'une série : menu des saisons, résumé de la saison, puis la liste (téléphone) ou la grille. */
function Episodes() {
  const { t } = useTranslation();
  return (
    <div className="pt-5 md:pt-9">
      <div className="md:mb-3 md:flex md:flex-wrap md:items-center md:justify-between md:gap-4">
        {/* Menu des saisons (`TvSeasonPills` → `DetailsSelect` en largeur ajustée). */}
        <Ghost className="inline-flex h-11 max-w-full items-center gap-3 rounded-[14px] border border-transparent px-4 text-sm font-medium" bar="inset-y-0" radius="!rounded-[14px]">
          <span className="flex min-w-0 items-center gap-2.5">
            <span>{t('details.seasonNumber', { number: 1 })}</span>
            <span className="whitespace-nowrap px-2 py-0.5 text-xs">{t('details.episodesCount', { count: 10 })}</span>
          </span>
          <span className="size-4 flex-none" />
        </Ghost>
        {/* Barre d'outils : la vue seule, dès 768 px (`TvEpisodesToolbar`). */}
        <div className="mt-3.5 hidden md:mt-0 md:flex md:justify-end">
          <Segmented count={3} />
        </div>
      </div>

      <div className="mb-1 mt-3.5 flex items-center justify-between gap-3 md:mb-[22px] md:mt-0">
        <p className="min-w-0 text-[13px] md:text-sm">
          <Ghost>{t('details.seasonNumber', { number: 1 })} · 2008 · {t('details.episodesCount', { count: 8 })}</Ghost>
        </p>
        <Segmented count={2} className="md:hidden" />
      </div>

      {/* Téléphone : lignes (`TvEpisodeRow`). */}
      <ul className="md:hidden">
        {EPISODES.map((index) => (
          <li key={index} className="grid grid-cols-[132px_minmax(0,1fr)_44px] items-center gap-x-3 border-b border-white/[.08] py-[11px]">
            <Bone className="aspect-video w-full" radius="!rounded-[10px]" />
            <div className="min-w-0">
              <Lines className="text-sm font-semibold leading-[1.3]" lines={[index % 2 ? 'w-[66%]' : 'w-[82%]']} />
              <div className="mt-[3px] flex items-center justify-between gap-2">
                <Lines className="min-w-0 flex-1 text-xs" lines={['w-[58%]']} />
                <span className="-my-2 flex size-8 flex-none items-center justify-center">
                  <Bone className="size-4" radius="!rounded" />
                </span>
              </div>
            </div>
            <span className="flex items-center justify-end">
              <EpisodeAction />
            </span>
          </li>
        ))}
      </ul>

      {/* Dès 768 px : grille de cartes (`TvEpisodeCard`), colonnes de `TvEpisodeList`. */}
      <ul className="hidden grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-5 gap-y-[30px] md:grid min-[1700px]:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
        {EPISODES.map((index) => (
          <li key={index} className="min-w-0">
            <Bone className="aspect-video w-full" radius="!rounded-xl" />
            <Lines className="mt-3 text-[15px] font-semibold leading-[1.35]" lines={[index % 3 === 1 ? 'w-[52%]' : 'w-[68%]']} />
            <div className="mt-0.5 flex min-h-9 items-center justify-between gap-2">
              <Lines className="min-w-0 flex-1 text-[13px]" lines={['w-[54%]']} />
              <div className="-mr-2 flex flex-none items-center">
                <EpisodeAction />
                <EpisodeAction />
              </div>
            </div>
            <div className="mt-0.5">
              <Lines className="text-[13px] leading-normal" lines={['w-full', 'w-[76%]']} />
              <Ghost className="mt-0.5 inline-flex h-7 items-center gap-1 text-xs font-semibold">
                {t('details.seeMore')}
                <span className="size-3.5" />
              </Ghost>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DetailsSkeleton = ({ mediaType = 'movie' }: DetailsSkeletonProps) => {
  const isTV = mediaType === 'tv';
  return (
    <div className="relative min-h-screen bg-black pb-24 text-white animate-skeleton-fade motion-reduce:animate-none" aria-hidden="true">
      <Hero isTV={isTV} />
      <SectionNav isTV={isTV} />
      <div className={DETAILS_GRID}>
        {isTV ? (
          <>
            <Episodes />
            <Overview isTV />
          </>
        ) : <Overview isTV={false} />}
        <Cast />
      </div>
    </div>
  );
};

export default DetailsSkeleton;
