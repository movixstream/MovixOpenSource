package com.movix.tv

import android.content.Context
import com.movix.tv.adblock.AdblockEngine
import com.movix.tv.data.account.AccountApi
import com.movix.tv.data.account.AccountManager
import com.movix.tv.data.account.HistoryApi
import com.movix.tv.data.account.SwiftFluxClient
import com.movix.tv.data.account.SyncManager
import com.movix.tv.data.local.LocalStore
import kotlinx.coroutines.launch
import com.movix.tv.data.local.TvKeys
import com.movix.tv.data.movix.MovixApi
import com.movix.tv.data.movix.SourceRepository
import com.movix.tv.data.movix.StreamProbe
import com.movix.tv.data.movix.VipManager
import com.movix.tv.data.net.ApiHostInterceptor
import com.movix.tv.data.net.ApiHostResolver
import com.movix.tv.data.net.Ipv4FirstDns
import com.movix.extract.BytecodeCache
import com.movix.extract.ExtractorRuntime
import com.movix.extract.OkHttpBridge
import com.movix.tv.player.CodecSupport
import com.movix.tv.player.MediaHeaders
import com.movix.tv.player.PlayerEngine
import com.movix.tv.data.tmdb.CatalogRepository
import com.movix.tv.data.tmdb.TmdbApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import okhttp3.Cache
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Injection manuelle : pas de Hilt ni de Koin (taille de l'APK, démarrage).
 * Un seul `OkHttpClient` pour TMDB, les images, et plus tard l'API Movix et Media3.
 */
class AppContainer(context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    private val baseHttp: OkHttpClient = OkHttpClient.Builder()
        // Par défaut OkHttp ne lance que 5 requêtes par hôte : un premier écran
        // d'accueil (≈ 60 affiches sur image.tmdb.org) se chargeait par vagues
        // de 5. En HTTP/2 les requêtes partagent une seule connexion.
        .dispatcher(Dispatcher().apply { maxRequests = 64; maxRequestsPerHost = 24 })
        .cache(Cache(File(context.cacheDir, "http"), 20L * 1024 * 1024))
        // IPv4 d'abord : sur un réseau où l'IPv6 est annoncé mais ne passe pas
        // (box mal réglée, émulateur), chaque connexion attendait son délai
        // IPv6 avant de se rabattre — 20 s pour le premier écran.
        .dns(Ipv4FirstDns)
        .eventListenerFactory(com.movix.tv.data.net.SlowCallLogger.Factory)
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** Domaine actuel de la Main API (rentry → address.json), les anciens étant bloqués par les FAI. */
    val apiHost = ApiHostResolver(context.applicationContext, baseHttp, json)

    val http: OkHttpClient = baseHttp.newBuilder().addInterceptor(ApiHostInterceptor(apiHost)).build()

    val store = LocalStore(context, appScope)

    /** Clé saisie dans les réglages, sinon celle du site intégrée au build (voir app/build.gradle.kts). */
    fun tmdbKey(): String? = store.get(TvKeys.TMDB_KEY)?.takeIf { it.isNotBlank() }
        ?: BuildConfig.TMDB_KEY.takeIf { it.isNotBlank() }

    val tmdb = TmdbApi(http, json, ::tmdbKey)
    val catalog = CatalogRepository(tmdb)

    val movix = MovixApi(http, json)
    // Clé de test de local.properties (debug et benchmark seulement, vide en
    // release) si aucune clé n'a été saisie ; revérifiée au démarrage comme une autre.
    val vip = VipManager(
        movix,
        appScope,
        { store.read(TvKeys.VIP_KEY) ?: BuildConfig.DEV_VIP_KEY.takeIf { it.isNotBlank() } },
        { store.set(TvKeys.VIP_KEY, it) },
    )
    val sources = SourceRepository(movix, json)

    val accountApi = AccountApi(http, json, movix.baseUrl)
    val accounts = AccountManager(context.applicationContext, store, accountApi, vip, json)
    val sync = SyncManager(appScope, store, accountApi, accounts, json)
    val swiftflux = SwiftFluxClient(http, json, movix.baseUrl)
    /** Rangée « Reprendre » lue sur le serveur (historique en base). */
    val history = HistoryApi(http, json, movix.baseUrl)

    /** Mise à jour depuis l'appli (manifeste `app-tv/version.json` du dépôt movix). */
    val updates = com.movix.tv.data.update.UpdateManager(context.applicationContext, http, store, appScope, BuildConfig.VERSION_CODE)

    init {
        // Couleur d'accent : suit le réglage, appliquée partout aussitôt.
        appScope.launch {
            store.values.collect { v ->
                com.movix.tv.ui.theme.MovixColors.setAccent(androidx.compose.ui.graphics.Color(com.movix.tv.data.local.UiPrefs.accent(v).argb))
            }
        }
        // Compte et file d'envoi relus au démarrage, puis premier tirage du profil.
        appScope.launch {
            accounts.restore()
            sync.start()
            sync.onForeground()
        }
        // En arrière-plan, au plus une fois toutes les 12 h.
        updates.start()
    }
    /** Bloqueur du lecteur web (moteur adblock-rust, chargé à la première ouverture). */
    val embedFilter: com.movix.tv.ui.embed.EmbedFilter = object : com.movix.tv.ui.embed.EmbedFilter {
        override fun check(url: String, sourceUrl: String, type: String) = AdblockEngine.check(url, sourceUrl, type)
        override fun cosmetic(url: String) = AdblockEngine.cosmetic(url)
        override fun hidden(classes: Array<String>, ids: Array<String>, exceptions: Array<String>) =
            AdblockEngine.hiddenSelectors(classes, ids, exceptions).takeIf { it.isNotEmpty() }?.joinToString(",")
    }

    /** Sous-titres Shegu et OpenSubtitles, comme le lecteur du site. */
    val externalSubtitles = com.movix.tv.data.subs.ExternalSubtitles(http, json)
    val subtitleTranslator = com.movix.tv.data.subs.SubtitleTranslator(http, json)
    /** Bandes-annonces lues dans l'appli (flux YouTube directs). */
    val youtube = com.movix.tv.data.youtube.YouTubeClient(http, json)

    private val appContext = context.applicationContext

    /** Langue de l'appli (« fr », « en ») : ses sous-titres passent devant. */
    fun uiLanguage(): String = appContext.resources.configuration.locales[0].language

    val streamProbe = StreamProbe(http)
    val codecSupport = CodecSupport(context.applicationContext)

    val playerEngine = PlayerEngine(context.applicationContext, http, (context.applicationContext as? MovixApp)?.lowRam ?: false)

    /**
     * Extraction sur la télé : le userscript Movix (assets/extract) dans un
     * QuickJS natif. Créé à la première extraction, fermé après 2 min sans
     * usage ; bytecode du script gardé sur disque d'une session à l'autre.
     */
    val extractor: ExtractorRuntime by lazy {
        val app = context.applicationContext
        ExtractorRuntime(
            http = OkHttpBridge(http) { url, headers ->
                val base = if (headers.keys.none { it.equals("User-Agent", true) }) headers + ("User-Agent" to MediaHeaders.SIGNED_USER_AGENT) else headers
                MediaHeaders.apply(url, base)
            },
            userscript = { app.assets.open("extract/movix.user.js").use { it.readBytes().decodeToString() } },
            userAgent = MediaHeaders.SIGNED_USER_AGENT,
            bytecodeCache = FileBytecodeCache(File(app.filesDir, "extract")),
            log = { level, message ->
                when (level) {
                    "error" -> android.util.Log.e("MovixExtract", message)
                    "warn" -> android.util.Log.w("MovixExtract", message)
                    "info" -> android.util.Log.i("MovixExtract", message)
                    else -> if (BuildConfig.DEBUG) android.util.Log.d("MovixExtract", message)
                }
            },
        )
    }
}

/** Bytecode du userscript sur disque ; un seul fichier, remplacé quand le script change. */
private class FileBytecodeCache(private val dir: File) : BytecodeCache {
    override fun load(key: String): ByteArray? = File(dir, "$key.qjsc").takeIf { it.isFile }?.readBytes()
    override fun save(key: String, bytes: ByteArray) {
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val tmp = File(dir, "$key.tmp")
        tmp.writeBytes(bytes)
        tmp.renameTo(File(dir, "$key.qjsc"))
    }
}
