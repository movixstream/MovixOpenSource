package com.movix.tv.data.movix

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class VipManagerTest {
    private val server = MockWebServer()
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private var stored: String? = null
    private lateinit var api: MovixApi

    @Before
    fun setUp() {
        server.start()
        api = MovixApi(OkHttpClient(), json, server.url("/"))
    }

    @After
    fun tearDown() = server.close()

    private fun manager(scope: CoroutineScope, a: MovixApi = api) = VipManager(a, scope, { stored }, { stored = it })

    @Test
    fun submitSendsHeaderWithoutOriginAndStoresKey() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"vip":true,"expiresAt":"2027-01-01T00:00:00.000Z","duration":"1y","reason":null}""").build())
        val vip = manager(backgroundScope)
        assertEquals(VipSubmitResult.OK, vip.submit("  VIP-abc "))
        val req = server.takeRequest()
        assertEquals("/api/check-vip", req.url.encodedPath)
        assertEquals("VIP-abc", req.headers["x-access-key"])
        assertNull(req.headers["Origin"]); assertNull(req.headers["Referer"])
        assertEquals("VIP-abc", stored)
        assertTrue(vip.state.value.vip)
        assertEquals("2027-01-01T00:00:00.000Z", vip.state.value.expiresAt)
        assertEquals("VIP-abc", vip.activeKey)
    }

    @Test
    fun invalidKeyIsNotStored() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"vip":false,"expiresAt":null,"duration":null,"reason":null}""").build())
        assertEquals(VipSubmitResult.INVALID, manager(backgroundScope).submit("VIP-bad"))
        assertNull(stored)
    }

    @Test
    fun refreshWithVipFalseClearsKey() = runTest {
        stored = "VIP-old"
        server.enqueue(MockResponse.Builder().body("""{"vip":false,"reason":"expired"}""").build())
        val vip = manager(backgroundScope)
        vip.restore()
        assertTrue(vip.state.value.vip)
        vip.refresh()
        assertNull(stored)
        assertFalse(vip.state.value.vip)
        assertNull(vip.activeKey)
    }

    @Test
    fun networkErrorKeepsState() = runTest {
        stored = "VIP-old"
        // Port fermé : connexion refusée tout de suite.
        val vip = manager(backgroundScope, MovixApi(OkHttpClient(), json, "http://127.0.0.1:1/".toHttpUrl()))
        vip.restore()
        vip.refresh()
        assertEquals("VIP-old", stored)
        assertTrue(vip.state.value.vip)
        assertEquals(VipSubmitResult.NETWORK, vip.submit("VIP-new"))
        assertEquals("VIP-old", stored)
    }

    @Test
    fun serverErrorKeepsState() = runTest {
        stored = "VIP-old"
        server.enqueue(MockResponse.Builder().code(500).body("""{"vip":false,"error":"Erreur interne"}""").build())
        val vip = manager(backgroundScope)
        vip.restore()
        vip.refresh()
        assertEquals("VIP-old", stored)
        assertTrue(vip.state.value.vip)
    }
}
