// Décodeurs audio FFmpeg (Dolby Digital Plus, TrueHD, DTS) pour les télés qui
// n'en ont pas : le module decoder_ffmpeg de Media3, que Google ne publie pas
// sur Maven. Les .so sont précompilés par build.sh et commités.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "androidx.media3.decoder.ffmpeg"
    compileSdk = 37

    defaultConfig {
        minSdk = 25
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        disable += "UnsafeOptInUsageError"
    }
}

dependencies {
    // Même version que l'appli : les classes Java viennent du tag Media3 correspondant.
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.decoder)
    implementation(libs.annotation)
    compileOnly(libs.checker.qual)
}
