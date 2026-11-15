"""Relais Streamed signé : SOCKS5, playlists HD et segments PNG/WebP."""

import asyncio
import ipaddress
import logging
import random
import re
import socket
import time
from urllib.parse import urlencode, urljoin, urlsplit

from aiohttp import ClientTimeout, TCPConnector, web
from aiohttp.resolver import DefaultResolver
from python_socks.async_.asyncio import Proxy
from yarl import URL

from media_signing import compute_signature, is_public_http_url, verify_request

ROUTE = '/streamed-proxy'
REFERERS = ('https://embed.st/', 'https://exposestrat.com/')
MAX_BODY = 32 * 1024 * 1024
USER_AGENT = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36')
logger = logging.getLogger(__name__)


def media_url(value):
    parsed = urlsplit(value)
    host = parsed.hostname or ''
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port
            or any(c.isspace() or ord(c) < 32 for c in value)
            or not host or not is_public_http_url(value)):
        raise ValueError('Invalid Streamed destination')
    return value


class StreamedResolver(DefaultResolver):
    async def resolve(self, host, port=0, family=socket.AF_INET):
        answers = await super().resolve(host, port, family)
        if not answers or any(not ipaddress.ip_address(item['host']).is_global for item in answers):
            raise OSError('Non-public Streamed destination')
        return answers


class StreamedSocksConnector(TCPConnector):
    """DNS validé une seule fois ; SOCKS reçoit l'IP et TLS garde le nom CDN.

    aiohttp-socks 0.9 remplace le resolver par NoResolver. Le socket SOCKS
    est donc ouvert ici via python-socks, puis confié à aiohttp pour TLS/HTTP.
    """
    def __init__(self, proxy_url):
        if urlsplit(proxy_url).scheme != 'socks5':
            raise ValueError('Streamed requires SOCKS5')
        self._streamed_resolver = StreamedResolver()
        super().__init__(resolver=self._streamed_resolver, family=socket.AF_INET, limit=100, ttl_dns_cache=60)
        self._streamed_proxy = Proxy.from_url(proxy_url, rdns=False)

    async def close(self, **kwargs):
        try:
            await super().close(**kwargs)
        finally:
            await self._streamed_resolver.close()

    async def _wrap_create_connection(self, *args, addr_infos, req, timeout, client_error=None, **kwargs):
        address = addr_infos[0][4]
        if not ipaddress.ip_address(address[0]).is_global:
            raise OSError('Non-public Streamed destination')
        sock = await self._streamed_proxy.connect(dest_host=address[0], dest_port=address[1], timeout=timeout.sock_connect)
        try:
            # server_hostname et ssl sont fournis par TCPConnector : le
            # certificat est vérifié pour le nom d'origine, jamais pour l'IP.
            return await self._loop.create_connection(*args, sock=sock, **kwargs)
        except BaseException:
            sock.close()
            raise


def select_variant(text):
    lines = text.split('\n')
    variants = []
    pending = None
    for index, line in enumerate(lines):
        value = line.strip()
        if value.startswith('#EXT-X-STREAM-INF:'):
            bandwidth = re.search(r'(?:^|,)BANDWIDTH=(\d+)(?:,|$)', value[18:])
            pending = (index, int(bandwidth[1]) if bandwidth else 0)
        elif value and not value.startswith('#') and pending is not None:
            variants.append((*pending, index))
            pending = None
    if len(variants) < 2:
        return text
    selected = max(variants, key=lambda variant: variant[1])
    removed = {index for variant in variants if variant != selected for index in (variant[0], variant[2])}
    return '\n'.join(line for index, line in enumerate(lines) if index not in removed)


def unwrap_segment(body):
    png = body.startswith(b'\x89PNG')
    webp = body[:4] == b'RIFF' and body[8:12] == b'WEBP'
    if not png and not webp:
        return body
    for offset in range(min(len(body) - 188, 65536)):
        if (body[offset] == body[offset + 188] == 0x47
                and (offset + 376 >= len(body) or body[offset + 376] == 0x47)):
            return body[offset:]
    raise ValueError('Invalid Streamed segment')


def signed_url(url, referer, expires):
    media_url(url)
    return ROUTE + '?' + urlencode({
        'url': url, 'referer': referer, 'exp': expires,
        'sig': compute_signature(ROUTE, url, expires),
    })


def rewrite_playlist(text, base, referer, expires):
    def register(value):
        return signed_url(urljoin(base, value), referer, expires)

    def rewrite(line):
        value = line.strip()
        if not value:
            return line
        if value.startswith('#'):
            return re.sub(r'URI="([^"]+)"', lambda match: 'URI="' + register(match[1]) + '"', line)
        return register(value)

    return '\n'.join(rewrite(line) for line in select_variant(text).split('\n'))


class StreamedProxy:
    def __init__(self, sessions, cors_headers):
        self.sessions = sessions
        self.headers = {**cors_headers, 'Cache-Control': 'private, no-store'}
        self._pending = {}

    async def pull(self, url, referer):
        # Partage uniquement les téléchargements simultanés, jamais le cache
        # de cinq secondes des autres playlists du service.
        key = (url, referer)
        task = self._pending.get(key)
        if task is None:
            task = asyncio.create_task(self._pull(url, referer))
            self._pending[key] = task

            def finished(done):
                self._pending.pop(key, None)
                if not done.cancelled():
                    done.exception()  # Un client déconnecté ne laisse pas de rejet orphelin.

            task.add_done_callback(finished)
        return await asyncio.shield(task)

    async def _pull(self, url, referer):
        for _ in range(5):
            media_url(url)
            pool = [session for key, session in self.sessions.items()
                    if key.startswith('streamed_') and not session.closed]
            if not pool:
                raise LookupError('Streamed SOCKS5 unavailable')
            session = random.choice(pool)
            async with session.get(URL(url, encoded=True), headers={
                'Referer': referer, 'Origin': referer.rstrip('/'), 'User-Agent': USER_AGENT,
            }, allow_redirects=False, timeout=ClientTimeout(total=20, connect=5, sock_connect=5, sock_read=15)) as response:
                if response.status in (301, 302, 303, 307, 308):
                    location = response.headers.get('Location')
                    if not location:
                        raise ValueError('Invalid Streamed redirect')
                    url = urljoin(url, location)
                    continue
                if not 200 <= response.status < 300:
                    # Ni URL signée ni identifiants SOCKS dans les logs.
                    logger.warning('[STREAMED-PROXY] host=%s status=%s', urlsplit(url).hostname, response.status)
                    raise ValueError('Streamed upstream error')
                body = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    body.extend(chunk)
                    if len(body) > MAX_BODY:
                        raise ValueError('Streamed response too large')
                return bytes(body), url
        raise ValueError('Too many Streamed redirects')

    async def handler(self, request):
        if request.method == 'OPTIONS':
            return web.Response(headers=self.headers)
        url = request.query.get('url', '')
        valid, _ = verify_request(request, ROUTE, url)
        if not valid:
            return web.Response(status=403, headers=self.headers)
        try:
            expires = int(request.query['exp'])
            referer = request.query.get('referer', REFERERS[0])
            if expires <= time.time() or referer not in REFERERS:
                return web.Response(status=403, headers=self.headers)
            media_url(url)
        except (ValueError, TypeError):
            return web.Response(status=403, headers=self.headers)
        try:
            body, base = await self.pull(url, referer)
            if body[:32].lstrip().startswith(b'#EXTM3U'):
                playlist = rewrite_playlist(body.decode('utf-8'), base, referer, expires)
                return web.Response(text=playlist, content_type='application/vnd.apple.mpegurl', headers=self.headers)
            body = unwrap_segment(body)
            return web.Response(body=body, content_type='video/mp2t' if body[:1] == b'G' else 'application/octet-stream', headers=self.headers)
        except LookupError:
            return web.Response(status=503, text='Streamed SOCKS5 unavailable', headers=self.headers)
        except Exception as error:
            logger.warning('[STREAMED-PROXY] host=%s error=%s', urlsplit(url).hostname, type(error).__name__)
            return web.Response(status=502, text='Streamed unavailable', headers=self.headers)

    async def close(self, _app):
        tasks = list(self._pending.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
