package com.movix.tv.player

/**
 * Étiquette de qualité (« 1080p ») d'après la largeur autant que la hauteur :
 * un film en format cinéma de 1920×872 est du 1080p, pas du « 872p ».
 * Arrondi à la classe standard la plus proche.
 */
fun qualityLabel(width: Int, height: Int): String? {
    if (height <= 0 && width <= 0) return null
    val equivalent = maxOf(height, width * 9 / 16)
    val classes = intArrayOf(4320, 2160, 1440, 1080, 720, 576, 480, 360, 240, 144)
    val best = classes.minByOrNull { kotlin.math.abs(it - equivalent) } ?: equivalent
    return "${best}p"
}
