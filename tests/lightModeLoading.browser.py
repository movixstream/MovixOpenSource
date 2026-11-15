"""Chargements et navigation en mode léger, sans serveur ni accès réseau.

python tests/lightModeLoading.browser.py
LIGHT_MODE_BASELINE=1 imprime seulement les mesures, sans assertions de performance.
"""
import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect

REPO = Path(__file__).resolve().parents[1]


def build_fixture(work):
    repo = REPO.as_posix()
    imports = '\n'.join(f'import {name} from {json.dumps(repo + path)};' for name, path in [
        ('GridSkeleton', '/src/components/skeletons/GridSkeleton'),
        ('DetailsSkeleton', '/src/components/skeletons/DetailsSkeleton'),
        ('HeroSkeleton', '/src/components/skeletons/HeroSkeleton'),
        ('ContentRowSkeleton', '/src/components/skeletons/ContentRowSkeleton'),
        ('GenreSkeleton', '/src/components/skeletons/GenreSkeleton'),
        ('Skeleton', '/src/components/ui/Skeleton'),
        ('EmblaCarouselPlatforms', '/src/components/EmblaCarouselPlatforms'),
        ('LazySection', '/src/components/LazySection'),
    ])
    entry = f"""
import React, {{useState}} from 'react';
import {{createRoot}} from 'react-dom/client';
import {{MemoryRouter}} from 'react-router-dom';
import {{motion}} from 'framer-motion';
import i18next from 'i18next';
import {{I18nextProvider}} from 'react-i18next';
import {{LightModeProvider,useLightMode}} from {json.dumps(repo + '/src/context/LightModeContext')};
import {{TopProgressBar}} from {json.dumps(repo + '/src/components/TopProgressBar')};
import {{RouteProgressBar}} from {json.dumps(repo + '/src/components/RouteProgressBar')};
import {{DelayedSuspense}} from {json.dumps(repo + '/src/components/DelayedSuspense')};
import {{PrefetchLink}} from {json.dumps(repo + '/src/routing/PrefetchLink')};
import {{IdleRoutePrefetch}} from {json.dumps(repo + '/src/routing/IdleRoutePrefetch')};
import fr from {json.dumps(repo + '/src/i18n/locales/fr.json')};
import {json.dumps(repo + '/src/styles/light-mode.css')};
{imports}
await i18next.init({{lng:'fr',resources:{{fr:{{translation:fr}}}}}});
let release;
const Pending=React.lazy(()=>new Promise(resolve=>{{release=()=>resolve({{default:()=> <p id="resolved">Ready</p>}});}}));
window.release=()=>release();
window.prefetchCount=0;
window.idlePrefetchCount=0;window.sectionLoads=0;
const loadSection=()=>{{window.sectionLoads++;return Promise.resolve();}};
function Fixture(){{
 const settings=useLightMode(); window.settings=settings;
 const [route,setRoute]=useState(0);
 const [pending,setPending]=useState(false);
 const [lazyKey,setLazyKey]=useState(0);
 const [showLazy,setShowLazy]=useState(true);
 window.resetLazy=()=>{{window.sectionLoads=0;setLazyKey(v=>v+1);setShowLazy(true)}};
 window.hideLazy=()=>setShowLazy(false);
 window.navigate=()=>setRoute(v=>v+1);window.suspend=()=>setPending(true);
 return <><IdleRoutePrefetch/><TopProgressBar/><main>
  <div id="skeletons" className="overflow-hidden px-3 md:px-4"><HeroSkeleton/><ContentRowSkeleton/><GridSkeleton/><GenreSkeleton/><DetailsSkeleton/></div>
  <div id="dimensions" style={{{{width:200}}}}><Skeleton variant="poster" width="100%"/><Skeleton variant="circle" width={{24}} height={{24}}/><Skeleton count={{2.5}} height={{10}}/></div>
  <div id="route-progress"><RouteProgressBar/></div>
  <div id="page"><motion.div key={{route}} data-route={{route}} initial={{{{opacity:0,y:80}}}} animate={{{{opacity:1,y:0}}}} transition={{{{duration:1,delay:1}}}}>Page {{route}}</motion.div></div>
  <div id="pending">{{pending&&<DelayedSuspense fallback={{<DetailsSkeleton/>}}><Pending/></DelayedSuspense>}}</div>
  <PrefetchLink to="/next">Next</PrefetchLink>
  <div id="platform"><EmblaCarouselPlatforms items={{[{{id:1,src:'/poster.svg',alt:'Platform',route:'/next',video:'/decorative.mp4'}}]}}/></div>
  <div className="custom-motion" id="custom-motion">CSS content</div>
  <div id="protected" style={{{{filter:'blur(8px)'}}}}>Spoiler</div>
  {{showLazy&&<div id="lazy-target" style={{{{marginTop:2000}}}}><LazySection key={{lazyKey}} index={{3}} immediateLoadCount={{2}} onLoad={{loadSection}}><p id="section-ready">Section ready</p></LazySection></div>}}
 </main></>;
}}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nextProvider i18n={{i18next}}><MemoryRouter><LightModeProvider><Fixture/></LightModeProvider></MemoryRouter></I18nextProvider></React.StrictMode>);
"""
    (work / 'entry.tsx').write_text(entry, encoding='utf8')
    (work / 'build.mjs').write_text(f"""
import {{createRequire}} from 'node:module';
const require=createRequire({json.dumps(repo + '/package.json')});
await require('esbuild').build({{
 entryPoints:[{json.dumps((work / 'entry.tsx').as_posix())}],outfile:{json.dumps((work / 'app.js').as_posix())},bundle:true,format:'esm',target:'es2022',jsx:'automatic',
 nodePaths:[{json.dumps(repo + '/node_modules')}],alias:{{'@':{json.dumps(repo + '/src')}}},
 plugins:[{{name:'fixture-routes',setup(build){{
  build.onResolve({{filter:/registry$/}},()=>({{path:'registry',namespace:'fixture'}}));
  build.onLoad({{filter:/.*/,namespace:'fixture'}},()=>({{contents:"export const ROUTES=[{{path:'/next',loader:()=>{{window.prefetchCount++;return Promise.resolve();}}}},...['/movies','/tv-shows','/anime','/search'].map(path=>({{path,loader:()=>{{window.idlePrefetchCount++;return Promise.resolve();}}}}))];"}}));
 }}}}]
}});
""", encoding='utf8')
    (work / 'base.css').write_text('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n@keyframes custom-enter {from{opacity:0;transform:translateY(50px)}to{opacity:1;transform:translateY(0)}}\n.custom-motion {animation:custom-enter 2s 1s both}', encoding='utf8')
    (work / 'index.html').write_text('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/app.css"><body style="background:black;color:white"><div id="root"></div><script type="module" src="/app.js"></script></body></html>', encoding='utf8')
    subprocess.run(['node', str(work / 'build.mjs')], cwd=REPO, check=True)
    subprocess.run(['node', 'node_modules/tailwindcss/lib/cli.js', '-c', 'tailwind.config.js', '-i', str(work / 'base.css'), '-o', str(work / 'ui.css'), '--content', 'src/components/skeletons/*.tsx,src/components/ui/Skeleton.tsx,src/components/RouteProgressBar.tsx,src/components/TopProgressBar.tsx,src/components/EmblaCarouselPlatforms.tsx'], cwd=REPO, check=True, capture_output=True)


async def run():
    baseline = os.environ.get('LIGHT_MODE_BASELINE') == '1'
    with tempfile.TemporaryDirectory(prefix='movix-loading-') as directory:
        work = Path(directory)
        build_fixture(work)
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            context = await browser.new_context(viewport={'width': 1280, 'height': 900})
            await context.add_init_script("""localStorage.setItem('settings_light_mode','on');
window.idleQueue=new Map();let nextIdle=1;
window.requestIdleCallback=cb=>{const id=nextIdle++;window.idleQueue.set(id,cb);return id};
window.cancelIdleCallback=id=>window.idleQueue.delete(id);
window.flushIdle=()=>{const callbacks=[...window.idleQueue.values()];window.idleQueue.clear();callbacks.forEach(cb=>cb({didTimeout:false,timeRemaining:()=>50}));};
""")

            async def route(request):
                path = urlparse(request.request.url).path
                file = work / (path.lstrip('/') or 'index.html')
                if path == '/poster.svg':
                    await request.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>')
                elif path == '/decorative.mp4':
                    await request.fulfill(status=204)
                else:
                    await request.fulfill(path=str(file if file.is_file() else work / 'index.html'))

            await context.route('**/*', route)
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto('https://loading.test')
            await page.wait_for_function('window.settings?.isLightMode')
            light_nodes = await page.locator('#skeletons *').count()
            light_static_skeletons = await page.locator('#skeletons [data-static-skeleton]').count()
            light_animated_skeletons = await page.locator('#skeletons .react-loading-skeleton').count()
            light_skeleton_height = await page.locator('#skeletons').evaluate('e=>e.getBoundingClientRect().height')
            await page.evaluate("window.settings.setLightModeSetting('off')")
            await page.wait_for_function('!window.settings.isLightMode')
            normal_nodes = await page.locator('#skeletons *').count()
            normal_static_skeletons = await page.locator('#skeletons [data-static-skeleton]').count()
            normal_animated_skeletons = await page.locator('#skeletons .react-loading-skeleton').count()
            normal_skeleton_height = await page.locator('#skeletons').evaluate('e=>e.getBoundingClientRect().height')
            await page.evaluate("window.settings.setLightModeSetting('on')")
            await page.wait_for_function('window.settings.isLightMode')
            await page.wait_for_timeout(400)
            await page.evaluate("() => {window.rafCalls=0;const raf=window.requestAnimationFrame;window.requestAnimationFrame=cb=>{window.rafCalls++;return raf(cb)};window.dispatchEvent(new Event('chunk:load:start'));}")
            await page.wait_for_timeout(650)
            raf_calls = await page.evaluate('window.rafCalls')
            running = await page.evaluate("document.getAnimations().filter(a=>a.playState==='running').length")
            await page.get_by_role('link', name='Next', exact=True).hover()
            await page.get_by_role('link', name='Next', exact=True).focus()
            prefetches = await page.evaluate('window.prefetchCount')
            await page.locator('#platform a').hover()
            videos = await page.locator('#platform video').count()
            measures = {
                'light_skeleton_nodes': light_nodes, 'normal_skeleton_nodes': normal_nodes,
                'light_static_skeletons': light_static_skeletons, 'normal_static_skeletons': normal_static_skeletons,
                'light_animated_skeletons': light_animated_skeletons, 'normal_animated_skeletons': normal_animated_skeletons,
                'light_skeleton_height': light_skeleton_height, 'normal_skeleton_height': normal_skeleton_height,
                'loading_raf_requests': raf_calls, 'running_animations': running,
                'speculative_prefetches': prefetches, 'decorative_videos': videos,
            }
            print(json.dumps(measures))
            if baseline:
                await browser.close()
                return
            # Les placeholders détaillés conservent la géométrie du contenu,
            # mais chaque Skeleton devient un bloc statique sans shimmer.
            assert light_nodes <= normal_nodes, measures
            assert light_static_skeletons > 0 and light_animated_skeletons == 0, measures
            assert normal_static_skeletons == 0 and normal_animated_skeletons > 0, measures
            assert abs(light_skeleton_height - normal_skeleton_height) <= 1, measures
            assert raf_calls == 0, measures
            assert running == 0, measures
            assert prefetches == 0, measures
            assert videos == 0, measures
            assert await page.evaluate('window.idleQueue.size') == 0
            assert await page.evaluate('window.idlePrefetchCount') == 0
            await page.evaluate("window.dispatchEvent(new Event('chunk:load:end'))")
            await expect(page.locator('[data-top-progress]')).to_have_count(0)
            await page.evaluate('window.navigate()')
            await expect(page.locator('[data-route="1"]')).to_have_css('opacity', '1', timeout=500)
            await expect(page.locator('[data-route="1"]')).to_have_css('transform', 'none', timeout=500)
            await expect(page.locator('#custom-motion')).to_have_css('opacity', '1')
            await page.evaluate("""() => {
const element=document.createElement('div');element.id='animation-end';element.className='custom-motion';
element.textContent='Transition';element.style.position='fixed';element.style.top='0';
window.animationEnded=0;element.addEventListener('animationend',()=>window.animationEnded++);
document.body.appendChild(element);
const style=getComputedStyle(element);window.cssProbe={name:style.animationName,duration:style.animationDuration};
}""")
            try:
                await page.wait_for_function('window.animationEnded === 1', timeout=3000)
            except Exception:
                print(await page.evaluate('({ended:window.animationEnded,style:window.cssProbe})'))
                raise
            await expect(page.locator('#animation-end')).to_have_css('opacity', '1')
            await expect(page.locator('#protected')).to_have_css('filter', 'blur(8px)')
            await page.evaluate('window.suspend()')
            await expect(page.locator('#pending [role="status"]')).to_be_visible()
            await page.evaluate('window.release()')
            await expect(page.locator('#resolved')).to_be_visible()
            await expect(page.locator('#pending [role="status"]')).to_have_count(0)
            assert await page.locator('#dimensions > :first-child').evaluate('e=>Math.round(e.getBoundingClientRect().height)') == 300
            assert await page.evaluate('window.sectionLoads') == 0
            await page.locator('#lazy-target').scroll_into_view_if_needed()
            await page.wait_for_function('window.idleQueue.size > 0')
            await page.evaluate('window.flushIdle()')
            await expect(page.locator('#section-ready')).to_be_visible()
            assert await page.evaluate('window.sectionLoads') == 1
            await page.evaluate("window.settings.setLightModeSetting('off')")
            await page.wait_for_function('!window.settings.isLightMode')
            await page.get_by_role('link', name='Next', exact=True).hover()
            await page.wait_for_function('window.prefetchCount === 1')
            assert await page.locator('#skeletons *').count() == normal_nodes
            assert await page.locator('#platform video').count() == 1
            # Un travail encore en attente est annulé en passant au mode léger.
            await page.evaluate("window.settings.setLightModeSetting('on')")
            await page.wait_for_function('window.settings.isLightMode')
            assert await page.evaluate('window.idleQueue.size') == 0
            await page.evaluate("window.settings.setLightModeSetting('off')")
            await page.wait_for_function('window.idleQueue.size > 0')
            await page.evaluate('window.flushIdle()')
            assert await page.evaluate('window.idlePrefetchCount') == 4
            assert await page.evaluate('window.sectionLoads') == 1
            # Une section disparue ne doit pas lancer son chargement retardé.
            await page.evaluate('window.resetLazy()')
            await page.locator('#lazy-target').scroll_into_view_if_needed()
            await page.wait_for_function('window.idleQueue.size > 0')
            await page.evaluate('window.hideLazy()')
            await expect(page.locator('#lazy-target')).to_have_count(0)
            await page.evaluate('window.flushIdle()')
            assert await page.evaluate('window.sectionLoads') == 0
            for width in [320, 390, 768, 1280]:
                await page.set_viewport_size({'width': width, 'height': 900})
                await page.evaluate("window.settings.setLightModeSetting('on')")
                await page.wait_for_function('window.settings.isLightMode')
                layout = await page.evaluate("""() => ({
                    documentWidth: document.documentElement.scrollWidth,
                    viewportWidth: innerWidth,
                    overflowing: Array.from(document.querySelectorAll('body *')).map(element => {
                        const rect = element.getBoundingClientRect();
                        return { tag: element.tagName, id: element.id, className: String(element.className), left: rect.left, right: rect.right };
                    }).filter(item => item.left < -1 || item.right > innerWidth + 1).slice(0, 10),
                })""")
                assert layout['documentWidth'] <= layout['viewportWidth'], (width, layout)
            assert errors == [], errors
            await browser.close()
            print('Light mode loading and navigation checks passed.')


if __name__ == '__main__':
    asyncio.run(run())
