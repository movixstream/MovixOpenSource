// Fabrique les vignettes des avatars embarquées dans l'appli TV.
//
//   node app-tv/scripts/build-avatar-thumbs.mjs
//
// Source : `public/avatars/**/*.png` (les avatars du site, jusqu'à 800 px et
// 600 Ko). Sortie : `app-tv/app/src/main/assets/avatar_thumbs/<md5>.webp`, une
// vignette carrée de 144 px par avatar. Le nom est le MD5 du chemin du site
// (`/avatars/…`, UTF-8, forme composée) : l'appli calcule le même
// (`AvatarThumbs.fileName`), et un nom en hexadécimal évite les accents, les
// apostrophes et les « + » dans les fichiers de l'APK.
//
// À relancer quand le site ajoute ou retire des avatars, avec le catalogue
// (`AvatarCatalog.kt`). `AvatarThumbsTest` échoue tant que ce n'est pas fait.
// Les vignettes d'avatars disparus sont supprimées.
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SIZE = 144;
const QUALITY = 78;

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const source = path.join(repo, 'public', 'avatars');
const output = path.join(repo, 'app-tv', 'app', 'src', 'main', 'assets', 'avatar_thumbs');

async function pngs(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await pngs(full)));
    else if (entry.name.toLowerCase().endsWith('.png')) found.push(full);
  }
  return found;
}

/** Chemin du site (`/avatars/…`) d'un fichier, tel que le catalogue de l'appli l'écrit. */
const sitePath = (file) => ('/avatars/' + path.relative(source, file).split(path.sep).join('/')).normalize('NFC');
const thumbName = (file) => createHash('md5').update(sitePath(file), 'utf8').digest('hex') + '.webp';

await mkdir(output, { recursive: true });
const files = await pngs(source);
const wanted = new Set();
let written = 0;
let bytes = 0;

for (const file of files) {
  const name = thumbName(file);
  wanted.add(name);
  const target = path.join(output, name);
  const made = await stat(target).catch(() => null);
  // Vignette déjà faite et plus récente que l'avatar : gardée telle quelle.
  if (!made || made.mtimeMs < (await stat(file)).mtimeMs) {
    await sharp(file)
      .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: QUALITY, effort: 6 })
      .toFile(target);
    written++;
  }
  bytes += (await stat(target)).size;
}

let removed = 0;
for (const name of await readdir(output)) {
  if (!wanted.has(name)) {
    await rm(path.join(output, name));
    removed++;
  }
}

console.log(`${files.length} avatars, ${written} vignette(s) écrite(s), ${removed} supprimée(s)`);
console.log(`total : ${(bytes / 1024 / 1024).toFixed(1)} Mo, ${Math.round(bytes / files.length / 102.4) / 10} Ko en moyenne`);
