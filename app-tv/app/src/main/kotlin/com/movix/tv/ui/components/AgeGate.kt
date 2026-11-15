package com.movix.tv.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.age.TitleRef
import com.movix.tv.data.tmdb.Access
import com.movix.tv.data.tmdb.MediaType
import com.movix.tv.ui.home.Message
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlin.coroutines.cancellation.CancellationException

/**
 * Restriction d'âge du profil qui regarde, suivie en direct : 0 = aucune,
 * 7 à 18 = âge maximal, `null` = pas encore connue (rien n'est montré).
 */
@Composable
fun rememberAgeLimit(): Int? = LocalContext.current.container.catalog.ageLimit.collectAsStateWithLifecycle().value

/** Clé d'écran tirée de la restriction : changer de restriction repart d'un état neuf (aucune carte de l'ancien profil). */
fun ageKey(limit: Int?): String = limit?.toString() ?: "?"

/**
 * [items] réduits aux titres que le profil peut voir (Ma liste, listes
 * locales). Sans restriction : [items] tels quels, tout de suite et sans
 * requête. Avec : `null` pendant la première vérification ; ensuite, la
 * dernière liste vérifiée reste affichée pendant qu'une nouvelle se vérifie
 * (le focus ne saute pas), sans jamais montrer un titre qui n'a pas été vérifié.
 */
@Composable
fun <T> rememberAgeAllowed(items: List<T>, ref: (T) -> TitleRef): List<T>? {
    val catalog = LocalContext.current.container.catalog
    val limit = rememberAgeLimit()
    if (limit == 0) return items
    // Restriction pas encore connue : demandée au serveur, rien n'est montré d'ici là.
    if (limit == null) {
        LaunchedEffect(Unit) { catalog.resolveAgeLimit() }
        return null
    }
    val checked by produceState<Pair<Int?, List<T>>?>(null, items, limit) {
        value = limit to catalog.allowedOnly(items, limit, ref)
    }
    val (forLimit, allowed) = checked ?: return null
    if (forLimit != limit) return null
    // Liste changée depuis la vérification (titre retiré) : seulement ce qui y est encore.
    val present = items.toHashSet()
    return if (allowed.all { it in present }) allowed else allowed.filter { it in present }
}

/** Rouge du site pour la restriction d'âge : fixe (pas la couleur d'accent), c'est une mise en garde. */
private val AgeRed = Color(0xFFDC2626)

/** Badge « 12+ » d'un profil enfant, comme sur le site (« Qui regarde ? », Réglages › Compte). */
@Composable
fun AgeBadge(limit: Int, modifier: Modifier = Modifier) {
    Text(
        stringResource(R.string.age_badge, limit),
        style = MovixType.Kicker.copy(color = Color.White, fontSize = 11.sp),
        modifier = modifier.background(AgeRed, RoundedCornerShape(999.dp)).padding(horizontal = 7.dp, vertical = 2.dp),
    )
}

/**
 * Fiche ou lecteur de [type] [id] : affiché seulement si le profil peut voir
 * le titre. Sinon, « Ce contenu n'est pas disponible pour ce profil » et un
 * bouton Retour ; rien du titre (ni image ni lecteur) n'est montré avant la
 * vérification. Sans restriction : [content] tout de suite, sans requête.
 */
@Composable
fun AgeGate(type: MediaType, id: Int, onBack: () -> Unit, content: @Composable () -> Unit) {
    val catalog = LocalContext.current.container.catalog
    val limit = rememberAgeLimit()
    if (limit == 0) {
        content()
        return
    }
    var attempt by remember { mutableIntStateOf(0) }
    val check by produceState<Pair<Int?, Result<Access>>?>(null, type, id, limit, attempt) {
        value = null
        value = limit to try {
            Result.success(catalog.access(type, id))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            android.util.Log.w("MovixAge", "accès à ${type.path} $id non vérifié : $e")
            Result.failure(e)
        }
    }
    val result = check?.takeIf { it.first == limit }?.second
    Box(Modifier.fillMaxSize().background(MovixColors.Ink)) {
        val access = result?.getOrNull()
        when {
            // Vérification en cours : écran vide, rien du titre.
            result == null -> Unit
            access == null -> Message(
                title = stringResource(R.string.error_title),
                body = stringResource(R.string.error_body),
                action = stringResource(R.string.action_retry),
                onAction = { attempt++ },
            )
            access is Access.Allowed -> content()
            access is Access.Blocked -> Message(
                title = stringResource(R.string.age_blocked_title),
                body = if (access.age != null) stringResource(R.string.age_blocked_rated, access.age, access.limit)
                else stringResource(R.string.age_blocked_unrated, access.limit),
                action = stringResource(R.string.age_blocked_back),
                onAction = onBack,
            )
        }
    }
}
