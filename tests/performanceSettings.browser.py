"""Régression du menu Performance, sans serveur ni accès réseau.

Exécution : python tests/performanceSettings.browser.py
Nécessite les dépendances npm et Python Playwright avec Chromium.
PERFORMANCE_SCREENSHOT_DIR permet de conserver les captures hors du dépôt.
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
    entry = f"""
import React, {{useState}} from 'react';
import {{createRoot}} from 'react-dom/client';
import {{MemoryRouter}} from 'react-router-dom';
import {{motion,MotionConfig}} from 'framer-motion';
import i18next from 'i18next';
import {{I18nextProvider}} from 'react-i18next';
import {{LightModeProvider,useLightMode}} from {json.dumps(repo + '/src/context/LightModeContext')};
import {{IntroProvider,useIntro}} from {json.dumps(repo + '/src/context/IntroContext')};
import {{PerformanceSettings}} from {json.dumps(repo + '/src/components/Settings/PerformanceSettings')};
import {{SquareBackground}} from {json.dumps(repo + '/src/components/ui/square-background')};
import ShinyText from {json.dumps(repo + '/src/components/ui/shiny-text')};
import SmoothScroll from {json.dumps(repo + '/src/components/SmoothScroll')};
import HeroSlider from {json.dumps(repo + '/src/components/HeroSlider')};
import DynamicBackground from {json.dumps(repo + '/src/components/DynamicBackground')};
import {{HexagonBackground}} from {json.dumps(repo + '/src/components/ui/hexagon-background')};
import EmblaCarouselPlatforms from {json.dumps(repo + '/src/components/EmblaCarouselPlatforms')};
import fr from {json.dumps(repo + '/src/i18n/locales/fr.json')};
import en from {json.dumps(repo + '/src/i18n/locales/en.json')};
import {json.dumps(repo + '/src/styles/light-mode.css')};
await i18next.init({{lng:location.search.includes('en')?'en':'fr',resources:{{fr:{{translation:fr}},en:{{translation:en}}}}}});
const items=[1,2,3].map(id=>({{id,title:'Film '+id,backdrop_path:'/backdrop.png',poster_path:'/poster.png',vote_average:8,media_type:'movie'}}));
function Probe() {{
 const settings=useLightMode();
 const intro=useIntro();
 const [open,setOpen]=useState(false);
 window.settings=settings;
 window.intro=intro;
 window.showMotion=()=>setOpen(true);
 return <><output id="state">{{JSON.stringify(settings)}}</output>{{open&&<motion.div id="motion-probe" initial={{{{opacity:0,x:100}}}} animate={{{{opacity:1,x:0}}}} transition={{{{duration:3,delay:2}}}}>Ready</motion.div>}}</>;
}}
function AnimationMotionConfig({{children}}) {{
 const {{effectivePrefs}}=useLightMode();
 return <MotionConfig reducedMotion={{effectivePrefs.transitions?'user':'always'}}>{{children}}</MotionConfig>;
}}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nextProvider i18n={{i18next}}><MemoryRouter><LightModeProvider><AnimationMotionConfig><IntroProvider><SmoothScroll/><SquareBackground className="min-h-screen"><main className="relative mx-auto max-w-3xl px-4 py-8"><PerformanceSettings/><div id="integration"><div id="hero"><HeroSlider items={{items}}/></div><ShinyText text="Decorative title"/><DynamicBackground/><HexagonBackground/><EmblaCarouselPlatforms items={{[]}}/><canvas id="functional-canvas" width="100" height="50"/><div id="spoiler" className="blur-sm">Spoiler</div><div id="video-filter" style={{{{filter:'brightness(0.8) contrast(1.2)'}}}}>Video</div><div id="loading" className="animate-spin">Loading</div><Probe/></div></main></SquareBackground></IntroProvider></AnimationMotionConfig></LightModeProvider></MemoryRouter></I18nextProvider></React.StrictMode>);
"""
    (work / 'entry.tsx').write_text(entry, encoding='utf8')
    script = f"""
import {{createRequire}} from 'node:module';
const require=createRequire({json.dumps(repo + '/package.json')});
const esbuild=require('esbuild');
await esbuild.build({{
 entryPoints:[{json.dumps((work / 'entry.tsx').as_posix())}],outfile:{json.dumps((work / 'app.js').as_posix())},
 bundle:true,format:'esm',target:'es2022',jsx:'automatic',nodePaths:[{json.dumps(repo + '/node_modules')}],
 alias:{{'@':{json.dumps(repo + '/src')}}},define:{{'import.meta.env':JSON.stringify({{'VITE_SITE_URL':'https://performance.test'}})}},
 plugins:[{{name:'fixture-data',setup(build){{
  build.onResolve({{filter:/useAgeRestrictedContent$/}},()=>({{path:'age-filter',namespace:'fixture'}}));
  build.onResolve({{filter:/PrefetchLink$/}},()=>({{path:'link',namespace:'fixture'}}));
  build.onLoad({{filter:/.*/,namespace:'fixture'}},args=>({{contents:args.path==='age-filter'
   ?'export const useAgeRestrictedContent = items => ({{items}});'
   :"export {{Link as PrefetchLink}} from 'react-router-dom';",resolveDir:{json.dumps(repo)}}}));
 }}}}]
}});
"""
    (work / 'build.mjs').write_text(script, encoding='utf8')
    (work / 'base.css').write_text('@tailwind base;\n@tailwind components;\n@tailwind utilities;', encoding='utf8')
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/app.css"></head><body style="background:#030712;color:white"><div id="root"></div><script type="module" src="/app.js"></script></body></html>', encoding='utf8')
    subprocess.run(['node', str(work / 'build.mjs')], cwd=REPO, check=True)
    subprocess.run(['node', 'node_modules/tailwindcss/lib/cli.js', '-c', 'tailwind.config.js', '-i', str(work / 'base.css'), '-o', str(work / 'ui.css'), '--content', 'src/components/Settings/PerformanceSettings.tsx,src/components/HeroSlider.tsx,src/components/ui/square-background.tsx,' + str(work / 'entry.tsx')], cwd=REPO, check=True, capture_output=True)


async def run():
    with tempfile.TemporaryDirectory(prefix='movix-performance-') as directory:
        work = Path(directory)
        build_fixture(work)
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            context = await browser.new_context(viewport={'width': 1280, 'height': 1000})
            await context.add_init_script("Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>8});Object.defineProperty(navigator,'deviceMemory',{get:()=>8});localStorage.setItem('movix_intro_enabled','true');")

            async def route(request):
                url = urlparse(request.request.url)
                if url.netloc != 'performance.test':
                    if '/images' in url.path:
                        await request.fulfill(json={'logos': []})
                    else:
                        await request.fulfill(status=200, content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#334155"/></svg>')
                    return
                path = work / (url.path.lstrip('/') or 'index.html')
                await request.fulfill(path=str(path if path.is_file() else work / 'index.html'))

            await context.route('**/*', route)
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto('https://performance.test')
            await expect(page.locator('#performance-title')).to_be_visible()
            await expect(page.locator('input[value="auto"]')).to_be_checked()
            await page.wait_for_function('window.lenis !== undefined')
            await page.locator('#performance-bgAnimations-label').scroll_into_view_if_needed()
            await page.get_by_role('switch', name='Animations de fond', exact=True).click()
            await page.wait_for_function('document.querySelectorAll("canvas").length === 1')

            await page.wait_for_function('Array.from(document.images).every(image=>image.complete && image.naturalWidth > 0)')
            quality_probe = """() => ({
                images: Array.from(document.images).map(image => ({
                    src: image.getAttribute('src'), srcset: image.getAttribute('srcset'), sizes: image.getAttribute('sizes'),
                    naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, filter: getComputedStyle(image).filter,
                })),
                spoilerFilter: getComputedStyle(document.querySelector('#spoiler')).filter,
                videoFilter: getComputedStyle(document.querySelector('#video-filter')).filter,
            })"""
            quality_before = await page.evaluate(quality_probe)
            await page.locator('label:has(input[value="on"])').click()
            await page.wait_for_function('document.documentElement.hasAttribute("data-light-mode") && window.lenis === undefined')
            for key in ['bgAnimations', 'loadingAnimations', 'carouselAutoplay', 'blurEffects', 'transitions']:
                switch = page.locator(f'button[aria-labelledby="performance-{key}-label"]')
                await expect(switch).to_be_disabled()
                await expect(switch).to_have_attribute('aria-checked', 'false')
            assert await page.locator('#functional-canvas').is_visible()
            assert await page.locator('#spoiler').evaluate("e=>getComputedStyle(e).filter") == 'blur(4px)'
            assert 'brightness' in await page.locator('#video-filter').evaluate("e=>getComputedStyle(e).filter")
            assert await page.locator('#loading').evaluate("e=>getComputedStyle(e).animationName") == 'none'
            assert await page.evaluate(quality_probe) == quality_before
            await page.evaluate('window.showMotion()')
            await expect(page.locator('#motion-probe')).to_have_css('opacity', '1', timeout=1000)
            await expect(page.locator('#motion-probe')).to_have_css('transform', 'none', timeout=1000)
            await expect(page.get_by_role('button', name='Reprendre le carrousel', exact=True)).to_have_count(0)
            assert not await page.evaluate('window.intro.showIntro')
            assert await page.evaluate('window.intro.introCompleted')

            # Le mode léger supprime la rotation, pas la navigation manuelle.
            await page.clock.install()
            second_slide = page.get_by_role('button', name='Afficher la diapositive 2 sur 3', exact=True)
            await second_slide.click()
            await expect(second_slide).to_have_attribute('aria-current', 'true')
            await page.clock.run_for(7000)
            await expect(second_slide).to_have_attribute('aria-current', 'true')
            await page.evaluate("window.settings.setLightModeSetting('off')")
            await page.wait_for_function('window.settings.effectivePrefs.carouselAutoplay')
            await page.clock.run_for(7200)
            await expect(second_slide).not_to_have_attribute('aria-current', 'true')
            await page.evaluate("window.settings.setPref('carouselAutoplay',false)")
            await page.wait_for_function('!window.settings.effectivePrefs.carouselAutoplay')
            selected = await page.locator('#hero [aria-current="true"]').get_attribute('aria-label')
            await page.clock.run_for(7000)
            assert await page.locator('#hero [aria-current="true"]').get_attribute('aria-label') == selected
            await page.evaluate("window.settings.setLightModeSetting('on')")

            # Restitution des choix et navigation clavier native des radios.
            await page.locator('input[value="on"]').focus()
            await page.keyboard.press('ArrowRight')
            await expect(page.locator('input[value="off"]')).to_be_checked()
            await expect(page.get_by_role('switch', name='Animations de fond', exact=True)).to_have_attribute('aria-checked', 'false')
            await expect(page.get_by_role('switch', name='Flous d’arrière-plan', exact=True)).to_have_attribute('aria-checked', 'true')
            await page.get_by_role('button', name='Réinitialiser les effets').click()
            await expect(page.get_by_role('switch', name='Animations de fond', exact=True)).to_have_attribute('aria-checked', 'true')
            await expect(page.locator('input[value="off"]')).to_be_checked()

            # Mise à jour système sans reload, même si le mode léger est désactivé.
            await page.emulate_media(reduced_motion='reduce')
            await expect(page.get_by_role('switch', name='Animations de fond', exact=True)).to_be_disabled()
            await expect(page.get_by_role('switch', name='Flous d’arrière-plan', exact=True)).to_be_enabled()
            await page.locator('label:has(input[value="auto"])').click()
            await page.wait_for_function('window.settings.isLightMode')
            await page.emulate_media(reduced_motion='no-preference')
            await page.wait_for_function('!window.settings.isLightMode')

            # Une synchronisation de profil et un autre onglet actualisent le provider.
            await page.evaluate("localStorage.setItem('settings_anim_blur','false');window.dispatchEvent(new Event('sync_storage_updated'))")
            await expect(page.get_by_role('switch', name='Flous d’arrière-plan', exact=True)).to_have_attribute('aria-checked', 'false')
            other = await context.new_page()
            await other.goto('https://performance.test')
            await other.evaluate("localStorage.setItem('settings_light_mode','on')")
            await page.wait_for_function('window.settings.isLightMode')
            await other.evaluate('localStorage.clear()')
            await page.wait_for_function('!window.settings.isLightMode && window.settings.prefs.blurEffects')
            await other.close()

            # Libellés, cibles tactiles et mise en page dans les deux langues.
            screenshots = os.environ.get('PERFORMANCE_SCREENSHOT_DIR')
            if screenshots:
                Path(screenshots).mkdir(parents=True, exist_ok=True)
            for lang in ['fr', 'en']:
                await page.goto('https://performance.test?'+lang)
                await page.locator('label:has(input[value="on"])').click()
                for width in [320, 390, 768, 1280]:
                    await page.set_viewport_size({'width': width, 'height': 1000})
                    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (lang, width, 'overflow')
                    for switch in await page.locator('#performance [role="switch"]').all():
                        box = await switch.bounding_box()
                        assert box['height'] >= 44 and box['width'] >= 44
                    if screenshots and width in [390, 1280]:
                        await page.locator('#performance').screenshot(path=str(Path(screenshots) / f'performance-{lang}-{width}.png'))

            # Stockage bloqué : le provider fonctionne et expose la limite.
            await page.evaluate("() => {Storage.prototype.setItem=()=>{throw new Error('blocked')};Storage.prototype.removeItem=()=>{throw new Error('blocked')};}")
            await page.locator('label:has(input[value="off"])').click()
            await page.wait_for_function('!window.settings.isLightMode && window.settings.storageUnavailable')
            await expect(page.get_by_text('Browser storage is unavailable.', exact=False)).to_be_visible()
            assert errors == [], errors
            await browser.close()
            print('Performance settings: keyboard, mobile/desktop FR/EN, persistence, live reduced motion, storage failure, CSS protections and runtime effects passed.')


if __name__ == '__main__':
    asyncio.run(run())
