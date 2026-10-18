package com.movix.tv.data.update

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.File
import java.security.MessageDigest

/**
 * Manifeste publié à côté de l'APK (`app-tv/version.json` de MovixOpenSource), au
 * format convenu avec la page du site. Aucun champ n'a de valeur par défaut :
 * un champ manquant rend le manifeste invalide, donc « pas de mise à jour ».
 */
@Immutable
@Serializable
data class UpdateManifest(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val apkSize: Long,
    val apkSha256: String,
    val minSdk: Int,
    val notes: UpdateNotes,
) {
    /** Notes dans la langue de l'appli : anglais si le système est en anglais, sinon français (langue par défaut). */
    fun notesFor(language: String): String = if (language == "en") notes.en else notes.fr
}

@Immutable
@Serializable
data class UpdateNotes(val fr: String, val en: String)

/** Étape en cours, affichée dans les réglages et sur le bandeau de l'accueil. */
enum class UpdatePhase {
    IDLE, CHECKING, UP_TO_DATE, AVAILABLE, DOWNLOADING, VERIFYING,
    /** L'appli n'a pas le droit d'installer : réglage système ouvert, à valider puis « Installer » de nouveau. */
    NEEDS_PERMISSION,
    /** Session confiée au système : l'écran de confirmation d'Android est ouvert. */
    INSTALLING,
    ERROR,
}

enum class UpdateError {
    /** Manifeste ou APK injoignable. */
    NETWORK,
    /** Manifeste illisible, incomplet ou URL refusée. */
    BAD_MANIFEST,
    /** Taille ou SHA-256 différents de ceux du manifeste : fichier supprimé. */
    CHECKSUM,
    /** L'APK téléchargé n'est pas Movix TV, ou pas la version annoncée. */
    BAD_APK,
    /** Pas assez de place pour télécharger. */
    STORAGE,
    /** Signature différente de l'appli installée (build de debug, autre clé). */
    CONFLICT,
    /** Ni l'installeur ni le réglage « sources inconnues » n'ont pu être ouverts. */
    BLOCKED,
    /** Échec rapporté par l'installeur. */
    INSTALL_FAILED,
}

@Immutable
data class UpdateState(
    val phase: UpdatePhase = UpdatePhase.IDLE,
    /** Dernière version plus récente connue (gardée pendant le téléchargement et en cas d'erreur). */
    val manifest: UpdateManifest? = null,
    /** 0..1 pendant le téléchargement. */
    val progress: Float = 0f,
    val error: UpdateError? = null,
)

/** Règles sans Android : testées sur la JVM. */
object UpdateRules {
    const val MANIFEST_URL = "https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app-tv/version.json"

    /** Vérification automatique au plus une fois toutes les 12 h. */
    const val CHECK_INTERVAL_MS = 12L * 60 * 60 * 1000

    /** Garde-fou : une APK de télé fait quelques Mo ; au-delà, le manifeste est suspect. */
    const val MAX_APK_SIZE = 200L * 1024 * 1024

    /** Hôtes acceptés dans le champ `apkUrl` du manifeste. */
    private val MANIFEST_HOSTS = setOf("raw.githubusercontent.com", "github.com")

    private val SHA256 = Regex("^[0-9a-f]{64}$")

    private val json = Json { ignoreUnknownKeys = true }

    /** URL de l'APK écrite dans le manifeste : https, hôte GitHub connu, port par défaut, pas d'identifiants. */
    fun isAllowedApkUrl(url: String): Boolean {
        val u = url.toHttpUrlOrNull() ?: return false
        return u.isHttps && u.host in MANIFEST_HOSTS && u.port == 443 && u.username.isEmpty() && u.password.isEmpty()
    }

    /**
     * Étape d'une redirection pendant le téléchargement : https et un domaine
     * de GitHub (github.com renvoie vers `*.githubusercontent.com`). Le
     * SHA-256 du manifeste reste la vraie garantie.
     */
    fun isAllowedRedirect(url: HttpUrl): Boolean =
        url.isHttps && url.port == 443 &&
            (url.host in MANIFEST_HOSTS || url.host.endsWith(".githubusercontent.com"))

    /** Manifeste lu et validé, ou `null` (champ manquant, valeur absurde, URL refusée). */
    fun parseManifest(text: String): UpdateManifest? {
        val m = runCatching { json.decodeFromString(UpdateManifest.serializer(), text) }.getOrNull() ?: return null
        val sha = m.apkSha256.trim().lowercase()
        val ok = m.versionCode > 0 &&
            m.versionName.isNotBlank() &&
            m.apkSize in 1..MAX_APK_SIZE &&
            SHA256.matches(sha) &&
            m.minSdk >= 1 &&
            isAllowedApkUrl(m.apkUrl)
        return if (ok) m.copy(apkSha256 = sha) else null
    }

    /** Mise à jour proposée : version strictement plus récente, et compatible avec le système de la télé. */
    fun isUpdate(manifest: UpdateManifest, currentVersionCode: Int, sdkInt: Int): Boolean =
        manifest.versionCode > currentVersionCode && sdkInt >= manifest.minSdk

    /** Le bandeau de l'accueil ne revient pas pour une version que l'utilisateur a mise de côté. */
    fun shouldPrompt(manifest: UpdateManifest, ignoredVersionCode: Int?): Boolean =
        ignoredVersionCode == null || manifest.versionCode > ignoredVersionCode

    fun isCheckDue(lastCheckMs: Long?, nowMs: Long): Boolean =
        lastCheckMs == null || nowMs - lastCheckMs >= CHECK_INTERVAL_MS || nowMs < lastCheckMs

    fun sha256Hex(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** Taille puis empreinte : la taille d'abord, pour ne pas hacher un fichier tronqué. */
    fun matches(file: File, size: Long, sha256: String): Boolean =
        file.isFile && file.length() == size && sha256Hex(file).equals(sha256, ignoreCase = true)
}
