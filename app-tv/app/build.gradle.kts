import java.net.URI
import java.security.MessageDigest
import java.util.Properties
import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// Clé TMDB intégrée à l'appli : la même que le site (VITE_TMDB_API_KEY du
// fichier .env à la racine du dépôt movix, déjà publique dans le JavaScript du
// site). Lue au build, jamais écrite dans le dépôt. Ordre : variable
// d'environnement MOVIX_TMDB_KEY, puis .env du site, puis `tmdb.key` de
// local.properties. L'utilisateur peut toujours mettre la sienne dans Réglages.
val tmdbKey: String = run {
    fun clean(value: String?) = value?.trim()?.removeSurrounding("\"")?.removeSurrounding("'")?.trim().orEmpty()
    val fromEnv = clean(System.getenv("MOVIX_TMDB_KEY"))
    val siteEnv = rootProject.file("../.env")
    val fromSite = if (siteEnv.exists()) {
        clean(siteEnv.readLines().firstOrNull { it.trimStart().startsWith("VITE_TMDB_API_KEY=") }?.substringAfter("="))
    } else ""
    fromEnv.ifBlank { fromSite }.ifBlank { clean(localProps.getProperty("tmdb.key")) }
}
require(tmdbKey.all { it.isLetterOrDigit() }) { "Clé TMDB illisible (lettres et chiffres attendus)." }

// Une version publique sans clé afficherait « Ajoute ta clé TMDB » à tout le monde.
gradle.taskGraph.whenReady {
    if (tmdbKey.isBlank() && allTasks.any { it.name.contains("Release") }) {
        throw GradleException("Clé TMDB absente : renseigne VITE_TMDB_API_KEY dans ../.env (ou MOVIX_TMDB_KEY) avant une release.")
    }
}

// Clé de diffusion : jamais dans git. Fichier de propriétés désigné par
// `release.signingFile` dans local.properties, sinon `keys/` à la racine du
// projet (ignoré par git), sinon le cache de la machine de build. Absent : la
// release sort non signée (scripts/release.sh refuse).
val releaseSigningFile = listOfNotNull(
    localProps.getProperty("release.signingFile"),
    rootProject.file("keys/movix-tv-release.properties").path,
    "${System.getProperty("user.home")}/.cache/movix-android-build/keys/movix-tv-release.properties",
).map { file(it) }.firstOrNull { it.exists() }
val releaseSigning = Properties().apply {
    releaseSigningFile?.inputStream()?.use { load(it) }
}

/** Le .jks posé à côté du fichier de propriétés passe avant le chemin qu'il contient. */
fun releaseStoreFile(): File {
    val declared = file(releaseSigning.getProperty("release.storeFile"))
    val sibling = releaseSigningFile?.parentFile?.resolve(declared.name)
    return if (sibling != null && sibling.exists()) sibling else declared
}

// libcurl-impersonate (github.com/lexiforest/curl-impersonate) : la pile TLS et
// HTTP/2 de curl_cffi, comme le relais Python et l'app mobile. Le lecteur s'en
// sert pour imiter un vrai Chrome face à Fsvid/Vidzy (voir
// CurlImpersonateDataSource). Archives de la release téléchargées au build et
// vérifiées par SHA-256 ; CMake empaquette la .so avec notre pont.
val curlImpersonateVersion = "2.3.1"
val curlImpersonateArchives = mapOf(
    "arm64-v8a" to ("aarch64" to "fd8a9ba3386d10f8519fcff3b50f655a41fd38e5e5a2fb8eabcac6085587bcbf"),
    "armeabi-v7a" to ("armv7" to "a3ca8c80d74fcc6ba4dd92bedb0c9a82bb2246806e5116294196351cfd8fbede"),
    "x86" to ("x86" to "22bc873b2ba2eae98367a34155107df6c6b221b707e5b8be0bc4746db25ea389"),
    "x86_64" to ("x86_64" to "d7f7d00b3bd0eae23eb7440e374ffbbbf978be782f8ebddccf888a1677282513"),
)
val curlImpersonateDir = layout.buildDirectory.dir("curl-impersonate/$curlImpersonateVersion")

android {
    namespace = "com.movix.tv"
    // Compose 1.12 exige de compiler contre l'API 37 ; la cible reste 36.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.movix.tv"
        minSdk = 25
        targetSdk = 36
        versionCode = 7
        versionName = "0.2.5"
        buildConfigField("String", "TMDB_KEY", "\"$tmdbKey\"")
        buildConfigField("String", "DEV_VIP_KEY", "\"\"")
    }

    androidResources {
        localeFilters += listOf("fr", "en")
    }

    signingConfigs {
        if (releaseSigning.getProperty("release.storeFile") != null) {
            create("release") {
                storeFile = releaseStoreFile()
                storePassword = releaseSigning.getProperty("release.storePassword")
                keyAlias = releaseSigning.getProperty("release.keyAlias")
                keyPassword = releaseSigning.getProperty("release.keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "DEV_VIP_KEY", "\"${localProps.getProperty("vip.key", "")}\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // La clé ne doit jamais changer : une autre clé = mise à jour impossible
            // sans désinstaller (perte de la liaison et de la bibliothèque).
            signingConfig = signingConfigs.findByName("release")
        }
        // Comme la release (R8, non débogable) mais avec la clé VIP de test :
        // sert à mesurer la vraie vitesse sur émulateur ou boîtier.
        create("benchmark") {
            initWith(getByName("release"))
            matchingFallbacks += listOf("release")
            // Mesures seulement : clé de debug, jamais diffusée.
            signingConfig = signingConfigs.getByName("debug")
            buildConfigField("String", "DEV_VIP_KEY", "\"${localProps.getProperty("vip.key", "")}\"")
        }
    }

    // Un APK par ABI : la plupart des Fire TV Sticks ont un système 32 bits.
    splits {
        abi {
            isEnable = true
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86")
            isUniversalApk = false
        }
    }

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "DebugProbesKt.bin", "kotlin-tooling-metadata.json")
    }

    lint {
        // Media3 marque `ResolvingDataSource`, `CronetDataSource`… comme
        // « API instable » : l'usage est voulu, la version est épinglée.
        disable += "UnsafeOptInUsageError"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    // Pont JNI vers libcurl-impersonate (src/main/cpp), pour Fsvid/Vidzy.
    ndkVersion = "26.1.10909125"
    defaultConfig {
        externalNativeBuild {
            cmake {
                // libcurl-impersonate.so demande libc++_shared.so : la livrer.
                arguments += listOf(
                    "-DANDROID_STL=c++_shared",
                    "-DCURL_IMPERSONATE_ROOT=${curlImpersonateDir.get().asFile.absolutePath.replace('\\', '/')}",
                )
            }
        }
    }
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }
    packaging {
        // Un autre module natif peut aussi embarquer la libc++ du NDK.
        jniLibs.pickFirsts += "**/libc++_shared.so"
    }
}

/** Télécharge, vérifie et déballe libcurl-impersonate (compatible avec le cache de configuration). */
abstract class PrepareCurlImpersonate : DefaultTask() {
    @get:Input
    abstract val releaseVersion: Property<String>

    /** ABI → « triplet:sha256 » de l'archive de la release. */
    @get:Input
    abstract val archives: MapProperty<String, String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fileOps: FileSystemOperations

    @get:Inject
    abstract val archiveOps: ArchiveOperations

    @TaskAction
    fun prepare() {
        val out = outputDir.get().asFile
        val version = releaseVersion.get()
        for ((abi, spec) in archives.get()) {
            val (triple, expectedSha) = spec.split(':')
            val name = "libcurl-impersonate-v$version.$triple-linux-android.tar.gz"
            val archive = File(out, name)
            if (!archive.exists() || sha256(archive) != expectedSha) {
                archive.parentFile.mkdirs()
                val url = "https://github.com/lexiforest/curl-impersonate/releases/download/v$version/$name"
                URI(url).toURL().openStream().use { input -> archive.outputStream().use { output -> input.copyTo(output) } }
            }
            val actualSha = sha256(archive)
            if (actualSha != expectedSha) {
                archive.delete()
                throw GradleException("SHA-256 inattendu pour $name : $actualSha")
            }
            val abiDir = File(out, abi)
            fileOps.delete { delete(abiDir) }
            fileOps.copy {
                from(archiveOps.tarTree(archiveOps.gzip(archive)))
                include("include/**", "libcurl-impersonate.so", "LICENSE*")
                into(abiDir)
            }
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(65_536)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }
}

val prepareCurlImpersonate = tasks.register<PrepareCurlImpersonate>("prepareCurlImpersonate") {
    releaseVersion.set(curlImpersonateVersion)
    archives.set(curlImpersonateArchives.mapValues { (_, spec) -> "${spec.first}:${spec.second}" })
    outputDir.set(curlImpersonateDir)
}
tasks.named("preBuild") { dependsOn(prepareCurlImpersonate) }

kotlin {
    jvmToolchain(17)
}

dependencies {
    coreLibraryDesugaring(libs.desugar)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.tv.material)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.core.ktx)
    implementation(libs.datastore)
    implementation(libs.profileinstaller)

    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)
    implementation(libs.okhttp)
    // Extraction des lecteurs embed : userscript Movix dans QuickJS natif (pas de WebView).
    implementation(project(":extractor"))
    // QR de l'écran de connexion (38 Ko, sans dépendance).
    implementation(libs.qrcodegen)
    // Lecteur web (phase 6) : scripts au démarrage de chaque frame (cosmétique, scriptlets).
    implementation(libs.webkit)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    // Lecteur : pas de media3-ui (vues, ressources, plusieurs centaines de Ko) ;
    // contrôles et sous-titres sont dessinés en Compose.
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.hls)
    implementation(libs.media3.okhttp)
    // Son Dolby / DTS décodé par l'appli quand la télé ne sait ni le décoder ni
    // l'envoyer à l'ampli (module ffmpeg/, environ 1,1 Mo par ABI).
    implementation(project(":ffmpeg"))
    // Cronet : la vraie empreinte TLS de Chrome (les CDN Fsvid/Vidzy bloquent
    // celle d'OkHttp). Chargé depuis les services Google quand ils existent ;
    // sinon (Fire TV) repli sur OkHttp.
    implementation(libs.media3.cronet)
    implementation(libs.play.services.cronet)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
}
