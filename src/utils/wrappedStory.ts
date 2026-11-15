import type { WrappedData } from '../services/wrappedService';
import type { WrappedScene, WrappedSignatureKind } from '../types/wrapped';

export type WrappedStoryMode = 'community' | 'explorer' | 'regular' | 'devoted' | 'balanced';
const positive = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value || 0) : 0;

const GENRES: Record<string, string> = {
    action: 'action', aventure: 'adventure', adventure: 'adventure', animation: 'animation',
    comedie: 'comedy', comedy: 'comedy', crime: 'crime', documentaire: 'documentary', documentary: 'documentary',
    drame: 'drama', drama: 'drama', familial: 'family', family: 'family', fantastique: 'fantasy', fantasy: 'fantasy',
    histoire: 'history', history: 'history', horreur: 'horror', horror: 'horror', musique: 'music', music: 'music',
    mystere: 'mystery', mystery: 'mystery', romance: 'romance', sciencefiction: 'scifi',
    telefilm: 'tvmovie', tvmovie: 'tvmovie', thriller: 'thriller', guerre: 'war', war: 'war', western: 'western',
    actionadventure: 'actionAdventure', scififantasy: 'scifiFantasy', sciencefictionfantastique: 'scifiFantasy', kids: 'kids', news: 'news',
    reality: 'reality', soap: 'soap', talk: 'talk', warpolitics: 'warPolitics',
};

/** Clé stable d'un genre reçu en français ou en anglais (« Science-fiction » → scifi). */
export function wrappedGenreKey(name: string): string | null {
    return GENRES[name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '')] || null;
}

export function hasWrappedCommunity(data: WrappedData): boolean {
    return Boolean(data.community && positive(data.community.commentsPosted) + positive(data.community.repliesPosted) > 0);
}

export function wrappedStoryMode(data: WrappedData): WrappedStoryMode {
    const total = positive(data.stats.totalMinutes);
    const contributions = positive(data.community?.commentsPosted) + positive(data.community?.repliesPosted);
    if (hasWrappedCommunity(data) && (data.community?.highlight || contributions >= 12)) return 'community';
    if (total > 0 && positive(data.topContent[0]?.minutes) / total >= 0.4) return 'devoted';
    if (data.stats.uniqueTitles >= 25 && (data.topGenres?.length || 0) >= 3) return 'explorer';
    if ((data.monthlyGraph?.filter(month => month.minutes > 0).length || 0) >= 6) return 'regular';
    return 'balanced';
}

/** Valeurs cumulées depuis janvier ; les mois sans lecture n'ajoutent rien. */
export function wrappedRaceFrames(data: WrappedData) {
    const race = data.story?.race;
    if (!race || race.items.length < 2) return [];
    const totals = race.items.map(() => 0);
    return [...race.months].filter(month => month.month >= 1 && month.month <= 12).sort((a, b) => a.month - b.month).map(month => {
        const entries = race.items.map((item, index) => {
            totals[index] += positive(month.minutes[index]);
            return { item, index, minutes: totals[index] };
        }).sort((a, b) => b.minutes - a.minutes || a.index - b.index);
        return { month: month.month, entries, active: month.minutes.some(value => value > 0) };
    });
}

export function hasWrappedRace(data: WrappedData): boolean {
    const frames = wrappedRaceFrames(data).filter(frame => frame.active);
    if (frames.length < 3) return false;
    // Une égalité ne crée pas artificiellement un changement de leader.
    const leaders = frames.filter(frame => frame.entries[0].minutes > frame.entries[1].minutes).map(frame => frame.entries[0].index);
    return new Set(leaders).size > 1;
}

export function wrappedEras(data: WrappedData) {
    return (data.story?.eras || []).filter(era => era.fromMonth >= 1 && era.toMonth <= 12 && era.fromMonth <= era.toMonth && era.share >= (era.kind === 'genre' ? 40 : 60) && era.coverage >= 70).sort((a, b) => a.fromMonth - b.fromMonth).slice(0, 3);
}

/** Un budget éditorial, jamais des scènes de remplissage. */
export function selectWrappedScenes(data: WrappedData): WrappedScene[] {
    const mode = wrappedStoryMode(data);
    const reveal: WrappedScene[] = [];
    if (data.topContent.length >= 3) reveal.push('quiz');
    if (data.topContent.length > 0) reveal.push('favorite');
    if (data.topContent.length > 1) reveal.push('top-five');
    const time: WrappedScene[] = data.stats.totalMinutes > 0 ? ['time'] : [];
    const coreCount = 3 + time.length + reveal.length;
    const hasRecord = positive(data.recordDay?.minutes) > 0 && data.stats.totalMinutes > 0;
    const eras = wrappedEras(data);
    const candidates: { scene: WrappedScene; score: number }[] = [];
    if (hasWrappedCommunity(data)) candidates.push({ scene: 'community', score: data.community?.highlight ? 110 : mode === 'community' ? 100 : 62 });
    if (hasWrappedRace(data)) candidates.push({ scene: 'race', score: 92 });
    if (eras.length >= 2 && new Set(eras.map(era => `${era.kind}:${era.label}`)).size > 1) candidates.push({ scene: 'eras', score: mode === 'explorer' ? 105 : 90 });
    if ((data.topGenres?.filter(genre => genre.minutes > 0).length || 0) > 1) candidates.push({ scene: 'genres', score: mode === 'explorer' ? 85 : 58 });
    if (hasRecord || (data.listeningClock?.filter(hour => hour.minutes > 0).length || 0) > 1) {
        candidates.push({ scene: 'rhythm', score: hasRecord ? 104 : mode === 'regular' ? 95 : 52 });
    }
    if ((data.monthlyGraph?.filter(month => month.minutes > 0).length || 0) > 1) candidates.push({ scene: 'timeline', score: mode === 'regular' ? 80 : 45 });
    const chosen = candidates.sort((a, b) => b.score - a.score).slice(0, Math.max(0, 10 - coreCount)).map(item => item.scene);
    const before = chosen.filter(scene => scene !== 'race');
    // La course raconte rétrospectivement le classement : elle ne révèle pas la réponse au quiz.
    const after: WrappedScene[] = chosen.includes('race') ? ['race'] : [];
    const opening = mode === 'community' && before[0] === 'community' ? [before.shift()!, ...time] : [...time];
    return ['intro', ...opening, ...before, ...reveal, ...after, 'persona', 'closing'];
}

export type WrappedTrait = { id: 'night' | 'early' | 'format' | 'explorer' | 'community'; percent?: number; count?: number; type?: string };

export function wrappedTraitFacts(data: WrappedData): WrappedTrait[] {
    const traits: WrappedTrait[] = [];
    const clock = data.listeningClock || [];
    const tracked = clock.reduce((sum, hour) => sum + positive(hour.minutes), 0);
    if (tracked > 0 && tracked >= data.stats.totalMinutes * 0.7) {
        const night = clock.filter(hour => hour.hour >= 22 || hour.hour < 5).reduce((sum, hour) => sum + positive(hour.minutes), 0) / tracked;
        const early = clock.filter(hour => hour.hour >= 5 && hour.hour < 10).reduce((sum, hour) => sum + positive(hour.minutes), 0) / tracked;
        if (night >= 0.3) traits.push({ id: 'night', percent: Math.round(night * 100) });
        else if (early >= 0.3) traits.push({ id: 'early', percent: Math.round(early * 100) });
    }
    const format = [...data.byType].filter(item => item.minutes > 0).sort((a, b) => b.minutes - a.minutes)[0];
    if (format && format.percent >= 40) traits.push({ id: 'format', type: format.type, percent: format.percent });
    if (hasWrappedCommunity(data)) traits.push({ id: 'community', count: data.community!.commentsPosted + data.community!.repliesPosted });
    if (data.stats.uniqueTitles >= 25) traits.push({ id: 'explorer', count: data.stats.uniqueTitles });
    return traits.slice(0, 2);
}

const FORMAT_PERSONAS = ['anime-fan', 'weeb-supreme', 'otaku', 'binger', 'series-addict', 'tv-enthusiast', 'movie-lover', 'live-watcher'];

/**
 * Le plan « signature » du film : un seul fait d'habitude, choisi d'après le profil,
 * jamais une scène vide. Ordre : horaires marqués, régularité, voix, format, genres.
 */
export function wrappedSignatureKind(data: WrappedData): WrappedSignatureKind | null {
    const persona = data.persona?.id || '';
    const traits = wrappedTraitFacts(data);
    const clock = (data.listeningClock?.filter(hour => positive(hour.minutes) > 0).length || 0) >= 2 && data.peakHour != null;
    const streak = positive(data.stats.longestStreak) >= 3;
    const genres = (data.topGenres?.filter(genre => positive(genre.minutes) > 0).length || 0) >= 2;
    const formats = data.byType.filter(item => positive(item.minutes) > 0).length >= 2;
    if (clock && (persona === 'night-owl' || persona === 'early-bird' || traits.some(trait => trait.id === 'night' || trait.id === 'early'))) return 'clock';
    if (streak && (persona === 'streak-machine' || positive(data.stats.longestStreak) >= 14)) return 'streak';
    if (hasWrappedCommunity(data) && wrappedStoryMode(data) === 'community') return 'community';
    // Un partage à peu près égal n'est pas une préférence : le plan format demande 60 %.
    if (formats && (FORMAT_PERSONAS.includes(persona) || traits.some(trait => trait.id === 'format' && (trait.percent || 0) >= 60))) return 'formats';
    if (genres) return 'genres';
    if (clock) return 'clock';
    if (streak) return 'streak';
    return formats ? 'formats' : null;
}
