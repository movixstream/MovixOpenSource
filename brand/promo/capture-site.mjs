// Capture la page d'accueil en ligne avec Edge sans fenêtre, par le protocole DevTools.
// Usage : node capture-site.mjs <url> <sortie.png> [largeur] [hauteur] [échelle] [attentes ms]
// Plusieurs attentes séparées par des virgules donnent une capture par palier
// (sortie-1.png, sortie-2.png…) : le carrousel d'accueil avance tout seul, on choisit ensuite.
// L'affiche utilise le haut d'une capture 1180 × 640 à l'échelle 2, recadré en 2360 × 1162
// et enregistré sous capture-site.jpg.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, w = '1180', h = '640', scale = '2', wait = '11500'] = process.argv.slice(2);
if (!url || !out) {
  console.error('Usage : node capture-site.mjs <url> <sortie.png> [largeur] [hauteur] [échelle] [attentes ms]');
  process.exit(1);
}
const port = 9377;
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const child = spawn(edge, [
  '--headless=new', '--mute-audio', '--disable-gpu', '--hide-scrollbars',
  '--autoplay-policy=user-gesture-required', '--lang=fr-FR',
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'movix-capture-'))}`,
  `--window-size=${w},${h}`, 'about:blank',
], { stdio: 'ignore' });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 60 && !target; i += 1) {
  await pause(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch { /* Edge n'écoute pas encore */ }
}
if (!target) { child.kill(); throw new Error('Edge ne répond pas'); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  seq += 1;
  pending.set(seq, resolve);
  ws.send(JSON.stringify({ id: seq, method, params }));
});
const save = async (file) => {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  console.log('ok', file);
};

// Avant tout script de la page : pas de popups d'arrivée, aucun son.
const init = `
  try {
    localStorage.setItem('support_popup_seen', 'true');
    localStorage.setItem('push_banner_dismissed_permanently', 'true');
    localStorage.setItem('ix_community_announcement_seen_v2', 'true');
  } catch (e) {}
  (() => {
    const mute = (el) => { try { el.muted = true; el.volume = 0; } catch (e) {} };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { mute(this); return play.apply(this, arguments); };
    new MutationObserver(() => document.querySelectorAll('video,audio').forEach(mute)).observe(document, { childList: true, subtree: true });
  })();
`;

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: Number(scale), mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: init });
await send('Page.navigate', { url });

const steps = String(wait).split(',').map(Number);
await pause(steps[0]);
for (let s = 1; s < steps.length; s += 1) {
  await save(out.replace(/\.png$/, `-${s}.png`));
  await pause(steps[s]);
}
await save(out);

await send('Browser.close');
await pause(300);
child.kill();
