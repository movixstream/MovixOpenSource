"""Bac à sable QuickJS Fsvid/Vidzy : mise en page simulée et cycle de vie du worker."""

import asyncio
import base64
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

PROXY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROXY_ROOT))
import fsvid_vidzy_sandbox  # noqa: E402
from fsvid_vidzy_sandbox import execute_player_scripts  # noqa: E402

HAS_QUICKJS = importlib.util.find_spec('quickjs') is not None
EMBED_URL = 'https://vidzy.cc/embed-example.html'
MEDIA_URL = 'https://v6.vidzy.cc/hls2/01/00064/,example_n,.urlset/master.m3u8?t=token&s=1'
DECOY_URL = 'https://v6.vidzy.cc/troll/master.m3u8'


def encode_for(media, host, measured):
    """Chiffre `media` comme le lecteur d'octobre 2026 (XOR glissant inversé)."""
    host_sum = sum(map(ord, host)) & 255
    encrypted = bytes(
        ord(char) ^ ((0x3d + index * 89 + host_sum + measured) & 255)
        for index, char in enumerate(media)
    )[::-1]
    return base64.b64encode(encrypted).decode()


def player_page(measurement_js, payload):
    """Page minimale : `measurement_js` doit affecter la mesure à `BC`."""
    return (
        '<html><body><video id="vplayer"></video><script>'
        'var player = videojs("vplayer");'
        'player.src({sources:[{src:(function(s){var h=(location&&location.hostname)||"",H=0;'
        'for(var j=0;j<h.length;j++){H=(H+h.charCodeAt(j))&255;}var BC=0;try{'
        + measurement_js +
        '}catch(e){}'
        'var b=atob(s),a=b.split("").reverse().join(""),r="";'
        'for(var i=0;i<a.length;i++){var kk=(0x3d+i*89+H+BC)&255;'
        'r+=String.fromCharCode(a.charCodeAt(i)^kk)}'
        f'return /^https?:/.test(r)?r:"{DECOY_URL}"}})("{payload}"),'
        'type:"application/x-mpegURL"}]});'
        '</script></body></html>'
    )


# Mesure exacte du lecteur Vidzy : enfant à 50 % d'un parent absolu en
# `calc(1in + 60px)`, attaché au body → 78 px dans Chrome.
VIDZY_MEASUREMENT = (
    'var _p=document.createElement("div");'
    '_p.style.cssText="position:absolute;visibility:hidden;left:-9999px;padding:0;border:0;margin:0;'
    'width:calc(1in + 60px)";'
    'var _ch=document.createElement("div");'
    '_ch.style.cssText="padding:0;border:0;margin:0;height:1px;width:50%";'
    '_p.appendChild(_ch);(document.body||document.documentElement).appendChild(_p);'
    'BC=_ch.offsetWidth|0;if(_p.parentNode)_p.parentNode.removeChild(_p);'
)

# Variante inventée : bloc statique en `calc(50vw - 2rem)` (608 px) avec
# padding et bordure, enfant en `calc(25% + 10px)` + padding, mesuré par
# getBoundingClientRect. Chrome : 608 × 25 % + 10 + 2 × 4 = 170 px.
GENERIC_MEASUREMENT = (
    'var wrap=document.createElement("section");'
    'wrap.style.width="calc(50vw - 2rem)";wrap.style.padding="0 10px";wrap.style.border="2px solid red";'
    'var probe=document.createElement("div");'
    'probe.setAttribute("style","width:calc(25% + 10px);padding-left:4px;padding-right:4px");'
    'wrap.appendChild(probe);document.body.appendChild(wrap);'
    'BC=probe.getBoundingClientRect().width|0;wrap.remove();'
)

# Variante en border-box imbriquée et em : parent 20em (320 px) en
# border-box avec 10 px de padding (contenu 300), enfant 2/3 → 200 px.
NESTED_MEASUREMENT = (
    'var outer=document.createElement("div");'
    'outer.style.cssText="box-sizing:border-box;width:20em;padding:10px;font-size:16px";'
    'var inner=document.createElement("div");inner.style.width="calc(100% * 2 / 3)";'
    'outer.appendChild(inner);document.documentElement.appendChild(outer);'
    'BC=inner.clientWidth;'
)

# Un élément jamais attaché au document ne génère aucune boîte : 0 px.
DETACHED_MEASUREMENT = (
    'var lone=document.createElement("div");lone.style.width="calc(1in + 60px)";'
    'BC=lone.offsetWidth|0;'
)


@unittest.skipUnless(HAS_QUICKJS, 'paquet python « quickjs » absent')
class SandboxLayoutTests(unittest.IsolatedAsyncioTestCase):
    async def assert_decodes(self, measurement_js, measured):
        payload = encode_for(MEDIA_URL, 'vidzy.cc', measured)
        result = await execute_player_scripts(player_page(measurement_js, payload), EMBED_URL, 'vidzy')
        self.assertIn(MEDIA_URL, result.candidates, result)
        self.assertFalse(any('troll' in candidate for candidate in result.candidates))

    async def test_vidzy_half_of_calc_measurement(self):
        await self.assert_decodes(VIDZY_MEASUREMENT, 78)

    async def test_other_calc_percentage_and_box_model(self):
        await self.assert_decodes(GENERIC_MEASUREMENT, 170)

    async def test_border_box_and_em_units(self):
        await self.assert_decodes(NESTED_MEASUREMENT, 200)

    async def test_detached_element_measures_zero(self):
        await self.assert_decodes(DETACHED_MEASUREMENT, 0)

    async def test_wrong_measurement_only_yields_rejected_decoy(self):
        # Clé chiffrée pour 79 px alors que la page en mesure 78 : le lecteur
        # rend son leurre, qui ne doit jamais remonter comme candidat.
        payload = encode_for(MEDIA_URL, 'vidzy.cc', 79)
        result = await execute_player_scripts(player_page(VIDZY_MEASUREMENT, payload), EMBED_URL, 'vidzy')
        self.assertEqual(result.candidates, ())
        self.assertEqual(result.error, 'no_valid_candidate')

    async def test_deferred_player_setup_runs_after_load(self):
        # Lecteur initialisé dans DOMContentLoaded puis un setTimeout : la
        # boucle d'événements simulée doit les jouer après le script.
        html = (
            '<script>document.addEventListener("DOMContentLoaded",function(){'
            'setTimeout(function(){Promise.resolve().then(function(){'
            f'jwplayer("p").setup({{file:"{MEDIA_URL}"}});'
            '});},500);});</script>'
        )
        result = await execute_player_scripts(html, EMBED_URL, 'vidzy')
        self.assertEqual(result.candidates, (MEDIA_URL,))


class SandboxProcessLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_request_kills_worker(self):
        spawned = []
        original = asyncio.create_subprocess_exec

        async def tracking_exec(*args, **kwargs):
            process = await original(*args, **kwargs)
            spawned.append(process)
            return process

        with tempfile.TemporaryDirectory() as directory:
            sleeper = Path(directory) / 'sleeper.py'
            sleeper.write_text('import time\ntime.sleep(30)\n', encoding='utf-8')
            with patch.object(fsvid_vidzy_sandbox, '_WORKER_PATH', sleeper), \
                    patch.object(fsvid_vidzy_sandbox.asyncio, 'create_subprocess_exec', tracking_exec):
                task = asyncio.create_task(
                    execute_player_scripts('<script>videojs("x")</script>', EMBED_URL, 'vidzy')
                )
                for _ in range(100):
                    if spawned:
                        break
                    await asyncio.sleep(0.02)
                self.assertTrue(spawned, 'le worker n’a pas démarré')
                await asyncio.sleep(0.1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task

        self.assertIsNotNone(spawned[0].returncode, 'le worker tourne encore après l’annulation')


if __name__ == '__main__':
    unittest.main()
