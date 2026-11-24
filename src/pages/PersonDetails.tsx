import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Film, Share, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SEO from '@/components/SEO';
import ShareButtons from '@/components/ShareButtons';
import { buildSiteUrl } from '@/config/runtime';
import { useAgeRestrictedContent } from '@/hooks/useAgeRestrictedContent';
import { useSagaProgress } from '@/hooks/useSagaProgress';
import { cn } from '@/lib/utils';
import {
  DETAILS_FOCUS, DETAILS_GRID,
  DetailsActionButton, DetailsActionRow, DetailsBarIconButton, DetailsButton, DetailsFacts, DetailsHero,
  DetailsLinkButton, DetailsMetaLine, DetailsPill, DetailsSection, DetailsSectionHeader, DetailsSectionNav,
  DetailsSynopsis, DetailsTitle, DetailsTmdbNote,
  detailsHeroImages, formatDetailsLongDate, scrollToDetailsSection, useDetailsImageSizing,
  type DetailsSectionLink,
} from '@/components/details';
import {
  PersonDetailsSkeleton, PersonFilmography, PersonKnownFor,
  ageInYears, pickKnownFor, personGenderContext, personProfessionLabel, usePersonDetails,
  type PersonExternalIds,
} from '@/components/details/person';

/** Ancres des sections : cibles de la barre de sections. */
const SECTION = {
  about: 'apropos',
  knownFor: 'connu-pour',
  filmography: 'filmographie',
} as const;

/** Biographie repliée dès 768 px au-delà de cette longueur (en caractères). */
const BIO_FOLD_AT = 1100;
/** Repliée, elle montre ses premiers paragraphes jusqu'à environ cette longueur. */
const BIO_PREVIEW = 650;

/** Autres noms en alphabet latin (TMDB mêle chinois, russe, coréen…), sans le nom affiché. */
const LATIN_NAME = /^[\p{Script=Latin}\p{M}\s.'’-]+$/u;

/** Liens externes de la fiche, dans cet ordre. */
function externalLinks(personId: number, ids: PersonExternalIds, imdbId: string | null) {
  const imdb = ids.imdb_id || imdbId;
  return [
    { key: 'tmdb', label: 'TMDB', href: `https://www.themoviedb.org/person/${personId}` },
    imdb && { key: 'imdb', label: 'IMDb', href: `https://www.imdb.com/name/${encodeURIComponent(imdb)}/` },
    ids.instagram_id && { key: 'instagram', label: 'Instagram', href: `https://www.instagram.com/${encodeURIComponent(ids.instagram_id)}/` },
    ids.twitter_id && { key: 'x', label: 'X', href: `https://x.com/${encodeURIComponent(ids.twitter_id)}` },
    ids.tiktok_id && { key: 'tiktok', label: 'TikTok', href: `https://www.tiktok.com/@${encodeURIComponent(ids.tiktok_id)}` },
    ids.facebook_id && { key: 'facebook', label: 'Facebook', href: `https://www.facebook.com/${encodeURIComponent(ids.facebook_id)}` },
  ].filter((link): link is { key: string; label: string; href: string } => Boolean(link));
}

/** Portrait du haut de page ; sans photo, l'initiale. */
function PersonPortrait({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  const box = 'block aspect-[4/5] w-[104px] flex-none overflow-hidden rounded-2xl shadow-[0_18px_48px_rgb(0_0_0/0.55)] ring-1 ring-inset ring-white/15 md:w-[160px] 2xl:w-[184px]';
  if (!url || failed) {
    return (
      <span aria-hidden="true" className={cn(box, 'flex items-center justify-center bg-white/10 text-4xl font-semibold text-white md:text-6xl')}>
        {name.trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span className={cn(box, 'relative bg-white/[.06]')}>
      <img
        src={url}
        alt={name}
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </span>
  );
}

const PersonDetails = (): JSX.Element => {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const sizing = useDetailsImageSizing();
  const { person, credits, externalIds, biographyInEnglish, loading, error } = usePersonDetails(id);
  // Filtre d'âge du profil : un titre interdit ne paraît nulle part sur la page.
  const { items: allowedCredits, isFiltering } = useAgeRestrictedContent(credits);
  const movieIds = useMemo(
    () => allowedCredits.filter((credit) => credit.media_type === 'movie').map((credit) => credit.id),
    [allowedCredits],
  );
  // Même suivi que les sagas : stockage local, puis l'historique du serveur.
  const progress = useSagaProgress(movieIds);
  const knownForDepartment = person?.known_for_department ?? null;
  const knownFor = useMemo(() => pickKnownFor(allowedCredits, knownForDepartment), [allowedCredits, knownForDepartment]);
  const [filmographyCount, setFilmographyCount] = useState<number | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);

  // La route n'a pas de marge haute (l'image passe sous l'en-tête) : les
  // écrans sans image la remettent eux-mêmes.
  if (loading || (credits.length > 0 && isFiltering)) return <PersonDetailsSkeleton />;
  if (error || !person) {
    const failed = error === 'failed';
    return (
      <div className="min-h-screen bg-black px-4 pb-24 pt-32 text-center text-white">
        <UserRound className="mx-auto mb-4 size-16 text-white opacity-40" aria-hidden="true" />
        <h1 className="mb-3 text-2xl font-bold">{failed ? t('common.error') : t('details.person.notFoundTitle')}</h1>
        <p className="mx-auto mb-8 max-w-[44ch] text-white/60">{failed ? t('details.loadError') : t('details.personNotFound')}</p>
        <DetailsLinkButton to="/" variant="primary" size="compact">{t('details.person.backHome')}</DetailsLinkButton>
      </div>
    );
  }

  const language = i18n.language;
  const context = personGenderContext(person.gender);
  const profession = personProfessionLabel(person.known_for_department, person.gender, t);
  const deceased = Boolean(person.deathday);
  const age = ageInYears(person.birthday, person.deathday ?? new Date());
  const birthLong = formatDetailsLongDate(person.birthday, language);
  const deathLong = formatDetailsLongDate(person.deathday, language);
  const birthYear = person.birthday?.slice(0, 4) ?? null;
  const deathYear = person.deathday?.slice(0, 4) ?? null;
  const biography = person.biography;

  // Grande image : celle du titre le plus connu, sinon de n'importe quel titre.
  const backdropPath = knownFor.find((credit) => credit.backdropPath)?.backdropPath
    ?? [...allowedCredits].sort((a, b) => b.voteCount - a.voteCount).find((credit) => credit.backdropPath)?.backdropPath
    ?? null;
  const hero = detailsHeroImages(sizing, { backdrop: backdropPath });
  const portraitUrl = sizing.profileUrl(person.profile_path, 184);

  const movieCount = movieIds.length;
  const seriesCount = allowedCredits.length - movieCount;
  const otherNames = person.also_known_as
    .map((name) => name.trim())
    .filter((name, index, list) => name && name !== person.name && LATIN_NAME.test(name) && list.indexOf(name) === index)
    .slice(0, 3);
  const links = externalLinks(person.id, externalIds, person.imdb_id);

  // Biographie de la section « À propos » : paragraphes, repliée si longue.
  const paragraphs = biography.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const bioFolds = biography.length > BIO_FOLD_AT;
  let previewLength = 0;
  const shownParagraphs = !bioFolds || bioExpanded ? paragraphs : paragraphs.filter((paragraph, index) => {
    const keep = index === 0 || previewLength < BIO_PREVIEW;
    previewLength += paragraph.length;
    return keep;
  });

  const shareUrl = buildSiteUrl(`/person/${person.id}`);
  const seoDescription = biography
    ? `${biography.slice(0, 157).trim()}${biography.length > 157 ? '…' : ''}`
    : t('details.person.seoDescription', { name: person.name });
  const shareTrigger = (render: (open: () => void) => JSX.Element) => (
    <ShareButtons
      title={person.name}
      description={seoDescription}
      imageUrl={person.profile_path ? `https://image.tmdb.org/t/p/original${person.profile_path}` : undefined}
      url={shareUrl}
      renderTrigger={(open) => render(() => open())}
    />
  );

  const sections: DetailsSectionLink[] = [
    { id: SECTION.about, label: t('details.person.about') },
    ...(knownFor.length > 0 ? [{ id: SECTION.knownFor, label: t('details.person.knownFor', { context }) }] : []),
    ...(allowedCredits.length > 0 ? [{ id: SECTION.filmography, label: t('details.filmography') }] : []),
  ];

  return (
    <MotionConfig reducedMotion="user">
      <SEO
        title={`${person.name} - Movix`}
        description={seoDescription}
        ogUrl={shareUrl}
        ogImage={person.profile_path ? `https://image.tmdb.org/t/p/original${person.profile_path}` : undefined}
        canonical={shareUrl}
      />

      <div className="relative min-h-screen bg-black pb-24 text-white animate-skeleton-fade motion-reduce:animate-none">
        <DetailsHero
          backdropUrl={hero.backdropUrl}
          media={<PersonPortrait name={person.name} url={portraitUrl} />}
          pills={(
            <>
              {profession && <DetailsPill uppercase>{profession}</DetailsPill>}
              {!deceased && age !== null && <DetailsPill>{t('details.person.age', { count: age })}</DetailsPill>}
              {deceased && <DetailsPill>{`${birthYear ?? '?'} – ${deathYear}`}</DetailsPill>}
              {progress.watchedCount > 0 && (
                <DetailsPill icon={<Check aria-hidden="true" strokeWidth={3} />}>
                  {t('details.person.watchedCount', { count: progress.watchedCount, total: progress.total })}
                </DetailsPill>
              )}
            </>
          )}
          title={<DetailsTitle title={person.name} />}
          meta={(
            <DetailsMetaLine
              items={[
                birthLong && { key: 'born', content: t('details.person.born', { date: birthLong, context }) },
                deathLong && { key: 'died', content: t('details.person.died', { date: deathLong, context }) },
                person.place_of_birth && { key: 'place', content: person.place_of_birth, desktopOnly: true },
              ]}
            />
          )}
          synopsis={biography ? (
            <DetailsSynopsis text={biography} moreLabel={t('details.readMore')} lessLabel={t('details.collapse')} />
          ) : null}
          actions={allowedCredits.length > 0 ? (
            <DetailsButton
              variant="primary"
              size="hero"
              icon={<Film aria-hidden="true" />}
              detail={t('details.person.titlesCount', { count: allowedCredits.length })}
              onClick={() => scrollToDetailsSection(SECTION.filmography)}
              className="w-full md:w-auto"
            >
              {t('details.person.seeFilmography')}
            </DetailsButton>
          ) : null}
          secondaryActions={(
            <DetailsActionRow columns={3}>
              {shareTrigger((open) => (
                <DetailsActionButton icon={Share} label={t('common.share')} aria-haspopup="dialog" onClick={open} />
              ))}
            </DetailsActionRow>
          )}
        />

        <DetailsSectionNav
          sections={sections}
          ariaLabel={t('details.sectionsNav')}
          backdropUrl={hero.backdropUrl}
          banner={{
            title: person.name,
            actions: (
              <>
                {allowedCredits.length > 0 && (
                  <DetailsButton
                    variant="primary"
                    size="bar"
                    icon={<Film aria-hidden="true" />}
                    onClick={() => scrollToDetailsSection(SECTION.filmography)}
                  >
                    {t('details.filmography')}
                  </DetailsButton>
                )}
                {shareTrigger((open) => (
                  <DetailsBarIconButton icon={Share} label={t('common.share')} aria-haspopup="dialog" onClick={open} />
                ))}
              </>
            ),
          }}
        />

        {/* Positionné : passe au-dessus de la coulure de la grande image. */}
        <div className={`${DETAILS_GRID} relative`}>
          {/* À propos : biographie complète dès 768 px (avant, elle se lit dans le haut), puis les faits. */}
          <DetailsSection id={SECTION.about} className="pt-[22px]">
            <div className="grid gap-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start lg:gap-[72px]">
              <div className="hidden md:block">
                <DetailsSectionHeader title={t('details.biography')} />
                {paragraphs.length > 0 ? (
                  <div id="biographie-texte" className="max-w-[66ch] space-y-4 text-pretty text-[17px] leading-[1.65] text-white/[.88] 2xl:text-[19px]">
                    {shownParagraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                  </div>
                ) : (
                  <p className="text-[17px] text-white/55">{t('details.noBiography')}</p>
                )}
                {bioFolds && (
                  <button
                    type="button"
                    aria-expanded={bioExpanded}
                    aria-controls="biographie-texte"
                    onClick={() => {
                      if (bioExpanded) scrollToDetailsSection(SECTION.about);
                      setBioExpanded(!bioExpanded);
                    }}
                    className={cn(
                      'mt-2 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-80 motion-reduce:transition-none',
                      DETAILS_FOCUS,
                    )}
                  >
                    {bioExpanded ? t('details.collapse') : t('details.readMore')}
                    {bioExpanded
                      ? <ChevronUp className="size-4" aria-hidden="true" />
                      : <ChevronDown className="size-4" aria-hidden="true" />}
                  </button>
                )}
                {biographyInEnglish && (
                  <p className="mt-3 text-[13px] text-white/55">{t('details.person.englishBiography')}</p>
                )}
                <DetailsTmdbNote mediaType="person" id={String(person.id)} className="mt-5" />
              </div>
              <div>
                <DetailsFacts
                  items={[
                    profession && { key: 'profession', label: t('details.profession'), value: profession },
                    birthLong && {
                      key: 'birth',
                      label: t('details.birthday'),
                      value: !deceased && age !== null ? `${birthLong} (${t('details.person.age', { count: age })})` : birthLong,
                    },
                    person.place_of_birth && { key: 'place', label: t('details.placeOfBirth'), value: person.place_of_birth },
                    deathLong && {
                      key: 'death',
                      label: t('details.deathday'),
                      value: age !== null ? `${deathLong} (${t('details.person.ageAtDeath', { count: age })})` : deathLong,
                    },
                    otherNames.length > 0 && { key: 'aka', label: t('details.person.alsoKnownAs'), value: otherNames.join(', ') },
                    allowedCredits.length > 0 && {
                      key: 'credits',
                      label: t('details.person.creditsLabel'),
                      value: [
                        movieCount > 0 && t('details.person.movieCount', { count: movieCount }),
                        seriesCount > 0 && t('details.person.seriesCount', { count: seriesCount }),
                      ].filter(Boolean).join(' · '),
                    },
                    {
                      key: 'links',
                      label: t('details.person.links'),
                      value: (
                        <span className="inline-flex flex-wrap justify-end gap-x-1">
                          {links.map((link, index) => (
                            <span key={link.key}>
                              {index > 0 && <span aria-hidden="true" className="mr-1 opacity-50">·</span>}
                              <a
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn('rounded-sm underline-offset-4 hover:underline', DETAILS_FOCUS)}
                              >
                                {link.label}
                              </a>
                            </span>
                          ))}
                        </span>
                      ),
                    },
                  ]}
                />
                <DetailsTmdbNote mediaType="person" id={String(person.id)} className="mt-3 md:hidden" />
              </div>
            </div>
          </DetailsSection>

          {knownFor.length > 0 && (
            <DetailsSection id={SECTION.knownFor}>
              <DetailsSectionHeader title={t('details.person.knownFor', { context })} />
              <PersonKnownFor credits={knownFor} gender={person.gender} progress={progress.films} />
            </DetailsSection>
          )}

          {allowedCredits.length > 0 && (
            <DetailsSection id={SECTION.filmography}>
              <DetailsSectionHeader title={t('details.filmography')} count={filmographyCount} />
              <PersonFilmography
                credits={allowedCredits}
                knownForDepartment={knownForDepartment}
                gender={person.gender}
                progress={progress.films}
                onCountChange={setFilmographyCount}
                sectionId={SECTION.filmography}
              />
            </DetailsSection>
          )}
        </div>
      </div>
    </MotionConfig>
  );
};

export default PersonDetails;
