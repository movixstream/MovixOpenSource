package com.movix.tv.data.age

import kotlinx.coroutines.flow.StateFlow

/**
 * Restriction d'âge du profil qui regarde, telle que la télé la connaît.
 *
 * [limit] : 0 = aucune (pas de compte relié, ou profil sans restriction) ;
 * 7, 12, 16 ou 18 = âge maximal des titres montrés ; `null` = compte relié dont
 * la restriction n'est pas encore connue (rien ne doit être montré).
 */
interface AgeLimits {
    val limit: StateFlow<Int?>

    /** Demande la restriction au serveur si elle est inconnue ; `null` si c'est impossible (hors ligne). */
    suspend fun resolve(): Int?
}

/** La restriction d'âge du profil n'a pas pu être lue (serveur injoignable) : on ne montre rien. */
class AgeLimitUnknownException : Exception("restriction d'âge du profil inconnue")
