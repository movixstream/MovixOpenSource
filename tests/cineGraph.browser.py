"""CinéGraph en carte et en liste, sans serveur ni panneau navigateur.

Exécution : python tests/cineGraph.browser.py
Nécessite les dépendances npm et Python Playwright avec Chromium.

Par défaut, les données TMDB sont des fixtures et les images des aplats :
le test reste hors ligne. Variables utiles :
- CINEGRAPH_SHOTS=<dossier> enregistre une capture de chaque étape ;
- CINEGRAPH_LIVE=1 utilise la vraie couche de données et l'API TMDB (clé lue
  dans .env), pour juger la qualité des liens sur de vrais titres.
"""
import asyncio
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect

REPO = Path(__file__).resolve().parents[1]
LIVE = os.environ.get('CINEGRAPH_LIVE') == '1'
SHOTS = Path(os.environ['CINEGRAPH_SHOTS']) if os.environ.get('CINEGRAPH_SHOTS') else None
IMG = 'https://image.tmdb.org/t/p/w185'

# Carte d'Inception écrite à la main : mêmes formes que la vraie couche de données.
INCEPTION = {
    'root': {
        'key': 'movie-27205', 'type': 'movie', 'tmdbId': 27205, 'title': 'Inception', 'year': '2010',
        'rating': 8.4, 'img': f'{IMG}/inception.jpg', 'genres': ['Action', 'Science-Fiction', 'Aventure'],
        'overview': 'Dom Cobb est un voleur expérimenté dans l’art périlleux de l’extraction.',
    },
    'zones': [
        {'kind': 'team', 'items': ['person-525', 'person-3899', 'person-6193', 'person-24045', 'person-2524']},
        {'kind': 'director', 'job': 'director', 'people': [{'id': 525, 'name': 'Christopher Nolan'}],
         'items': ['movie-157336', 'movie-155', 'movie-1124', 'movie-577922', 'movie-77']},
        {'kind': 'cast', 'items': ['movie-11324', 'movie-76341', 'movie-59967']},
        {'kind': 'mood', 'items': ['movie-4977', 'movie-603']},
    ],
    'items': {},
}


def person(key, name, zone, reasons, related=()):
    pid = int(key.split('-')[1])
    INCEPTION['items'][key] = {'key': key, 'type': 'person', 'tmdbId': pid, 'title': name,
                               'img': f'{IMG}/{pid}.jpg', 'zone': zone, 'reasons': reasons, 'related': list(related)}


def work(key, title, year, zone, reasons, related=()):
    kind, wid = key.split('-')
    INCEPTION['items'][key] = {'key': key, 'type': kind, 'tmdbId': int(wid), 'title': title, 'year': year,
                               'rating': 7.9, 'img': f'{IMG}/{wid}.jpg', 'zone': zone, 'reasons': reasons,
                               'related': list(related), 'overview': f'Résumé de {title}.'}


NOLAN = {'id': 525, 'name': 'Christopher Nolan'}
CAINE = {'id': 3899, 'name': 'Michael Caine'}
DICAPRIO = {'id': 6193, 'name': 'Leonardo DiCaprio'}
person('person-525', 'Christopher Nolan', 'team', [{'type': 'crew', 'job': 'director'}],
       ['movie-157336', 'movie-155', 'movie-1124', 'movie-577922', 'movie-77'])
person('person-6193', 'Leonardo DiCaprio', 'team', [{'type': 'plays', 'character': 'Dom Cobb'}], ['movie-11324'])
person('person-24045', 'Joseph Gordon-Levitt', 'team', [{'type': 'plays', 'character': 'Arthur'}], ['movie-59967'])
person('person-3899', 'Michael Caine', 'team', [{'type': 'plays', 'character': 'Miles'}],
       ['movie-157336', 'movie-155', 'movie-1124'])
person('person-2524', 'Tom Hardy', 'team', [{'type': 'plays', 'character': 'Eames'}], ['movie-76341'])
work('movie-157336', 'Interstellar', '2014', 'director',
     [{'type': 'sameDirector', 'job': 'director', 'people': [NOLAN]}, {'type': 'sharedCast', 'people': [CAINE]}],
     ['person-525', 'person-3899'])
work('movie-155', 'The Dark Knight : Le Chevalier noir', '2008', 'director',
     [{'type': 'sameDirector', 'job': 'director', 'people': [NOLAN]}, {'type': 'sharedCast', 'people': [CAINE]}],
     ['person-525', 'person-3899'])
work('movie-1124', 'Le Prestige', '2006', 'director',
     [{'type': 'sameDirector', 'job': 'director', 'people': [NOLAN]}, {'type': 'sharedCast', 'people': [CAINE]}],
     ['person-525', 'person-3899'])
work('movie-577922', 'Tenet', '2020', 'director', [{'type': 'sameDirector', 'job': 'director', 'people': [NOLAN]}],
     ['person-525'])
work('movie-77', 'Memento', '2000', 'director', [{'type': 'sameDirector', 'job': 'director', 'people': [NOLAN]}],
     ['person-525'])
work('movie-11324', 'Shutter Island', '2010', 'cast', [{'type': 'sharedCast', 'people': [DICAPRIO]}], ['person-6193'])
work('movie-76341', 'Mad Max: Fury Road', '2015', 'cast',
     [{'type': 'sharedCast', 'people': [{'id': 2524, 'name': 'Tom Hardy'}]}], ['person-2524'])
work('movie-59967', 'Looper', '2012', 'cast',
     [{'type': 'sharedCast', 'people': [{'id': 24045, 'name': 'Joseph Gordon-Levitt'}]}], ['person-24045'])
work('movie-4977', 'Paprika', '2006', 'mood', [{'type': 'themes', 'keywords': ['rêve', 'subconscient'], 'genres': []}])
work('movie-603', 'Matrix', '1999', 'mood',
     [{'type': 'themes', 'keywords': ['réalité virtuelle'], 'genres': ['Action', 'Science-Fiction']}])

TMDB_FIXTURE = f"""
const inception = {json.dumps(INCEPTION, ensure_ascii=False)};
const wait = () => new Promise(resolve => setTimeout(resolve, 30));
export async function fetchWorkMap(type, id) {{
  await wait();
  if (id === 27205) return inception;
  return {{ root: {{ key: `${{type}}-${{id}}`, type, tmdbId: id, title: id === 157336 ? 'Interstellar' : 'Titre ' + id }},
    zones: [{{ kind: 'team', items: ['person-525'] }}],
    items: {{ 'person-525': {{ ...inception.items['person-525'], related: [] }} }} }};
}}
export async function fetchPersonMap(id) {{ await wait(); throw new Error('Pas de fixture pour ' + id); }}
export async function searchCineGraph() {{ await wait(); return [{{ type: 'movie', id: 27205, title: 'Inception', year: '2010' }}]; }}
export async function fetchTrending() {{ return [{{ type: 'movie', id: 27205, title: 'Inception', year: '2010' }}]; }}
"""

# Distance (px écran) entre le point lumineux et le trait actif qu'il doit suivre.
DOT_ON_PATH = """() => {
  const dot = document.querySelector('.cg-beam.is-active .cg-beam-dot');
  const path = document.querySelector('.cg-beam.is-active .react-flow__edge-path');
  if (!dot || !path) return null;
  const box = dot.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const matrix = path.getScreenCTM();
  const length = path.getTotalLength();
  let distance = Infinity;
  for (let i = 0; i <= 400; i++) {
    const point = path.getPointAtLength(length * i / 400).matrixTransform(matrix);
    distance = Math.min(distance, Math.hypot(point.x - x, point.y - y));
  }
  return { distance, x, y };
}"""

# Une affiche neutre suffit hors ligne : on vérifie la mise en page, pas TMDB.
POSTER_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="185" height="278">'
              '<rect width="185" height="278" fill="#374151"/></svg>')


def read_tmdb_key():
    for line in (REPO / '.env').read_text(encoding='utf8').splitlines():
        if line.startswith('VITE_TMDB_API_KEY='):
            return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit('VITE_TMDB_API_KEY absent de .env')


def build_fixture(work, broken_canvas=False):
    """broken_canvas : le morceau de la carte pointe vers un fichier absent, comme
    un chunk qui ne se charge pas (504 du serveur de dev, coupure réseau)."""
    repo = REPO.as_posix()
    (work / 'entry.tsx').write_text(f"""
import React from 'react';
import {{createRoot}} from 'react-dom/client';
import {{BrowserRouter,useLocation}} from 'react-router-dom';
import i18next from 'i18next';
import {{I18nextProvider,initReactI18next}} from 'react-i18next';
import {{MotionConfig}} from 'framer-motion';
import {{LightModeProvider}} from {json.dumps(repo + '/src/context/LightModeContext')};
import CineGraph from {json.dumps(repo + '/src/pages/CineGraph')};
import fr from {json.dumps(repo + '/src/i18n/locales/fr.json')};
await i18next.use(initReactI18next).init({{lng:'fr',resources:{{fr:{{translation:fr}}}},interpolation:{{escapeValue:false}}}});
function Route() {{
 const location = useLocation();
 return <output id="route" hidden>{{location.pathname + location.search}}</output>;
}}
// Comme App.tsx (AnimationMotionConfig) : Framer suit le réglage du système.
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nextProvider i18n={{i18next}}><BrowserRouter><LightModeProvider><MotionConfig reducedMotion="user"><Route/><CineGraph/></MotionConfig></LightModeProvider></BrowserRouter></I18nextProvider></React.StrictMode>);
""", encoding='utf8')
    mocks = {'i18n': "export const getTmdbLanguage = () => 'fr-FR';"} if LIVE else {'tmdb': TMDB_FIXTURE}
    env = {'VITE_TMDB_API_KEY': read_tmdb_key() if LIVE else '', 'DEV': False, 'PROD': True, 'MODE': 'production'}
    (work / 'build.mjs').write_text(f"""
import {{createRequire}} from 'node:module';
const require=createRequire({json.dumps(repo + '/package.json')});
const mocks={json.dumps(mocks)};
const brokenCanvas={json.dumps(broken_canvas)};
await require('esbuild').build({{
 entryPoints:[{json.dumps((work / 'entry.tsx').as_posix())}],outfile:{json.dumps((work / 'app.js').as_posix())},
 bundle:true,format:'esm',target:'es2022',jsx:'automatic',nodePaths:[{json.dumps(repo + '/node_modules')}],
 alias:{{'@':{json.dumps(repo + '/src')}}},loader:{{'.svg':'dataurl','.png':'dataurl','.webp':'dataurl'}},
 define:{{'import.meta.env':{json.dumps(json.dumps(env))}}},
 plugins:[{{name:'fixture-services',setup(build){{
  build.onResolve({{filter:/.*/}},args=>{{
   const name=args.path.split('/').pop();
   if(Object.hasOwn(mocks,name)) return {{path:name,namespace:'fixture'}};
   if(brokenCanvas && name==='CineMapCanvas') return {{path:'/chunks/CineMapCanvas-absent.js',external:true}};
  }});
  build.onLoad({{filter:/.*/,namespace:'fixture'}},args=>({{contents:mocks[args.path],loader:'js'}}));
 }}}}]
}});
""", encoding='utf8')
    (work / 'base.css').write_text('@tailwind base;\n@tailwind components;\n@tailwind utilities;', encoding='utf8')
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/app.css"></head><body style="margin:0;background:black;color:white;font-family:Inter,system-ui,sans-serif"><div id="root"></div><script type="module" src="/app.js"></script></body></html>', encoding='utf8')
    subprocess.run(['node', str(work / 'build.mjs')], cwd=REPO, check=True)
    subprocess.run(['node', 'node_modules/tailwindcss/lib/cli.js', '-c', 'tailwind.config.js', '-i', str(work / 'base.css'), '-o', str(work / 'ui.css'), '--content', 'src/pages/CineGraph.tsx,src/components/cinegraph/*.tsx,src/components/ui/tooltip.tsx,src/components/ui/square-background.tsx'], cwd=REPO, check=True, capture_output=True)


async def open_page(browser, work, width, height, url, touch=False, reduced=False):
    context = await browser.new_context(
        viewport={'width': width, 'height': height}, has_touch=touch, is_mobile=touch,
        reduced_motion='reduce' if reduced else 'no-preference',
    )

    async def route(request):
        url = request.request.url
        host = urlparse(url).netloc
        if host == 'image.tmdb.org':
            if LIVE:
                await request.continue_()
            else:
                await request.fulfill(body=POSTER_SVG, content_type='image/svg+xml')
            return
        if host.endswith('themoviedb.org'):
            await (request.continue_() if LIVE else request.abort())
            return
        if host != 'cinegraph.test':
            await request.abort()
            return
        file = work / urlparse(url).path.lstrip('/')
        await request.fulfill(path=str(file if file.is_file() else work / 'index.html'))

    await context.route('**/*', route)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto(f'https://cinegraph.test{url}')
    return context, page, errors


async def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        await page.wait_for_timeout(700)
        await page.screenshot(path=str(SHOTS / f'{name}.png'))


async def check_map(browser, work):
    context, page, errors = await open_page(browser, work, 1440, 900, '/cinegraph?type=movie&id=27205')
    canvas = page.locator('.cg-canvas')
    await expect(canvas.locator('.cg-root')).to_be_visible(timeout=20000)
    await expect(canvas.locator('.cg-zone')).to_have_count(4 if not LIVE else await canvas.locator('.cg-zone').count())
    await shot(page, '1-carte')
    if LIVE:
        await context.close()
        assert errors == [], errors
        print('OK : carte réelle (captures seulement)')
        return

    # Chaque vignette porte sa raison, et la zone son titre.
    await expect(canvas.locator('.cg-zone-title', has_text='Même réalisateur')).to_be_visible()
    interstellar = canvas.locator('.cg-card', has_text='Interstellar')
    await expect(interstellar.locator('.cg-card-chip')).to_have_text('de Christopher Nolan')
    await expect(canvas.locator('.cg-card', has_text='Shutter Island').locator('.cg-card-chip')).to_have_text('avec Leonardo DiCaprio')

    # Survoler un acteur fait ressortir ses films présents ailleurs sur la carte.
    await canvas.locator('.cg-card', has_text='Michael Caine').hover()
    await expect(interstellar).to_have_class(re.compile(r'\bis-related\b'))
    await expect(canvas.locator('.cg-card', has_text='Shutter Island')).to_have_class(re.compile(r'\bis-dimmed\b'))
    await shot(page, '2-survol-acteur')

    # Glisser sur le fond déplace la vue (les cadres de zone ne bloquent pas).
    viewport = canvas.locator('.react-flow__viewport')
    before = await viewport.get_attribute('style')
    await page.mouse.move(700, 300)
    await page.mouse.down()
    await page.mouse.move(640, 330, steps=6)
    await page.mouse.up()
    assert await viewport.get_attribute('style') != before, 'le fond de carte ne se déplace pas'
    await page.get_by_role('button', name='Recentrer').click()
    await page.wait_for_timeout(600)

    # Molette : la carte se déplace sans zoomer. Ctrl + molette : elle zoome.
    x0, y0, s0 = await viewport_state(canvas)
    await page.mouse.move(700, 300)
    await page.mouse.wheel(0, 240)
    await page.wait_for_timeout(250)
    x1, y1, s1 = await viewport_state(canvas)
    assert abs(s1 - s0) < 1e-6 and abs(y1 - y0) > 50, f'la molette ne déplace pas la carte : {(x0, y0, s0)} → {(x1, y1, s1)}'
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -240)
    await page.keyboard.up('Control')
    await page.wait_for_timeout(300)
    s2 = (await viewport_state(canvas))[2]
    assert s2 > s1 * 1.05, f'Ctrl + molette ne zoome pas : {s1} → {s2}'

    # Clic sur le titre d'une zone : la carte zoome sur elle.
    await page.get_by_role('button', name='Recentrer').click()
    await page.wait_for_timeout(600)
    s3 = (await viewport_state(canvas))[2]
    await canvas.locator('.cg-zone-focus', has_text='Même réalisateur').click()
    await page.wait_for_timeout(800)
    s4 = (await viewport_state(canvas))[2]
    zone_box = await canvas.locator('.react-flow__node[data-id="zone-director"]').bounding_box()
    canvas_box = await canvas.bounding_box()
    offset = abs((zone_box['x'] + zone_box['width'] / 2) - (canvas_box['x'] + canvas_box['width'] / 2))
    assert s4 > s3 * 1.1 and offset < 40, f'zoom sur la zone : {s3} → {s4}, écart au centre {offset:.0f} px'
    await shot(page, '2b-zoom-zone')

    # La dernière case de la zone ouvre les titres cachés, puis les replie.
    director = canvas.locator('.react-flow__node[data-id="zone-director"]')
    more = canvas.locator('.react-flow__node[data-id="more-director"] .cg-more')
    await expect(more).to_contain_text('+2')
    await expect(canvas.locator('.cg-card', has_text='Memento')).to_have_count(0)
    width = (await director.bounding_box())['width']
    await more.click()
    await expect(canvas.locator('.cg-card', has_text='Memento')).to_be_visible()
    await expect(more).to_contain_text('Voir moins')
    assert abs((await director.bounding_box())['width'] - width) < 1, 'la zone a changé de largeur'
    await shot(page, '2c-voir-plus-ouvert')
    await more.click()
    await expect(canvas.locator('.cg-card', has_text='Memento')).to_have_count(0)

    await page.get_by_role('button', name='Recentrer').click()
    await page.wait_for_timeout(600)

    # Passer à une vignette voisine de la même zone continue le trajet du point
    # (même cercle, même animation) au lieu de le relancer du début.
    await interstellar.hover()
    await page.wait_for_timeout(400)
    started = await page.evaluate("""() => {
      const dot = document.querySelector('.cg-beam.is-active .cg-beam-dot');
      dot.dataset.suivi = 'oui';
      return dot.getAnimations()[0].currentTime;
    }""")
    neighbour = await canvas.locator('.cg-card', has_text='Le Prestige').bounding_box()
    await page.mouse.move(neighbour['x'] + neighbour['width'] / 2, neighbour['y'] + neighbour['height'] / 2, steps=12)
    await page.wait_for_timeout(300)
    moved = await page.evaluate("""() => {
      const dot = document.querySelector('.cg-beam.is-active .cg-beam-dot');
      return { same: dot?.dataset.suivi === 'oui', time: dot?.getAnimations()[0]?.currentTime ?? null };
    }""")
    assert moved['same'], 'le point a été recréé en changeant de vignette dans la zone'
    assert moved['time'] is not None and moved['time'] > started, f'animation relancée : {started} puis {moved}'

    # Le panneau dit en clair pourquoi le film est là, sans cacher la vignette.
    await page.mouse.move(5, 5)
    await interstellar.click()
    panel = page.locator('.cg-why')
    await expect(panel).to_be_visible()
    await expect(panel.locator('.cg-why-lines')).to_contain_text('Même réalisateur que « Inception » : Christopher Nolan')
    await expect(panel.locator('.cg-why-lines')).to_contain_text('Casting en commun avec « Inception » : Michael Caine')
    await expect(panel.locator('.cg-why-beam > svg')).to_have_count(2)
    # Le trait de la zone s'allume et un point file dessus : il doit être sur le
    # trait dès la première image (en SMIL, il clignotait d'abord en 0,0).
    await expect(canvas.locator('.cg-beam.is-active .cg-beam-halo')).to_have_count(1)
    first = await page.evaluate(f'() => new Promise(resolve => requestAnimationFrame(() => resolve(({DOT_ON_PATH})())))')
    assert first and first['distance'] < 6, f'point hors du trait à la première image : {first}'
    await page.wait_for_timeout(500)
    later = await page.evaluate(DOT_ON_PATH)
    assert later and later['distance'] < 6, f'point hors du trait en route : {later}'
    assert abs(later['x'] - first['x']) + abs(later['y'] - first['y']) > 20, 'le point ne file pas le long du trait'
    await page.wait_for_timeout(600)
    box = await interstellar.bounding_box()
    assert box and box['x'] + box['width'] <= 1440 - 400, f'vignette cachée par le panneau : {box}'
    await shot(page, '3-panneau')

    # Explorer d'ici recentre la carte et garde le chemin parcouru.
    await panel.get_by_role('button', name="Explorer d'ici").click()
    await expect(page.locator('#route')).to_have_text('/cinegraph?type=movie&id=157336')
    await expect(page.locator('.cg-trail')).to_contain_text('Inception')
    await expect(page.locator('.cg-trail .is-current')).to_have_text('Interstellar')
    await page.locator('.cg-trail button', has_text='Inception').click()
    await expect(page.locator('#route')).to_have_text('/cinegraph?type=movie&id=27205')
    await expect(canvas.locator('.cg-zone')).to_have_count(4)

    # Masquer une zone la retire de la carte.
    await page.locator('.cg-zone-chip', has_text='Même ambiance').click()
    await expect(canvas.locator('.cg-zone')).to_have_count(3)
    await page.locator('.cg-zone-chip', has_text='Même ambiance').click()

    # La vue liste reste disponible sur grand écran.
    await page.get_by_role('button', name='Liste').click()
    await expect(page.locator('.cg-list .cg-list-zone')).to_have_count(4)

    # Survoler les vignettes d'une rangée défilée ne doit pas la faire sauter.
    await page.set_viewport_size({'width': 1200, 'height': 900})
    row = page.locator('.cg-list-zone', has_text='Même réalisateur').locator('.cg-list-row')
    await row.evaluate('row => { row.style.maxWidth = "300px"; row.scrollLeft = 75; }')
    await page.wait_for_timeout(300)
    start = await row.evaluate('row => row.scrollLeft')
    # La souris passe sur chaque vignette visible, y compris celles coupées au
    # bord (mouse.move ne fait pas défiler, contrairement à hover()).
    bounds = await row.bounding_box()
    for step in range(13):
        x = bounds['x'] + 8 + (bounds['width'] - 16) * step / 12
        await page.mouse.move(x, bounds['y'] + 80, steps=3)
        await page.wait_for_timeout(120)
        assert await row.evaluate('row => row.scrollLeft') == start, f'la rangée a bougé (souris à {x:.0f} px)'
    await row.evaluate('row => { row.style.maxWidth = ""; }')
    await page.set_viewport_size({'width': 1440, 'height': 900})

    await page.get_by_role('button', name='Carte').click()
    await expect(canvas.locator('.cg-zone')).to_have_count(4)
    assert errors == [], errors
    await context.close()
    print('OK : carte 1440 px')


async def viewport_state(canvas):
    """(x, y, zoom) de la vue React Flow, lus dans la transformation du viewport."""
    style = await canvas.locator('.react-flow__viewport').get_attribute('style')
    match = re.search(r'translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([-\d.]+)\)', style or '')
    assert match, f'transformation illisible : {style}'
    return tuple(float(value) for value in match.groups())


async def check_fullscreen(browser, work):
    """La carte tient dans la fenêtre, puis passe en plein écran ; Échap ressort par étapes."""
    context, page, errors = await open_page(browser, work, 1440, 900, '/cinegraph?type=movie&id=27205')
    canvas = page.locator('.cg-canvas')
    await expect(canvas.locator('.cg-root')).to_be_visible(timeout=20000)
    stage = await page.locator('.cg-stage--map').bounding_box()
    assert stage['y'] + stage['height'] <= 901, f'le bas de la carte dépasse de la fenêtre : {stage}'

    await page.get_by_role('button', name='Plein écran').click()
    overlay = page.locator('.cg-fullscreen')
    await expect(overlay).to_be_visible()
    assert await overlay.bounding_box() == {'x': 0, 'y': 0, 'width': 1440, 'height': 900}
    await expect(overlay.locator('.cg-canvas .cg-root')).to_be_visible()
    await expect(overlay.locator('.cg-zone-chip')).to_have_count(4)
    await expect(overlay.locator('.cinegraph-search-input')).to_be_visible()
    assert await page.evaluate('document.body.style.overflow') == 'hidden'
    await shot(page, '7-plein-ecran')

    # Échap ferme d'abord le panneau, puis seulement le plein écran.
    await overlay.locator('.cg-card', has_text='Interstellar').click()
    await expect(page.locator('.cg-why')).to_be_visible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.cg-why')).to_have_count(0)
    await expect(overlay).to_be_visible()
    await page.keyboard.press('Escape')
    await expect(overlay).to_have_count(0)
    await expect(page.locator('.cg-stage--map .cg-root')).to_be_visible()
    assert await page.evaluate('document.body.style.overflow') == ''
    assert errors == [], errors
    await context.close()
    print('OK : plein écran 1440 px')


async def check_map_reduced(browser, work):
    """Animations réduites : le trait s'allume, aucun point ne court dessus."""
    context, page, errors = await open_page(browser, work, 1440, 900, '/cinegraph?type=movie&id=27205', reduced=True)
    canvas = page.locator('.cg-canvas')
    await canvas.locator('.cg-card', has_text='Interstellar').hover()
    await expect(canvas.locator('.cg-beam.is-active')).to_have_count(1)
    await expect(canvas.locator('.cg-beam-dot')).to_have_count(0)
    assert errors == [], errors
    await context.close()
    print('OK : carte 1440 px, animations réduites')


async def check_mobile(browser, work, reduced=False):
    context, page, errors = await open_page(browser, work, 390, 844, '/cinegraph?type=movie&id=27205',
                                            touch=True, reduced=reduced)
    await expect(page.locator('.cg-list .cg-root')).to_be_visible(timeout=20000)
    await expect(page.locator('.cg-canvas')).to_have_count(0)
    await shot(page, '4-mobile-liste' + ('-reduit' if reduced else ''))
    if not LIVE:
        card = page.locator('.cg-list .cg-card', has_text='Interstellar')
        await card.scroll_into_view_if_needed()
        await card.tap()
        sheet = page.locator('.cg-why--sheet')
        await expect(sheet).to_be_visible()
        await expect(sheet.locator('.cg-why-lines')).to_contain_text('Christopher Nolan')
        await shot(page, '5-mobile-feuille' + ('-reduit' if reduced else ''))
        await page.locator('.cg-sheet-backdrop').click(position={'x': 20, 'y': 40})
        await expect(sheet).to_have_count(0)
    assert errors == [], errors
    await context.close()
    print(f'OK : liste 390 px, animations réduites={reduced}')


async def check_broken_canvas(browser, work):
    """Le moteur de carte ne se charge pas : liste dans le cadre, jamais de rechargement."""
    context, page, errors = await open_page(browser, work, 1440, 900, '/cinegraph?type=movie&id=27205')
    reloads = []
    page.on('load', lambda: reloads.append(1))
    await expect(page.locator('.cg-stage--map .cg-list .cg-card').first).to_be_visible(timeout=20000)
    # Le mode « Carte » dit pourquoi il montre une liste, et propose un nouvel essai.
    note = page.locator('.cg-engine-note')
    await expect(note).to_contain_text("La vue carte n'a pas pu se charger")
    await shot(page, '6-carte-indisponible')
    await note.get_by_role('button', name='Réessayer').click()
    await expect(note).to_be_visible(timeout=20000)
    await page.wait_for_timeout(5000)
    assert reloads == [], f'la page s’est rechargée {len(reloads)} fois'
    await page.locator('.cg-list .cg-card', has_text='Interstellar').click()
    await expect(page.locator('.cg-why')).to_be_visible()
    # React de développement signale aussi l'erreur déjà interceptée par la
    # bascule en liste ; toute autre erreur reste un échec.
    unexpected = [error for error in errors if 'dynamically imported module' not in error]
    assert unexpected == [], unexpected
    await context.close()
    print('OK : carte indisponible → liste, sans rechargement')


async def check_live_maps(browser, work):
    """Vraies cartes : un film, une série, un acteur, un cinéaste (captures à juger)."""
    for name, url in [('serie', '/cinegraph?type=tv&id=1396'), ('acteur', '/cinegraph?type=person&id=6193'),
                      ('cineaste', '/cinegraph?type=person&id=525')]:
        context, page, errors = await open_page(browser, work, 1440, 900, url)
        await expect(page.locator('.cg-canvas .cg-root')).to_be_visible(timeout=30000)
        await shot(page, f'live-{name}')
        await page.locator('.cg-canvas .cg-card').first.click()
        await expect(page.locator('.cg-why')).to_be_visible()
        await shot(page, f'live-{name}-panneau')
        assert errors == [], errors
        await context.close()
        print(f'OK : carte réelle {name}')


async def run():
    with tempfile.TemporaryDirectory(prefix='movix-cinegraph-') as directory:
        work = Path(directory) / 'carte'
        broken = Path(directory) / 'carte-absente'
        work.mkdir()
        build_fixture(work)
        if not LIVE:
            broken.mkdir()
            build_fixture(broken, broken_canvas=True)
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                await check_map(browser, work)
                if not LIVE:
                    await check_fullscreen(browser, work)
                    await check_map_reduced(browser, work)
                await check_mobile(browser, work)
                await check_mobile(browser, work, reduced=True)
                if LIVE:
                    await check_live_maps(browser, work)
                else:
                    await check_broken_canvas(browser, broken)
            finally:
                await browser.close()


if __name__ == '__main__':
    asyncio.run(run())
