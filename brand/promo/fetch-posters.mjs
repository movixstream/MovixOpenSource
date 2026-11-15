// Récupère des affiches TMDB connues (films, séries, animés) pour le mur de fond.
// Usage : node fetch-posters.mjs <chemin du .env du Main API> <dossier de sortie>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [envPath, outDir] = process.argv.slice(2);
const env = readFileSync(envPath, 'utf8');
const key = (env.match(/^TMDB_API_KEY=([^\s#]+)/m) || [])[1];
if (!key) throw new Error('TMDB_API_KEY introuvable');

mkdirSync(outDir, { recursive: true });

const api = async (path, params = {}) => {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  const headers = {};
  // Clé v3 (courte) en paramètre, jeton v4 (long) en en-tête.
  if (key.length > 60) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('include_adult', 'false');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB ${path} → ${res.status}`);
  return (await res.json()).results || [];
};

const pick = (list, n) => list.filter((r) => r.poster_path).slice(0, n);

const movies = [
  ...(await api('/discover/movie', { sort_by: 'vote_count.desc', page: 1 })),
  ...(await api('/discover/movie', { sort_by: 'vote_count.desc', page: 2 })),
];
const recent = await api('/trending/movie/week');
const series = [
  ...(await api('/discover/tv', { sort_by: 'vote_count.desc', page: 1 })),
  ...(await api('/discover/tv', { sort_by: 'vote_count.desc', page: 2 })),
].filter((r) => !(r.genre_ids || []).includes(16));
const anime = await api('/discover/tv', {
  sort_by: 'vote_count.desc',
  with_genres: '16',
  with_original_language: 'ja',
});

const groups = [pick(movies, 30), pick(series, 22), pick(anime, 16), pick(recent, 12)];
const seen = new Set();
const ordered = [];
// Entrelace les familles pour que le mur mélange films, séries et animés.
for (let i = 0; ordered.length < 72 && i < 40; i += 1) {
  for (const g of groups) {
    const item = g[i];
    if (!item || seen.has(item.poster_path)) continue;
    seen.add(item.poster_path);
    ordered.push(item);
  }
}

const manifest = [];
let index = 0;
for (const item of ordered) {
  const res = await fetch(`https://image.tmdb.org/t/p/w342${item.poster_path}`);
  if (!res.ok) continue;
  const name = `p${String(index).padStart(2, '0')}.jpg`;
  writeFileSync(join(outDir, name), Buffer.from(await res.arrayBuffer()));
  manifest.push({ file: name, title: item.title || item.name });
  index += 1;
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${manifest.length} affiches`);
console.log(manifest.map((m, i) => `${i}:${m.title}`).join(' | '));
