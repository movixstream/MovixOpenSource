package com.movix.tv.player

/** Classes de qualité standard, de la plus haute à la plus basse. */
private val QUALITY_CLASSES = intArrayOf(4320, 2160, 1440, 1080, 720, 576, 480, 360, 240, 144)

/**
 * Classe standard (1080, 720…) la plus proche d'une hauteur équivalente
 * (voir `HlsMaster.equivalentHeight`) : deux sources de même classe portent
 * la même étiquette.
 */
fun qualityClass(equivalentHeight: Int): Int =
    QUALITY_CLASSES.minByOrNull { kotlin.math.abs(it - equivalentHeight) } ?: equivalentHeight

/**
 * Étiquette de qualité (« 1080p ») d'après la largeur autant que la hauteur :
 * un film en format cinéma de 1920×872 est du 1080p, pas du « 872p ».
 * Arrondi à la classe standard la plus proche.
 */
fun qualityLabel(width: Int, height: Int): String? {
    if (height <= 0 && width <= 0) return null
    val equivalent = maxOf(height, width * 9 / 16)
    return "${qualityClass(equivalent)}p"
}
