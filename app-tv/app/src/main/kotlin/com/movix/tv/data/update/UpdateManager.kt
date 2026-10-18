package com.movix.tv.data.update

import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import com.movix.tv.data.local.LocalStore
import com.movix.tv.data.local.TvKeys
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.CacheControl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Mise à jour de l'appli depuis l'appli, sur le modèle de l'appli mobile :
 * manifeste `app-tv/version.json` de MovixOpenSource, APK téléchargé dans
 * `cacheDir/update/`, contrôlé (taille, SHA-256, paquet, version), puis confié
 * à l'installeur du système.
 *
 * Rien ne s'installe sans l'utilisateur : le téléchargement ne part que sur
 * « Installer », et la session demande toujours la confirmation d'Android.
 */
class UpdateManager(
    context: Context,
    http: OkHttpClient,
    private val store: LocalStore,
    private val scope: CoroutineScope,
    private val currentVersionCode: Int,
) {
    private val app = context.applicationContext
    private val sdkInt = Build.VERSION.SDK_INT

    private val _state = MutableStateFlow(UpdateState())
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    /** Manifeste : jamais servi par le cache HTTP de l'appli. */
    private val manifestHttp = http.newBuilder().cache(null).build()

    /** APK : pas de cache disque (20 Mo), délai de lecture plus long, chaque redirection contrôlée. */
    private val downloadHttp = http.newBuilder()
        .cache(null)
        .readTimeout(60, TimeUnit.SECONDS)
        .addNetworkInterceptor(Interceptor { chain ->
            val url = chain.request().url
            if (!UpdateRules.isAllowedRedirect(url)) throw IOException("hôte refusé pour l'APK : ${url.host}")
            chain.proceed(chain.request())
        })
        .build()

    private val dir get() = File(app.cacheDir, "update")
    private val apkFile get() = File(dir, APK_NAME)

    private var checkJob: Job? = null
    private var installJob: Job? = null

    /** Au démarrage : reprend le dernier manifeste connu, puis revérifie si 12 h sont passées. */
    fun start() {
        scope.launch {
            store.read(KEY_MANIFEST)?.let(UpdateRules::parseManifest)?.let { cached ->
                if (UpdateRules.isUpdate(cached, currentVersionCode, sdkInt) && _state.value.phase == UpdatePhase.IDLE) {
                    _state.value = UpdateState(UpdatePhase.AVAILABLE, cached)
                }
            }
            if (UpdateRules.isCheckDue(store.read(KEY_LAST_CHECK)?.toLongOrNull(), System.currentTimeMillis())) {
                check(userInitiated = false)
            } else if (_state.value.manifest == null) {
                // Appli déjà mise à jour depuis la dernière vérification : le vieil APK ne sert plus.
                withContext(Dispatchers.IO) { dir.deleteRecursively() }
            }
        }
    }

    /** « Rechercher une mise à jour » (ou vérification de démarrage). */
    fun check(userInitiated: Boolean = true) {
        if (checkJob?.isActive == true || busy()) return
        checkJob = scope.launch {
            if (userInitiated) _state.update { it.copy(phase = UpdatePhase.CHECKING, error = null) }
            val manifest = try {
                fetchManifest()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "manifeste injoignable", e)
                if (userInitiated) _state.update { it.copy(phase = UpdatePhase.ERROR, error = UpdateError.NETWORK) }
                return@launch
            }
            store.writeAll(mapOf(KEY_LAST_CHECK to System.currentTimeMillis().toString()))
            if (manifest == null) {
                if (userInitiated) _state.update { it.copy(phase = UpdatePhase.ERROR, error = UpdateError.BAD_MANIFEST) }
                return@launch
            }
            if (UpdateRules.isUpdate(manifest, currentVersionCode, sdkInt)) {
                store.writeAll(mapOf(KEY_MANIFEST to RAW_JSON.encodeToString(UpdateManifest.serializer(), manifest)))
                if (!busy()) _state.value = UpdateState(UpdatePhase.AVAILABLE, manifest)
            } else {
                store.writeAll(mapOf(KEY_MANIFEST to null))
                _state.value = UpdateState(UpdatePhase.UP_TO_DATE)
                withContext(Dispatchers.IO) { dir.deleteRecursively() }
            }
        }
    }

    /** « Installer » : téléchargement (si besoin), contrôles, puis installeur du système. Toujours lancé par l'utilisateur. */
    fun install() {
        val manifest = _state.value.manifest ?: return
        if (busy()) return
        installJob = scope.launch {
            try {
                val file = download(manifest) ?: return@launch
                _state.update { it.copy(phase = UpdatePhase.VERIFYING) }
                if (!checkArchive(file, manifest)) {
                    file.delete()
                    fail(UpdateError.BAD_APK)
                    return@launch
                }
                if (!canInstall()) {
                    _state.update { it.copy(phase = UpdatePhase.NEEDS_PERMISSION) }
                    if (!openUnknownSourcesSettings()) fail(UpdateError.BLOCKED)
                    return@launch
                }
                _state.update { it.copy(phase = UpdatePhase.INSTALLING) }
                withContext(Dispatchers.IO) { startSession(file) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "installation impossible", e)
                fail(UpdateError.INSTALL_FAILED)
            }
        }
    }

    /** Annule le téléchargement en cours ; la version reste proposée. */
    fun cancel() {
        installJob?.cancel()
        installJob = null
        _state.update { if (it.manifest != null) it.copy(phase = UpdatePhase.AVAILABLE, progress = 0f, error = null) else UpdateState() }
    }

    /** « Plus tard » sur l'accueil : cette version n'est plus proposée au démarrage (les réglages la montrent toujours). */
    fun dismiss(versionCode: Int) {
        scope.launch { store.writeAll(mapOf(KEY_IGNORED to versionCode.toString())) }
    }

    /** Version mise de côté par « Plus tard ». */
    fun ignoredVersion(values: Map<String, String>): Int? = values[KEY_IGNORED]?.toIntOrNull()

    /** Résultat de la session, reçu par [UpdateInstallReceiver]. */
    internal fun onInstallResult(status: Int, message: String?) {
        Log.i(TAG, "installeur : statut $status ${message.orEmpty()}")
        when (status) {
            PackageInstaller.STATUS_SUCCESS -> _state.value = UpdateState(UpdatePhase.UP_TO_DATE)
            // Annulé sur l'écran de confirmation : l'APK vérifié reste prêt.
            PackageInstaller.STATUS_FAILURE_ABORTED -> _state.update { it.copy(phase = UpdatePhase.AVAILABLE, error = null) }
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> fail(UpdateError.CONFLICT)
            PackageInstaller.STATUS_FAILURE_STORAGE -> fail(UpdateError.STORAGE)
            PackageInstaller.STATUS_FAILURE_BLOCKED -> fail(UpdateError.BLOCKED)
            else -> fail(UpdateError.INSTALL_FAILED)
        }
    }

    /**
     * Téléchargement ou contrôle en cours. `INSTALLING` n'en fait pas partie :
     * si l'écran de confirmation se ferme sans renvoyer de statut, « Installer »
     * relance une session avec l'APK déjà vérifié.
     */
    private fun busy() = _state.value.phase == UpdatePhase.DOWNLOADING || _state.value.phase == UpdatePhase.VERIFYING

    private fun fail(error: UpdateError) = _state.update { it.copy(phase = UpdatePhase.ERROR, error = error, progress = 0f) }

    private suspend fun fetchManifest(): UpdateManifest? = withContext(Dispatchers.IO) {
        // Paramètre jetable : le CDN de raw.githubusercontent.com garde ~5 min l'ancienne version.
        val request = Request.Builder()
            .url("${UpdateRules.MANIFEST_URL}?_=${System.currentTimeMillis() / 60_000}")
            .cacheControl(CacheControl.FORCE_NETWORK)
            .build()
        manifestHttp.newCall(request).execute().use { res ->
            if (!res.isSuccessful) throw IOException("HTTP ${res.code}")
            val body = res.body.source().apply { request(MAX_MANIFEST_BYTES + 1) }.buffer
            if (body.size > MAX_MANIFEST_BYTES) return@use null
            UpdateRules.parseManifest(body.readUtf8())
        }
    }

    /** APK vérifié dans `cacheDir/update/`, ou `null` (l'erreur est déjà dans l'état). */
    private suspend fun download(manifest: UpdateManifest): File? = withContext(Dispatchers.IO) {
        val target = apkFile
        if (UpdateRules.matches(target, manifest.apkSize, manifest.apkSha256)) return@withContext target
        dir.deleteRecursively()
        dir.mkdirs()
        if (dir.usableSpace < manifest.apkSize + FREE_SPACE_MARGIN) {
            fail(UpdateError.STORAGE)
            return@withContext null
        }
        _state.update { it.copy(phase = UpdatePhase.DOWNLOADING, progress = 0f, error = null) }
        val part = File(dir, "$APK_NAME.part")
        try {
            val request = Request.Builder().url(manifest.apkUrl).cacheControl(CacheControl.FORCE_NETWORK).build()
            downloadHttp.newCall(request).execute().use { res ->
                if (!res.isSuccessful) throw IOException("HTTP ${res.code}")
                var done = 0L
                var shown = -1
                res.body.byteStream().use { input ->
                    part.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            ensureActive()
                            val n = input.read(buf)
                            if (n < 0) break
                            done += n
                            // Plus gros qu'annoncé : inutile d'aller au bout.
                            if (done > manifest.apkSize) throw SizeMismatch()
                            out.write(buf, 0, n)
                            val percent = (done * 100 / manifest.apkSize).toInt()
                            if (percent != shown) {
                                shown = percent
                                _state.update { it.copy(progress = percent / 100f) }
                            }
                        }
                    }
                }
            }
        } catch (e: CancellationException) {
            part.delete()
            throw e
        } catch (e: SizeMismatch) {
            part.delete()
            fail(UpdateError.CHECKSUM)
            return@withContext null
        } catch (e: IOException) {
            Log.w(TAG, "téléchargement interrompu", e)
            part.delete()
            fail(UpdateError.NETWORK)
            return@withContext null
        }
        _state.update { it.copy(phase = UpdatePhase.VERIFYING, progress = 1f) }
        if (!UpdateRules.matches(part, manifest.apkSize, manifest.apkSha256)) {
            Log.w(TAG, "APK refusé : taille ${part.length()} ou SHA-256 différents du manifeste")
            part.delete()
            fail(UpdateError.CHECKSUM)
            return@withContext null
        }
        if (!part.renameTo(target)) {
            part.delete()
            fail(UpdateError.STORAGE)
            return@withContext null
        }
        target
    }

    /** L'APK est bien Movix TV, à la version annoncée (la signature, elle, est contrôlée par Android). */
    private suspend fun checkArchive(file: File, manifest: UpdateManifest): Boolean = withContext(Dispatchers.IO) {
        val info: PackageInfo = runCatching { app.packageManager.getPackageArchiveInfo(file.path, 0) }.getOrNull()
            ?: return@withContext false
        info.packageName == app.packageName && PackageInfoCompat.getLongVersionCode(info) == manifest.versionCode.toLong()
    }

    /** Android 8+ : autorisation « installer des applis inconnues » propre à l'appli. Avant : réglage global, vu par l'installeur. */
    private fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || app.packageManager.canRequestPackageInstalls()

    private fun openUnknownSourcesSettings(): Boolean {
        val intents = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                add(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}")))
            }
            // Fire OS et certaines télés n'ont pas l'écran par appli.
            add(Intent(Settings.ACTION_SECURITY_SETTINGS))
            add(Intent(Settings.ACTION_SETTINGS))
        }
        return intents.any { intent ->
            try {
                app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                true
            } catch (_: ActivityNotFoundException) {
                false
            } catch (_: SecurityException) {
                false
            }
        }
    }

    /**
     * Session [PackageInstaller] (la voie la plus fiable sur Android TV et
     * Fire OS) ; si le système la refuse, repli sur `ACTION_VIEW` + FileProvider.
     */
    private fun startSession(file: File) {
        try {
            val installer = app.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(app.packageName)
                setSize(file.length())
                // Android 12+ : sans ce réglage, une appli peut se mettre à jour en silence. Ici, toujours la confirmation.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    setPackageSource(PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE)
                }
            }
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                session.openWrite(APK_NAME, 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out, 64 * 1024) }
                    session.fsync(out)
                }
                val intent = Intent(app, UpdateInstallReceiver::class.java).setAction(UpdateInstallReceiver.ACTION)
                // L'installeur ajoute ses extras à l'intent : il doit rester modifiable (intent explicite).
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                val pending = PendingIntent.getBroadcast(app, sessionId, intent, flags)
                session.commit(pending.intentSender)
            }
        } catch (e: Exception) {
            Log.w(TAG, "session PackageInstaller refusée, repli ACTION_VIEW", e)
            viewFallback(file)
        }
    }

    private fun viewFallback(file: File) {
        val uri = FileProvider.getUriForFile(app, "${app.packageName}.updates", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            app.startActivity(intent)
            // Aucun retour de l'installeur dans ce mode : la version reste proposée.
            _state.update { it.copy(phase = UpdatePhase.AVAILABLE, error = null) }
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "aucun installeur pour ACTION_VIEW", e)
            fail(UpdateError.BLOCKED)
        }
    }

    private class SizeMismatch : IOException()

    companion object {
        private const val TAG = "MovixUpdate"
        private const val APK_NAME = "movix-tv.apk"
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val MAX_MANIFEST_BYTES = 64L * 1024
        private const val FREE_SPACE_MARGIN = 20L * 1024 * 1024
        private val RAW_JSON = kotlinx.serialization.json.Json
        private const val KEY_LAST_CHECK = TvKeys.UPDATE_LAST_CHECK
        private const val KEY_MANIFEST = TvKeys.UPDATE_MANIFEST
        private const val KEY_IGNORED = TvKeys.UPDATE_IGNORED
    }
}
