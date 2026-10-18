"""Navigation du header avec et sans animations, sans serveur ni accès réseau.

Exécution : python tests/headerNavigation.browser.py
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


def build_fixture(work):
    repo = REPO.as_posix()
    (work / 'entry.tsx').write_text(f"""
import React from 'react';
import {{createRoot}} from 'react-dom/client';
import {{BrowserRouter,useLocation}} from 'react-router-dom';
import i18next from 'i18next';
import {{I18nextProvider}} from 'react-i18next';
import {{LightModeProvider}} from {json.dumps(repo + '/src/context/LightModeContext')};
import Header from {json.dumps(repo + '/src/components/Header')};
import fr from {json.dumps(repo + '/src/i18n/locales/fr.json')};
import {json.dumps(repo + '/src/styles/light-mode.css')};
await i18next.init({{lng:'fr',resources:{{fr:{{translation:fr}}}}}});
function Fixture() {{
 const location=useLocation();
 return <><Header/><main style={{{{paddingTop:100,minHeight:1500}}}}>
  <output id="route">{{location.pathname + location.search}}</output>
  <button id="outside" style={{{{position:'fixed',bottom:10,right:10}}}}>Outside</button>
 </main></>;
}}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nextProvider i18n={{i18next}}><BrowserRouter><LightModeProvider><Fixture/></LightModeProvider></BrowserRouter></I18nextProvider></React.StrictMode>);
""", encoding='utf8')
    # Seuls les services et sous-menus sans rapport sont simulés. Le header,
    # ses portails, PrefetchLink, le routeur et Framer Motion restent réels.
    mocks = {
        'ProfileMenu': 'export default () => null;',
        'NotificationsPopup': 'export default () => null;',
        'apiNotificationService': 'export const getUnreadNotificationsCount=async()=>0; export const getNotificationsDisabled=async()=>false;',
        'authUtils': 'export const isUserVip=()=>false;',
        'vipUtils': 'export const checkVipStatus=async()=>false;',
        'SearchContext': "const noop=()=>{}; export const useSearch=()=>({autocompleteSuggestions:[{id:42,title:'Film de test',media_type:'movie',poster_path:null,vote_average:0}],loadingAutocomplete:false,fetchAutocompleteSuggestions:noop,clearAutocompleteSuggestions:noop});",
        'useAgeRestrictedContent': 'export const useAgeRestrictedContent=items=>({items});',
        'registry': 'export const ROUTES=[];',
    }
    (work / 'build.mjs').write_text(f"""
import {{createRequire}} from 'node:module';
const require=createRequire({json.dumps(repo + '/package.json')});
const mocks={json.dumps(mocks)};
await require('esbuild').build({{
 entryPoints:[{json.dumps((work / 'entry.tsx').as_posix())}],outfile:{json.dumps((work / 'app.js').as_posix())},
 bundle:true,format:'esm',target:'es2022',jsx:'automatic',nodePaths:[{json.dumps(repo + '/node_modules')}],
 alias:{{'@':{json.dumps(repo + '/src')}}},
 plugins:[{{name:'fixture-services',setup(build){{
  build.onResolve({{filter:/.*/}},args=>{{
   const name=args.path.split('/').pop();
   if(Object.hasOwn(mocks,name)) return {{path:name,namespace:'fixture'}};
  }});
  build.onLoad({{filter:/.*/,namespace:'fixture'}},args=>({{contents:mocks[args.path]}}));
 }}}}]
}});
""", encoding='utf8')
    (work / 'base.css').write_text('@tailwind base;\n@tailwind components;\n@tailwind utilities;', encoding='utf8')
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/app.css"></head><body style="background:black;color:white"><div id="root"></div><script type="module" src="/app.js"></script></body></html>', encoding='utf8')
    subprocess.run(['node', str(work / 'build.mjs')], cwd=REPO, check=True)
    subprocess.run(['node', 'node_modules/tailwindcss/lib/cli.js', '-c', 'tailwind.config.js', '-i', str(work / 'base.css'), '-o', str(work / 'ui.css'), '--content', 'src/components/Header.tsx,src/components/ExploreMenu.tsx,src/components/header/*.tsx,src/components/ui/hover-highlight.tsx'], cwd=REPO, check=True, capture_output=True)


async def check_navigation(browser, work, width, setting, touch=False, reduced=False):
    context = await browser.new_context(
        viewport={'width': width, 'height': 900}, has_touch=touch,
        reduced_motion='reduce' if reduced else 'no-preference',
    )
    await context.add_init_script(f"localStorage.setItem('settings_light_mode',{json.dumps(setting)});")

    async def route(request):
        path = urlparse(request.request.url).path
        file = work / path.lstrip('/')
        await request.fulfill(path=str(file if file.is_file() else work / 'index.html'))

    await context.route('**/*', route)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto('https://header.test/')
    await expect(page.locator('#route')).to_have_text('/')
    trigger = page.locator('[data-explore-trigger]:visible')
    mobile = width < 1024
    menu = page.locator('#movix-overlay-root [data-lenis-prevent]') if mobile else page.locator('header [data-explore-menu]')

    async def open_menu():
        await trigger.click()
        await expect(menu).to_be_visible()
        await expect(menu).to_have_css('opacity', '1')

    for destination in ['/movies', '/search', '/collections']:
        await open_menu()
        scope = menu if mobile or destination == '/collections' else page.locator('header nav')
        link = scope.locator(f'a[href="{destination}"]')
        # Cliquer un enfant du lien reproduit le geste sur son icône/texte
        # (les grands liens du menu mobile n'ont pas d'icône).
        target = link.locator('svg, span').first
        if touch:
            await target.tap()
        else:
            # Un vrai intervalle entre l'appui et le relâchement révèle une
            # fermeture prématurée, même si les animations masquent le bug.
            await target.click(delay=150)
        await expect(page.locator('#route')).to_have_text(destination)
        await expect(menu).to_have_count(0)
        assert await page.evaluate('document.body.style.position') == ''
        assert await page.evaluate('document.documentElement.style.overflow') == ''

    await open_menu()
    await trigger.click()
    await expect(menu).to_have_count(0)
    if not mobile:
        await open_menu()
        await page.locator('#outside').click()
        await expect(menu).to_have_count(0)
        await expect(page.locator('#route')).to_have_text('/collections')

    async def search(query):
        if width < 768:
            await page.locator('header button:visible').filter(has=page.locator('svg.lucide-search')).click()
        field = page.locator('input[type="text"]:visible')
        await field.fill(query)
        await expect(page.get_by_role('button', name='Film de test')).to_be_visible()
        return field

    result = page.get_by_role('button', name='Film de test')
    field = await search('Film')
    await field.click()
    await expect(result).to_be_visible()
    if touch:
        await result.tap()
    else:
        await result.click(delay=150)
    await expect(page.locator('#route')).to_have_text('/movie/42')
    await expect(result).to_have_count(0)

    await search('Film & série')
    all_results = page.get_by_role('link', name='Voir tous les résultats')
    await all_results.click(delay=150)
    await expect(page.locator('#route')).to_have_text('/search?q=Film%20%26%20s%C3%A9rie')
    await expect(result).to_have_count(0)

    field = await search('Autre film')
    await field.press('Enter')
    await expect(page.locator('#route')).to_have_text('/search?q=Autre%20film')
    await expect(result).to_have_count(0)
    assert errors == [], errors
    await context.close()
    print(f'OK: width={width}, mode={setting}, touch={touch}, reduced={reduced}')


async def run():
    with tempfile.TemporaryDirectory(prefix='movix-header-') as directory:
        work = Path(directory)
        build_fixture(work)
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                await check_navigation(browser, work, 390, 'on')
                await check_navigation(browser, work, 390, 'off')
                await check_navigation(browser, work, 768, 'on', touch=True)
                await check_navigation(browser, work, 390, 'off', reduced=True)
                await check_navigation(browser, work, 1440, 'on')
                await check_navigation(browser, work, 1440, 'off')
                await check_navigation(browser, work, 1440, 'off', reduced=True)
            finally:
                await browser.close()


if __name__ == '__main__':
    asyncio.run(run())
