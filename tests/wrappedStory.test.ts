import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createWrappedTestData } from '../src/data/wrappedTestData.ts';
import { hasWrappedCommunity, hasWrappedRace, selectWrappedScenes, wrappedEras, wrappedRaceFrames, wrappedStoryMode, wrappedTraitFacts } from '../src/utils/wrappedStory.ts';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'fr', resources: { fr: { translation: JSON.parse(readFileSync(new URL('../src/i18n/locales/fr.json', import.meta.url), 'utf8')) } } });
const fixture = () => createWrappedTestData(2026, 'fr', i18n.t);

test('le jour record existant entre dans le récit sans changer l’historique ni dépasser dix scènes', () => {
    const data = fixture();
    const before = structuredClone(data);
    assert.ok(selectWrappedScenes(data).includes('rhythm'));
    assert.equal(selectWrappedScenes(data).length, 10);
    assert.deepEqual(data, before);
    data.recordDay = null;
    data.listeningClock = [];
    assert.ok(!selectWrappedScenes(data).includes('rhythm'));
});

test('un profil communautaire ouvre sur son vrai commentaire, sans déplacer le quiz du podium', () => {
    const data = fixture();
    const copy = structuredClone(data);
    const scenes = selectWrappedScenes(data);
    assert.equal(wrappedStoryMode(data), 'community');
    assert.equal(scenes[1], 'community');
    assert.deepEqual(scenes.slice(scenes.indexOf('quiz'), scenes.indexOf('quiz') + 3), ['quiz', 'favorite', 'top-five']);
    assert.ok(scenes.indexOf('race') > scenes.indexOf('favorite'));
    assert.equal(scenes.length, 10);
    assert.equal(new Set(scenes).size, scenes.length);
    assert.deepEqual(data, copy);
});

test('le montage change avec les données, les activités absentes ne créent aucun chapitre', () => {
    const explorer = fixture();
    explorer.community = null;
    assert.equal(wrappedStoryMode(explorer), 'explorer');
    assert.equal(selectWrappedScenes(explorer)[2], 'eras');
    assert.ok(!selectWrappedScenes(explorer).includes('community'));
    const sparse = fixture();
    sparse.community = { commentsPosted: 0, repliesPosted: 0, discussedTitles: 0, topTitles: [], calendarTimezone: 'UTC' };
    sparse.story = null; sparse.topContent = []; sparse.topGenres = []; sparse.monthlyGraph = []; sparse.listeningClock = [];
    sparse.stats.totalMinutes = 0; sparse.stats.uniqueTitles = 0;
    assert.deepEqual(selectWrappedScenes(sparse), ['intro', 'persona', 'closing']);
    assert.equal(hasWrappedCommunity(sparse), false);
    assert.deepEqual(wrappedTraitFacts({ ...sparse, byType: [] }), []);
});

test('la course cumule les vrais mois, garde les formats distincts et atteint les totaux annuels', () => {
    const data = fixture();
    assert.equal(hasWrappedRace(data), true);
    const frames = wrappedRaceFrames(data);
    assert.equal(frames.length, 12);
    const last = frames.at(-1)!;
    for (const entry of last.entries) assert.equal(entry.minutes, entry.item.minutes);
    for (let index = 1; index < frames.length; index++) for (const entry of frames[index].entries) {
        assert.ok(entry.minutes >= frames[index - 1].entries.find(prior => prior.index === entry.index)!.minutes);
    }
    const race = data.story!.race!;
    race.months = [{ month: 1, minutes: [10, 10, 0, 0, 0] }, { month: 2, minutes: [0, 0, 0, 0, 0] }, { month: 3, minutes: [10, 10, 0, 0, 0] }];
    assert.equal(hasWrappedRace(data), false, 'ni égalité ni mois vide ne fabriquent une course');
});

test('un leader constant ne crée pas une course artificielle', () => {
    const data = fixture();
    data.story!.race!.months = [1, 2, 3, 4].map(month => ({ month, minutes: [10, 1, 1, 1, 1] }));
    assert.equal(hasWrappedRace(data), false);
    assert.ok(!selectWrappedScenes(data).includes('race'));
});

test('les périodes reviennent dans l’ordre et les profils nocturnes exigent une couverture suffisante', () => {
    const data = fixture();
    data.story!.eras.reverse();
    assert.deepEqual(wrappedEras(data).map(era => era.fromMonth), [1, 5, 9]);
    data.story!.eras[0].coverage = 20;
    assert.equal(wrappedEras(data).length, 2);
    data.listeningClock = [{ hour: 23, minutes: 1 }];
    assert.ok(!wrappedTraitFacts(data).some(trait => trait.id === 'night'));
    data.listeningClock = [{ hour: 23, minutes: data.stats.totalMinutes }];
    assert.equal(wrappedTraitFacts(data)[0].id, 'night');
});
