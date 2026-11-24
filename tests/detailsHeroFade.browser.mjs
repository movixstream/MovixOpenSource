// Bas de la grande image des fiches (film, série, saga), mesuré au pixel dans
// un vrai navigateur.
//
// Un voile noir ne fait qu'assombrir l'image : le défaut dépend donc de
// l'image. Claire, elle s'arrête sur une ligne ; sombre, elle traîne presque
// noire avec son grain (des taches sur un écran OLED) ; et un noir atteint trop
// tôt laisse une bande vide avant la barre de sections. Ce banc rend le vrai
// composant `DetailsHeroBackdrop` avec le CSS Tailwind du dépôt, sur des images
// extrêmes fabriquées sur place, puis mesure les captures.
//
// Exécution : node tests/detailsHeroFade.browser.mjs
//             HERO_FADE_SHOTS=<dossier> pour garder les captures
// Nécessite les dépendances npm, Node 22 ou plus, et Chrome ou Edge (chemin
// dans BROWSER sinon). Le navigateur tourne sans fenêtre et sans son ; aucun
// accès réseau.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const require = createRequire(path.join(repo, 'package.json'));

const browserPath = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge',
].find(candidate => candidate && existsSync(candidate));
if (!browserPath) {
  console.error('Chrome ou Edge introuvable : donner son chemin dans la variable BROWSER.');
  process.exit(2);
}

const work = mkdtempSync(path.join(os.tmpdir(), 'movix-hero-fade-'));
const shotsDir = process.env.HERO_FADE_SHOTS || null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

// ── Page : le vrai composant, des images fabriquées dans un canevas ──────────

const backdropFile = path.join(repo, 'src/components/details/DetailsHeroBackdrop.tsx');
const page = `
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { DetailsHeroBackdrop } from ${JSON.stringify(backdropFile)};

// Tirage reproductible : les mêmes images à chaque exécution.
const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const IMAGES = {
  // Le pire cas pour une coupure : rien de plus clair.
  blanc(context, width, height) {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
  },
  // Désert doré, clair en bas, avec du grain et des détails nets.
  sable(context, width, height) {
    const next = random(7);
    const pixels = context.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const light = 0.55 + 0.45 * (y / height);
      for (let x = 0; x < width; x++) {
        const grain = Math.round((next() - 0.5) * 44);
        const at = (y * width + x) * 4;
        pixels.data[at] = 250 * light + grain;
        pixels.data[at + 1] = 214 * light + grain;
        pixels.data[at + 2] = 150 * light + grain;
        pixels.data[at + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    for (let index = 0; index < 60; index++) {
      const radius = 8 + next() * 62;
      context.fillStyle = ['#785a32', '#fff5d7', '#b48c50'][index % 3];
      context.beginPath();
      context.ellipse(next() * width, 300 + next() * (height - 300), radius, radius / 3, 0, 0, Math.PI * 2);
      context.fill();
    }
  },
  // Le pire cas pour un détail qui passerait la couture : des rayures
  // horizontales nettes, du clair au sombre, jusqu'en bas.
  rayures(context, width, height) {
    for (let y = 0; y < height; y += 24) {
      context.fillStyle = (y / 24) % 2 ? '#303030' : '#f0f0f0';
      context.fillRect(0, y, width, 24);
    }
  },
  // Le pire cas pour une traînée : sombre et plein de grain.
  sombre(context, width, height) {
    const next = random(11);
    const small = document.createElement('canvas');
    small.width = width / 4;
    small.height = height / 4;
    const smallContext = small.getContext('2d');
    const pixels = smallContext.createImageData(small.width, small.height);
    for (let at = 0; at < pixels.data.length; at += 4) {
      const value = 10 + next() * 60;
      pixels.data[at] = value;
      pixels.data[at + 1] = value * 0.9;
      pixels.data[at + 2] = value * 1.2;
      pixels.data[at + 3] = 255;
    }
    smallContext.putImageData(pixels, 0, 0);
    context.imageSmoothingEnabled = true;
    context.drawImage(small, 0, 0, width, height);
  },
};

const cache = new Map();
const imageUrl = (name) => {
  if (!cache.has(name)) {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    IMAGES[name](canvas.getContext('2d'), canvas.width, canvas.height);
    cache.set(name, canvas.toDataURL('image/jpeg', 0.7));
  }
  return cache.get(name);
};

const root = createRoot(document.getElementById('root'));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// Appelé par le banc : rend un cas, attend que tout soit peint, puis dit où
// finit l'image, où est la couture et si la coulure est affichée.
const getContext = HTMLCanvasElement.prototype.getContext;
window.showCase = async ({ image, height, lightMode, black, drip, plainVeil, layers }) => {
  const html = document.documentElement;
  const src = imageUrl(image);
  // Voile CSS seul, pour comparer : sans contexte de dessin, le canevas tramé
  // de la fin de la coulure ne peut rien peindre.
  HTMLCanvasElement.prototype.getContext = plainVeil ? () => null : getContext;
  // Démonte le cas d'avant : rien de son canevas ne doit rester.
  flushSync(() => root.render(null));
  html.toggleAttribute('data-no-blur', Boolean(lightMode));
  if (black) html.style.setProperty('--movix-black', black); else html.style.removeProperty('--movix-black');
  flushSync(() => root.render(
    <section style={{ position: 'relative', height, background: 'rgb(var(--movix-black))' }}>
      <DetailsHeroBackdrop
        image={{ src }}
        phoneHeight="520px"
        positionClass="object-[50%_20%] md:object-[50%_22%]"
        phoneFadeClass="h-[72%]"
        drip={drip}
      >
        {/* Calques de la fiche film (\`DetailsHero\`) : teinte de l'image, voile de gauche. */}
        {layers && <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 80% at 0% 100%, rgb(52, 136, 199) 0%, rgba(52, 136, 199, 0.5) 28%, rgba(52, 136, 199, 0.15) 55%, transparent 85%)' }} />}
        {layers && <div className="absolute inset-0 hidden bg-gradient-to-r from-black/85 via-black/50 via-60% to-black/30 md:block lg:from-black/[.92] lg:via-black/[.72] lg:via-30% lg:to-transparent lg:to-[68%]" />}
      </DetailsHeroBackdrop>
    </section>,
  ));
  await Promise.all(Array.from(document.images, (img) => img.decode()));
  await frame();
  await frame();
  // Canevas tramé de la fin de la coulure : peint un peu après l'image.
  const dither = document.querySelector('[data-details-hero-dither]');
  if (dither && !plainVeil && !lightMode && getComputedStyle(dither).display !== 'none') {
    for (let wait = 0; wait < 120 && dither.dataset.detailsHeroDither !== 'on'; wait++) await frame();
  } else if (dither) {
    for (let wait = 0; wait < 12; wait++) await frame();
  }
  await frame();
  await frame();
  const backdrop = document.querySelector('section > div');
  const soft = document.querySelector('[data-details-hero-soft]');
  // L'image étirée a la boîte de l'image : son point fixe est la couture.
  const smear = soft?.querySelector('img');
  return {
    seam: smear ? Math.round(backdrop.getBoundingClientRect().top + parseFloat(getComputedStyle(smear).transformOrigin.split(' ')[1])) : 0,
    bottom: Math.round(backdrop.getBoundingClientRect().bottom),
    softTop: soft ? Math.round(soft.getBoundingClientRect().top) : 0,
    softShown: Boolean(soft) && getComputedStyle(soft).display !== 'none',
    dithered: dither?.dataset.detailsHeroDither === 'on',
  };
};
window.ready = true;
`;
writeFileSync(path.join(work, 'page.tsx'), page);

await require('esbuild').build({
  entryPoints: [path.join(work, 'page.tsx')],
  outfile: path.join(work, 'page.js'),
  bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'warning',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Le CSS du site pour ces fichiers : Tailwind avec la configuration du dépôt
// (couleurs du thème comprises), puis les règles du mode léger.
const tailwindConfig = require('tailwindcss/loadConfig')(path.join(repo, 'tailwind.config.js'));
const compiled = await require('postcss')([
  require('tailwindcss')({
    ...tailwindConfig,
    // La fiche film donne les classes de hauteur et de cadrage reprises ici.
    content: [
      backdropFile,
      path.join(repo, 'src/components/details/layout.ts'),
      path.join(repo, 'src/components/details/DetailsHero.tsx'),
      path.join(repo, 'src/components/details/DetailsHeroDrips.tsx'),
      path.join(repo, 'src/components/details/dripCanvas.ts'),
      path.join(repo, 'src/components/details/useDripDither.ts'),
    ],
  }),
]).process('@tailwind base; @tailwind utilities;', { from: undefined });
const css = `${compiled.css}\n${readFileSync(path.join(repo, 'src/styles/light-mode.css'), 'utf8')}`;

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://banc');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/page.css">'
      + '<body style="margin:0;background:rgb(var(--movix-black))"><div id="root"></div><script type="module" src="/page.js"></script>');
  } else if (url.pathname === '/page.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(readFileSync(path.join(work, 'page.js')));
  } else if (url.pathname === '/page.css') {
    response.writeHead(200, { 'content-type': 'text/css' });
    response.end(css);
  } else {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

// ── Navigateur, piloté par le protocole DevTools ─────────────────────────────

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = path.join(work, 'profile');
const browser = spawn(browserPath, [
  '--headless=new', '--mute-audio', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--force-device-scale-factor=1', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: 'ignore' });

let socket = null;
const cleanUp = () => {
  try { socket?.close(); } catch { /* déjà fermé */ }
  browser.kill();
  server.close();
  server.closeAllConnections();
  // Le profil du navigateur peut rester verrouillé un instant après son arrêt.
  setTimeout(() => {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* nettoyé au prochain démarrage du système */ }
  }, 500);
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK ' : 'KO '} ${name} — ${detail}`);
};

try {
  // Port choisi par le navigateur : il l'écrit dans son profil.
  let target = null;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    await sleep(150);
    try {
      const port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(entry => entry.type === 'page') ?? null;
    } catch { /* le navigateur démarre */ }
  }
  if (!target) throw new Error('le navigateur ne répond pas sur son port de débogage');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('connexion DevTools refusée')); });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('window.ready === true').catch(() => false)) break;
    if (attempt === 99) throw new Error('la page du banc ne démarre pas');
    await sleep(150);
  }

  /** Rend un cas et renvoie sa capture décodée, avec la ligne où finit l'image. */
  const shoot = async (name, { width, viewportHeight, ...options }) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
    const info = await evaluate(`window.showCase(${JSON.stringify(options)})`);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = Buffer.from(data, 'base64');
    if (shotsDir) writeFileSync(path.join(shotsDir, `${name}.png`), file);
    if (info.bottom < 300) throw new Error(`${name} : image haute de ${info.bottom} px, une classe de hauteur manque dans le CSS`);
    return { ...info, ...decodePng(file) };
  };

  // ── Cas ────────────────────────────────────────────────────────────────────

  const DESKTOP = { width: 2000, viewportHeight: 1060, height: 900 };
  const PHONE = { width: 390, viewportHeight: 800, height: 700 };

  for (const image of ['blanc', 'sable', 'sombre']) {
    const shot = await shoot(`ordinateur-${image}`, { ...DESKTOP, image });
    const m = measure(shot);
    check(`ordinateur, image « ${image} » : pas de bord visible en bas`, m.edge <= 1,
      `dernière ligne à ${m.edge.toFixed(1)} sur 255 (1 au plus)`);
    check(`ordinateur, image « ${image} » : arrivée au noir en douceur`, m.arrival <= 0.45 && m.step <= 2.5,
      `${m.arrival.toFixed(2)} niveau par px à l'arrivée (0,45 au plus), plus grande marche ${m.step.toFixed(2)} (2,5 au plus)`);
    if (image !== 'sombre') {
      // Sur une image sombre, les dernières lignes sont noires d'elles-mêmes.
      check(`ordinateur, image « ${image} » : pas de bande noire vide`, m.emptyRows <= 6,
        `${m.emptyRows} px de noir pur avant la suite (6 au plus)`);
    } else {
      check('ordinateur, image « sombre » : pas de grain dans la zone presque noire', m.grain <= 0.45 && shot.softShown,
        `grain ${m.grain.toFixed(2)} (0,45 au plus) sur ${m.tail} px presque noirs`);
      check('ordinateur, image « sombre » : la coulure commence sans ligne', m.softStart >= 0.6,
        `sous son bord haut, il reste ${Math.round(m.softStart * 100)} % du grain d'au-dessus (60 % au moins)`);
    }
  }

  for (const image of ['blanc', 'sombre']) {
    const shot = await shoot(`telephone-${image}`, { ...PHONE, image });
    const m = measure(shot);
    check(`téléphone, image « ${image} » : fondu sans bord ni cassure`, m.edge <= 1 && m.arrival <= 0.45,
      `dernière ligne à ${m.edge.toFixed(1)}, ${m.arrival.toFixed(2)} niveau par px à l'arrivée`);
    if (image === 'sombre') {
      check('téléphone, image « sombre » : pas de grain dans la zone presque noire', m.grain <= 0.45 && shot.softShown,
        `grain ${m.grain.toFixed(2)} (0,45 au plus) sur ${m.tail} px presque noirs`);
      check('téléphone, image « sombre » : la coulure commence sans ligne', m.softStart >= 0.6,
        `sous son bord haut, il reste ${Math.round(m.softStart * 100)} % du grain d'au-dessus (60 % au moins)`);
    }
  }

  // Mode léger : la coulure disparaît, le voile seul doit encore fondre
  // l'image. Le grain revient : c'est aussi la preuve que la mesure le voit.
  {
    const shot = await shoot('mode-leger-sombre', { ...DESKTOP, image: 'sombre', lightMode: true });
    const m = measure(shot);
    check('mode léger : coulure retirée, fondu gardé', !shot.softShown && m.edge <= 1 && m.arrival <= 0.45,
      `coulure ${shot.softShown ? 'affichée' : 'retirée'}, dernière ligne à ${m.edge.toFixed(1)}`);
    check('mode léger : le grain mesuré revient sans la coulure', m.grain > 0.6,
      `grain ${m.grain.toFixed(2)} (plus de 0,6 attendu)`);
  }

  // Coulure : sous la couture, plus aucun détail de l'image, seulement ses
  // couleurs qui coulent vers le noir. Des rayures nettes ne doivent laisser
  // aucune marche ; sans la coulure (mode léger), elles en laissent : c'est la
  // preuve que la mesure les voit.
  for (const [label, size] of [['ordinateur', DESKTOP], ['téléphone', PHONE]]) {
    const shot = await shoot(`${label}-rayures`, { ...size, image: 'rayures' });
    const plain = await shoot(`${label}-rayures-mode-leger`, { ...size, image: 'rayures', lightMode: true });
    const below = stepBelowSeam(shot, measure(shot));
    const belowPlain = stepBelowSeam({ ...plain, seam: shot.seam }, measure(plain));
    check(`${label}, rayures : aucun détail sous la couture`, shot.seam > 0 && below <= 2.5 && belowPlain > 10,
      `couture à ${shot.seam} px, plus grande marche dessous ${below.toFixed(2)} (2,5 au plus), ${belowPlain.toFixed(1)} sans la coulure`);
    // Les mesures ci-dessus laissent les côtés : là, un flou trop étroit
    // laisserait voir l'image nette sous la coulure.
    const sides = sideStepBelowSeam(shot);
    check(`${label}, rayures : rien ne reparaît sur les côtés`, sides <= 4,
      `plus grande marche dans les 6 px du bord ${sides.toFixed(2)} (4 au plus)`);
  }

  // Coulure qui sort de la section (`drip`), puis coule encore 640 px dans la
  // page avant de s'éteindre. Fiches film et série (`sectionNav`) : l'image
  // nette continue sous les onglets de la barre de sections (56 px) jusqu'à son
  // filet, et seule la coulure passe sous le trait. Sagas (`section`) : l'image
  // s'arrête au bas de la section, sans filet pour cacher quoi que ce soit.
  const TALL = { ...DESKTOP, viewportHeight: 1700 };
  for (const [drip, label, imageEnd] of [
    ['sectionNav', 'sous la barre de sections', DESKTOP.height + 56],
    ['section', 'saga', DESKTOP.height],
  ]) {
    const shot = await shoot(`ordinateur-coulure-${drip}`, { ...TALL, image: 'blanc', drip });
    const m = measure(shot);
    check(`${label} : la coulure descend 640 px sous l'image`, shot.bottom === imageEnd + 640,
      `fin du fond à ${shot.bottom} px (${imageEnd + 640} attendus)`);
    // Tout le voile : il part 384 px au-dessus du bas de l'image.
    const profile = rowLevels(shot, imageEnd - 384, shot.bottom);
    const onEnd = profile[384];
    const below = profile[484];
    check(`${label} : la coulure se voit sortir de l'image`, onEnd >= 170 && below >= 120,
      `niveau ${onEnd.toFixed(0)} sur 255 au bas de l'image (170 au moins), ${below.toFixed(0)} 100 px plus bas (120 au moins)`);
    check(`${label} : arrivée au noir en douceur`, m.edge <= 1 && m.arrival <= 0.45 && m.step <= 2.5,
      `dernière ligne à ${m.edge.toFixed(1)}, ${m.arrival.toFixed(2)} niveau par px à l'arrivée, plus grande marche ${m.step.toFixed(2)}`);
    // Une pente droite qui s'aplatit d'un coup se voit comme un trait : 0,5
    // environ, ramené à une image blanche, sur une capture de la version qui
    // s'arrêtait à 240 px ; 0,125 pour la suivante, qui gardait un coude sur
    // le filet ; 0,10 pour deux paraboles sur 512 px. Sur 1 024 px, la courbe
    // ne change plus que de 0,025 ; il reste surtout l'arrondi des couleurs à
    // l'entier, environ 0,05 d'après le calcul. Mesuré jusqu'à 256 px sous
    // l'image : plus bas, les gouttes (`DetailsHeroDrips`) font varier le bout
    // d'une colonne à l'autre, et la moyenne des lignes ne dit plus rien.
    const knee = kneeOf(profile.slice(0, 640));
    check(`${label} : ni trait ni coude dans la coulure`, knee <= 0.07,
      `plus grand changement de pente ${knee.toFixed(3)} niveau par px d'une tranche de 24 px à l'autre (0,07 au plus)`);
    // Le bout de la coulure n'est pas une ligne droite : d'une colonne à
    // l'autre, la dernière ligne encore éclairée change de hauteur.
    const ends = columnEnds(shot, imageEnd, 8);
    const spread = Math.max(...ends) - Math.min(...ends);
    check(`${label} : le bout de la coulure finit en gouttes`, spread >= 60,
      `dernière ligne éclairée entre ${Math.min(...ends)} et ${Math.max(...ends)} px selon la colonne (60 px d'écart au moins)`);
    // Le cadrage de l'image ne bouge pas : sa couture reste à 85 % de sa
    // hauteur, et rien de l'image nette ne passe sous elle.
    const striped = await shoot(`ordinateur-coulure-${drip}-rayures`, { ...TALL, image: 'rayures', drip });
    const stripedBelow = stepBelowSeam(striped, measure(striped));
    check(`${label} : même couture, aucun détail dessous`, striped.seam === Math.round(imageEnd * 0.85) && stripedBelow <= 2.5,
      `couture à ${striped.seam} px (${Math.round(imageEnd * 0.85)} attendus), plus grande marche dessous ${stripedBelow.toFixed(2)}`);
    const phone = await shoot(`telephone-coulure-${drip}`, { ...PHONE, viewportHeight: 1300, image: 'blanc', drip });
    // Téléphone : l'image garde ses 520 px, la coulure coule dessous comme
    // sur ordinateur, fin tramée comprise.
    const phoneMeasure = measure(phone);
    check(`${label} : sur téléphone, la coulure descend 640 px sous l'image`,
      phone.bottom === 520 + 640 && phone.dithered && phoneMeasure.edge <= 1 && phoneMeasure.step <= 2.5,
      `fin du fond à ${phone.bottom} px (${520 + 640} attendus), canevas tramé ${phone.dithered ? 'peint' : 'absent'}, dernière ligne à ${phoneMeasure.edge.toFixed(1)}, plus grande marche ${phoneMeasure.step.toFixed(2)}`);

    // Fin de la coulure sur un écran OLED : près du noir, un voile CSS ne
    // laisse que les niveaux 3, 2, 1 puis 0, en bandes de plusieurs dizaines
    // de pixels. Le canevas tramé doit les mêler pixel par pixel. Avec les
    // calques de la fiche film (teinte, voile de gauche), comme sur le site :
    // ce sont eux qui assombrissent le fond au point d'étouffer le tramage
    // du voile CSS. Le même cas avec le voile CSS seul montre les bandes :
    // c'est la preuve que la mesure les voit. Le fondu lui-même ne doit pas
    // changer ; le voile CSS seul est un peu plus clair, son tramage
    // l'éclaircit de 2 niveaux sur 255 en moyenne.
    for (const image of ['blanc', 'sable', 'sombre']) {
      const dithered = await shoot(`ordinateur-coulure-${drip}-${image}-calques`, { ...TALL, image, drip, layers: true });
      const plain = await shoot(`ordinateur-coulure-${drip}-${image}-calques-voile-css`, { ...TALL, image, drip, layers: true, plainVeil: true });
      const bands = flatRows(dithered, imageEnd);
      const plainBands = flatRows(plain, imageEnd);
      check(`${label}, image « ${image} » : pas de bandes près du noir`,
        dithered.dithered && !plain.dithered && bands.share <= 0.01 && plainBands.share >= 0.04,
        `${(bands.share * 100).toFixed(1)} % de lignes unies entre les niveaux 0 et 4 (1 % au plus, sur ${bands.rows}), ${(plainBands.share * 100).toFixed(1)} % avec le voile CSS seul (4 % au moins, sur ${plainBands.rows})`);
      const drift = profileGap(rowLevels(dithered, imageEnd, dithered.bottom), rowLevels(plain, imageEnd, plain.bottom));
      check(`${label}, image « ${image} » : même fondu qu'avec le voile CSS`, drift <= 3,
        `plus grand écart du niveau moyen d'une ligne ${drift.toFixed(2)} sur 255 (3 au plus)`);
    }
  }

  // Thème qui change le noir de la page : le voile doit finir sur ce noir-là.
  {
    const shot = await shoot('theme-blanc', { ...DESKTOP, image: 'blanc', black: '8 7 11' });
    const m = measure(shot);
    const [r, g, b] = m.floor;
    check('thème au noir modifié : l\'image finit sur la couleur de la page', r === 8 && g === 7 && b === 11 && m.edge <= 1,
      `page en rgb(${r} ${g} ${b}), dernière ligne à ${m.edge.toFixed(1)} de cette couleur`);
  }
} catch (error) {
  check('exécution du banc', false, error.message);
} finally {
  cleanUp();
}

const failed = results.filter(result => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} réussis`);
setTimeout(() => process.exit(failed || !results.length ? 1 : 0), 700);

// ── Mesure ───────────────────────────────────────────────────────────────────

/**
 * Mesure les 260 dernières lignes de l'image, sur la largeur utile. Un niveau
 * est l'écart d'un pixel à la couleur de la page (0 = fondu dans la page).
 */
function measure({ width, channels, pixels, bottom, softTop }) {
  const at = (x, y) => (y * width + x) * channels;
  const floorAt = at(Math.round(width / 2), bottom + 40);
  const floor = [pixels[floorAt], pixels[floorAt + 1], pixels[floorAt + 2]];
  const left = Math.round(width * 0.08);
  const right = Math.round(width * 0.92);

  const levels = (y) => {
    const row = new Float64Array(right - left);
    for (let x = left; x < right; x++) {
      const i = at(x, y);
      row[x - left] = Math.max(Math.abs(pixels[i] - floor[0]), Math.abs(pixels[i + 1] - floor[1]), Math.abs(pixels[i + 2] - floor[2]));
    }
    return row;
  };
  // Grain d'une ligne : écart moyen de chaque pixel à ses 15 voisins.
  const grainOf = (row) => {
    let deviation = 0;
    for (let x = 7; x < row.length - 7; x++) {
      let local = 0;
      for (let k = -7; k <= 7; k++) local += row[x + k];
      deviation += Math.abs(row[x] - local / 15);
    }
    return deviation / (row.length - 14);
  };
  const grainOver = (from, to) => {
    let sum = 0;
    for (let y = from; y < to; y++) sum += grainOf(levels(y));
    return sum / (to - from);
  };

  const rows = [];
  for (let y = bottom - 260; y < bottom; y++) rows.push(levels(y));
  const means = rows.map(row => row.reduce((sum, value) => sum + value, 0) / row.length);

  // Lignes entièrement fondues dans la page, en partant du bas.
  let emptyRows = 0;
  for (let index = rows.length - 1; index >= 0 && rows[index].every(value => value === 0); index--) emptyRows++;

  // Zone presque noire : là où un écran OLED montre le grain en taches.
  let tail = 0;
  let grainSum = 0;
  for (let index = 0; index < rows.length; index++) {
    if (means[index] < 0.5 || means[index] > 12) continue;
    tail++;
    grainSum += grainOf(rows[index]);
  }

  // Bord haut de la coulure : un masque absent la ferait commencer d'un
  // coup, le grain tomberait sur une ligne. On compare 8 lignes de part et d'autre.
  const softStart = softTop > 8 ? grainOver(softTop, softTop + 8) / grainOver(softTop - 8, softTop) : 0;

  // Pente d'arrivée : niveau moyen 6 px au-dessus de la première ligne fondue.
  const lastLit = rows.length - 1 - emptyRows;
  const arrival = lastLit >= 6 ? means[lastLit - 6] / 6 : 0;

  let step = 0;
  for (let index = rows.length - 200; index < rows.length - 1; index++) {
    step = Math.max(step, Math.abs(means[index] - means[index + 1]));
  }

  return { floor, means, edge: means[means.length - 1], emptyRows, tail, grain: tail ? grainSum / tail : 0, arrival, step, softStart };
}

/** Plus grande marche d'une ligne à l'autre, de 8 px sous la couture jusqu'en bas. */
function stepBelowSeam({ seam, bottom }, { means }) {
  let step = 0;
  for (let index = Math.max(0, seam + 8 - (bottom - means.length)); index < means.length - 1; index++) {
    step = Math.max(step, Math.abs(means[index] - means[index + 1]));
  }
  return step;
}

/** Même mesure sur les 6 colonnes de chaque bord, par rapport au noir pur. */
function sideStepBelowSeam({ seam, bottom, width, channels, pixels }) {
  const levelAt = (y) => {
    let sum = 0;
    for (const x of [0, 1, 2, 3, 4, 5, width - 6, width - 5, width - 4, width - 3, width - 2, width - 1]) {
      const i = (y * width + x) * channels;
      sum += Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    }
    return sum / 12;
  };
  let step = 0;
  for (let y = seam + 8; y < bottom - 1; y++) step = Math.max(step, Math.abs(levelAt(y) - levelAt(y + 1)));
  return step;
}

/** Niveau moyen de chaque ligne (8 à 92 % de la largeur), écart au fond de page. */
function rowLevels({ width, channels, pixels, bottom }, from, to) {
  const at = (x, y) => (y * width + x) * channels;
  const floorAt = at(Math.round(width / 2), bottom + 40);
  const floor = [pixels[floorAt], pixels[floorAt + 1], pixels[floorAt + 2]];
  const left = Math.round(width * 0.08);
  const right = Math.round(width * 0.92);
  const levels = [];
  for (let y = from; y < to; y++) {
    let sum = 0;
    for (let x = left; x < right; x++) {
      const i = at(x, y);
      sum += Math.max(Math.abs(pixels[i] - floor[0]), Math.abs(pixels[i + 1] - floor[1]), Math.abs(pixels[i + 2] - floor[2]));
    }
    levels.push(sum / (right - left));
  }
  return levels;
}

/**
 * Bandes près du noir : sur des tranches de 24 px de large, part des lignes
 * « unies » (tous les pixels de la même couleur) parmi celles dont le niveau
 * moyen est entre 0,15 et 3,5. Un voile CSS y laisse des paliers entiers,
 * coupés seulement là où un contour traverse la tranche. Un tramage mêle
 * partout deux niveaux voisins.
 */
function flatRows({ width, channels, pixels, bottom }, from) {
  const at = (x, y) => (y * width + x) * channels;
  const floorAt = at(Math.round(width / 2), bottom + 40);
  const floor = [pixels[floorAt], pixels[floorAt + 1], pixels[floorAt + 2]];
  let rows = 0;
  let flat = 0;
  // Sous le voile de gauche des fiches : la zone la plus sombre.
  for (let strip = 1; strip <= 7; strip++) {
    const left = Math.round(width * strip / 25);
    for (let y = from; y < bottom; y++) {
      let sum = 0;
      let same = true;
      const first = at(left, y);
      for (let x = left; x < left + 24; x++) {
        const i = at(x, y);
        sum += Math.max(Math.abs(pixels[i] - floor[0]), Math.abs(pixels[i + 1] - floor[1]), Math.abs(pixels[i + 2] - floor[2]));
        if (pixels[i] !== pixels[first] || pixels[i + 1] !== pixels[first + 1] || pixels[i + 2] !== pixels[first + 2]) same = false;
      }
      if (sum / 24 < 0.15 || sum / 24 > 3.5) continue;
      rows++;
      if (same) flat++;
    }
  }
  return { rows, share: rows ? flat / rows : 1 };
}

/** Plus grand écart entre deux profils de niveaux moyens, ligne à ligne. */
function profileGap(a, b) {
  let gap = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index++) gap = Math.max(gap, Math.abs(a[index] - b[index]));
  return gap;
}

/**
 * Une colonne tous les 16 px (8 à 92 % de la largeur) : dernière ligne, depuis
 * `from`, encore éclairée d'au moins `threshold` au-dessus du fond de page.
 */
function columnEnds({ width, channels, pixels, bottom }, from, threshold) {
  const at = (x, y) => (y * width + x) * channels;
  const floorAt = at(Math.round(width / 2), bottom + 40);
  const floor = [pixels[floorAt], pixels[floorAt + 1], pixels[floorAt + 2]];
  const ends = [];
  for (let x = Math.round(width * 0.08); x < width * 0.92; x += 16) {
    let end = from;
    for (let y = from; y < bottom; y++) {
      const i = at(x, y);
      const level = Math.max(Math.abs(pixels[i] - floor[0]), Math.abs(pixels[i + 1] - floor[1]), Math.abs(pixels[i + 2] - floor[2]));
      if (level >= threshold) end = y;
    }
    ends.push(end);
  }
  return ends;
}

/**
 * Plus grand changement de pente entre deux tranches de 24 px qui se suivent.
 * La pente de chaque tranche est celle de la droite la plus proche de ses 24
 * lignes : prise entre ses deux bouts seulement, elle mesurerait surtout
 * l'arrondi des niveaux à l'entier, comme des tranches plus courtes.
 */
function kneeOf(levels) {
  const slopes = [];
  for (let start = 0; start + 24 <= levels.length; start += 24) {
    const rows = levels.slice(start, start + 24);
    const meanRow = rows.reduce((sum, level) => sum + level, 0) / 24;
    let covariance = 0;
    let variance = 0;
    rows.forEach((level, index) => {
      covariance += (index - 11.5) * (level - meanRow);
      variance += (index - 11.5) ** 2;
    });
    slopes.push(-covariance / variance);
  }
  let knee = 0;
  for (let index = 0; index + 1 < slopes.length; index++) knee = Math.max(knee, Math.abs(slopes[index] - slopes[index + 1]));
  return knee;
}

/** Décodeur PNG réduit à ce que rend une capture : 8 bits, RVB ou RVBA, non entrelacé. */
function decodePng(file) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colorType = body[9];
      if (body[8] !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) {
        throw new Error(`format de capture non géré (profondeur ${body[8]}, type ${colorType})`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      parts.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const packed = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const line = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? pixels[line + i - channels] : 0;
      const b = y > 0 ? pixels[line - stride + i] : 0;
      const c = i >= channels && y > 0 ? pixels[line - stride + i - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[line + i] = (packed[source + i] + predicted) & 255;
    }
  }
  return { width, height, channels, pixels };
}
