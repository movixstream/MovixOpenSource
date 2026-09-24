import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWrappedYear, getWrappedExperiment, isWrappedTestRoute } from '../src/utils/wrappedExperiment.ts';

test('seules les routes Wrapped explicitement en test peuvent ignorer la sélection du profil', () => {
    for (const pathname of ['/wrapped', '/wrapped/', '/wrapped/2026', '/wrapped/2026/']) {
        assert.equal(isWrappedTestRoute(pathname, '?test=true&version=A'), true);
        assert.equal(isWrappedTestRoute(pathname, '?test=true&version=B'), true);
        assert.equal(isWrappedTestRoute(pathname, '?version=A'), false);
        assert.equal(isWrappedTestRoute(pathname, '?test=false'), false);
    }
    for (const pathname of ['/', '/movies', '/wrapped-other', '/wrapped/2026/details', '/profile-selection']) {
        assert.equal(isWrappedTestRoute(pathname, '?test=true'), false);
    }
});
test('la campagne de janvier reste sur l’année terminée, sans modifier les routes explicites', () => {
    assert.equal(defaultWrappedYear(new Date(2026, 11, 31)), 2026);
    assert.equal(defaultWrappedYear(new Date(2027, 0, 1)), 2026);
    assert.equal(defaultWrappedYear(new Date(2027, 0, 31)), 2026);
    assert.equal(defaultWrappedYear(new Date(2027, 1, 1)), 2027);
    assert.equal(defaultWrappedYear(new Date(2024, 0, 1)), 2024);
});

test('B reste la version par défaut et seul test=true active les fixtures', () => {
    for (const search of ['', '?test=false', '?test=1', '?test=True', '?test', '?version=unknown']) {
        assert.deepEqual(getWrappedExperiment(search), { test: false, version: 'B' });
    }
    assert.deepEqual(getWrappedExperiment('?test=true'), { test: true, version: 'B' });
    assert.deepEqual(getWrappedExperiment('?test=true&version=A'), { test: true, version: 'A' });
    assert.deepEqual(getWrappedExperiment('?version=b&test=true'), { test: true, version: 'B' });
    assert.deepEqual(getWrappedExperiment('?version=a'), { test: false, version: 'A' });
    assert.deepEqual(getWrappedExperiment('?test=false&version=A'), { test: false, version: 'A' });
});
