package com.movix.extract

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * Runtime avec un faux userscript qui exerce les polyfills et le pont réseau
 * (sans réseau réel). Chaque vérification échoue avec son nom.
 */
class ExtractorRuntimeTest {
    private val fakeScript = """
        (function () {
          var failures = [];
          function check(name, cond) { if (!cond) failures.push(name); }
          globalThis.__MOVIX_PREPARE_CAST_SOURCE__ = function (r) { return { url: r.url, headers: { Referer: "https://lecteur.test/" }, protocolVersion: 1 }; };
          globalThis.movixExtractM3u8 = async function (type, url) {
            failures = [];
            // URL et URLSearchParams
            var u = new URL("/e/abc?x=1&y=a+b#h", url);
            check("url.href", u.href === "https://hote.test/e/abc?x=1&y=a+b#h");
            check("url.origin", u.origin === "https://hote.test");
            check("url.param", u.searchParams.get("y") === "a b");
            u.searchParams.set("x", "2");
            check("url.set", u.search === "?x=2&y=a+b");
            check("url.port", new URL("https://a.test:443/").port === "" && new URL("http://a.test:8080/").port === "8080");
            check("url.invalid", (function () { try { new URL("pas une url"); return false; } catch (e) { return e instanceof TypeError; } })());
            // Encodages
            var bytes = new TextEncoder().encode("héllo");
            check("encode.type", bytes instanceof Uint8Array && bytes.length === 6);
            check("decode", new TextDecoder().decode(bytes) === "héllo");
            check("base64", atob(btoa("abé")) === "abé" && atob("aGk") === "hi");
            // Minuteurs : ordre, annulation, intervalle
            var order = [];
            await new Promise(function (done) {
              setTimeout(function () { order.push(2); done(); }, 20);
              setTimeout(function () { order.push(1); }, 5);
              var t = setTimeout(function () { order.push("annulé"); }, 10);
              clearTimeout(t);
            });
            check("timers", order.join(",") === "1,2");
            var ticks = 0;
            await new Promise(function (done) { var i = setInterval(function () { if (++ticks === 3) { clearInterval(i); done(); } }, 5); });
            check("interval", ticks === 3);
            // AbortSignal.timeout
            var s = AbortSignal.timeout(5);
            await new Promise(function (done) { s.addEventListener("abort", done); });
            check("abort", s.aborted && s.reason.name === "TimeoutError");
            // crypto : SHA-256 et AES-CBC (vecteur NIST SP 800-38A F.2.1, premier bloc)
            var digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc")));
            check("sha256", digest[0] === 0xba && digest[31] === 0xad);
            var hex = function (h) { return new Uint8Array(h.match(/../g).map(function (x) { return parseInt(x, 16); })); };
            var key = await crypto.subtle.importKey("raw", hex("2b7e151628aed2a6abf7158809cf4f3c"), { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
            var iv = hex("000102030405060708090a0b0c0d0e0f");
            var plain = hex("6bc1bee22e409f96e93d7e117393172a");
            var enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv }, key, plain));
            check("aes.enc", enc[0] === 0x76 && enc[15] === 0x7d);
            var dec = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, enc));
            check("aes.dec", dec.length === 16 && dec[0] === 0x6b && dec[15] === 0x2a);
            // Pont réseau (arraybuffer comme gmFetch)
            var r = await new Promise(function (ok, ko) {
              GM_xmlhttpRequest({ method: "GET", url: url, headers: { "X-Test": "1" }, responseType: "arraybuffer", onload: ok, onerror: ko });
            });
            check("gm.status", r.status === 200 && r.finalUrl === url + "?final=1");
            check("gm.headers", /content-type: text\/plain/.test(r.responseHeaders));
            var body = new TextDecoder().decode(r.response);
            check("gm.body", body.indexOf("X-Test=1") >= 0);
            // Cale QuickJS : un second runtime natif, isolé
            var QuickJS = await __movixNativeQJS.getQuickJS();
            var rt = QuickJS.newRuntime();
            rt.setInterruptHandler(__movixNativeQJS.shouldInterruptAfterDeadline(Date.now() + 1000));
            var ctx = rt.newContext();
            ctx.evalCode("var secret = 6 * 7;", "a.js");
            var res = ctx.evalCode("JSON.stringify([secret, typeof GM_xmlhttpRequest])", "b.js");
            check("sandbox", ctx.dump(res.value) === '[42,"undefined"]');
            var loop = ctx.evalCode("while (true) {}", "boucle.js");
            check("sandbox.interrupt", !!loop.error);
            ctx.dispose(); rt.dispose();
            // Promesse rejetée sans gestionnaire : ne doit rien casser
            Promise.reject(new Error("oubliée"));
            if (failures.length) return { success: false, error: failures.join(",") };
            return { success: true, hlsUrl: "https://cdn.test/master.m3u8", subtitles: [{ url: "https://cdn.test/fr.vtt", label: "Français", lang: "fr", format: "vtt", default: true }] };
          };
        })();
    """.trimIndent()

    private val calls = AtomicInteger()
    private val bridge = HttpBridge { req ->
        calls.incrementAndGet()
        delay(10)
        BridgeResponse(200, "OK", listOf("Content-Type" to "text/plain"), req.url + "?final=1", ("X-Test=" + req.headers["X-Test"]).toByteArray())
    }

    @Test
    fun polyfillsBridgeAndSandboxWork() = runBlocking {
        val runtime = ExtractorRuntime(bridge, { fakeScript }, "UA-test", log = { _, _ -> })
        val r = runtime.extract("https://hote.test/e/1")
        assertNull(r.error, r.error)
        assertEquals("https://cdn.test/master.m3u8", r.url)
        assertEquals("https://lecteur.test/", r.headers["Referer"])
        assertEquals(true, r.isHls)
        assertEquals("fr", r.subtitles.single().lang)
        assertEquals(1, calls.get())
        // Le même runtime sert une seconde fois.
        assertTrue(runtime.extract("https://hote.test/e/2").ok)
        runtime.close()
    }

    @Test
    fun hangingExtractionTimesOutAndOthersStillWork() = runBlocking {
        val script = """
            globalThis.__MOVIX_PREPARE_CAST_SOURCE__ = function (r) { return { url: r.url, headers: {} }; };
            globalThis.movixExtractM3u8 = function (t, url) {
              if (url.indexOf("lent") >= 0) return new Promise(function () {});
              return Promise.resolve({ success: true, m3u8Url: "https://cdn.test/v.mp4" });
            };
        """.trimIndent()
        val runtime = ExtractorRuntime(bridge, { script }, "UA", log = { _, _ -> })
        val slow = runtime.extract("https://x.test/lent", timeoutMs = 300)
        assertEquals("timeout", slow.error)
        val fast = runtime.extract("https://x.test/vite")
        assertEquals(false, fast.isHls)
        runtime.close()
    }

    @Test
    fun patcherReportsMissingTarget() {
        val r = UserscriptPatcher.apply("rien à voir")
        assertEquals(listOf("quickjs-natif"), r.missing)
    }
}
