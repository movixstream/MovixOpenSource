"""Mise en page de B et interactions, dans une fixture hors réseau et sans serveur."""
import asyncio
import base64
import importlib.util
import os
import struct
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

spec = importlib.util.spec_from_file_location('wrapped_motion', Path(__file__).with_name('wrappedMotion.browser.py'))
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)


async def check_export(page, format_name='story', download_label='Télécharger', artifact_prefix=''):
    preview = page.locator('[data-wrapped-card-preview]')
    await preview.wait_for()
    await page.wait_for_function('document.querySelector("[data-wrapped-card-preview]")?.naturalWidth > 0')
    encoded = await preview.evaluate('''async image => {
        const blob=await (await fetch(image.src)).blob();
        return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob)});
    }''')
    async with page.expect_download() as pending:
        await page.get_by_role('button', name=download_label, exact=True).click()
    download = await pending.value
    exported = Path(await download.path()).read_bytes()
    assert exported == base64.b64decode(encoded), 'Le téléchargement doit reprendre exactement le PNG de l’aperçu'
    assert struct.unpack('>II', exported[16:24]) == (1080, 1620 if format_name == 'poster' else 1920)
    output = os.environ.get('WRAPPED_QA_OUTPUT')
    if output:
        directory = Path(output).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f'export-{artifact_prefix}{format_name}.png').write_bytes(exported)


async def verify(work):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            for width, height in [(360, 640), (390, 844), (768, 768), (1366, 768), (1920, 1080)]:
                context = await browser.new_context(viewport={'width': width, 'height': height}, reduced_motion='reduce')

                async def route(request):
                    url = urlparse(request.request.url)
                    if url.hostname == 'image.tmdb.org':
                        # Affiche synthétique pour rendre les limites des images visibles.
                        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#23405a"/><circle cx="300" cy="350" r="180" fill="#bf9764"/><path d="M0 900L300 480L600 900" fill="#16212c"/><text x="300" y="810" fill="#fff" text-anchor="middle" font-size="44">MOVIX · FIXTURE</text></svg>'
                        await request.fulfill(body=svg, content_type='image/svg+xml', headers={'Access-Control-Allow-Origin': '*'} )
                        return
                    file = (work / (url.path.lstrip('/') or 'index.html')).resolve()
                    if url.hostname != 'wrapped.test' or not file.is_relative_to(work) or not file.is_file():
                        await request.abort()
                        return
                    await request.fulfill(path=str(file), content_type={'.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html'}.get(file.suffix, 'application/octet-stream'))

                await context.route('**/*', route)
                page = await context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto('https://wrapped.test/')
                await page.evaluate('document.fonts.ready')
                assert await page.locator('#outside').evaluate('button => button.inert')
                await page.get_by_role('button', name='Fermer le Wrapped', exact=True).focus()
                await page.keyboard.press('Shift+Tab')
                assert await page.evaluate('document.activeElement.closest("main") !== null')
                count = int(await page.get_by_role('progressbar').get_attribute('aria-valuemax'))
                for index in range(count):
                    await page.wait_for_function('document.querySelectorAll("[data-wrapped-scene]").length === 1')
                    await page.wait_for_timeout(230)
                    dimensions = await page.evaluate('''() => {
                        const scene=document.querySelector('[data-wrapped-scene]');
                        const rect=scene.getBoundingClientRect();
                        return {name:scene.dataset.wrappedScene, width:scene.clientWidth, scrollWidth:scene.scrollWidth,
                            overflow:scene.scrollHeight-scene.clientHeight, rect:[rect.x,rect.y,rect.width,rect.height]};
                    }''')
                    assert dimensions['scrollWidth'] <= dimensions['width'] + 2, (width, height, dimensions)
                    if dimensions['name'] in ['intro', 'quiz', 'favorite', 'rhythm', 'closing']:
                        assert dimensions['overflow'] <= 8, (width, height, 'simple-scene-scroll', dimensions)
                    if dimensions['name'] == 'quiz':
                        buttons = page.locator('[data-wrapped-scene="quiz"] button[aria-pressed]')
                        assert await buttons.count() == 3
                        await buttons.first.focus()
                        await page.keyboard.press('Space')
                        assert await page.locator('[data-wrapped-scene="quiz"] [role="status"]').inner_text()
                        assert await page.get_by_role('progressbar').get_attribute('aria-valuenow') == str(index + 1)
                        assert await page.get_by_role('button', name='Découvrir mon numéro 1', exact=True).is_visible()
                        await page.wait_for_timeout(60)
                        assert await page.locator('[data-wrapped-scene="quiz"]').evaluate('scene => scene.scrollHeight - scene.clientHeight <= 8'), (width, height, 'quiz-answer-overflow')
                    if dimensions['name'] == 'closing':
                        await page.locator('[data-wrapped-card-preview]').wait_for()
                        assert await page.get_by_role('button', name='Partager', exact=True).is_enabled()
                        # Le film est proposé directement sur la carte, sans ouvrir les options.
                        assert await page.get_by_role('button', name='Ton film · 18 s', exact=True).is_visible()
                        summary = page.get_by_text('Autres formats et statistiques', exact=True)
                        await summary.focus()
                        await page.keyboard.press('Space')
                        assert await page.get_by_role('group', name='Choisis ton format', exact=True).is_visible()
                        if width == 1366:
                            options = page.get_by_role('group', name='Choisis ton format', exact=True).get_by_role('button')
                            for item, format_name in enumerate(['story', 'top-five', 'poster', 'ticket']):
                                await options.nth(item).click()
                                await check_export(page, format_name)
                            await options.first.click()
                            await page.locator('[data-wrapped-card-preview]').wait_for()
                        await summary.click()
                        await page.wait_for_timeout(100)
                        assert not await page.get_by_text('Faire défiler la suite', exact=True).is_visible()
                    output = os.environ.get('WRAPPED_QA_OUTPUT')
                    if output and dimensions['name'] in ['intro', 'rhythm', 'quiz', 'closing']:
                        directory = Path(output).resolve()
                        directory.mkdir(parents=True, exist_ok=True)
                        await page.screenshot(path=str(directory / f'{width}-{height}-{dimensions["name"]}.png'))
                    if index < count - 1:
                        await page.get_by_role('button', name='Scène suivante', exact=True).click()
                await page.keyboard.press('Escape')
                await page.locator('main').wait_for(state='detached')
                assert not await page.locator('#outside').evaluate('button => button.inert')
                assert await page.evaluate('document.activeElement.id') == 'outside'
                assert await page.evaluate('document.documentElement.style.overflow') == ''
                assert not errors, errors
                print(f'{width}x{height}: {count} scènes, devinette clavier, partage et options vérifiés', flush=True)
                await context.close()

            context = await browser.new_context(viewport={'width': 360, 'height': 640}, reduced_motion='reduce')
            await context.route('**/*', route)
            page = await context.new_page()
            for scenario in ['english&edge', 'english&empty']:
                await page.goto('https://wrapped.test/?' + scenario)
                await page.evaluate('document.fonts.ready')
                await page.evaluate('document.documentElement.style.fontSize="24px"')
                count = int(await page.get_by_role('progressbar').get_attribute('aria-valuemax'))
                for index in range(count):
                    await page.wait_for_function('document.querySelectorAll("[data-wrapped-scene]").length === 1')
                    await page.wait_for_timeout(200)
                    assert await page.locator('[data-wrapped-scene]').evaluate('scene => scene.scrollWidth <= scene.clientWidth + 2'), (scenario, index, 'horizontal-overflow')
                    if index < count - 1:
                        await page.get_by_role('button', name='Next scene', exact=True).click()
                await check_export(page, download_label='Download', artifact_prefix=scenario.replace('&', '-') + '-')
                print(f'{scenario}: textes agrandis, défilement accessible et export vérifiés', flush=True)
            await context.close()
        finally:
            await browser.close()


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='movix-wrapped-layout-') as directory:
        work = Path(directory).resolve()
        motion.build_fixture(work)
        asyncio.run(verify(work))
