"""Relais signé et transport SOCKS Streamed, sans réseau ni secrets locaux."""

import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlsplit

from aiohttp.test_utils import make_mocked_request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import media_signing
import streamed_proxy as streamed

MASTER = ('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=700000\nlow.m3u8\n'
          '#EXT-X-STREAM-INF:BANDWIDTH=8000000\nhigh.m3u8\n')
BASE = 'https://lb1.strmd.st/live/master.m3u8'
REF = 'https://embed.st/'
TS = b'G' + bytes(187) + b'G' + bytes(187) + b'G' + bytes(187)


class Upstream:
    def __init__(self, body=b'', status=200, headers=None):
        self.status, self.headers = status, headers or {}
        self.content = self
        self.body = body
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        self.closed = True

    async def iter_chunked(self, size):
        for offset in range(0, len(self.body), size):
            yield self.body[offset:offset + size]


class StreamedProxyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.secret = patch.object(media_signing, 'SIGNING_SECRET', 'streamed-test-secret')
        self.secret.start()
        self.addCleanup(self.secret.stop)
        self.expires = int(time.time()) + 60
        self.sessions = {}
        self.proxy = streamed.StreamedProxy(self.sessions, {'Access-Control-Allow-Origin': '*'})

    def request(self, url=BASE, referer=REF, expires=None):
        return make_mocked_request('GET', streamed.signed_url(url, referer, expires or self.expires))

    def session(self, *responses):
        return SimpleNamespace(closed=False, get=MagicMock(side_effect=responses))

    async def test_signature_node_matches_python_and_target_cannot_change(self):
        repo = ROOT.parents[1]
        code = ("const s=require('./API/Mainapi/utils/mediaSigning');"
                "process.stdout.write(s.buildSignedProxyUrl('https://proxy.test','/streamed-proxy',"
                + json.dumps(BASE) + ",{ttlSeconds:60,extraParams:{referer:'https://embed.st/'}}));")
        signed = subprocess.check_output(['node', '-e', code], cwd=repo,
                                         env={**os.environ, 'MEDIA_SIGNING_SECRET': 'streamed-test-secret'}, text=True)
        request = make_mocked_request('GET', signed)
        self.proxy.pull = AsyncMock(return_value=(b'#EXTM3U\n#EXTINF:6,\nseg.ts\n', BASE))
        self.assertEqual((await self.proxy.handler(request)).status, 200)
        forged = signed.replace('master.m3u8', 'other.m3u8')
        self.assertEqual((await self.proxy.handler(make_mocked_request('GET', forged))).status, 403)
        self.assertEqual(self.proxy.pull.await_count, 1)

    async def test_unsigned_expired_missing_secret_and_bad_referer_do_not_pull(self):
        self.proxy.pull = AsyncMock()
        for request in [make_mocked_request('GET', '/streamed-proxy?url=' + BASE),
                        self.request(expires=int(time.time()) - 1), self.request(referer='https://evil.test/')]:
            self.assertEqual((await self.proxy.handler(request)).status, 403)
        valid = self.request()
        with patch.object(media_signing, 'SIGNING_SECRET', ''):
            self.assertEqual((await self.proxy.handler(valid)).status, 403)
        self.proxy.pull.assert_not_awaited()

    async def test_master_one_quality_all_children_keep_original_expiration(self):
        self.proxy.pull = AsyncMock(return_value=(MASTER.encode(), BASE))
        response = await self.proxy.handler(self.request())
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
        self.assertEqual(response.text.count('#EXT-X-STREAM-INF:'), 1)
        child = next(line for line in response.text.splitlines() if line.startswith('/streamed-proxy'))
        query = parse_qs(urlsplit(child).query)
        self.assertEqual(query['url'], ['https://lb1.strmd.st/live/high.m3u8'])
        self.assertEqual(query['exp'], [str(self.expires)])
        self.assertTrue(media_signing.verify_signature(streamed.ROUTE, query['url'][0], query['exp'][0], query['sig'][0])[0])
        # Deux versions suffisent pour détecter une playlist figée entre les lectures.
        for seq in (25056, 25057):
            playlist = f'#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:{seq}\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg-{seq}.ts\n'
            self.proxy.pull.return_value = (playlist.encode(), query['url'][0])
            refreshed = await self.proxy.handler(make_mocked_request('GET', child))
            self.assertIn(f'#EXT-X-MEDIA-SEQUENCE:{seq}', refreshed.text)
            self.assertEqual(refreshed.text.count(f'exp={self.expires}'), 2)

    async def test_normalizes_png_webp_and_preserves_keys(self):
        for source in [b'\x89PNG' + bytes(38) + TS, b'RIFF' + bytes(4) + b'WEBP' + bytes(30) + TS, TS]:
            self.proxy.pull = AsyncMock(return_value=(source, BASE))
            response = await self.proxy.handler(self.request())
            self.assertEqual(response.body, TS)
            self.assertEqual(response.content_type, 'video/mp2t')
        key = bytes(range(16))
        self.proxy.pull.return_value = (key, BASE)
        self.assertEqual((await self.proxy.handler(self.request())).body, key)

    async def test_rotation_redirect_validation_no_direct_fallback(self):
        normal = self.session(Upstream(TS))
        first = self.session(Upstream(status=302, headers={'Location': 'next.m3u8'}))
        second = self.session(Upstream(TS))
        self.sessions.update(normal=normal, streamed_0=first, streamed_1=second)
        with patch.object(streamed.random, 'choice', side_effect=[first, second]) as choice:
            self.assertEqual(await self.proxy.pull(BASE, REF), (TS, 'https://lb1.strmd.st/live/next.m3u8'))
            self.assertEqual(choice.call_count, 2)
        normal.get.assert_not_called()
        for session in (first, second):
            options = session.get.call_args.kwargs
            self.assertFalse(options['allow_redirects'])
            self.assertEqual(options['headers']['Referer'], REF)
            self.assertNotIn('Cookie', options['headers'])
        self.sessions.clear()
        self.assertEqual((await self.proxy.handler(self.request())).status, 503)

    async def test_allowlist_covers_redirects_and_playlist_resources(self):
        for url in ['https://127.0.0.1/a', 'https://cdn.strmd.st.evil.test/a',
                    'http://cdn.strmd.st/a', 'https://user@lb1.strmd.st/a', 'https://lb1.strmd.st:123/a']:
            with self.assertRaises(ValueError):
                streamed.media_url(url)
        session = self.session(Upstream(status=302, headers={'Location': 'https://127.0.0.1/secret'}))
        self.sessions['streamed_0'] = session
        self.assertEqual((await self.proxy.handler(self.request())).status, 502)
        self.assertEqual(session.get.call_count, 1)
        with self.assertRaises(ValueError):
            streamed.rewrite_playlist('#EXTM3U\nhttps://evil.test/a.ts\n', BASE, REF, self.expires)

    async def test_bounded_body_failure_and_invalid_wrapper(self):
        upstream = Upstream(b'x' * 1025)
        self.sessions['streamed_0'] = self.session(upstream)
        with patch.object(streamed, 'MAX_BODY', 1024):
            self.assertEqual((await self.proxy.handler(self.request())).status, 502)
        self.assertTrue(upstream.closed)
        self.proxy.pull = AsyncMock(return_value=(b'\x89PNGinvalid', BASE))
        self.assertEqual((await self.proxy.handler(self.request())).status, 502)

    async def test_concurrent_requests_share_work_and_cancellation_does_not_abort_other_viewer(self):
        waiting = asyncio.Event()
        async def fetch(*_):
            await waiting.wait()
            return TS, BASE
        self.proxy._pull = AsyncMock(side_effect=fetch)
        first = asyncio.create_task(self.proxy.pull(BASE, REF))
        second = asyncio.create_task(self.proxy.pull(BASE, REF))
        await asyncio.sleep(0)
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        waiting.set()
        self.assertEqual(await second, (TS, BASE))
        await self.proxy.pull(BASE, REF)
        self.assertEqual(self.proxy._pull.await_count, 2)

    async def test_dns_rejects_mixed_public_private_answers(self):
        resolver = streamed.StreamedResolver()
        try:
            with patch.object(streamed.DefaultResolver, 'resolve', new=AsyncMock(return_value=[{'host': '1.1.1.1'}, {'host': '127.0.0.1'}])):
                with self.assertRaises(OSError):
                    await resolver.resolve('cdn.strmd.st')
        finally:
            await resolver.close()

    async def test_socks_connects_to_validated_ip_and_tls_keeps_cdn_name(self):
        connector = streamed.StreamedSocksConnector('socks5://127.0.0.1:1080')
        sock = MagicMock()
        connector._streamed_proxy = SimpleNamespace(connect=AsyncMock(return_value=sock))
        try:
            with patch.object(connector._loop, 'create_connection', new=AsyncMock(return_value=('transport', 'protocol'))) as create:
                await connector._wrap_create_connection('factory', addr_infos=[(socket.AF_INET, 0, 0, '', ('1.1.1.1', 443))],
                                                        req=None, timeout=SimpleNamespace(sock_connect=5), ssl=True, server_hostname='lb1.strmd.st')
                connector._streamed_proxy.connect.assert_awaited_once_with(dest_host='1.1.1.1', dest_port=443, timeout=5)
                self.assertEqual(create.call_args.kwargs['server_hostname'], 'lb1.strmd.st')
                self.assertTrue(create.call_args.kwargs['ssl'])
                self.assertIs(create.call_args.kwargs['sock'], sock)
                create.side_effect = OSError('TLS failed')
                with self.assertRaises(OSError):
                    await connector._wrap_create_connection('factory', addr_infos=[(socket.AF_INET, 0, 0, '', ('1.1.1.1', 443))], req=None, timeout=SimpleNamespace(sock_connect=5))
                sock.close.assert_called_once()
        finally:
            await connector.close()


if __name__ == '__main__':
    unittest.main()
