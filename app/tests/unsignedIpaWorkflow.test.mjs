import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const generatorPath = fileURLToPath(
  new URL('../scripts/generate-ios-source.mjs', import.meta.url),
);

function generatorEnv(overrides = {}) {
  return {
    ...process.env,
    IOS_SOURCE_VERSION: '9.9.9',
    IOS_SOURCE_BUILD_NUMBER: '42',
    IOS_SOURCE_MIN_OS: '15.1',
    // N'importe quel fichier lisible fait office d'IPA pour la taille.
    IOS_SOURCE_IPA_PATH: generatorPath,
    IOS_SOURCE_DATE: '2026-01-02T03:04:05+02:00',
    IOS_SOURCE_DOWNLOAD_URL: 'https://example.test/movix-ios-unsigner.ipa',
    IOS_SOURCE_ICON_URL: 'https://example.test/icon-1024.png',
    IOS_SOURCE_NOTES_URL: 'https://example.test/releases/tag/ios-v9.9.9',
    ...overrides,
  };
}

test('sidestore source generator produces a source consistent with its inputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'movix-ios-source-'));
  try {
    const output = join(dir, 'movix-ios-source.json');
    execFileSync(process.execPath, [generatorPath], {
      env: generatorEnv({
        IOS_SOURCE_OUTPUT: output,
        IOS_SCARLET_OUTPUT: join(dir, 'movix-scarlet-source.json'),
      }),
    });

    const source = JSON.parse(await readFile(output, 'utf8'));
    // Clés primaires des stores : figées pour toujours.
    assert.equal(source.identifier, 'com.movix.source');
    const app = source.apps[0];
    assert.equal(app.bundleIdentifier, 'com.movix.app');

    const latest = app.versions[0];
    assert.equal(latest.version, '9.9.9');
    assert.equal(latest.buildVersion, '42');
    assert.equal(latest.date, '2026-01-02');
    assert.equal(latest.minOSVersion, '15.1');
    assert.equal(latest.downloadURL, 'https://example.test/movix-ios-unsigner.ipa');
    assert.equal(latest.size, (await stat(generatorPath)).size);

    // Champs hérités du premier format : duplication exacte de la dernière
    // version, pour les anciens AltStore.
    assert.equal(app.version, latest.version);
    assert.equal(app.versionDate, latest.date);
    assert.equal(app.downloadURL, latest.downloadURL);
    assert.equal(app.size, latest.size);

    // L'IPA est compilée sans entitlements : la source ne doit en déclarer aucun.
    assert.deepEqual(app.appPermissions, { entitlements: [], privacy: {} });

    // Le domaine du site tourne sous blocage FAI. Le lien n'est lu que par
    // l'interface du store, mais il ne doit jamais renvoyer vers un domaine
    // mort : movix.tax ne répond plus depuis longtemps.
    assert.match(source.website, /^https:\/\//);
    assert.doesNotMatch(source.website, /movix\.tax/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scarlet source describes the same IPA in scarlet own format', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'movix-scarlet-source-'));
  try {
    const scarletOutput = join(dir, 'movix-scarlet-source.json');
    const output = join(dir, 'movix-ios-source.json');
    execFileSync(process.execPath, [generatorPath], {
      env: generatorEnv({
        IOS_SOURCE_OUTPUT: output,
        IOS_SCARLET_OUTPUT: scarletOutput,
      }),
    });

    const scarlet = JSON.parse(await readFile(scarletOutput, 'utf8'));
    // Format Scarlet : un bloc META, puis des seaux par catégorie. Movix n'est
    // ni un tweak ni un émulateur, donc « Other ».
    assert.equal(scarlet.META.repoName, 'Movix');
    assert.equal(scarlet.META.repoIcon, 'https://example.test/icon-1024.png');
    const entry = scarlet.Other[0];
    assert.equal(entry.name, 'Movix');
    assert.equal(entry.bundleID, 'com.movix.app');
    assert.equal(entry.version, '9.9.9');
    // `down` est l'équivalent Scarlet de `downloadURL` : la même IPA doit être
    // servie aux deux stores, jamais deux fichiers différents.
    const altStore = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(entry.down, altStore.apps[0].versions[0].downloadURL);
    assert.equal(entry.bundleID, altStore.apps[0].bundleIdentifier);
    assert.equal(entry.version, altStore.apps[0].versions[0].version);
    assert.equal(entry.contact.web, altStore.website);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sidestore source generator refuses malformed or missing inputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'movix-ios-source-'));
  try {
    const output = join(dir, 'movix-ios-source.json');
    const scarlet = join(dir, 'movix-scarlet-source.json');
    const cases = [
      { IOS_SOURCE_OUTPUT: output, IOS_SCARLET_OUTPUT: scarlet, IOS_SOURCE_VERSION: 'v9.9.9' },
      { IOS_SOURCE_OUTPUT: output, IOS_SCARLET_OUTPUT: scarlet, IOS_SOURCE_BUILD_NUMBER: 'quarante-deux' },
      { IOS_SOURCE_OUTPUT: output, IOS_SCARLET_OUTPUT: scarlet, IOS_SOURCE_DOWNLOAD_URL: 'http://example.test/movix.ipa' },
      { IOS_SOURCE_OUTPUT: output, IOS_SCARLET_OUTPUT: scarlet, IOS_SOURCE_IPA_PATH: join(dir, 'absent.ipa') },
      { IOS_SOURCE_OUTPUT: output, IOS_SCARLET_OUTPUT: scarlet, IOS_SOURCE_NOTES_URL: '' },
      // La sortie Scarlet est obligatoire : un oubli côté workflow doit faire
      // échouer la publication, pas produire une source sur deux.
      { IOS_SOURCE_OUTPUT: output, IOS_SCARLET_OUTPUT: '' },
    ];
    for (const overrides of cases) {
      assert.throws(
        () => execFileSync(process.execPath, [generatorPath], {
          env: generatorEnv(overrides),
          stdio: 'pipe',
        }),
        undefined,
        `should reject ${JSON.stringify(overrides)}`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
