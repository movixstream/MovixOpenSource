// Assemble les ressources uBlock Origin au format `Resource` d'adblock-rust.
//
// Usage : node ubo-resources.mjs <dossier-source-uBO> <sortie.json>
//
// - Redirections (`$redirect=`) : `src/js/redirect-resources.js` (Map
//   exportée) + fichiers de `src/web_accessible_resources/`. Les entrées à
//   paramètres (`params`) sont ignorées, comme dans l'assembleur
//   d'adblock-rust : elles ne sont pas prises en charge.
// - Scriptlets (`+js(...)`) : `src/js/resources/scriptlets.js` exporte
//   `builtinScriptlets` (module ES). Chaque scriptlet devient une ressource
//   `application/javascript` contenant sa fonction nommée ; les fonctions
//   utilitaires `*.fn` deviennent des dépendances `fn/javascript`.
//   adblock-rust appelle alors `nomDeFonction("arg1", …)`.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , uboDir, outFile] = process.argv;
if (!uboDir || !outFile) {
    console.error('usage : node ubo-resources.mjs <dossier-source-uBO> <sortie.json>');
    process.exit(2);
}

const MIME_BY_EXT = {
    '.css': 'text/css',
    '.gif': 'image/gif',
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.mp3': 'audio/mp3',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.txt': 'text/plain',
    '.xml': 'text/xml',
};
const TEXTUAL = new Set(['application/javascript', 'text/html', 'text/plain', 'text/css', 'application/json', 'text/xml']);

const b64 = (data) => Buffer.from(data).toString('base64');
const resources = [];
const names = new Set();

// 1. Redirections.
const redirectMap = (await import(pathToFileURL(resolve(uboDir, 'src/js/redirect-resources.js')).href)).default;
let redirects = 0;
for (const [name, props] of redirectMap) {
    if (props.params) continue;
    const mime = MIME_BY_EXT[extname(name)] ?? 'application/octet-stream';
    let content = readFileSync(join(uboDir, 'src/web_accessible_resources', name));
    if (TEXTUAL.has(mime)) content = content.toString('utf8').replace(/\r/g, '');
    const aliases = props.alias === undefined ? [] : [].concat(props.alias);
    resources.push({ name, aliases, kind: { mime }, content: b64(content) });
    names.add(name);
    redirects += 1;
}

// 2. Scriptlets.
const { builtinScriptlets } = await import(pathToFileURL(resolve(uboDir, 'src/js/resources/scriptlets.js')).href);
let scriptlets = 0;
for (const s of builtinScriptlets) {
    if (names.has(s.name)) continue;
    const code = s.fn.toString();
    const isFn = s.name.endsWith('.fn');
    // adblock-rust reconnaît le style « fonction » par `function nom(` en tête
    // pour les scriptlets injectables ; les dépendances `*.fn` sont seulement
    // recopiées (fonctions ou classes nommées, comme dans uBO).
    const named = isFn
        ? /^((async\s+)?function\s+[^\s(){}]+\s*\(|class\s+[A-Za-z_$][\w$]*)/.test(code)
        : /^function\s+[^\s(){}]+\s*\(/.test(code);
    if (!named) {
        throw new Error(`scriptlet ${s.name} : fonction non nommée, format inattendu`);
    }
    const resource = {
        name: s.name,
        aliases: s.aliases ?? [],
        kind: { mime: isFn ? 'fn/javascript' : 'application/javascript' },
        content: b64(code),
    };
    const deps = (s.dependencies ?? []).filter((d) => typeof d === 'string');
    if (deps.length) resource.dependencies = deps;
    // `requiresTrust` : réservé aux listes de confiance (bit 1, voir gen.rs).
    if (s.requiresTrust) resource.permission = 1;
    resources.push(resource);
    names.add(s.name);
    scriptlets += 1;
}

writeFileSync(outFile, JSON.stringify(resources));
console.log(`  ressources uBO : ${redirects} redirections, ${scriptlets} scriptlets`);
