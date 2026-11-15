"""Décor de la popup pub : sprites prêts dès l'ouverture, sans serveur ni réseau.

Exécution : python tests/adPopupCinemaRain.browser.py
Nécessite les dépendances de tests/liveTvAdPopup.browser.py.
"""
import asyncio
import importlib.util
import json
import tempfile
from pathlib import Path
from urllib.parse import urlparse

spec = importlib.util.spec_from_file_location('popup_fixture', Path(__file__).with_name('liveTvAdPopup.browser.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

# 14 motifs sur trois plans, le projecteur sur deux, et son faisceau.
SPRITE_COUNT = 14 * 3 + 2 + 1

PROBE = """
localStorage.setItem('settings_light_mode', 'off');
// Décor cinéma : le thème Halloween, actif par défaut en octobre, le
// remplacerait par ses bonbons et chauves-souris.
localStorage.setItem('settings_halloween_theme', '0');
window.probe = {frame: 0, loads: [], preparations: [], preparedKeys: [], svgOnScreen: 0, earlyMeasurements: 0, draws: 0, fills: 0, motifs: new Set(), frames: new Map(), firstPaintFrame: null, releases: []};
probe.resetDraws = () => {
  probe.motifs = new Set();
  probe.frames = new Map();
  probe.firstPaintFrame = null;
};
// Motifs distincts et opacité maximale de la première frame où ils apparaissent.
probe.firstMotifFrame = () => {
  const frames = [...probe.frames.keys()].sort((a, b) => a - b);
  if (!frames.length) return null;
  const first = probe.frames.get(frames[0]);
  return {frame: frames[0], motifs: first.motifs.size, alpha: first.alpha};
};
const laidOut = new WeakSet();
const NativeResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends NativeResizeObserver {
  constructor(callback) {
    super((entries, observer) => {
      entries.forEach(entry => laidOut.add(entry.target));
      callback(entries, observer);
    });
  }
};
const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
Object.defineProperty(Element.prototype, 'clientWidth', {...clientWidth, get() {
  if (this instanceof HTMLCanvasElement && this.isConnected && !laidOut.has(this)) probe.earlyMeasurements++;
  return clientWidth.get.call(this);
}});
function tick() { probe.frame++; requestAnimationFrame(tick); }
requestAnimationFrame(tick);
window.waitFrames = count => new Promise(resolve => {
  function step() { if (--count <= 0) resolve(); else requestAnimationFrame(step); }
  requestAnimationFrame(step);
});
const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
Object.defineProperty(HTMLImageElement.prototype, 'src', {...src, set(value) {
  probe.loads.push(probe.frame);
  src.set.call(this, value);
}});
const decode = HTMLImageElement.prototype.decode;
HTMLImageElement.prototype.decode = function() {
  const decoded = decode.call(this);
  if (window.holdDecode) return Promise.all([decoded, new Promise(resolve => probe.releases.push(resolve))]);
  if (window.failDecode) return decoded.then(() => { throw new Error('Décodage indisponible'); });
  return decoded;
};
const markPaint = canvas => {
  if (canvas.isConnected && probe.firstPaintFrame === null) probe.firstPaintFrame = probe.frame;
};
const fill = CanvasRenderingContext2D.prototype.fill;
CanvasRenderingContext2D.prototype.fill = function(...args) {
  if (this.canvas.isConnected) probe.fills++;
  markPaint(this.canvas);
  return fill.apply(this, args);
};
const draw = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
  if (image instanceof HTMLImageElement) {
    if (this.canvas.isConnected) probe.svgOnScreen++;
    else {
      probe.preparations.push(probe.frame);
      probe.preparedKeys.push(`${image.src}|${this.filter}`);
    }
  }
  if (this.canvas.isConnected) {
    probe.draws++;
    markPaint(this.canvas);
    const motif = image.dataset.cinemaMotif;
    if (motif) {
      probe.motifs.add(motif);
      const frame = probe.frames.get(probe.frame) || {motifs: new Set(), alpha: 0};
      frame.motifs.add(motif);
      frame.alpha = Math.max(frame.alpha, this.globalAlpha);
      probe.frames.set(probe.frame, frame);
    }
  }
  return draw.call(this, image, ...args);
};
window.setHidden = hidden => {
  Object.defineProperty(document, 'hidden', {configurable: true, value: hidden});
  document.dispatchEvent(new Event('visibilitychange'));
};
window.releaseDecode = () => {
  window.holdDecode = false;
  probe.releases.splice(0).forEach(resolve => resolve());
};
"""


async def open_fixture(browser, work, provider=False, storage=None):
    context = await browser.new_context(viewport={'width': 1280, 'height': 900})
    await context.add_init_script(PROBE)
    values = {'fixture_provider': str(provider).lower(), **(storage or {})}
    await context.add_init_script(f'Object.entries({json.dumps(values)}).forEach(([key, value]) => localStorage.setItem(key, value));')

    async def route(request):
        path = work / urlparse(request.request.url).path.lstrip('/')
        await request.fulfill(path=str(path if path.is_file() else work / 'index.html'))

    await context.route('**/*', route)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto('https://cinema.test/')
    await page.wait_for_function('!!window.popup')
    return context, page, errors


async def open_popup(page):
    await page.evaluate('probe.resetDraws(); popup.open()')
    await fixture.expect(page.get_by_role('dialog')).to_be_visible()
    await page.wait_for_function('probe.motifs.size === 15')
    return await page.evaluate('({first: probe.firstMotifFrame(), paint: probe.firstPaintFrame})')


async def expect_complete_first_frame(page):
    stats = await open_popup(page)
    assert stats['first']['frame'] == stats['paint'], f'Les motifs doivent être là dès la première image : {stats}'
    assert stats['first']['motifs'] == 15, f'Tous les motifs doivent apparaître ensemble : {stats}'


async def close_popup(page):
    await page.evaluate('popup.close()')
    await fixture.expect(page.get_by_role('dialog')).to_have_count(0)
    before = await page.evaluate('probe.draws')
    await page.evaluate('waitFrames(5)')
    assert await page.evaluate('probe.draws') == before, 'La fermeture doit arrêter le dessin'


async def check_warm_open(browser, work):
    context, page, errors = await open_fixture(browser, work, provider=True)
    # Le provider prépare le décor pendant un temps mort, avant toute popup.
    await page.wait_for_function('sprites.areCinemaRainSpritesReady()')
    assert await page.evaluate('probe.loads.length') == 16
    assert await page.evaluate('probe.preparations.length') == SPRITE_COUNT
    await expect_complete_first_frame(page)
    assert await page.evaluate('probe.preparations.length') == SPRITE_COUNT, "L'ouverture ne doit rien préparer"
    assert await page.evaluate('probe.svgOnScreen') == 0, 'Le canvas animé ne doit dessiner que des sprites en cache'
    assert await page.evaluate('probe.earlyMeasurements') == 0, 'Attendre le layout natif avant de mesurer le canvas'
    # Seule la moitié visible du champ de particules est allouée.
    sizes = await page.evaluate("""(() => {
      const canvas = document.querySelector('[role="dialog"] canvas');
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      return {bitmap: canvas.width, css: canvas.clientWidth, dialog: canvas.closest('[role="dialog"]').clientWidth, ratio};
    })()""")
    assert sizes['css'] <= sizes['dialog'] and sizes['bitmap'] <= sizes['dialog'] * sizes['ratio'], sizes
    await close_popup(page)
    await expect_complete_first_frame(page)
    assert await page.evaluate('probe.loads.length') == 16, 'Réutiliser les images à la réouverture'
    assert await page.evaluate('new Set(probe.preparedKeys).size === probe.preparedKeys.length'), 'Ne pas recalculer un sprite déjà préparé'
    assert not errors, errors
    await context.close()


async def check_cold_open(browser, work):
    # Sans préchargement, le reste est préparé d'un bloc et les motifs entrent ensemble.
    context, page, errors = await open_fixture(browser, work)
    stats = await open_popup(page)
    assert stats['first']['frame'] > stats['paint'], stats
    assert stats['first']['motifs'] == 15, f'Tous les motifs doivent apparaître ensemble : {stats}'
    assert stats['first']['alpha'] < 0.1, f'Les motifs tardifs entrent en fondu : {stats}'
    await page.evaluate('waitFrames(30)')
    assert await page.evaluate('Math.max(...[...probe.frames.values()].map(frame => frame.alpha))') > 0.15
    assert await page.evaluate('probe.preparations.length') == SPRITE_COUNT
    assert await page.evaluate('probe.svgOnScreen') == 0
    assert not errors, errors
    await context.close()


async def check_interruption(browser, work, interruption):
    context, page, errors = await open_fixture(browser, work)
    await page.evaluate('window.holdDecode = true; popup.open()')
    await page.wait_for_function('probe.releases.length === 16')
    await page.evaluate(interruption)
    await page.evaluate('releaseDecode()')
    # La préparation continue malgré l'interruption : la popup suivante en profite.
    await page.wait_for_function('sprites.areCinemaRainSpritesReady()')
    assert await page.evaluate('probe.preparations.length') == SPRITE_COUNT
    await page.evaluate('setHidden(false); popup.light(false); popup.close()')
    await fixture.expect(page.get_by_role('dialog')).to_have_count(0)
    await expect_complete_first_frame(page)
    assert await page.evaluate('probe.loads.length') == 16
    assert not errors, errors
    await context.close()


async def check_preferences_and_failure(browser, work):
    context, page, errors = await open_fixture(browser, work)
    await page.evaluate('popup.light(true); popup.open()')
    await fixture.expect(page.get_by_role('dialog')).to_be_visible()
    await page.evaluate('waitFrames(5)')
    assert await page.evaluate('probe.loads.length') == 0
    await page.emulate_media(reduced_motion='reduce')
    await page.evaluate('popup.light(false); waitFrames(5)')
    assert await page.evaluate('probe.loads.length') == 0
    await page.evaluate('window.failDecode = true')
    await page.emulate_media(reduced_motion='no-preference')
    await page.wait_for_function('probe.loads.length >= 16 && probe.fills > 0')
    await page.evaluate('waitFrames(5)')
    assert await page.evaluate('probe.preparations.length') == 0
    # Une erreur de décodage ne doit empêcher ni le bouton ni une réouverture.
    await page.locator('[data-ad-view-button]').click()
    await page.get_by_role('button', name='Accéder à la chaîne', exact=True).click()
    await fixture.expect(page.get_by_role('dialog')).to_have_count(0)
    await page.evaluate('window.failDecode = false')
    await open_popup(page)
    assert not errors, errors
    await context.close()


async def check_no_warmup(browser, work, storage):
    context, page, errors = await open_fixture(browser, work, provider=True, storage=storage)
    await page.evaluate('new Promise(resolve => requestIdleCallback(() => setTimeout(resolve, 300), {timeout: 4000}))')
    assert await page.evaluate('probe.loads.length') == 0, f'Aucun préchargement attendu : {storage}'
    assert not errors, errors
    await context.close()


async def main():
    with tempfile.TemporaryDirectory(prefix='movix-cinema-test-') as directory:
        work = Path(directory)
        repo = fixture.REPO.as_posix()
        fixture.build_fixture(work, extra_mocks={
            'vipUtils': "export const getVipHeaders=()=>({}); export const isUserVip=()=>localStorage.getItem('fixture_vip')==='true'; export const checkVipStatus=async()=>localStorage.getItem('fixture_vip')==='true';",
            'LiveTV': f"""
import React, {{useState}} from 'react';
import AdFreePlayerAds from {json.dumps(repo + '/src/components/AdFreePlayerAds')};
import {{AdFreePopupProvider}} from {json.dumps(repo + '/src/context/AdFreePopupContext.tsx')};
import {{useLightMode}} from {json.dumps(repo + '/src/context/LightModeContext')};
import * as sprites from {json.dumps(repo + '/src/utils/cinemaRainSprites')};
window.sprites = sprites;
export default function Fixture() {{
  const [open, setOpen] = useState(false);
  const {{setLightModeSetting}} = useLightMode();
  window.popup = {{open: () => setOpen(true), close: () => setOpen(false), light: value => setLightModeSetting(value ? 'on' : 'off')}};
  const popup = open ? <AdFreePlayerAds variant="livetv" onClose={{() => setOpen(false)}} onAccept={{() => setOpen(false)}}/> : null;
  return localStorage.getItem('fixture_provider') === 'true' ? <AdFreePopupProvider>{{popup}}</AdFreePopupProvider> : popup;
}}
"""})
        async with fixture.async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            await check_warm_open(browser, work)
            await check_cold_open(browser, work)
            for interruption in ['setHidden(true)', 'popup.close()', 'popup.light(true)']:
                await check_interruption(browser, work, interruption)
            await check_preferences_and_failure(browser, work)
            for storage in [{'fixture_vip': 'true'}, {'settings_ad_popup_mode': 'auto'}, {'settings_light_mode': 'on'}]:
                await check_no_warmup(browser, work, storage)
            await browser.close()
    print('Décor pub : préchargement, première image complète, secours groupé, cache et erreurs vérifiés.')


if __name__ == '__main__':
    asyncio.run(main())
