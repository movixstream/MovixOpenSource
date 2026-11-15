package com.movix.tv.data.account

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class AccountApiTest {
    private val server = MockWebServer()
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }
    private lateinit var api: AccountApi

    @Before
    fun setUp() {
        server.start()
        api = AccountApi(OkHttpClient(), json, server.url("/"))
    }

    @After
    fun tearDown() = server.close()

    // Compte VIP avec une clé datée : un ancien serveur renvoie `expiresAt` en
    // millisecondes (BIGINT). La lecture doit passer, sinon la liaison est perdue.
    @Test
    fun `poll approuvé lu avec une date VIP en nombre`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"status":"approved","token":"jwt","userType":"oauth","userId":"u1",
            "profileId":"p1","profile":{"id":"p1","name":"Alice","avatar":null,"ageRestriction":0},
            "vip":{"active":true,"expiresAt":1823758332500,"accessKey":"VIP-1"}}""").build())
        val poll = api.poll("d".repeat(43))
        assertEquals("approved", poll.status)
        assertEquals("jwt", poll.token)
        assertEquals("VIP-1", poll.vip?.accessKey)
    }

    @Test
    fun `poll approuvé lu avec une date VIP en ISO`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"status":"approved","token":"jwt","userType":"oauth","userId":"u1",
            "profileId":"p1","vip":{"active":true,"expiresAt":"2027-10-17T07:32:12.500Z","accessKey":"VIP-1"}}""").build())
        assertEquals("VIP-1", api.poll("d".repeat(43)).vip?.accessKey)
    }

    // Restriction d'âge du profil (profil enfant). Une valeur mal typée ne doit
    // ni faire échouer toute la réponse (liaison perdue, liste des profils vide),
    // ni passer pour « aucune restriction ».
    @Test
    fun `poll approuvé garde la restriction d'âge du profil`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"status":"approved","token":"jwt","userType":"oauth","userId":"u1",
            "profileId":"p1","profile":{"id":"p1","name":"Léa","avatar":null,"ageRestriction":12}}""").build())
        assertEquals(12, api.poll("d".repeat(43)).profile?.ageRestriction)
    }

    @Test
    fun `restriction d'âge lue même mal typée`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"success":true,"profiles":[
            {"id":"a","ageRestriction":12},{"id":"b","ageRestriction":"16"},{"id":"c","ageRestriction":7.0},
            {"id":"d"},{"id":"e","ageRestriction":null},{"id":"f","ageRestriction":"abc"},{"id":"g","ageRestriction":true}]}""").build())
        val list = api.profiles("jwt")
        assertEquals(listOf("a", "b", "c", "d", "e", "f", "g"), list.map { it.id })
        assertEquals(12, list[0].ageRestriction)
        assertEquals(16, list[1].ageRestriction)
        assertEquals(7, list[2].ageRestriction)
        assertEquals(null, list[3].ageRestriction)
        assertEquals(null, list[4].ageRestriction)
        // Illisible : la restriction la plus stricte du site, jamais « aucune ».
        assertEquals(com.movix.tv.data.age.AgeRules.UNREADABLE_LIMIT, list[5].ageRestriction)
        assertEquals(com.movix.tv.data.age.AgeRules.UNREADABLE_LIMIT, list[6].ageRestriction)
    }
}
