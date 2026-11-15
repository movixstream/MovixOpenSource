'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cheerio = require('cheerio');

// parseSourceIdentity n'appelle jamais TMDB : un module vide suffit.
const tmdbCachePath = path.join(__dirname, '..', 'tmdbCache.js');
require.cache[tmdbCachePath] = { id: tmdbCachePath, filename: tmdbCachePath, loaded: true, exports: {} };
const { parseSourceIdentity } = require('../sourceIdentity');

// Fiche réaliste : menus, liste d'épisodes et commentaires autour des libellés utiles.
const episodes = Array.from({ length: 40 }, (_, i) => `<li><span>Épisode ${i + 1}</span> <a href="#e${i + 1}">VF</a></li>`).join('');
const html = `<!DOCTYPE html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Flemmix"},
{"@type":"Movie","name":"Kraken","datePublished":"2026-09-25","image":{"url":"https://image.tmdb.org/t/p/w300/francais.jpg"},
"actor":[{"name":"Marie Dupont"},{"name":"Jean Martin"}],"director":{"name":"Paul Durand"},"description":"Résumé structuré."}]}</script>
</head><body>
<nav><ul class="menu"><li><span>Accueil</span><ul><li><a href="/films">Films</a></li><li><a href="/series">Séries</a></li></ul></li>
<li><span>Genres</span> Action, Drame</li></ul></nav>
<h1>Kraken</h1>
<div class="fposter"><img src="https://image.tmdb.org/t/p/w300/francais.jpg"></div>
<ul class="mov-list">
<li><div class="mov-label">Titre original:</div> <div class="mov-desc">Kraken : l'éveil</div></li>
<li><div class="mov-label">Date de sortie:</div> <div class="mov-desc">25 septembre 2026</div></li>
<li><div class="mov-label">Réalisateur:</div> <div class="mov-desc">Paul Durand</div></li>
<li><div class="mov-label">Acteurs:</div> <div class="mov-desc">Marie Dupont, Jean Martin, Luc Petit</div></li>
<li><div class="mov-label">Genre:</div> <div class="mov-desc">Thriller</div></li>
<li><div class="mov-label">Synopsis:</div> <div class="mov-desc">Kraken en Streaming Complet : Un monstre surgit.</div></li>
</ul>
<ul class="fstream-info"><li><span>Créateurs :</span> Anne Roy, Paul Durand</li></ul>
<ul class="episodes">${episodes}</ul>
<div class="fdesc"><h2 class="fdesc-title">Synopsis</h2><p>Un monstre marin surgit au large de Brest.</p></div>
<section class="comments"><ul><li><span>Pseudo</span> Super film !</li></ul></section>
</body></html>`;

test('parseSourceIdentity donne la même identité depuis le HTML ou depuis un DOM déjà chargé', () => {
  const fromString = parseSourceIdentity(html);
  const $ = cheerio.load(html);
  const before = $.html();
  assert.deepEqual(parseSourceIdentity($), fromString);
  assert.equal($.html(), before, 'le DOM partagé n’est pas modifié');
  assert.deepEqual(fromString, {
    titles: ['Kraken', 'Kraken : l\'éveil'], type: 'movie', season: null, year: 2026,
    posters: ['https://image.tmdb.org/t/p/w300/francais.jpg'],
    cast: ['marie dupont', 'jean martin', 'luc petit'], directors: ['paul durand', 'anne roy'],
    synopsis: 'Un monstre marin surgit au large de Brest.',
  });
});

test('parseSourceIdentity ne copie que les <li> aux libellés utiles', () => {
  const $ = cheerio.load(html);
  let clones = 0;
  const clone = $.fn.clone;
  $.fn.clone = function countedClone(...args) { clones++; return clone.apply(this, args); };
  parseSourceIdentity($);
  // 5 libellés de la fiche, 1 libellé FStream et le bloc .fdesc ; ni menus, ni épisodes, ni commentaires.
  assert.equal(clones, 7);
});

test('le synopsis du libellé sert quand la fiche n’a pas de bloc .fdesc', () => {
  const identity = parseSourceIdentity(html.replace(/<div class="fdesc">.*?<\/div>/s, ''));
  assert.equal(identity.synopsis, 'Un monstre surgit.');
});
