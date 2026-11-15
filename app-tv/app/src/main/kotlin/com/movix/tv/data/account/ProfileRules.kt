package com.movix.tv.data.account

import com.movix.tv.data.age.AgeRules

/**
 * Règles des profils réglés depuis la télé (« Qui regarde ? », « Gérer les
 * profils »), aux bornes du serveur (`API/Mainapi/routes/profiles.js`) :
 * nom de 1 à 32 caractères, avatar `/avatars/…`, cinq profils au plus, et
 * `PUT /api/profiles/{id}` ne modifie que les champs reçus.
 */
object ProfileRules {
    /** Longueur maximale d'un nom de profil (`validateProfileName` du serveur). */
    const val PROFILE_NAME_MAX = 32

    /** Nombre de profils qu'un compte peut avoir (limite du serveur). */
    const val MAX_PROFILES = 5

    /** Avatars du site proposés d'office à un profil créé sur la télé (on peut le changer). */
    val NEW_PROFILE_AVATARS: List<String> = listOf(
        "/avatars/pixar/pixar_avatar_1.png",
        "/avatars/mickey/mickey_avatar_1.png",
        "/avatars/pixar/pixar_avatar_2.png",
        "/avatars/mickey/mickey_avatar_2.png",
        "/avatars/pixar/pixar_avatar_3.png",
    )

    /** Premier avatar que les autres profils ([taken]) n'ont pas : on les distingue dans « Qui regarde ? ». */
    fun newProfileAvatar(taken: Collection<String?>): String =
        NEW_PROFILE_AVATARS.firstOrNull { it !in taken } ?: NEW_PROFILE_AVATARS.first()

    /** Nom d'un profil, aux bornes du serveur (1 à 32 caractères) ; `null` s'il est vide. */
    fun profileName(raw: String): String? = raw.trim().take(PROFILE_NAME_MAX).trim().takeIf { it.isNotEmpty() }

    /** Avatar que le serveur accepte : un chemin du site (`/avatars/…`). */
    fun isSiteAvatar(path: String?): Boolean = path != null && path.startsWith("/avatars/")

    /**
     * Ce qui part au serveur quand on enregistre [original] avec ce [name], cet
     * [avatar] et cette limite d'âge [limit] : seulement les champs changés.
     * Un nom vide ou un avatar hors du site ne part jamais (le serveur les
     * refuserait) ; l'écran vérifie le nom avant d'enregistrer.
     */
    fun changes(original: LinkedProfile, name: String, avatar: String, limit: Int): ProfileEdit {
        val safeName = profileName(name)?.takeIf { it != original.name }
        val safeAvatar = avatar.takeIf { isSiteAvatar(it) && it != original.avatar }
        val age = AgeRules.profileLimit(limit).takeIf { it != AgeRules.profileLimit(original.ageRestriction) }
        return ProfileEdit(name = safeName, avatar = safeAvatar, ageRestriction = age)
    }

    /**
     * Le profil [profileId] peut-il être supprimé depuis la télé ? Jamais celui
     * en cours d'utilisation ([currentId]), ni le dernier du compte : le serveur
     * le remplacerait par un profil par défaut et son historique serait perdu.
     * [count] : nombre de profils du compte.
     */
    fun canDelete(profileId: String, currentId: String?, count: Int): Boolean = profileId != currentId && count > 1

    /**
     * Compte de la télé après l'enregistrement de [saved] : nom, avatar et
     * limite d'âge suivent si c'est le profil en cours ; `null` sinon (rien ne
     * change sur la télé). La limite vient de ce que le serveur a gardé.
     */
    fun accountAfterSave(account: Account, saved: LinkedProfile): Account? {
        if (saved.id != account.profileId) return null
        return account.copy(
            profileName = saved.name,
            avatar = saved.avatar,
            ageRestriction = AgeRules.profileLimit(saved.ageRestriction),
        )
    }
}
