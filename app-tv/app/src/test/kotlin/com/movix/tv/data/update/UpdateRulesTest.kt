package com.movix.tv.data.update

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class UpdateRulesTest {
    @get:Rule val tmp = TemporaryFolder()

    private val sha = "a".repeat(64)
    private val url = "https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/tv/movix-tv.apk"

    private fun manifestJson(
        versionCode: String = "2",
        apkUrl: String = url,
        apkSize: String = "3500000",
        apkSha256: String = sha,
        minSdk: String = "25",
        notes: String = """{"fr":"Corrections","en":"Fixes"}""",
        drop: String? = null,
    ): String {
        val fields = linkedMapOf(
            "versionCode" to versionCode,
            "versionName" to "\"0.2.0\"",
            "apkUrl" to "\"$apkUrl\"",
            "apkSize" to apkSize,
            "apkSha256" to "\"$apkSha256\"",
            "minSdk" to minSdk,
            "notes" to notes,
        )
        drop?.let(fields::remove)
        return fields.entries.joinToString(",", "{", "}") { (k, v) -> "\"$k\":$v" }
    }

    private fun manifest(versionCode: Int = 2, minSdk: Int = 25) =
        UpdateManifest(versionCode, "0.2.0", url, 10, sha, minSdk, UpdateNotes("fr", "en"))

    // --- Comparaison de version ---

    @Test
    fun newerVersionIsAnUpdate() {
        assertTrue(UpdateRules.isUpdate(manifest(versionCode = 2), currentVersionCode = 1, sdkInt = 28))
    }

    @Test
    fun sameOrOlderVersionIsNotAnUpdate() {
        assertFalse(UpdateRules.isUpdate(manifest(versionCode = 2), currentVersionCode = 2, sdkInt = 28))
        assertFalse(UpdateRules.isUpdate(manifest(versionCode = 1), currentVersionCode = 2, sdkInt = 28))
    }

    @Test
    fun minSdkAboveDeviceIsNotAnUpdate() {
        assertFalse(UpdateRules.isUpdate(manifest(versionCode = 9, minSdk = 30), currentVersionCode = 1, sdkInt = 28))
        assertTrue(UpdateRules.isUpdate(manifest(versionCode = 9, minSdk = 28), currentVersionCode = 1, sdkInt = 28))
    }

    @Test
    fun laterHidesOnlyThatVersion() {
        assertTrue(UpdateRules.shouldPrompt(manifest(versionCode = 3), ignoredVersionCode = null))
        assertFalse(UpdateRules.shouldPrompt(manifest(versionCode = 3), ignoredVersionCode = 3))
        assertTrue(UpdateRules.shouldPrompt(manifest(versionCode = 4), ignoredVersionCode = 3))
    }

    @Test
    fun checkAtMostEvery12Hours() {
        val h = 60L * 60 * 1000
        assertTrue(UpdateRules.isCheckDue(null, 100 * h))
        assertFalse(UpdateRules.isCheckDue(100 * h, 111 * h))
        assertTrue(UpdateRules.isCheckDue(100 * h, 112 * h))
        // Horloge revenue en arrière (télé sans heure réseau) : on revérifie.
        assertTrue(UpdateRules.isCheckDue(100 * h, 50 * h))
    }

    // --- Validation d'URL ---

    @Test
    fun allowsHttpsGithubHosts() {
        assertTrue(UpdateRules.isAllowedApkUrl(url))
        assertTrue(UpdateRules.isAllowedApkUrl("https://github.com/movixstream/MovixOpenSource/raw/main/tv/movix-tv.apk"))
    }

    @Test
    fun refusesHttpOtherHostsAndTricks() {
        assertFalse(UpdateRules.isAllowedApkUrl(url.replace("https://", "http://")))
        assertFalse(UpdateRules.isAllowedApkUrl("https://evil.example/movix-tv.apk"))
        assertFalse(UpdateRules.isAllowedApkUrl("https://raw.githubusercontent.com.evil.example/x.apk"))
        assertFalse(UpdateRules.isAllowedApkUrl("https://evilraw.githubusercontent.com/x.apk"))
        assertFalse(UpdateRules.isAllowedApkUrl("https://raw.githubusercontent.com@evil.example/x.apk"))
        assertFalse(UpdateRules.isAllowedApkUrl("https://user:pw@raw.githubusercontent.com/x.apk"))
        assertFalse(UpdateRules.isAllowedApkUrl("https://raw.githubusercontent.com:8443/x.apk"))
        assertFalse(UpdateRules.isAllowedApkUrl("file:///sdcard/x.apk"))
        assertFalse(UpdateRules.isAllowedApkUrl("pas une url"))
    }

    @Test
    fun redirectsStayOnGithub() {
        assertTrue(UpdateRules.isAllowedRedirect("https://objects.githubusercontent.com/x".toHttpUrl()))
        assertTrue(UpdateRules.isAllowedRedirect(url.toHttpUrl()))
        assertFalse(UpdateRules.isAllowedRedirect("http://objects.githubusercontent.com/x".toHttpUrl()))
        assertFalse(UpdateRules.isAllowedRedirect("https://githubusercontent.com.evil.example/x".toHttpUrl()))
        assertFalse(UpdateRules.isAllowedRedirect("https://cdn.example.com/x".toHttpUrl()))
    }

    // --- Contrôle SHA-256 ---

    @Test
    fun sha256OfKnownContent() {
        val f = tmp.newFile("abc.apk").apply { writeText("abc") }
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", UpdateRules.sha256Hex(f))
    }

    @Test
    fun matchesChecksSizeAndHash() {
        val f = tmp.newFile("abc.apk").apply { writeText("abc") }
        val good = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        assertTrue(UpdateRules.matches(f, 3, good))
        assertTrue(UpdateRules.matches(f, 3, good.uppercase()))
        assertFalse(UpdateRules.matches(f, 4, good))
        assertFalse(UpdateRules.matches(f, 3, good.replaceFirst('b', 'c')))
        assertFalse(UpdateRules.matches(tmp.root.resolve("absent.apk"), 3, good))
    }

    // --- Parsing du manifeste ---

    @Test
    fun parsesCompleteManifest() {
        val m = UpdateRules.parseManifest(manifestJson(apkSha256 = sha.uppercase()))
        assertNotNull(m)
        assertEquals(2, m!!.versionCode)
        assertEquals("0.2.0", m.versionName)
        assertEquals(3_500_000L, m.apkSize)
        assertEquals(sha, m.apkSha256)
        assertEquals("Fixes", m.notesFor("en"))
        assertEquals("Corrections", m.notesFor("fr"))
        assertEquals("Corrections", m.notesFor("de"))
    }

    @Test
    fun ignoresUnknownFields() {
        assertNotNull(UpdateRules.parseManifest(manifestJson().dropLast(1) + ",\"mandatory\":false}"))
    }

    @Test
    fun missingFieldMeansNoUpdate() {
        for (field in listOf("versionCode", "versionName", "apkUrl", "apkSize", "apkSha256", "minSdk", "notes")) {
            assertNull("sans $field", UpdateRules.parseManifest(manifestJson(drop = field)))
        }
        assertNull(UpdateRules.parseManifest(manifestJson(notes = """{"fr":"seulement fr"}""")))
    }

    @Test
    fun invalidValuesMeanNoUpdate() {
        assertNull(UpdateRules.parseManifest(manifestJson(apkUrl = "https://evil.example/movix-tv.apk")))
        assertNull(UpdateRules.parseManifest(manifestJson(apkSha256 = "abc")))
        assertNull(UpdateRules.parseManifest(manifestJson(apkSize = "0")))
        assertNull(UpdateRules.parseManifest(manifestJson(apkSize = "999999999999")))
        assertNull(UpdateRules.parseManifest(manifestJson(versionCode = "0")))
        assertNull(UpdateRules.parseManifest(manifestJson(versionCode = "\"deux\"")))
        assertNull(UpdateRules.parseManifest(manifestJson(minSdk = "null")))
        assertNull(UpdateRules.parseManifest("<html>404</html>"))
        assertNull(UpdateRules.parseManifest(""))
    }
}
