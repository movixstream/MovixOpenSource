// Rend affiche.html en image avec Edge sans fenêtre, puis l'enregistre en JPEG.
// Usage : node brand/promo/render.mjs   (écrit brand/promo/affiche-movix.jpg, 2160 × 2700)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const work = mkdtempSync(join(tmpdir(), 'movix-affiche-'));
const png = join(work, 'affiche.png');

// L'attente virtuelle laisse le temps aux polices et aux affiches de se charger.
const run = spawnSync(edge, [
  '--headless=new', '--mute-audio', '--disable-gpu', '--hide-scrollbars',
  '--allow-file-access-from-files', `--user-data-dir=${join(work, 'profil')}`,
  '--window-size=1080,1350', '--force-device-scale-factor=2', '--virtual-time-budget=9000',
  `--screenshot=${png}`, pathToFileURL(join(here, 'affiche.html')).href,
], { stdio: 'ignore' });
if (run.status !== 0) throw new Error(`Edge a échoué (code ${run.status})`);

const out = join(here, 'affiche-movix.jpg');
const info = await sharp(png).jpeg({ quality: 90, progressive: true, mozjpeg: true }).toFile(out);
console.log(`${out} : ${info.width} × ${info.height}, ${Math.round(info.size / 1024)} Ko`);

try { rmSync(work, { recursive: true, force: true }); } catch { /* Edge tient parfois encore son profil */ }
