"""Régression des transitions et contrôles du Wrapped. Nécessite Python Playwright/Chromium et npm install.

Exécution : python tests/wrappedMotion.browser.py
Le test compile une fixture temporaire et intercepte ses URLs : aucun serveur ni accès réseau.
"""
import asyncio
import base64
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parents[1]
PIXEL = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=')

def build_fixture(work):
    repo = REPO.as_posix()
    entry = f"""
import React from 'react';
import {{createRoot}} from 'react-dom/client';
import i18next from 'i18next';
import {{I18nextProvider}} from 'react-i18next';
import WrappedExperience from {json.dumps(repo + '/src/components/wrapped/WrappedExperience')};
import {{createWrappedTestData}} from {json.dumps(repo + '/src/data/wrappedTestData')};
import fr from {json.dumps(repo + '/src/i18n/locales/fr.json')};
import en from {json.dumps(repo + '/src/i18n/locales/en.json')};
const language=location.search.includes('english')?'en':'fr';
await i18next.init({{lng:language,resources:{{fr:{{translation:fr}},en:{{translation:en}}}}}});
const data=createWrappedTestData(2026,language,i18next.t);
if(location.search.includes('legacy')) {{ data.story=null; data.community=null; }}
if(location.search.includes('edge')) {{
 data.topContent=data.topContent.map(item=>({{...item,poster_path:null,backdrop_path:null,title:item.title+' — The extraordinary adventure beyond the edge of a very long and unexpected year'}}));
}}
if(location.search.includes('empty')) {{ data.topContent=[]; data.story=null; data.community=null; }}
function Fixture() {{
 const [open,setOpen]=React.useState(true);
 return <I18nextProvider i18n={{i18next}}>{{open&&<WrappedExperience data={{data}} onClose={{()=>setOpen(false)}} />}}</I18nextProvider>;
}}
document.getElementById('outside').focus();
createRoot(document.getElementById('root')).render(<Fixture />);
"""
    (work / 'entry.tsx').write_text(entry, encoding='utf8')
    script = f"""
import {{createRequire}} from 'node:module';
import {{resolve}} from 'node:path';
const require=createRequire({json.dumps(repo + '/package.json')});
const esbuild=require('esbuild');
await esbuild.build({{
 entryPoints:[{json.dumps((work / 'entry.tsx').as_posix())}],outfile:{json.dumps((work / 'app.js').as_posix())},
 bundle:true,format:'esm',target:'es2022',jsx:'automatic',nodePaths:[{json.dumps(repo + '/node_modules')}],
 alias:{{'@':{json.dumps(repo + '/src')}}},define:{{'import.meta.env':JSON.stringify({{VITE_SITE_URL:'https://wrapped.test'}})}},
 loader:{{'.woff2':'dataurl','.woff':'dataurl','.mp3':'dataurl'}},plugins:[{{name:'asset-url',setup(build){{
  build.onResolve({{filter:/\\.woff2\\?url$/}},args=>({{path:require.resolve(args.path.replace('?url',''))}}));
  build.onResolve({{filter:/\\.mp3\\?url$/}},args=>({{path:resolve(args.resolveDir,args.path.replace('?url',''))}}));
 }}}}]
}});
"""
    (work / 'build.mjs').write_text(script, encoding='utf8')
    (work / 'base.css').write_text('@tailwind base;\n@tailwind components;\n@tailwind utilities;', encoding='utf8')
    (work / 'index.html').write_text('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/ui.css"><button id="outside">Outside Wrapped</button><div id="root"></div><script type="module" src="/app.js"></script>', encoding='utf8')
    subprocess.run(['node', str(work / 'build.mjs')], cwd=REPO, check=True)
    subprocess.run(['node', 'node_modules/tailwindcss/lib/cli.js', '-c', 'tailwind.config.js', '-i', str(work / 'base.css'), '-o', str(work / 'ui.css'), '--content', 'src/components/wrapped/**/*.tsx,src/components/ui/SmoothRange.tsx,src/components/ui/checkbox.tsx'], cwd=REPO, check=True, capture_output=True)

MONITOR = """() => {
 window.styleResets=[];
 const cancel=Animation.prototype.cancel;
 Animation.prototype.cancel=function(...args){
  const e=this.effect?.target;
  const scene=e instanceof HTMLElement && e.closest('[data-wrapped-scene]:not([aria-hidden="true"])');
  const flights=e instanceof HTMLElement && e.closest('[data-wrapped-flights]');
  const active=scene || flights;
  const read=()=>{const s=getComputedStyle(e);return [s.opacity,s.transform,s.clipPath]};
  const before=active?read():null;
  const result=cancel.apply(this,args);
  if(active && e.isConnected){const after=read();if(JSON.stringify(before)!==JSON.stringify(after))
   window.styleResets.push({scope:flights?'flights':scene.dataset.wrappedScene,tag:e.tagName,before,after});}
  return result;
 };
}"""

TRACE = """({label,duration}) => new Promise(resolve=>{
 const frames=[];const start=performance.now();
 const from=document.querySelector('[data-wrapped-scene]:not([aria-hidden="true"])')?.dataset.wrappedScene;
 const mountedScenes=()=>[...document.querySelectorAll('[data-wrapped-scene]')].map(scene=>({scene:scene.dataset.wrappedScene,hidden:scene.getAttribute('aria-hidden')==='true'}));
 let retentionProbe=null;
 document.querySelector(`button[aria-label="${label}"]`).click();
 setTimeout(()=>{retentionProbe={t:performance.now()-start,mountedScenes:mountedScenes()};},300);
 function tick(now){
  const e=document.querySelector('[data-wrapped-scene]:not([aria-hidden="true"])');
  if(e){
   const s=getComputedStyle(e);
   const flights=[...document.querySelectorAll('[data-wrapped-flight-poster]')].map(flight=>{
    const key=flight.dataset.wrappedFlightPoster;
    const style=getComputedStyle(flight), rect=flight.getBoundingClientRect();
    const originals=[...document.querySelectorAll(`[data-wrapped-poster="${CSS.escape(key)}"]`)].filter(original=>{
     const owner=original.closest('[data-wrapped-scene]');
     return owner===e||owner?.dataset.wrappedScene===from;
    });
    const visibleOriginals=originals.filter(original=>{const value=getComputedStyle(original);return value.visibility!=='hidden'&&value.display!=='none'&&Number(value.opacity)>0;});
    const flightVisible=style.visibility!=='hidden'&&style.display!=='none'&&Number(style.opacity)>0;
    return {key,transform:style.transform,rect:[rect.x,rect.y,rect.width,rect.height],originals:originals.length,
     hiddenOriginals:originals.filter(original=>getComputedStyle(original).visibility==='hidden').length,
     painted:visibleOriginals.length+(flightVisible?1:0)};
   });
   const cards=[...document.querySelectorAll('[data-wrapped-card][data-wrapped-flight="true"]')].map(card=>{
    const preview=card.querySelector('[data-wrapped-card-preview]');
    return {hasPreview:Boolean(preview),clip:preview?getComputedStyle(preview).clipPath:'none'};
   });
   frames.push({scene:e.dataset.wrappedScene,t:now-start,opacity:Number(s.opacity),transform:s.transform,clip:s.clipPath,flights,cards,mountedScenes:mountedScenes()});
  }
  if(now-start<duration)requestAnimationFrame(tick);else {
   const active=document.querySelector('[data-wrapped-scene]:not([aria-hidden="true"])');
   const style=getComputedStyle(active), rect=active.getBoundingClientRect(), parentRect=active.parentElement.getBoundingClientRect();
   const matrix=style.transform==='none'?new DOMMatrix():new DOMMatrix(style.transform);
   const content=active.lastElementChild, contentRect=content?.getBoundingClientRect();
   const originals=[...(active?.querySelectorAll('[data-wrapped-poster]')||[])];
   resolve({from,frames,retentionProbe,restored:{layerCount:document.querySelectorAll('[data-wrapped-flights]').length,
    flightCount:document.querySelectorAll('[data-wrapped-flight-poster]').length,
    flaggedCount:document.querySelectorAll('[data-wrapped-poster][data-wrapped-flight="true"]').length,
    flaggedCardCount:document.querySelectorAll('[data-wrapped-card][data-wrapped-flight="true"]').length,
    hiddenCount:originals.filter(original=>getComputedStyle(original).visibility==='hidden').length},
    final:{matrix:[matrix.m11,matrix.m12,matrix.m21,matrix.m22,matrix.m41,matrix.m42],clip:style.clipPath,
     rect:[rect.x,rect.y,rect.width,rect.height],parentRect:[parentRect.x,parentRect.y,parentRect.width,parentRect.height],
     contentHeight:contentRect?.height||0,posterCount:originals.length,
     closingPosterPosition:active.dataset.wrappedScene==='closing'&&originals[0]?getComputedStyle(originals[0]).position:null,
     viewportCount:document.querySelectorAll('[data-wrapped-scene]').length,
     hiddenViewportCount:document.querySelectorAll('[data-wrapped-scene][aria-hidden="true"]').length}});
  }
 }requestAnimationFrame(tick);
})"""

FLIGHT_KINDS = {
    'favorite': 'poster', 'top-five': 'podium', 'race': 'track', 'persona': 'stamp', 'closing': 'print',
}

def assert_settled_viewport(mode, label, target, final):
    m11, m12, m21, m22, tx, ty = final['matrix']
    assert abs(m11 - 1) < 0.001 and abs(m22 - 1) < 0.001, (mode, label, target, 'scale', final)
    assert max(abs(m12), abs(m21), abs(tx), abs(ty)) < 0.1, (mode, label, target, 'matrix', final)
    rect, parent = final['rect'], final['parentRect']
    assert rect[2] > 100 and rect[3] > 100 and final['contentHeight'] > 0, (mode, label, target, 'dimensions', final)
    assert max(abs(rect[index] - parent[index]) for index in range(4)) < 1, (mode, label, target, 'viewport-parent', final)
    clip = final['clip']
    assert clip.startswith('inset('), (mode, label, target, 'clip-type', clip)
    edges = clip.removeprefix('inset(').split('round', 1)[0]
    values = [float(value.rstrip('%').rstrip('px')) for value in edges.replace(')', '').split()]
    assert values and max(abs(value) for value in values) < 0.001, (mode, label, target, 'clip-open', clip)
    assert final['viewportCount'] == 1 and final['hiddenViewportCount'] == 0, (mode, label, target, 'stale-viewports', final)

async def verify(work):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            covered_flight_kinds = set()
            for mode in ['normal', 'legacy', 'reduced']:
                context = await browser.new_context(viewport={'width':390,'height':844}, reduced_motion='reduce' if mode == 'reduced' else 'no-preference')
                async def route(request):
                    url = urlparse(request.request.url)
                    if url.hostname == 'image.tmdb.org':
                        await request.fulfill(body=PIXEL, content_type='image/png', headers={'Access-Control-Allow-Origin':'*'})
                        return
                    file = (work / (url.path.lstrip('/') or 'index.html')).resolve()
                    if url.hostname != 'wrapped.test' or not file.is_relative_to(work) or not file.is_file():
                        await request.abort()
                        return
                    await request.fulfill(path=str(file), content_type={'.js':'application/javascript','.css':'text/css','.html':'text/html'}.get(file.suffix,'application/octet-stream'))
                await context.route('**/*', route)
                page = await context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto('https://wrapped.test/?' + mode)
                await page.evaluate('document.fonts.ready')
                await page.wait_for_timeout(1200)
                await page.evaluate(MONITOR)
                count = int(await page.get_by_role('progressbar').get_attribute('aria-valuemax'))
                for label in ['Scène suivante', 'Scène précédente']:
                    for _ in range(count - 1):
                        trace = await page.evaluate(TRACE, {'label':label,'duration':1100})
                        frames = trace['frames']
                        target, settled = frames[-1]['scene'], False
                        destination = target if label == 'Scène suivante' else trace['from']
                        flight_kind = FLIGHT_KINDS.get(destination)
                        assert_settled_viewport(mode, label, target, trace['final'])
                        assert all(frame['clip'] == 'none' or (frame['clip'].startswith('inset(') and 'round' in frame['clip']) for frame in frames), (mode, label, trace['from'], target)
                        if target == 'quiz' and label == 'Scène suivante':
                            assert trace['final']['posterCount'] == 3, (mode, trace['final'])
                            if mode != 'reduced':
                                gallery_window = [trace['retentionProbe'], *[{'t': frame['t'], 'mountedScenes': frame['mountedScenes']} for frame in frames if 150 <= frame['t'] <= 550]]
                                retained = [probe for probe in gallery_window if probe and
                                    any(scene['scene'] == trace['from'] and scene['hidden'] for scene in probe['mountedScenes']) and
                                    any(scene['scene'] == target and not scene['hidden'] for scene in probe['mountedScenes'])]
                                assert retained, (mode, 'gallery-source-not-retained', trace['from'], target, gallery_window)
                                if mode == 'legacy':
                                    print('legacy gallery retention:', {'t': round(retained[0]['t'], 1), 'scenes': retained[0]['mountedScenes']}, flush=True)
                        if destination == 'rhythm' and mode != 'reduced':
                            rounded = [frame['clip'] for frame in frames if 50 <= frame['t'] <= 650 and 'round' in frame['clip']]
                            assert any('round 0%' not in clip and 'round 0px' not in clip for clip in rounded), (mode, label, 'orbit-radius', rounded)
                        if target == 'closing' and label == 'Scène suivante':
                            assert trace['final']['closingPosterPosition'] == 'absolute', (mode, trace['final'])
                        if flight_kind:
                            covered_flight_kinds.add(flight_kind)
                            flight_frames = [frame for frame in frames if frame['flights']]
                            if mode == 'reduced':
                                assert not flight_frames, (mode, label, trace['from'], target, flight_kind)
                            else:
                                assert flight_frames, (mode, label, trace['from'], target, flight_kind)
                                identities = {flight['key'] for frame in flight_frames for flight in frame['flights']}
                                for key in identities:
                                    samples = [flight for frame in flight_frames for flight in frame['flights'] if flight['key'] == key]
                                    assert len({flight['transform'] for flight in samples}) > 1, (mode, label, flight_kind, key)
                                    assert all(flight['originals'] >= 1 and flight['hiddenOriginals'] == flight['originals'] for flight in samples), (mode, label, flight_kind, key, samples)
                                    assert all(flight['painted'] == 1 for flight in samples), (mode, label, flight_kind, key, samples)
                                card_samples = [card for frame in flight_frames for card in frame['cards']]
                                rendered_card_samples = [card for card in card_samples if card['hasPreview']]
                                assert all(card['clip'].startswith('polygon(evenodd,') for card in rendered_card_samples), (mode, label, flight_kind, rendered_card_samples)
                                if flight_kind == 'print':
                                    assert rendered_card_samples, (mode, label, flight_kind, 'rendered-card-not-masked')
                        assert trace['restored'] == {'layerCount': 0, 'flightCount': 0, 'flaggedCount': 0, 'flaggedCardCount': 0, 'hiddenCount': 0}, (mode, label, flight_kind, trace['restored'])
                        if target == 'closing' and label == 'Scène suivante' and mode != 'reduced':
                            assert any(80 < frame['t'] < 450 and frame['scene'] == target and frame['clip'] not in ['none', 'inset(0%)'] for frame in frames), 'le passage au partage doit révéler toute la page'
                        for frame in frames:
                            if frame['scene'] != target:
                                continue
                            assert not (settled and frame['opacity'] < 0.9), (mode, label, frame)
                            settled |= frame['opacity'] >= 0.999 and frame['t'] > 100
                        settled_frames = [frame for frame in frames if frame['scene'] == target and frame['opacity'] >= 0.999 and frame['t'] > 100]
                        assert settled_frames and settled_frames[0]['t'] <= 900, (mode, label, target, settled_frames[:1])
                await page.evaluate('''() => {for(let i=0;i<5;i++)document.querySelector('button[aria-label="Scène suivante"]').click()}''')
                await page.wait_for_timeout(1600)
                assert await page.get_by_role('progressbar').get_attribute('aria-valuenow') == '6'
                if mode == 'normal':
                    await page.get_by_role('button', name='Partager votre Wrapped', exact=True).click()
                    await page.get_by_role('button', name='Ton film · 18 s', exact=True).click()
                    generate = page.get_by_role('button', name='Générer le film', exact=True)
                    # La bande-son est proposée par défaut : la génération attend son décodage.
                    await page.wait_for_function('''() => [...document.querySelectorAll('button')].some(e => e.textContent.includes('Générer le film') && !e.disabled)''')
                    assert await page.locator('input[type=checkbox], input[type=range]').count() == 0
                    sound = page.get_by_role('checkbox', name='Bande-son cinématique', exact=True)
                    assert await sound.get_attribute('aria-checked') == 'true'
                    await sound.focus()
                    await page.keyboard.press('Space')
                    assert await sound.get_attribute('aria-checked') == 'false'
                    await page.locator('label').filter(has=sound).click()
                    assert await sound.get_attribute('aria-checked') == 'true'
                    slider = page.get_by_role('slider', name='Position dans le film', exact=True)
                    await slider.focus()
                    await page.keyboard.press('End')
                    assert float(await slider.get_attribute('aria-valuenow')) == 18
                    await page.keyboard.press('ArrowLeft')
                    assert float(await slider.get_attribute('aria-valuenow')) == 17.9
                    await page.keyboard.press('Home')
                    assert float(await slider.get_attribute('aria-valuenow')) == 0
                    bounds = await slider.bounding_box()
                    await page.mouse.move(bounds['x'] + bounds['width'] * 0.2, bounds['y'] + bounds['height'] / 2)
                    await page.mouse.down()
                    await page.mouse.move(bounds['x'] + bounds['width'] * 0.75, bounds['y'] + bounds['height'] / 2, steps=6)
                    await page.mouse.up()
                    assert abs(float(await slider.get_attribute('aria-valuenow')) - 13.5) <= 0.2
                    assert await page.get_by_role('progressbar').get_attribute('aria-valuenow') == '10'
                    await page.mouse.down()
                    await page.wait_for_timeout(30)
                    await generate.evaluate('button => button.click()')
                    assert await sound.is_disabled()
                    assert await slider.get_attribute('aria-disabled') == 'true'
                    disabled_value = await slider.get_attribute('aria-valuenow')
                    await page.mouse.move(bounds['x'] + bounds['width'] * 0.3, bounds['y'] + bounds['height'] / 2, steps=3)
                    await page.mouse.up()
                    assert await slider.get_attribute('aria-valuenow') == disabled_value
                    await page.get_by_role('button', name='Annuler', exact=True).click()
                    await page.wait_for_function('''() => [...document.querySelectorAll('[role=checkbox]')].every(e => !e.disabled)''')
                    assert await sound.get_attribute('aria-checked') == 'true'
                    await page.wait_for_function('''() => [...document.querySelectorAll('button')].some(e => e.textContent.includes('Générer le film') && !e.disabled)''')
                    await page.evaluate('''() => {
                        window.wrappedCaptureTracks=[];window.wrappedAudioTracks=[];window.wrappedAudioContexts=[];
                        const capture=HTMLCanvasElement.prototype.captureStream;
                        HTMLCanvasElement.prototype.captureStream=function(...args){
                            const stream=capture.apply(this,args);window.wrappedCaptureTracks.push(...stream.getVideoTracks());return stream;
                        };
                        const destination=AudioContext.prototype.createMediaStreamDestination;
                        AudioContext.prototype.createMediaStreamDestination=function(...args){
                            window.wrappedAudioContexts.push(this);const node=destination.apply(this,args);
                            window.wrappedAudioTracks.push(...node.stream.getAudioTracks());return node;
                        };
                    }''')
                    await generate.evaluate('button => button.click()')
                    await page.wait_for_function('''() => document.querySelector('button[aria-label="Scène précédente"]') && [...document.querySelectorAll('[role=checkbox]')].some(e => e.disabled)''')
                    await page.get_by_role('button', name='Scène précédente', exact=True).click()
                    await page.wait_for_timeout(150)
                    stopped = await page.evaluate('''() => ({
                        capture:window.wrappedCaptureTracks.map(track=>track.readyState),
                        audio:window.wrappedAudioTracks.map(track=>track.readyState),
                        contexts:window.wrappedAudioContexts.map(context=>context.state)
                    })''')
                    assert stopped['capture'] and all(state == 'ended' for state in stopped['capture']), stopped
                    assert stopped['audio'] and all(state == 'ended' for state in stopped['audio']), stopped
                    assert stopped['contexts'] and all(state == 'closed' for state in stopped['contexts']), stopped
                    print('Sortie du film : pistes vidéo/audio terminées et contexte audio fermé en 150 ms', flush=True)
                    await page.wait_for_timeout(750)
                    await page.get_by_role('button', name='Scène précédente', exact=True).click()
                    await page.wait_for_timeout(900)
                    months = page.get_by_role('slider', name='Parcourir les mois', exact=True)
                    await months.focus()
                    await page.keyboard.press('End')
                    assert float(await months.get_attribute('aria-valuenow')) == 11
                    await page.keyboard.press('ArrowLeft')
                    assert float(await months.get_attribute('aria-valuenow')) == 10
                    assert await page.get_by_role('progressbar').get_attribute('aria-valuenow') == '8'
                    print('Contrôles custom : cases, clic sur label, curseurs clavier/souris et désactivation pendant export vérifiés', flush=True)
                resets = await page.evaluate('window.styleResets')
                assert not resets, json.dumps(resets, ensure_ascii=False)
                assert not errors, errors
                print(f'{mode}: {2 * (count - 1)} transitions + clics rapides, aucun flash ni retour aux styles initiaux', flush=True)
                await context.close()
            assert covered_flight_kinds == set(FLIGHT_KINDS.values()), covered_flight_kinds
        finally:
            await browser.close()

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='movix-wrapped-motion-') as directory:
        work = Path(directory).resolve()
        assert work.is_relative_to(Path(tempfile.gettempdir()).resolve())
        build_fixture(work)
        asyncio.run(verify(work))
