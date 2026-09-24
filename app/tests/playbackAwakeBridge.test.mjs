import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = path.basename(process.cwd()) === 'app'
  ? process.cwd()
  : path.resolve(process.cwd(), 'app');
const read = relativePath => readFile(path.join(ROOT, relativePath), 'utf8');

async function loadPlaybackAwakeService(nativeModule) {
  const source = await read('src/services/playbackAwake.ts');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  const factory = vm.runInNewContext(
    `(function(require,module,exports){${outputText}\n})`,
    {},
  );
  factory(
    id => {
      assert.equal(id, 'react-native');
      return { NativeModules: { PlaybackAwake: nativeModule } };
    },
    module,
    module.exports,
  );
  return module.exports;
}

test('playback-awake owners are forwarded independently when the native owner API exists', async () => {
  const ownerCalls = [];
  const localCalls = [];
  const service = await loadPlaybackAwakeService({
    setLocalPlaybackAwake: active => localCalls.push(active),
    setPlaybackAwakeOwner: (owner, active) => ownerCalls.push([owner, active]),
  });

  service.setPlaybackAwakeOwner('local-playback', true);
  service.setPlaybackAwakeOwner('cast', true);
  service.setPlaybackAwakeOwner('local-playback', false);
  service.setPlaybackAwakeOwner('pip', true);
  service.setPlaybackAwakeOwner('cast', false);

  assert.deepEqual(ownerCalls, [
    ['local-playback', true],
    ['cast', true],
    ['local-playback', false],
    ['pip', true],
    ['cast', false],
  ]);
  assert.deepEqual(localCalls, []);
});

test('owner API falls back only for local playback on legacy native modules', async () => {
  const localCalls = [];
  const service = await loadPlaybackAwakeService({
    setLocalPlaybackAwake: active => localCalls.push(active),
  });

  service.setPlaybackAwakeOwner('local-playback', true);
  service.setPlaybackAwakeOwner('pip', true);
  service.setPlaybackAwakeOwner('cast', false);
  service.setLocalPlaybackAwake(false);

  assert.deepEqual(localCalls, [true, false]);
});
