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

    // Mode enfant réglé depuis la télé. Le serveur ne touche qu'aux champs
    // envoyés : seul `ageRestriction` part, sinon le nom ou l'avatar du profil
    // seraient réécrits par la télé.
    @Test
    fun `restriction d'âge d'un profil envoyée seule au serveur`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"success":true,"profile":{"id":"p1","name":"Léa",
            "avatar":"/avatars/disney/disney_avatar_1.png","ageRestriction":12}}""").build())
        val profile = api.updateProfileAge("jwt", "p1", 12)
        val req = server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("/api/profiles/p1", req.url.encodedPath)
        assertEquals("Bearer jwt", req.headers["Authorization"])
        assertEquals("""{"ageRestriction":12}""", req.body?.utf8())
        assertEquals(12, profile.ageRestriction)
        assertEquals("Léa", profile.name)
    }

    @Test
    fun `mode enfant coupé envoie zéro, pas un champ absent`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"success":true,"profile":{"id":"p1","ageRestriction":0}}""").build())
        api.updateProfileAge("jwt", "p1", 0)
        // Champ absent : le serveur répondrait 400 (« Name, avatar, or ageRestriction is required »).
        assertEquals("""{"ageRestriction":0}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `profil créé depuis la télé avec nom, avatar et restriction`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"success":true,"profile":{"id":"new","name":"Enfant",
            "avatar":"/avatars/pixar/pixar_avatar_1.png","ageRestriction":7,"isDefault":false}}""").build())
        val profile = api.createProfile("jwt", "Enfant", "/avatars/pixar/pixar_avatar_1.png", 7)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/profiles", req.url.encodedPath)
        assertEquals("Bearer jwt", req.headers["Authorization"])
        val sent = json.parseToJsonElement(req.body!!.utf8()) as kotlinx.serialization.json.JsonObject
        assertEquals(setOf("name", "avatar", "ageRestriction"), sent.keys)
        assertEquals("\"Enfant\"", sent["name"].toString())
        assertEquals("\"/avatars/pixar/pixar_avatar_1.png\"", sent["avatar"].toString())
        assertEquals("7", sent["ageRestriction"].toString())
        assertEquals("new", profile.id)
        assertEquals(7, profile.ageRestriction)
    }

    // Refus du serveur (5 profils déjà, nom refusé) : à distinguer d'une panne, pour le dire à l'écran.
    @Test
    fun `création refusée par le serveur distinguée d'une panne`() = runTest {
        server.enqueue(MockResponse.Builder().code(400).body("""{"error":"Maximum 5 profiles allowed"}""").build())
        val refused = runCatching { api.createProfile("jwt", "Enfant", "/avatars/pixar/pixar_avatar_1.png", 7) }.exceptionOrNull()
        assertEquals(true, refused is ProfileRefusedException)

        server.enqueue(MockResponse.Builder().code(500).body("""{"error":"Failed to create profile"}""").build())
        val broken = runCatching { api.createProfile("jwt", "Enfant", "/avatars/pixar/pixar_avatar_1.png", 7) }.exceptionOrNull()
        assertEquals(true, broken is java.io.IOException && broken !is ProfileRefusedException)
    }

    @Test
    fun `session supprimée pendant le réglage du mode enfant`() = runTest {
        server.enqueue(MockResponse.Builder().code(401).body("""{"error":"Unauthorized"}""").build())
        val error = runCatching { api.updateProfileAge("jwt", "p1", 12) }.exceptionOrNull()
        assertEquals(true, error is SessionRevokedException)
    }

    // Réponse sans le profil (serveur en panne partielle) : une erreur, pas un profil inventé.
    @Test
    fun `réponse sans profil refusée`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"success":true}""").build())
        val error = runCatching { api.updateProfileAge("jwt", "p1", 12) }.exceptionOrNull()
        assertEquals(true, error is java.io.IOException)
    }
}
