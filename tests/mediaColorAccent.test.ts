// Couleur automatique de la grande image (fiche, HeroSlider) avec « ignorer
// les fonds clairs et beiges » : un petit sujet vif doit l'emporter sur une
// grande surface beige ou dorée, et une image sans couleur ne doit jamais
// donner du blanc.
//
// Color Thief version Node lit les images avec sharp ; la version navigateur
// lit les pixels : node --conditions=browser --test tests/mediaColorAccent.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

// Node n'a pas d'ImageData ; Color Thief le reconnaît par `instanceof`.
class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace = 'srgb';
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}
const globals = globalThis as unknown as { ImageData?: unknown };
globals.ImageData ??= FakeImageData;

const { extractMediaColor, isBeigeColor } = await import('../src/utils/mediaColors.ts');

/** Image 64 × 36 faite de bandes : [couleur hex, part des pixels]. */
function image(bands: [string, number][]): ImageData {
  const width = 64;
  const height = 36;
  const data = new Uint8ClampedArray(width * height * 4);
  const total = width * height;
  let pixel = 0;
  for (const [hex, share] of bands) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const end = Math.min(total, pixel + Math.round(share * total));
    for (; pixel < end; pixel++) data.set([r, g, b, 255], pixel * 4);
  }
  return new (globals.ImageData as typeof FakeImageData)(data, width, height) as unknown as ImageData;
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const signal = new AbortController().signal;

test('beige : doré clair, peau dans l’ombre ; pas le rouge ni la brique', () => {
  assert.equal(isBeigeColor(0.84, 0.09, 84), true); // vitre dorée
  assert.equal(isBeigeColor(0.6, 0.07, 40), true); // peau dans l'ombre
  assert.equal(isBeigeColor(0.85, 0.12, 83), true); // doré de soleil, clair
  assert.equal(isBeigeColor(0.5, 0.2, 29), false); // rouge franc
  assert.equal(isBeigeColor(0.38, 0.08, 30), false); // brique
  assert.equal(isBeigeColor(0.6, 0.15, 250), false); // bleu
});

test('un petit costume rouge l’emporte sur une grande vitre dorée', async () => {
  const pixels = image([['#e3c68d', 0.82], ['#9c1a1a', 0.06], ['#3a2722', 0.12]]);
  for (const algorithm of ['legacy', 'perceptual', 'rgb'] as const) {
    const { color } = await extractMediaColor(pixels, algorithm, signal, undefined, true);
    const [r, g, b] = channels(color!);
    assert.ok(r > g * 1.6 && r > b * 1.6, `${algorithm} : ${color} devrait être rouge`);
  }
  // Réglage coupé : la vitre dorée reste la couleur, comme avant.
  const { color } = await extractMediaColor(pixels, 'legacy', signal, undefined, false);
  const [r, g, b] = channels(color!);
  assert.ok(r > 180 && g > 150 && b > 100, `${color} devrait rester doré`);
});

test('une image toute blanche et beige ne donne pas du blanc', async () => {
  const pixels = image([['#f5f5f5', 0.7], ['#c49a7a', 0.3]]);
  for (const algorithm of ['legacy', 'perceptual', 'rgb'] as const) {
    const { color } = await extractMediaColor(pixels, algorithm, signal, undefined, true);
    const [r, g, b] = channels(color!);
    assert.ok(Math.min(r, g, b) < 200, `${algorithm} : ${color} ne devrait pas être blanc`);
  }
});

test('une image grise garde son gris', async () => {
  const pixels = image([['#4a4a4a', 0.6], ['#9a9a9a', 0.4]]);
  const { color } = await extractMediaColor(pixels, 'legacy', signal, undefined, true);
  const [r, g, b] = channels(color!);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 12, `${color} devrait rester gris`);
});
