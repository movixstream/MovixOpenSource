import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const ts = require('typescript');

class ReactNativePartialURL {
  constructor(url) {
    this.value = url.endsWith('/') ? url : `${url}/`;
  }

  get href() {
    return this.value;
  }

  toString() {
    return this.value;
  }
}

for (const accessor of [
  'hash',
  'host',
  'hostname',
  'origin',
  'password',
  'pathname',
  'port',
  'protocol',
  'search',
  'username',
]) {
  Object.defineProperty(ReactNativePartialURL.prototype, accessor, {
    configurable: true,
    get() {
      throw new Error(`URL.${accessor} is not implemented`);
    },
  });
}

async function loadUpdateHelpersWithReactNativeURL() {
  const source = await read('../src/hooks/useAppUpdate.ts');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const module = { exports: {} };
  const context = vm.createContext({
    AbortController,
    URL: ReactNativePartialURL,
    clearTimeout,
    console,
    exports: module.exports,
    module,
    require: specifier => {
      if (specifier === 'react') return {};
      if (specifier === 'react-native') {
        return { AppState: { currentState: 'active' }, Platform: { OS: 'ios' } };
      }
      if (specifier === '@react-native-async-storage/async-storage') {
        return { __esModule: true, default: {} };
      }
      return {};
    },
    setTimeout,
  });
  new vm.Script(compiled, { filename: 'useAppUpdate.compiled.cjs' }).runInContext(
    context,
  );
  return module.exports;
}

test('iOS update URLs work with the partial React Native URL global', async () => {
  const { isValidHttpsUpdateUrl, releasePageUrl } =
    await loadUpdateHelpersWithReactNativeURL();
  const repository = 'https://github.com/Movix-STMG/MovixOpenSource';

  assert.equal(isValidHttpsUpdateUrl(repository), true);
  assert.equal(
    releasePageUrl(`${repository}/?source=mobile#download`),
    `${repository}/releases/latest`,
  );

  for (const unsafe of [
    'http://github.com/Movix-STMG/MovixOpenSource',
    'https://user:password@github.com/Movix-STMG/MovixOpenSource',
    'https://github.com/Movix-STMG/\u0000MovixOpenSource',
    'https://github.com/Movix-STMG/%00MovixOpenSource',
    'https://github.com/Movix-STMG/MovixOpenSource\\redirect',
    'https://github.com:99999/Movix-STMG/MovixOpenSource',
  ]) {
    assert.equal(isValidHttpsUpdateUrl(unsafe), false, unsafe);
  }
});

test('semantic versions reject numeric prerelease leading zeroes', async () => {
  const { isNewerSemanticVersion } =
    await loadUpdateHelpersWithReactNativeURL();

  assert.equal(isNewerSemanticVersion('2.5.13-0', '2.5.12'), true);
  assert.equal(isNewerSemanticVersion('2.5.13-01', '2.5.12'), false);
  assert.equal(isNewerSemanticVersion('2.5.13-01a', '2.5.12'), true);
  assert.equal(isNewerSemanticVersion('2.5.13+build.7', '2.5.12'), true);
  assert.equal(isNewerSemanticVersion('2.5.13', '2.5.13-rc.1'), true);
  assert.equal(isNewerSemanticVersion('2.5.13-rc.1', '2.5.13'), false);
});
