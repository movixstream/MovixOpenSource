"""Ouverture du popup Live TV sur une grande grille, sans serveur ni réseau.

Exécution : python tests/liveTvAdPopup.browser.py
Nécessite les dépendances npm et Python Playwright avec Chromium.
"""
import asyncio
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect

REPO = Path(__file__).resolve().parents[1]


def build_fixture(work, real_player=False, extra_mocks=None):
    repo = REPO.as_posix()
    (work / 'entry.tsx').write_text(f"""
import React from 'react';
import {{createRoot}} from 'react-dom/client';
import {{BrowserRouter,Routes,Route,Link}} from 'react-router-dom';
import i18next from 'i18next';
import {{I18nextProvider}} from 'react-i18next';
import {{LightModeProvider}} from {json.dumps(repo + '/src/context/LightModeContext')};
import {{TooltipProvider}} from {json.dumps(repo + '/src/components/ui/tooltip')};
import LiveTV from {json.dumps(repo + '/src/pages/LiveTV')};
import ScrollToTop from './scroll';
import fr from {json.dumps(repo + '/src/i18n/locales/fr.json')};
import {json.dumps(repo + '/src/styles/light-mode.css')};
await i18next.init({{lng:'fr',resources:{{fr:{{translation:fr}}}}}});
createRoot(document.getElementById('root')).render(<I18nextProvider i18n={{i18next}}><BrowserRouter>{'<ScrollToTop/>' if real_player else ''}<LightModeProvider><TooltipProvider>{'<Routes><Route path="/" element={<Link to="/live-tv">Ouvrir la TV</Link>}/><Route path="/live-tv" element={<LiveTV/>}/></Routes>' if real_player else '<LiveTV/>'}</TooltipProvider></LightModeProvider></BrowserRouter></I18nextProvider>);
""", encoding='utf8')
    # La page, le popup, les particules, Radix et les préférences sont réels.
    # Le contrôle VIP compte les rendus de la page catalogue, sans modifier React.
    mocks = {
        'PrefetchLink': "export {Link as PrefetchLink} from 'react-router-dom';",
        'LiveTVPlayer': "import React from 'react'; export default ({channelName,onClose}) => <button id='player' onClick={onClose}>{channelName}</button>;",
        'useWrappedTracker': 'export const useWrappedTracker=()=>{};',
        'authUtils': "export const isUserVip=()=>{window.catalogRenders=(window.catalogRenders||0)+1; return localStorage.getItem('fixture_vip')==='true';};",
        'vipUtils': "export const getVipHeaders=()=>({}); export const isUserVip=()=>localStorage.getItem('fixture_vip')==='true';",
        'extensionProxy': 'export const isExtensionAvailable=()=>false; export const fetchFromExtension=async()=>({});',
        'AdFreePopupContext': 'export const useAdFreePopup=()=>({showAdFreePopup:false,isVoVostfrOnly:false,handlePopupAccept:()=>{}});',
        'adAdultMode': 'export const getAdTargetUrls=()=>[]; export const isAdultAdsEnabled=()=>false; export const subscribeToAdultAdsChanges=()=>()=>{};',
    }
    if real_player:
        del mocks['LiveTVPlayer']
        mocks['castUtils'] = 'export const initializeCastApi=async()=>{}; export const requestCastSession=async()=>{}; export const loadMediaOnCast=async()=>{}; export const prepareCastMediaInfo=()=>({}); export const isAirPlaySupported=()=>false; export const initializeAirPlay=()=>()=>{}; export const requestAirPlay=()=>{};'
    if extra_mocks:
        mocks.update(extra_mocks)
    (work / 'build.mjs').write_text(f"""
import {{createRequire}} from 'node:module';
import {{readFileSync,writeFileSync}} from 'node:fs';
const require=createRequire({json.dumps(repo + '/package.json')});
const mocks={json.dumps(mocks)};
// Compiler le vrai gestionnaire global de défilement sans démarrer toute l'app.
const ts=require('typescript');
const app=ts.createSourceFile('App.tsx',readFileSync({json.dumps(repo + '/src/App.tsx')},'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const scrollNames=new Set(['shouldPreserveScrollOnBack','shouldDisableRouteScrollToTop','isSmoothScrollEnabled','shouldAnimateScrollToTop','syncHistoryScrollRestoration','resetNestedScrollableContainers','forceViewportTop','scrollViewportToTop','ScrollToTop']);
const scrollSource=app.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>scrollNames.has(declaration.name.getText(app)))).map(node=>node.getText(app)).join('\\n');
writeFileSync({json.dumps((work / 'scroll.tsx').as_posix())}, "import React,{{useEffect,useLayoutEffect}} from 'react'; import {{useLocation,useNavigationType}} from 'react-router-dom';\\n"+scrollSource+'\\nexport default ScrollToTop;');
await require('esbuild').build({{
 entryPoints:[{json.dumps((work / 'entry.tsx').as_posix())}],outfile:{json.dumps((work / 'app.js').as_posix())},
 bundle:true,format:'esm',target:'es2022',jsx:'automatic',nodePaths:[{json.dumps(repo + '/node_modules')}],
 alias:{{'@':{json.dumps(repo + '/src')}}},loader:{{'.svg':'dataurl','.woff':'dataurl','.woff2':'dataurl'}},
 define:{{'import.meta.env':'{{}}','process.env.NODE_ENV':'"production"'}},
 plugins:[{{name:'fixture-services',setup(build){{
  build.onResolve({{filter:/.*/}},args=>{{
   const name=args.path.split('/').pop();
   if(Object.hasOwn(mocks,name)) return {{path:name,namespace:'fixture'}};
  }});
  build.onLoad({{filter:/.*/,namespace:'fixture'}},args=>({{contents:mocks[args.path],loader:'jsx',resolveDir:{json.dumps(repo)}}}));
 }}}}]
}});
""", encoding='utf8')
    # index.css n'est pas compilé ici : reprendre les ratios des cartes de la
    # grille, sinon leurs enfants absolus laissent des cartes de hauteur nulle.
    (work / 'base.css').write_text('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n.media-aspect-poster{aspect-ratio:2/3}\n.media-aspect-video{aspect-ratio:16/9}', encoding='utf8')
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/app.css"></head><body style="background:black;color:white"><div id="root"></div><script type="module" src="/app.js"></script></body></html>', encoding='utf8')
    subprocess.run(['node', str(work / 'build.mjs')], cwd=REPO, check=True)
    subprocess.run(['node', 'node_modules/tailwindcss/lib/cli.js', '-c', 'tailwind.config.js', '-i', str(work / 'base.css'), '-o', str(work / 'ui.css'), '--content', 'src/pages/LiveTV.tsx,src/components/LiveTVPlayer.tsx,src/components/StreamedSourceSelector.tsx,src/components/AdFreePlayerAds.tsx,src/components/AdPopupCinemaRain.tsx,src/components/ui/*.tsx'], cwd=REPO, check=True, capture_output=True)


async def check_popup(browser, work, mode='normal', light='off', reduced=False, transitions=True, vip=False):
    context = await browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce' if reduced else 'no-preference')
    await context.add_init_script(f"""
localStorage.setItem('settings_light_mode',{json.dumps(light)});
localStorage.setItem('settings_anim_transitions',{json.dumps(str(transitions).lower())});
localStorage.setItem('settings_ad_popup_mode',{json.dumps(mode)});
localStorage.setItem('fixture_vip',{json.dumps(str(vip).lower())});
""")

    async def route(request):
        path = urlparse(request.request.url).path
        if path == '/api/livetv/manifest':
            await request.fulfill(json={'catalogs': [{'id': 'northlive_all', 'name': 'Toutes', 'type': 'tv'}]})
        elif path == '/api/livetv/catalog/tv/northlive_all':
            await request.fulfill(json={'metas': [{'id': f'northlive_{i}', 'type': 'tv', 'name': f'Chaîne {i}', 'poster': ''} for i in range(400)]})
        else:
            file = work / path.lstrip('/')
            await request.fulfill(path=str(file if file.is_file() else work / 'index.html'))

    await context.route('**/*', route)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto('https://livetv.test/live-tv')
    first_channel = page.get_by_role('heading', name='Chaîne 0', exact=True)
    try:
        await expect(first_channel).to_be_visible()
    except AssertionError:
        print({'errors': errors, 'page': await page.locator('body').inner_text()}, flush=True)
        raise
    await expect(page.get_by_role('heading', name='Chaîne 399', exact=True)).to_have_count(1)
    await first_channel.scroll_into_view_if_needed()
    # Laisser finir uniquement l'entrée initiale des cartes avant la mesure.
    await first_channel.locator('xpath=../..').evaluate('(card)=>Promise.all(card.getAnimations().map(a=>a.finished))')
    before = await page.evaluate('window.catalogRenders')
    await first_channel.click()

    if vip or mode == 'auto':
        await expect(page.locator('#player')).to_have_text('Chaîne 0')
        await expect(page.get_by_role('dialog')).to_have_count(0)
    else:
        if mode == 'click-anywhere':
            await page.locator('[role="button"][tabindex="0"]').click()
        else:
            dialog = page.get_by_role('dialog')
            await expect(dialog).to_be_visible()
            animations = await dialog.evaluate('(el)=>el.getAnimations().map(a=>({name:a.animationName,duration:a.effect.getTiming().duration,easing:getComputedStyle(el).animationTimingFunction}))')
            after = await page.evaluate('window.catalogRenders')
            print(json.dumps({'mode': mode, 'light': light, 'reduced': reduced, 'transitions': transitions, 'catalogRendersOnOpen': after - before, 'animations': animations}), flush=True)
            assert after == before, 'Ouvrir le popup ne doit pas recalculer la grille des chaînes'
            if light == 'on' or reduced or not transitions:
                assert all(a['duration'] <= 1 for a in animations), 'Les préférences doivent supprimer la transition'
            else:
                assert animations and all(a['duration'] == 150 for a in animations)
                assert all(a['easing'] == 'cubic-bezier(0.23, 1, 0.32, 1)' for a in animations)
            await expect(page.locator('#player')).to_have_count(0)
            await page.keyboard.press('Escape')
            await expect(dialog).to_be_visible()
            await page.locator('[data-ad-view-button]').click()
            await page.get_by_role('button', name='Accéder à la chaîne', exact=True).click()
        await expect(page.locator('#player')).to_have_text('Chaîne 0')
        await expect(page.get_by_role('dialog')).to_have_count(0)
        assert await page.evaluate("sessionStorage.getItem('livetv_ad_credits')") == '1'

        await page.locator('#player').click()
        await expect(page.locator('#player')).to_have_count(0)
        await first_channel.click()
        await expect(page.locator('#player')).to_have_text('Chaîne 0')
        await expect(page.get_by_role('dialog')).to_have_count(0)
        assert await page.evaluate("sessionStorage.getItem('livetv_ad_credits')") == '0'
    assert not errors, errors
    await context.close()


async def main():
    with tempfile.TemporaryDirectory(prefix='movix-livetv-ad-') as directory:
        work = Path(directory)
        build_fixture(work)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            for options in [{}, {'light': 'on'}, {'reduced': True}, {'transitions': False}, {'mode': 'auto'}, {'mode': 'click-anywhere'}, {'vip': True}]:
                await check_popup(browser, work, **options)
            await browser.close()
    print('Live TV : popup, préférences, crédits et accès VIP vérifiés.')


if __name__ == '__main__':
    asyncio.run(main())
