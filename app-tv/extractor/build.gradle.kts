// Extraction des lecteurs embed : le userscript Movix dans un QuickJS natif.
// Module Kotlin pur (sans Android) : testable sur PC contre les vrais
// hébergeurs, la bibliothèque QuickJS embarquant sa version Windows / Linux.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.quickjs)
    implementation(libs.coroutines.core)
    implementation(libs.serialization.json)
    implementation(libs.okhttp)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}

tasks.test {
    // Les tests réels (MOVIX_LIVE=1) interrogent la Main API et les hébergeurs.
    environment("MOVIX_LIVE", System.getenv("MOVIX_LIVE") ?: "")
    environment("MOVIX_LIVE_VERBOSE", System.getenv("MOVIX_LIVE_VERBOSE") ?: "")
    testLogging { events("passed", "skipped", "failed"); showStandardStreams = true }
}
