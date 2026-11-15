package com.movix.tv.ui.embed

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import java.io.ByteArrayInputStream

/**
 * Ce que le lecteur web demande au bloqueur. Voir
 * `docs/plans/2026-10-15-phase6-embed-souris-bloqueur.md`.
 */
interface EmbedFilter {
    /** `null` = laisser passer, `""` = bloquer, sinon URL `data:` de remplacement. */
    fun check(url: String, sourceUrl: String, type: String): String?
    /** JSON `{"css","script","generichide"}` de la frame [url], ou `null`. */
    fun cosmetic(url: String): String?
    /**
     * Sélecteurs à cacher (séparés par des virgules) pour ces classes et ids,
     * ou `null`. [exceptions] : tableau `exceptions` du JSON cosmétique de la frame.
     */
    fun hidden(classes: Array<String>, ids: Array<String>, exceptions: Array<String>): String?
}

/**
 * Page d'un lecteur embed en plein écran, pilotée au D-pad par une souris
 * virtuelle, derrière le bloqueur. Les touches arrivent par [onKey] (depuis
 * Compose) : la WebView n'a jamais le focus, les clics sont des touchers
 * synthétiques, ce qui marche aussi dans les iframes d'autres domaines.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class EmbedLayout(context: Context, private val filter: EmbedFilter?) : FrameLayout(context) {
    private val web = WebView(context)
    private val cursor = CursorView(context)
    private val density = resources.displayMetrics.density

    private var startUrl = ""
    private var startHost = ""
    @Volatile private var pageUrl = ""
    /** Après le premier clic, toute sortie vers un autre site est une pub. */
    private var userClicked = false
    // ---------- « aucune vidéo ne démarre » ----------
    /** Une vidéo a joué dans une frame (même une pub) : plus de bandeau. */
    private var videoPlayed = false
    /** Erreurs de syntaxe JS vues dans les frames : WebView trop ancienne pour ce lecteur. */
    private var syntaxErrors = 0
    private var loadedAt = 0L
    private var lastClickAt = 0L
    private var stuckReported = false
    /** Appelé (fil principal) quand rien ne joue ; [oldEngine] : la WebView est en cause. */
    var onStuck: ((oldEngine: Boolean) -> Unit)? = null
    /** Appelé (fil principal) à la première vidéo qui joue. */
    var onPlaying: (() -> Unit)? = null
    private val stuckCheck = object : Runnable {
        override fun run() {
            if (videoPlayed || stuckReported) return
            val now = SystemClock.uptimeMillis()
            val afterClick = lastClickAt > 0 && now - lastClickAt >= STUCK_AFTER_CLICK_MS
            val brokenOnLoad = syntaxErrors > 0 && now - loadedAt >= STUCK_ON_LOAD_MS
            if (afterClick || brokenOnLoad) {
                stuckReported = true
                onStuck?.invoke(syntaxErrors > 0 || webViewMajor(context) in 1 until MIN_WEBVIEW_MAJOR)
            } else {
                postDelayed(this, 1_000)
            }
        }
    }

    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null

    // ---------- curseur ----------
    private var cx = 0f
    private var cy = 0f
    private var dirX = 0
    private var dirY = 0
    private var heldSince = 0L
    private var lastFrame = 0L
    private var looping = false
    private val hideCursor = Runnable { cursor.animate().alpha(0f).setDuration(250).start() }

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (dirX == 0 && dirY == 0) { looping = false; return }
            val dt = if (lastFrame == 0L) 16f else ((frameTimeNanos - lastFrame) / 1_000_000f).coerceIn(4f, 50f)
            lastFrame = frameTimeNanos
            // Un appui bref = un pas fixe (déjà fait) ; tenue au-delà de 150 ms :
            // glissement continu, ×1 au départ puis ×4 après 0,6 s.
            val held = SystemClock.uptimeMillis() - heldSince - HOLD_DELAY_MS
            if (held > 0) {
                val speed = BASE_DP_PER_MS * density * (1f + 3f * (held / 600f).coerceAtMost(1f))
                moveBy(dirX * speed * dt, dirY * speed * dt)
            }
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    init {
        setBackgroundColor(android.graphics.Color.BLACK)
        addView(web, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(cursor, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
        web.isFocusable = false
        web.isFocusableInTouchMode = false
        setupWebView()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (oldw == 0) { cx = w / 2f; cy = h / 2f; placeCursor() }
    }

    /** [referer] : page d'où l'embed est censé venir (le lecteur YouTube l'exige, sinon « Erreur 153 »). */
    fun load(url: String, referer: String? = null) {
        startUrl = url
        startHost = Uri.parse(url).host.orEmpty()
        pageUrl = url
        loadedAt = SystemClock.uptimeMillis()
        if (referer != null) web.loadUrl(url, mapOf("Referer" to referer)) else web.loadUrl(url)
        showCursor()
        postDelayed(stuckCheck, 1_000)
    }

    /** « Rester sur ce lecteur » : le bandeau peut revenir après un nouveau clic sans vidéo. */
    fun dismissStuck() {
        stuckReported = false
        lastClickAt = 0L
        syntaxErrors = 0
        removeCallbacks(stuckCheck)
        postDelayed(stuckCheck, 1_000)
    }

    // ---------- touches ----------

    /** Touche du D-pad ou de la télécommande ; `true` si traitée. */
    fun onKey(keyCode: Int, down: Boolean, repeat: Int): Boolean {
        val dx = when (keyCode) { KEY_LEFT -> -1; KEY_RIGHT -> 1; else -> 0 }
        val dy = when (keyCode) { KEY_UP -> -1; KEY_DOWN -> 1; else -> 0 }
        if (dx != 0 || dy != 0) {
            if (down) {
                if (repeat == 0 || (dirX == 0 && dirY == 0)) {
                    if (dx != 0) dirX = dx
                    if (dy != 0) dirY = dy
                    if (repeat == 0) {
                        heldSince = SystemClock.uptimeMillis()
                        moveBy(dx * STEP_DP * density, dy * STEP_DP * density)
                    }
                    showCursor()
                    if (!looping) { looping = true; lastFrame = 0L; Choreographer.getInstance().postFrameCallback(frame) }
                }
            } else {
                if (dx != 0) dirX = 0
                if (dy != 0) dirY = 0
                showCursor()
            }
            return true
        }
        return when (keyCode) {
            KEY_CENTER, KEY_ENTER, KEY_NUM_ENTER -> { if (down && repeat == 0) click(); true }
            KEY_PLAY_PAUSE, KEY_PLAY, KEY_PAUSE -> { if (down) togglePlayback(); true }
            else -> false
        }
    }

    /** Retour : sortir du plein écran de la vidéo s'il est actif. `true` si consommé. */
    fun handleBack(): Boolean {
        if (customView != null) { customCallback?.onCustomViewHidden(); hideCustom(); return true }
        return false
    }

    private fun moveBy(dx: Float, dy: Float) {
        val w = width.toFloat()
        val h = height.toFloat()
        val nx = cx + dx
        val ny = cy + dy
        cx = nx.coerceIn(0f, w - 1)
        cy = ny.coerceIn(0f, h - 1)
        placeCursor()
        // Au bord : la page défile au lieu du curseur.
        val edge = EDGE_DP * density
        if ((ny < edge && dy < 0) || (ny > h - edge && dy > 0)) scrollPage(0, (dy * 2).toInt())
        if ((nx < edge && dx < 0) || (nx > w - edge && dx > 0)) scrollPage((dx * 2).toInt(), 0)
    }

    private fun placeCursor() {
        cursor.translationX = cx
        cursor.translationY = cy
    }

    private fun showCursor() {
        removeCallbacks(hideCursor)
        cursor.animate().cancel()
        cursor.alpha = 1f
        postDelayed(hideCursor, 3_000)
    }

    /** Toucher au point du curseur (DOWN puis UP), comme un doigt. */
    private fun click() {
        showCursor()
        userClicked = true
        lastClickAt = SystemClock.uptimeMillis()
        val target = customView ?: web
        val down = SystemClock.uptimeMillis()
        fun event(action: Int, time: Long) = MotionEvent.obtain(down, time, action, cx, cy, 0).apply {
            source = android.view.InputDevice.SOURCE_TOUCHSCREEN
        }
        event(MotionEvent.ACTION_DOWN, down).also { target.dispatchTouchEvent(it); it.recycle() }
        postDelayed({
            event(MotionEvent.ACTION_UP, SystemClock.uptimeMillis()).also { target.dispatchTouchEvent(it); it.recycle() }
        }, 60)
    }

    private fun scrollPage(dx: Int, dy: Int) {
        if (customView != null || (dx == 0 && dy == 0)) return
        web.evaluateJavascript("window.scrollBy($dx,$dy)", null)
    }

    /** Lecture/pause de toutes les vidéos de la page, iframes comprises (script injecté). */
    private fun togglePlayback() {
        web.evaluateJavascript("window.postMessage({movix:'toggle'},'*')", null)
    }

    // ---------- WebView ----------

    private fun setupWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // window.open passe par onCreateWindow, qui refuse : pas de pop-up ni de pop-under.
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // UA de la WebView sans « ; wv » ni « Version/4.0 » : certains lecteurs refusent les WebView.
            userAgentString = userAgentString.replace("; wv", "").replace(Regex("""Version/\d+(\.\d+)* """), "")
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.addJavascriptInterface(Bridge(), "MovixAdblock")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, FRAME_SCRIPT, setOf("*"))
        }
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        runCatching {
            ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? = intercept(request)
            })
        }
    }

    private fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val f = filter ?: return null
        val url = request.url.toString()
        if (!url.startsWith("http")) return null
        if (request.isForMainFrame) return null
        val verdict = runCatching { f.check(url, pageUrl, requestType(request)) }.getOrNull() ?: return null
        if (verdict.isEmpty()) return blocked()
        return dataResponse(verdict) ?: blocked()
    }

    private fun blocked() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun dataResponse(dataUrl: String): WebResourceResponse? {
        if (!dataUrl.startsWith("data:")) return null
        val comma = dataUrl.indexOf(',').takeIf { it > 0 } ?: return null
        val meta = dataUrl.substring(5, comma)
        val payload = dataUrl.substring(comma + 1)
        val base64 = meta.endsWith(";base64")
        val mime = meta.removeSuffix(";base64").substringBefore(';').ifBlank { "text/plain" }
        val bytes = if (base64) runCatching { Base64.decode(payload, Base64.DEFAULT) }.getOrNull() ?: return null
        else Uri.decode(payload).toByteArray()
        return WebResourceResponse(mime, "utf-8", 200, "OK", mapOf("Access-Control-Allow-Origin" to "*"), ByteArrayInputStream(bytes))
    }

    private fun requestType(r: WebResourceRequest): String {
        val path = r.url.path.orEmpty().lowercase()
        val accept = r.requestHeaders["Accept"].orEmpty()
        return when {
            accept.startsWith("text/html") -> "subdocument"
            path.endsWith(".js") || path.endsWith(".mjs") -> "script"
            path.endsWith(".css") || accept.startsWith("text/css") -> "stylesheet"
            accept.startsWith("image/") || IMAGE_EXT.any(path::endsWith) -> "image"
            MEDIA_EXT.any(path::endsWith) -> "media"
            FONT_EXT.any(path::endsWith) -> "font"
            accept.contains("*/*") && r.requestHeaders.keys.any { it.equals("X-Requested-With", true) } -> "xmlhttprequest"
            else -> "other"
        }
    }

    /** Même site que la page de départ (domaine enregistrable approché : deux derniers labels). */
    private fun sameSite(host: String): Boolean {
        fun base(h: String) = h.split('.').takeLast(2).joinToString(".")
        return host.isNotEmpty() && base(host) == base(startHost)
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = intercept(request)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            val scheme = url.scheme.orEmpty()
            // intent:, market:, tg:… : jamais d'appli ouverte depuis un lecteur.
            if (scheme != "http" && scheme != "https") return true
            if (!request.isForMainFrame) return false
            val host = url.host.orEmpty()
            if (sameSite(host)) return false
            // Le bloqueur a le dernier mot sur la destination.
            if (filter?.check(url.toString(), pageUrl, "document")?.isEmpty() == true) return true
            // Avant tout clic, les lecteurs changent de domaine d'eux-mêmes (Voe et ses
            // domaines tournants) ; après un clic, une sortie vers un autre site est une pub.
            val allowed = !userClicked && !request.hasGesture()
            if (allowed) startHost = host
            else Log.i("MovixEmbed", "navigation refusée vers $host")
            return !allowed
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            pageUrl = url
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            Log.i("MovixEmbed", "fenêtre refusée")
            return false
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            hideCustom()
            customView = view
            customCallback = callback
            addView(view, indexOfChild(cursor), LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }

        override fun onHideCustomView() = hideCustom()

        // Pas de boîtes de dialogue JavaScript (alert / confirm des pubs).
        override fun onJsAlert(view: WebView, url: String, message: String, result: android.webkit.JsResult): Boolean { result.cancel(); return true }
        override fun onJsConfirm(view: WebView, url: String, message: String, result: android.webkit.JsResult): Boolean { result.cancel(); return true }
    }

    private fun hideCustom() {
        customView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        customView = null
        customCallback = null
    }

    /** Pont appelé par le script injecté dans chaque frame. */
    private inner class Bridge {
        /** `playing` : une vidéo joue ; `syntax` : erreur de syntaxe JS (fil JS de la WebView). */
        @JavascriptInterface
        fun report(kind: String) {
            post {
                when (kind) {
                    "playing" -> if (!videoPlayed) {
                        videoPlayed = true
                        removeCallbacks(stuckCheck)
                        onPlaying?.invoke()
                    }
                    "syntax" -> syntaxErrors++
                }
            }
        }

        @JavascriptInterface
        fun cosmetic(url: String): String = runCatching { filter?.cosmetic(url) }.getOrNull() ?: "{}"

        @JavascriptInterface
        fun hidden(classesJson: String, idsJson: String, exceptionsJson: String): String {
            fun arr(s: String, max: Int = 500) = runCatching { JSONArray(s).let { a -> Array(minOf(a.length(), max)) { a.optString(it) } } }.getOrDefault(emptyArray())
            return runCatching { filter?.hidden(arr(classesJson), arr(idsJson), arr(exceptionsJson, 5_000)) }.getOrNull().orEmpty()
        }
    }

    /** Libère la WebView (appelé en quittant l'écran ; 1 Go de RAM sur les petites clés). */
    fun destroy() {
        removeCallbacks(hideCursor)
        removeCallbacks(stuckCheck)
        onStuck = null
        onPlaying = null
        dirX = 0; dirY = 0
        runCatching { ServiceWorkerController.getInstance().setServiceWorkerClient(null) }
        hideCustom()
        web.stopLoading()
        web.loadUrl("about:blank")
        web.removeJavascriptInterface("MovixAdblock")
        removeView(web)
        web.destroy()
    }

    companion object {
        private const val BASE_DP_PER_MS = 0.32f
        private const val EDGE_DP = 6f
        private const val STEP_DP = 12f
        private const val HOLD_DELAY_MS = 150L
        private const val STUCK_AFTER_CLICK_MS = 15_000L
        private const val STUCK_ON_LOAD_MS = 20_000L
        /** En dessous, les lecteurs récents (syntaxe ES2020 et plus) cassent souvent. */
        private const val MIN_WEBVIEW_MAJOR = 90

        /** Version majeure de la WebView du système (Chrome 66 → 66), 0 si inconnue. */
        fun webViewMajor(context: Context): Int =
            runCatching { WebViewCompat.getCurrentWebViewPackage(context)?.versionName?.substringBefore('.')?.toInt() }.getOrNull() ?: 0

        // Codes Android (évite d'importer KeyEvent pour un switch).
        const val KEY_UP = 19
        const val KEY_DOWN = 20
        const val KEY_LEFT = 21
        const val KEY_RIGHT = 22
        const val KEY_CENTER = 23
        const val KEY_ENTER = 66
        const val KEY_NUM_ENTER = 160
        const val KEY_PLAY_PAUSE = 85
        const val KEY_PLAY = 126
        const val KEY_PAUSE = 127

        private val IMAGE_EXT = listOf(".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif")
        private val MEDIA_EXT = listOf(".m3u8", ".mp4", ".ts", ".m4s", ".webm", ".mp3", ".aac", ".vtt")
        private val FONT_EXT = listOf(".woff", ".woff2", ".ttf", ".otf")

        /**
         * Injecté au démarrage de chaque frame : CSS et scriptlets du bloqueur
         * pour cette frame, sélecteurs génériques au fil du DOM (par lots,
         * 300 ms au plus), et lecture/pause relayée aux iframes.
         */
        private val FRAME_SCRIPT = """
(function(){
  if (window.__movixAb) return; window.__movixAb = 1;
  var B = window.MovixAdblock;
  // Détection « aucune vidéo ne démarre » : une vidéo qui joue, ou une erreur
  // de syntaxe (WebView trop ancienne pour le code du lecteur).
  if (B && B.report) {
    document.addEventListener('playing', function(e){ if (e.target && e.target.tagName === 'VIDEO') { try { B.report('playing'); } catch(_){} } }, true);
    window.addEventListener('error', function(e){ var m = (e && e.message) || ''; if (/SyntaxError/.test(m) || (e.error && e.error.name === 'SyntaxError')) { try { B.report('syntax'); } catch(_){} } }, true);
  }
  function addStyle(css){ if(!css) return; var s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }
  window.addEventListener('message', function(e){
    if (!e.data || e.data.movix !== 'toggle') return;
    var vs = document.querySelectorAll('video');
    for (var i=0;i<vs.length;i++){ var v=vs[i]; if (v.paused) { v.play && v.play().catch(function(){}); } else v.pause(); }
    for (var j=0;j<window.frames.length;j++){ try { window.frames[j].postMessage({movix:'toggle'}, '*'); } catch(_){} }
  });
  if (!B) return;
  var r = {};
  try { r = JSON.parse(B.cosmetic(location.href) || '{}'); } catch(_){}
  if (r.script) { try { (0,eval)(r.script); } catch(_){ try { var sc=document.createElement('script'); sc.textContent=r.script; (document.head||document.documentElement).appendChild(sc); sc.remove(); } catch(__){} } }
  addStyle(r.css);
  if (r.generichide) return;
  var exc = JSON.stringify(r.exceptions || []);
  var seenC = {}, seenI = {}, qC = [], qI = [], timer = 0;
  function collect(el){
    if (!el || el.nodeType !== 1) return;
    var id = el.id; if (id && !seenI[id]) { seenI[id]=1; qI.push(id); }
    var cl = el.classList; if (cl) for (var k=0;k<cl.length;k++){ var c=cl[k]; if (!seenC[c]) { seenC[c]=1; qC.push(c); } }
  }
  function flush(){
    timer = 0; if (!qC.length && !qI.length) return;
    var out = ''; try { out = B.hidden(JSON.stringify(qC.splice(0, 500)), JSON.stringify(qI.splice(0, 500)), exc); } catch(_){}
    if (out) addStyle(out + '{display:none!important}');
    if (qC.length || qI.length) schedule();
  }
  function schedule(){ if (!timer) timer = setTimeout(flush, 300); }
  function scan(root){
    collect(root);
    if (root.querySelectorAll) { var all = root.querySelectorAll('[id],[class]'); for (var i=0;i<all.length && i<3000;i++) collect(all[i]); }
    schedule();
  }
  new MutationObserver(function(muts){
    for (var i=0;i<muts.length;i++){ var m=muts[i];
      if (m.type === 'attributes') collect(m.target);
      else for (var j=0;j<m.addedNodes.length;j++) scan(m.addedNodes[j]);
    }
    schedule();
  }).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['class','id']});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ scan(document.documentElement); });
  else scan(document.documentElement);
})();
""".trimIndent()
    }
}
