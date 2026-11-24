"""Régressions des en-têtes CDN, sans démarrer le serveur ni charger ses secrets."""

import ast
import asyncio
import base64
import binascii
import hashlib
import logging
from pathlib import Path
import random
import re
import sys
import time
from types import SimpleNamespace
import unittest
import urllib.parse
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urljoin, urlparse

import aiohttp
from aiohttp import ClientTimeout, web

PROXY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROXY_ROOT))
from uqload_utils import (
    extract_uqload_media_url,
    extract_uqload_subtitles,
    get_uqload_site_origin,
    normalize_uqload_embed_url,
    parse_allowed_uqload_url,
)


def load_proxy_headers():
    tree = ast.parse((PROXY_ROOT / 'server.py').read_text(encoding='utf-8-sig'))
    proxy_class = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'ProxyServer')
    methods = {
        '_prepare_headers', 'fsvid_proxy_handler', 'vidzy_proxy_handler', 'uqload_proxy_handler',
        'fsvid_extract_handler', 'vidzy_extract_handler', '_is_fsvid_vidzy_embed_url',
        '_extract_uqload_media_url', '_extract_uqload_media', '_validate_uqload_url',
        '_extract_m3u8_url', '_fsvid_vidzy_gate_urls', '_fsvid_vidzy_gate_key',
        '_with_fsvid_vidzy_gate_key', '_is_fsvid_vidzy_media_candidate',
        '_fetch_embed_page_via_socks', '_fsvid_vidzy_master_is_fake', '_extract_fsvid_vidzy_m3u8',
        '_is_retryable_egress_failure', '_service_proxy_via_random_socks',
        '_random_socks5_session_key',
    }
    proxy_class.body = [
        node for node in proxy_class.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in methods
        or isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id.startswith('RE_') for target in node.targets
        )
    ]
    constants = [
        node for node in tree.body if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name)
            and target.id.startswith(('FSVID_VIDZY_', '_FSVID_VIDZY_', 'PROVIDER_MEDIA_', 'EMBED_SOCKS_', 'SOCKS_EGRESS_'))
            for target in node.targets
        )
    ] + [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name.startswith('is_fsvid_vidzy_')
    ]
    module = ast.Module(body=[
        ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0),
        *constants, proxy_class,
    ], type_ignores=[])
    namespace = {
        're': re, 'urlparse': urlparse, 'urljoin': urljoin, 'random': random,
        'base64': base64, 'binascii': binascii,
        'get_uqload_site_origin': get_uqload_site_origin,
        'parse_allowed_uqload_url': parse_allowed_uqload_url,
        'normalize_uqload_embed_url': normalize_uqload_embed_url,
        'extract_uqload_media_url': extract_uqload_media_url,
        'extract_uqload_subtitles': extract_uqload_subtitles,
        'asyncio': asyncio, 'aiohttp': aiohttp, 'ClientTimeout': ClientTimeout,
        'web': web, 'hashlib': hashlib, 'urllib': urllib, 'time': time,
        '_signed_service_url': lambda route, url: url,
        'logger': logging.getLogger(__name__),
        'redact_url_for_log': lambda url: url,
        'CORS_HEADERS': {}, 'SELF_VALIDATED_PROXY_ROUTES': frozenset(),
    }
    exec(compile(ast.fix_missing_locations(module), 'server.py', 'exec'), namespace)
    proxy = namespace['ProxyServer']()
    proxy._fsvid_vidzy_gate_key_entry = None
    proxy._fsvid_vidzy_gate_lock = asyncio.Lock()
    proxy._socks_egress_penalties = {}
    proxy.ssl_context = None
    return proxy


class ProviderEncodingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.proxy = load_proxy_headers()

    def assert_media_encoding(self, provider, headers):
        if provider == 'uqload':
            self.assertEqual(
                headers.get('Accept-Encoding'),
                'identity, gzip;q=0, deflate;q=0, br;q=0, zstd;q=0',
            )
        else:
            # Fsvid/Vidzy servent un faux master à tout Accept-Encoding qui
            # n'est pas exactement celui de Chrome.
            self.assertEqual(headers.get('Accept-Encoding'), 'gzip, deflate, br, zstd')

    async def test_dedicated_and_generic_relays_use_the_same_encoding(self):
        proxy = self.proxy
        proxy._service_proxy = AsyncMock()
        proxy._service_proxy_via_random_socks = AsyncMock()
        for provider, host, origin in [
            ('fsvid', 'r1.fsvid.lol', 'https://fsvid.lol'),
            ('vidzy', 'u14.vidzy.cc', 'https://vidzy.org'),
            ('uqload', 'strm4.uqload.vc', 'https://uqload.vc'),
            ('uqload', 'strm1.uqload.bz', 'https://uqload.bz'),
        ]:
            with self.subTest(provider=provider, host=host):
                url = f'https://{host}/hls/master.m3u8?t=example&s=123&i=0.0'
                request = SimpleNamespace(query={'url': url}, headers={}, method='GET')
                await getattr(proxy, f'{provider}_proxy_handler')(request)
                # Les trois passent par le pool SOCKS : leur CDN refuse l'IP du serveur.
                dedicated = proxy._service_proxy_via_random_socks.call_args.args[2]
                generic = proxy._prepare_headers(url, request)
                for headers in (dedicated, generic):
                    self.assert_media_encoding(provider, headers)
                    self.assertEqual(headers['Origin'], origin)
                    self.assertEqual(headers['Referer'], f'{origin}/')

    async def test_extraction_leaves_compression_negotiation_to_aiohttp(self):
        proxy = self.proxy
        session = MagicMock()
        media = 'https://strm4.uqload.vc/hls/master.m3u8?t=example'
        session.get.return_value.__aenter__.return_value = SimpleNamespace(
            status=200, text=AsyncMock(return_value=f'<script>var sources=["{media}"];</script>'),
        )
        session.closed = False
        proxy.sessions = {'proxy_0': session}
        proxy._require_internal = lambda request: None
        proxy._check_vip = AsyncMock(return_value=True)
        proxy._resolve_fsvid_vidzy_m3u8 = AsyncMock(return_value=media)
        proxy._with_fsvid_vidzy_gate_key = AsyncMock(side_effect=lambda url, *args: url)
        for provider, host in [('fsvid', 'fsvid.lol'), ('vidzy', 'vidzy.org'), ('uqload', 'uqload.vc')]:
            with self.subTest(provider=provider):
                session.get.reset_mock()
                url = f'https://{host}/embed-example.html'
                if provider == 'uqload':
                    self.assertEqual(await proxy._extract_uqload_media_url(url), media)
                else:
                    setattr(proxy, f'{provider}_cache', SimpleNamespace(get=lambda key: None, set=lambda *args: None))
                    response = await getattr(proxy, f'{provider}_extract_handler')(SimpleNamespace(query={'url': url}))
                    self.assertEqual(response.status, 200)
                headers = session.get.call_args_list[0].kwargs['headers']
                self.assertNotIn('Accept-Encoding', headers)

    def test_rolling_xor_survives_a_misread_width_measurement(self):
        # Lecteur Vidzy d'octobre 2026 : la largeur mesurée est celle d'un
        # enfant à 50 % d'un parent en `calc(1in + 60px)`, soit 78 px et non
        # 156. Une graine mal relue doit quand même retrouver la vraie URL,
        # jamais le leurre `troll`.
        embed = 'https://vidzy.cc/embed-example.html'
        media = 'https://v6.vidzy.cc/hls2/01/00064/,example_n,.urlset/master.m3u8?t=token&s=1'
        host_sum = sum(map(ord, 'vidzy.cc')) & 255
        encrypted = bytes(
            ord(char) ^ ((0x3d + index * 89 + host_sum + 78) & 255)
            for index, char in enumerate(media)
        )[::-1]
        payload = base64.b64encode(encrypted).decode()
        script = (
            'sources: [{src: (function(s){var h=(location&&location.hostname)||"",H=0;'
            'for(var j=0;j<h.length;j++){H=(H+h.charCodeAt(j))&255;}var BC=0;try{'
            'var _p=document.createElement("div");_p.style.cssText="position:absolute;width:calc(1in + 60px)";'
            'var _ch=document.createElement("div");_ch.style.cssText="height:1px;width:50%";'
            '_p.appendChild(_ch);BC=_ch.offsetWidth|0;}catch(e){}'
            'var b=atob(s),a=b.split("").reverse().join(""),r="";'
            'for(var i=0;i<a.length;i++){var kk=(0x3d+i*89+H+BC)&255;'
            'r+=String.fromCharCode(a.charCodeAt(i)^kk)}'
            'return /^https?:/.test(r)?r:"https://v6.vidzy.cc/troll/master.m3u8"})'
            f'("{payload}"), type: "application/x-mpegURL"}}]'
        )
        self.assertEqual(self.proxy._extract_m3u8_url(script, embed), media)

    def test_vidzy_media_accepts_both_cdn_domains(self):
        # Le CDN Vidzy alterne entre u*.vidzy.cc et u*.vidzy.org.
        for host in ('u14.vidzy.cc', 'u14.vidzy.org'):
            url = f'https://{host}/hls2/05/00028/id_o/master.m3u8?t=x'
            with self.subTest(host=host):
                self.assertTrue(self.proxy._is_fsvid_vidzy_media_candidate(url, 'vidzy'))
                self.assertFalse(self.proxy._is_fsvid_vidzy_media_candidate(url, 'fsvid'))
        self.assertFalse(self.proxy._is_fsvid_vidzy_media_candidate(
            'https://u14.vidzy.org/troll/master.m3u8', 'vidzy'))


class FakeGateSession:
    """Session aiohttp minimale : chaque porte répond par son entrée de `replies`."""

    def __init__(self, replies):
        self.replies = replies
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        reply = self.replies[url.split('?', 1)[0]]
        session = self

        class Context:
            async def __aenter__(self):
                if isinstance(reply, Exception):
                    raise reply
                status, payload = reply
                return SimpleNamespace(
                    status=status,
                    url=url,
                    json=AsyncMock(return_value=payload),
                    text=AsyncMock(return_value=payload if isinstance(payload, str) else ''),
                )

            async def __aexit__(self, *exc):
                return False

        return Context()


class FsvidVidzyGateKeyTests(unittest.IsolatedAsyncioTestCase):
    MASTER = 'https://u14.vidzy.cc/hls2/06/00065/id_n/master.m3u8?t=tok&s=1&e=14400&f=2&i=0.0&sp=0'
    KEY = 'uPkLjE6iV6vLOUDFlpmYqrXzbcHX_nVDwW6Ut3pRupA.1792771707.86400'
    VIDZY_PAGE = "<script>fetch('https://v7.vidzy.cc/gate.php?'+d,{mode:'cors'})</script>"
    REAL_MASTER = (
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720\n'
        'https://u14.vidzy.cc/hls2/06/00065/id_n/index-v1-a1.m3u8?t=tok&s=1\n'
    )
    # Master leurre du 2026-11-21 : variante `index.m3u8` sans jeton.
    FAKE_MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720\nindex.m3u8\n'

    def _extracting_proxy(self, provider, egresses):
        proxy = load_proxy_headers()
        proxy.sessions = {'normal': FakeGateSession({}), **egresses}
        proxy._require_internal = lambda request: None
        proxy._check_vip = AsyncMock(return_value=True)
        proxy._resolve_fsvid_vidzy_m3u8 = AsyncMock(return_value=self.MASTER)
        proxy._fsvid_vidzy_gate_key_entry = (self.KEY, time.monotonic() + 60)
        cache = MagicMock()
        cache.get.return_value = None
        setattr(proxy, f'{provider}_cache', cache)
        return proxy, cache

    async def test_extraction_switches_egress_when_the_token_is_marked(self):
        # Mesuré le 2026-11-21 : le jeton `t=` est marqué selon l'IP qui ouvre
        # la page ; le master leurre reste leurre lu depuis n'importe quelle IP.
        embed = 'https://fsvid.lol/embed-example.html'
        master = self.MASTER.split('?', 1)[0]
        marked = FakeGateSession({embed: (200, '<html></html>'), master: (200, self.FAKE_MASTER)})
        clean = FakeGateSession({embed: (200, '<html></html>'), master: (200, self.REAL_MASTER)})
        proxy, cache = self._extracting_proxy('fsvid', {'proxy_1': marked, 'proxy_2': clean})
        with patch.object(random, 'shuffle', lambda keys: keys.sort()):
            response = await proxy.fsvid_extract_handler(SimpleNamespace(query={'url': embed}))
        self.assertEqual(response.status, 200)
        self.assertIn('gk=', response.text)
        self.assertTrue(cache.set.called)
        self.assertEqual(marked.calls[0], embed)
        self.assertEqual(clean.calls[0], embed)

    async def test_extraction_reports_a_decoy_when_every_egress_is_marked(self):
        embed = 'https://vidzy.cc/embed-example.html'
        master = self.MASTER.split('?', 1)[0]
        egresses = {
            f'proxy_{index}': FakeGateSession({embed: (200, '<html></html>'), master: (200, self.FAKE_MASTER)})
            for index in range(2)
        }
        proxy, cache = self._extracting_proxy('vidzy', egresses)
        response = await proxy.vidzy_extract_handler(SimpleNamespace(query={'url': embed}))
        self.assertEqual(response.status, 502)
        self.assertFalse(cache.set.called)
        self.assertTrue(all(session.calls for session in egresses.values()))
        self.assertEqual(proxy.sessions['normal'].calls, [])

    def setUp(self):
        self.proxy = load_proxy_headers()

    async def test_key_is_appended_and_shared_between_providers(self):
        # Relevé du 2026-10-23 : sans `gk`, 403 dès le 10e segment (u14) ou le
        # 20e (v6, r1.fsvid.lol) ; avec, les 40 premiers passent.
        session = FakeGateSession({'https://v7.vidzy.cc/gate.php': (200, {'ok': 1, 'gk': self.KEY})})
        self.proxy.sessions = {'normal': session}
        url = await self.proxy._with_fsvid_vidzy_gate_key(self.MASTER, self.VIDZY_PAGE, 'vidzy')
        self.assertEqual(url, f'{self.MASTER}&gk={self.KEY}')
        # La porte inscrite dans la page passe d'abord, avec une empreinte de
        # vrai Chrome : une empreinte sans canvas reçoit `{"ok":0}`.
        query = urllib.parse.parse_qs(session.calls[0].split('?', 1)[1], keep_blank_values=True)
        self.assertEqual(query['cw'], ['159.56'])
        self.assertEqual(query['ft'], ['TOP'])
        # La clé ne dépend pas de la vidéo : Fsvid réutilise la même, sans
        # rappeler la porte.
        fsvid_master = 'https://r1.fsvid.lol/hls2/01/00031/id_n/master.m3u8?t=x'
        fsvid_url = await self.proxy._with_fsvid_vidzy_gate_key(fsvid_master, '', 'fsvid')
        self.assertEqual(fsvid_url, f'{fsvid_master}&gk={self.KEY}')
        self.assertEqual(len(session.calls), 1)
        # Déjà porteuse d'une clé : l'URL ne change pas.
        self.assertEqual(await self.proxy._with_fsvid_vidzy_gate_key(url, '', 'vidzy'), url)

    async def test_falls_back_to_the_other_gate_then_pauses_after_a_failure(self):
        session = FakeGateSession({
            'https://fsvid.lol/gk': aiohttp.ClientError('down'),
            'https://v6.vidzy.cc/gate.php': (200, {'ok': 1, 'gk': self.KEY}),
        })
        self.proxy.sessions = {'normal': session}
        master = 'https://r1.fsvid.lol/hls2/01/00031/id_n/master.m3u8?t=x'
        self.assertEqual(
            await self.proxy._with_fsvid_vidzy_gate_key(master, '', 'fsvid'),
            f'{master}&gk={self.KEY}',
        )

        refused = FakeGateSession({
            'https://fsvid.lol/gk': (200, {'ok': 0}),
            'https://v6.vidzy.cc/gate.php': (200, {'ok': 0}),
        })
        proxy = load_proxy_headers()
        proxy.sessions = {'normal': refused}
        self.assertEqual(await proxy._with_fsvid_vidzy_gate_key(master, '', 'fsvid'), master)
        self.assertEqual(len(refused.calls), 2)
        # Pendant la panne, une nouvelle extraction ne rappelle pas les portes.
        self.assertEqual(await proxy._with_fsvid_vidzy_gate_key(master, '', 'fsvid'), master)
        self.assertEqual(len(refused.calls), 2)

    async def test_extraction_caches_only_a_keyed_url(self):
        for provider, host, gate in [
            ('vidzy', 'vidzy.cc', 'https://v6.vidzy.cc/gate.php'),
            ('fsvid', 'fsvid.lol', 'https://fsvid.lol/gk'),
        ]:
            for reply, expect_key in [((200, {'ok': 1, 'gk': self.KEY}), True), ((200, {'ok': 0}), False)]:
                with self.subTest(provider=provider, keyed=expect_key):
                    proxy = load_proxy_headers()
                    embed = f'https://{host}/embed-example.html'
                    other = 'https://fsvid.lol/gk' if provider == 'vidzy' else 'https://v6.vidzy.cc/gate.php'
                    # Page et porte par la même sortie SOCKS ; jamais en direct
                    # (une session `normal` vide lèverait KeyError).
                    egress = FakeGateSession({
                        embed: (200, '<html></html>'), gate: reply, other: reply,
                        self.MASTER.split('?', 1)[0]: (200, self.REAL_MASTER),
                    })
                    direct = FakeGateSession({})
                    proxy.sessions = {'normal': direct, 'proxy_3': egress}
                    proxy._require_internal = lambda request: None
                    proxy._check_vip = AsyncMock(return_value=True)
                    proxy._resolve_fsvid_vidzy_m3u8 = AsyncMock(return_value=self.MASTER)
                    cache = MagicMock()
                    cache.get.return_value = None
                    setattr(proxy, f'{provider}_cache', cache)
                    response = await getattr(proxy, f'{provider}_extract_handler')(
                        SimpleNamespace(query={'url': embed}),
                    )
                    self.assertEqual(response.status, 200)
                    self.assertEqual('gk=' in response.text, expect_key)
                    self.assertEqual(cache.set.called, expect_key)
                    self.assertEqual(direct.calls, [])
                    self.assertEqual(egress.calls[0], embed)
                    self.assertTrue(any(call.startswith(gate) for call in egress.calls[1:]))


class SocksRelayRetryTests(unittest.IsolatedAsyncioTestCase):
    """Relais Uqload/Fsvid/Vidzy : une sortie refusée est remplacée puis évitée."""

    def _relay(self, replies):
        proxy = load_proxy_headers()
        proxy.sessions = {'normal': object(), **{key: SimpleNamespace(closed=False) for key in replies}}
        proxy._require_signature = lambda request, url: None
        used = []

        async def service_proxy(request, service_name, headers, session_key):
            used.append(session_key)
            status = replies[session_key]
            if status == 200:
                return web.Response(body=b'#EXTM3U\n', status=200)
            return web.json_response({'error': f'Upstream HTTP error: {status}'}, status=status)

        proxy._service_proxy = service_proxy
        return proxy, used

    async def test_refused_egress_is_replaced_then_avoided(self):
        proxy, used = self._relay({'proxy_0': 403, 'proxy_1': 200})
        request = SimpleNamespace(method='GET', path='/uqload-proxy', query={'url': 'https://strm12.uqload.vc/x.m3u8'})
        with patch.object(random, 'choice', lambda keys: sorted(keys)[0]):
            response = await proxy._service_proxy_via_random_socks(request, 'uqload', {})
            self.assertEqual(response.status, 200)
            self.assertEqual(used, ['proxy_0', 'proxy_1'])
            # Requête suivante : la sortie refusée est évitée d'emblée.
            used.clear()
            response = await proxy._service_proxy_via_random_socks(request, 'uqload', {})
        self.assertEqual(response.status, 200)
        self.assertEqual(used, ['proxy_1'])

    async def test_missing_file_is_not_retried(self):
        proxy, used = self._relay({'proxy_0': 404, 'proxy_1': 200})
        request = SimpleNamespace(method='GET', path='/uqload-proxy', query={'url': 'https://strm12.uqload.vc/x.m3u8'})
        with patch.object(random, 'choice', lambda keys: sorted(keys)[0]):
            response = await proxy._service_proxy_via_random_socks(request, 'uqload', {})
        self.assertEqual(response.status, 404)
        self.assertEqual(used, ['proxy_0'])


def load_decoy_helpers():
    tree = ast.parse((PROXY_ROOT / 'server.py').read_text(encoding='utf-8-sig'))
    names = {
        'is_fsvid_vidzy_decoy_url', 'is_fsvid_vidzy_decoy_playlist', '_FSVID_VIDZY_DECOY_PATH',
        'is_fsvid_vidzy_fake_master', '_FSVID_VIDZY_VIDEO_CODE',
    }
    body = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in names
        or isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in names for target in node.targets
        )
    ]
    namespace = {'re': re, 'urlparse': urlparse, 'urljoin': urljoin}
    exec(compile(ast.Module(body=body, type_ignores=[]), 'server.py', 'exec'), namespace)
    return namespace


class FsvidVidzyDecoyTests(unittest.TestCase):
    def setUp(self):
        self.helpers = load_decoy_helpers()

    def test_decoy_urls(self):
        is_decoy = self.helpers['is_fsvid_vidzy_decoy_url']
        for url in [
            'https://s1.fsvid.lol/troll/master.m3u8',
            'https://v6.vidzy.cc/troll/master.m3u8',
            'https://s1.fsvid.lol/e/seg0.ts',
            'https://u14.vidzy.cc/e/seg8.ts',
        ]:
            with self.subTest(url=url):
                self.assertTrue(is_decoy(url))
        for url in [
            'https://s1.fsvid.lol/hls2/01/00031/cq02gw2dbv0t_n/seg-1-v1-a1.ts?t=x',
            'https://u14.vidzy.cc/hls2/05/00064/,id_n,.urlset/master.m3u8?t=x',
            'https://example.com/e/seg0.ts',
        ]:
            with self.subTest(url=url):
                self.assertFalse(is_decoy(url))

    def test_decoy_playlist_served_with_200(self):
        # Playlist relevée le 2026-10-15 à l'URL réelle du master quand la
        # requête portait `Accept-Encoding: identity, gzip;q=0, …`.
        decoy = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n' + ''.join(
            f'#EXTINF:2.0,\nhttps://s1.fsvid.lol/e/seg{index}.ts\n' for index in range(9)
        ) + '#EXT-X-ENDLIST\n'
        master = 'https://s1.fsvid.lol/hls2/01/00031/,id_n,.urlset/master.m3u8?t=x'
        is_decoy_playlist = self.helpers['is_fsvid_vidzy_decoy_playlist']
        self.assertTrue(is_decoy_playlist(decoy, master))
        self.assertTrue(is_decoy_playlist(decoy.replace('https://s1.fsvid.lol', ''), master))
        real = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex-v1-a1.m3u8?t=x\n'
        self.assertFalse(is_decoy_playlist(real, master))
        self.assertFalse(is_decoy_playlist('#EXTM3U\n', master))

    def test_fake_master_that_loops_on_itself(self):
        # Relevé le 2026-11-09 en prod : le master d'une vidéo pointe vers la
        # variante `index.m3u8` d'une autre, qui renvoie ce même master.
        is_fake = self.helpers['is_fsvid_vidzy_fake_master']
        target = 'https://v6.vidzy.org/hls2/03/00064/d51sasae2ik1_o/master.m3u8?t=x&gk=k'
        fake = (
            '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720\n'
            'https://u14.vidzy.org/hls2/07/00064/kt9yhz08i92s_o/index.m3u8\n'
        )
        self.assertTrue(is_fake(fake, target, target))
        # La variante qui répond par un master : même boucle.
        variant = 'https://u14.vidzy.org/hls2/07/00064/kt9yhz08i92s_o/index.m3u8'
        self.assertTrue(is_fake(fake, variant, variant))
        # Autre forme, relevée via les SOCKS de prod : même vidéo, variante
        # `index.m3u8` sans jeton.
        same_video = fake.replace('07/00064/kt9yhz08i92s_o', '03/00064/d51sasae2ik1_o')
        self.assertTrue(is_fake(same_video, target, target))

        real = (
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=604440\n'
            'https://v6.vidzy.org/hls2/03/00064/d51sasae2ik1_o/index-v1-a1.m3u8?t=x\n'
            '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="iframes-v1-a1.m3u8?t=x"\n'
        )
        self.assertFalse(is_fake(real, target, target))
        urlset = 'https://r1.fsvid.lol/hls2/03/00004/,96z2sojktgc1_n,lang/eng/96z2sojktgc1_eng,.urlset/master.m3u8?t=x'
        self.assertFalse(is_fake(
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex-v1-a1.m3u8?t=x\n', urlset, urlset,
        ))
        media = '#EXTM3U\n#EXTINF:10,\nseg-1-v1-a1.ts?t=x\n'
        self.assertFalse(is_fake(media, variant, variant))


if __name__ == '__main__':
    unittest.main()
