"""Vérifie la configuration et les routes sans démarrer le serveur ni lire le .env."""

import ast
import asyncio
import json
import logging
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from aiohttp import web

PROXY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROXY_ROOT))
from debrid_providers import DEBRID_PROVIDERS, get_enabled_debrid_providers


class ProviderConfigurationTests(unittest.TestCase):
    def test_default_and_explicit_empty(self):
        self.assertEqual(get_enabled_debrid_providers(None), ['deepbrid'])
        self.assertEqual(get_enabled_debrid_providers(''), [])
        self.assertEqual(get_enabled_debrid_providers(' , '), [])

    def test_preserves_order_normalizes_and_deduplicates(self):
        self.assertEqual(
            get_enabled_debrid_providers(' Debrid-R,REAL-DEBRID,deepbrid,realdebrid,bestdebrid '),
            ['debridr', 'realdebrid', 'deepbrid'],
        )

    def test_unknown_services_never_enable_a_fallback(self):
        self.assertEqual(get_enabled_debrid_providers('unknown,alldebrid'), [])


class ProviderRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        tree = ast.parse((PROXY_ROOT / 'server.py').read_text(encoding='utf-8-sig'))
        proxy_class = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'ProxyServer')
        proxy_class.body = [node for node in proxy_class.body if isinstance(node, ast.AsyncFunctionDef)
                            and node.name in ('debrid_providers_handler', 'debrid_unlock_handler')]
        self.namespace = {
            'Request': object, 'Response': object, 'web': web, 'asyncio': asyncio,
            'logger': logging.getLogger(__name__), 'DEBRID_PROVIDERS': DEBRID_PROVIDERS,
            'DEBRID_ENABLED_PROVIDERS': ['deepbrid'],
        }
        exec(compile(ast.Module(body=[proxy_class], type_ignores=[]), 'debrid_handlers', 'exec'), self.namespace)
        self.proxy = self.namespace['ProxyServer']()
        self.proxy._require_internal = lambda request: None
        self.proxy._check_vip = AsyncMock(return_value=True)
        self.proxy._vip_denied_response = lambda: web.json_response({'error': 'VIP requis'}, status=403)
        self.proxy._unlock_with_deepbrid = AsyncMock(return_value=web.json_response({'status': 'success'}))
        self.proxy._unlock_with_realdebrid = AsyncMock()
        self.proxy._unlock_with_debridr = AsyncMock()
        self.request = SimpleNamespace(json=AsyncMock(return_value={'link': 'https://1fichier.com/?example'}))

    async def test_list_contains_only_configuration_and_is_not_cached(self):
        response = await self.proxy.debrid_providers_handler(self.request)
        self.assertEqual(json.loads(response.text), {'status': 'success', 'providers': ['deepbrid']})
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.namespace['DEBRID_ENABLED_PROVIDERS'] = []
        response = await self.proxy.debrid_providers_handler(self.request)
        self.assertEqual(json.loads(response.text)['providers'], [])

    async def test_both_routes_require_internal_key_and_vip(self):
        for route in ('debrid_providers_handler', 'debrid_unlock_handler'):
            with self.subTest(route=route):
                self.proxy._require_internal = lambda request: web.json_response({}, status=401)
                self.assertEqual((await getattr(self.proxy, route)(self.request)).status, 401)
                self.proxy._require_internal = lambda request: None
                self.proxy._check_vip.return_value = False
                self.assertEqual((await getattr(self.proxy, route)(self.request)).status, 403)
                self.proxy._check_vip.return_value = True
        self.request.json.assert_not_awaited()

    async def test_disabled_provider_is_refused_before_unlock(self):
        for provider in ('realdebrid', 'debridr'):
            with self.subTest(provider=provider):
                self.request.json.return_value['provider'] = provider
                response = await self.proxy.debrid_unlock_handler(self.request)
                self.assertEqual(response.status, 403)
        self.proxy._unlock_with_deepbrid.assert_not_awaited()
        self.proxy._unlock_with_realdebrid.assert_not_awaited()
        self.proxy._unlock_with_debridr.assert_not_awaited()

    async def test_default_provider_can_be_enabled_or_disabled(self):
        self.assertEqual((await self.proxy.debrid_unlock_handler(self.request)).status, 200)
        self.proxy._unlock_with_deepbrid.assert_awaited_once_with('https://1fichier.com/?example', '')
        self.namespace['DEBRID_ENABLED_PROVIDERS'] = []
        self.assertEqual((await self.proxy.debrid_unlock_handler(self.request)).status, 403)

    async def test_reenabled_real_debrid_uses_existing_connector(self):
        self.namespace['DEBRID_ENABLED_PROVIDERS'] = ['realdebrid']
        self.request.json.return_value['provider'] = 'real-debrid'
        await self.proxy.debrid_unlock_handler(self.request)
        self.proxy._unlock_with_realdebrid.assert_awaited_once_with('https://1fichier.com/?example', '')
        self.proxy._unlock_with_deepbrid.assert_not_awaited()

    async def test_removed_bestdebrid_is_rejected(self):
        self.assertNotIn('bestdebrid', DEBRID_PROVIDERS)
        self.request.json.return_value['provider'] = 'bestdebrid'
        self.assertEqual((await self.proxy.debrid_unlock_handler(self.request)).status, 400)
        self.proxy._unlock_with_deepbrid.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
