import java.util.Properties

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

android {
    namespace = "com.movix.tv"
    // Compose 1.12 exige de compiler contre l'API 37 ; la cible reste 36.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.movix.tv"
        minSdk = 25
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
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
}

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
    // Cronet : la vraie empreinte TLS de Chrome (les CDN Fsvid/Vidzy bloquent
    // celle d'OkHttp). Chargé depuis les services Google quand ils existent ;
    // sinon (Fire TV) repli sur OkHttp.
    implementation(libs.media3.cronet)
    implementation(libs.play.services.cronet)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
}
