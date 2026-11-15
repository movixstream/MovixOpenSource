package com.movix.tv.data.age

import kotlinx.coroutines.flow.StateFlow

/**
 * Limite d'âge de ce que la télé propose, telle qu'elle la connaît.
 *
 * [limit] : 0 = aucune ; 7, 12, 16 ou 18 = âge maximal des titres montrés ;
 * `null` = compte relié dont la restriction n'est pas encore connue (rien ne
 * doit être montré). Compte relié : restriction du profil qui regarde. Sans
 * compte : mode enfant réglé sur la télé (Réglages › Mode enfant).
 */
interface AgeLimits {
    val limit: StateFlow<Int?>

    /** Demande la restriction au serveur si elle est inconnue ; `null` si c'est impossible (hors ligne). */
    suspend fun resolve(): Int?
}

/** La restriction d'âge du profil n'a pas pu être lue (serveur injoignable) : on ne montre rien. */
class AgeLimitUnknownException : Exception("restriction d'âge du profil inconnue")
