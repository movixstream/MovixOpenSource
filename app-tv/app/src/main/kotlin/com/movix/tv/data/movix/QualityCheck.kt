package com.movix.tv.data.movix

import androidx.compose.runtime.Immutable
import com.movix.tv.player.qualityClass

/** Ce que « Vérifier la qualité » a trouvé pour une source. */
@Immutable
sealed interface QualityResult {
    /** Extraction sur la télé ou lecture de la playlist en cours. */
    data object Checking : QualityResult

    /** Pas de réponse dans le délai, lien mort ou extraction ratée. */
    data object Unavailable : QualityResult

    /** Le flux répond mais n'annonce pas sa résolution (playlist de segments, format inconnu). */
    data object Unknown : QualityResult

    /** Meilleure variante lisible ici, ou codecs que la télé ne sait pas décoder ([SourceSelector.rate]). */
    data class Measured(val rating: SourceSelector.Rating) : QualityResult
}

/** Règles de « Vérifier la qualité » (fonctions pures, testées sans Android). */
object QualityCheck {
    /**
     * Classe de qualité (1080, 720…) la plus haute parmi les sources mesurées
     * que la télé sait lire, `null` si aucune.
     */
    fun bestHeight(results: Map<String, QualityResult>): Int? =
        results.values.mapNotNull { readableClass(it) }.maxOrNull()

    /**
     * Sources de la meilleure classe : toutes celles qui partagent
     * l'étiquette la plus haute (un 1920×800 vaut un 1920×1080). Une source
     * illisible ici (H.265 sans décodeur…) n'est jamais la meilleure.
     */
    fun best(results: Map<String, QualityResult>): Set<String> {
        val top = bestHeight(results) ?: return emptySet()
        return results.filterValues { readableClass(it) == top }.keys
    }

    private fun readableClass(r: QualityResult): Int? {
        val rating = (r as? QualityResult.Measured)?.rating ?: return null
        if (!rating.playableHere) return null
        return rating.height?.let(::qualityClass)
    }
}
