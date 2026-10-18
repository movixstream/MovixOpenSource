package com.movix.tv.data.movix

import com.movix.tv.player.Codecs

/**
 * Rangement des sources et choix de celle qu'on lance. Repris de l'appli
 * React (`sourceAutoSelect.ts`, `types/sourcePriority.ts`), adapté au lecteur
 * natif : seules les sources jouables tout de suite sont candidates.
 *
 * Ordre : VF avant VOSTFR avant inconnu avant VO ; puis les flux extraits par
 * le serveur (HLS d'abord), PurStream, fichiers communautaires, KissKH ; puis
 * la route (FStream en tête, Coflix en dernier) ; puis l'hébergeur.
 * Avant de lancer, [byQuality] fait passer devant, dans la langue choisie,
 * les flux en 720p ou plus que l'appareil sait décoder.
 */
object SourceSelector {
    private val LANG_RANK = mapOf(Lang.VF to 0, Lang.VOSTFR to 1, Lang.UNKNOWN to 2, Lang.VO to 3)

    private val PROVIDER_RANK = listOf(
        Provider.FSTREAM, Provider.SWIFTFLUX, Provider.WIFLIX, Provider.VIPER, Provider.J1F, Provider.OMEGA, Provider.LINKS,
        Provider.SWIFTFLOW, Provider.VOX, Provider.PURSTREAM, Provider.KISSKH, Provider.COFLIX,
    )

    private val HOST_RANK = listOf(
        "voe", "vidmoly", "vidzy", "uqload", "sibnet", "veev", "doodstream", "lulustream", "vidara",
        "seekstreaming", "smoothpre", "minochinos", "darkibox", "supervideo", "dropload", "oneupload", "fsvid",
    )

    private fun categoryRank(s: PlaybackSource): Int = when {
        s.provider == Provider.PURSTREAM -> 2
        s.provider == Provider.KISSKH -> 4
        s.provider == Provider.LINKS && s.embedUrl == null -> 3 // fichier MP4 communautaire
        s.kind == StreamKind.HLS -> 0
        else -> 1
    }

    private fun rank(list: List<Any?>, value: Any?): Int = list.indexOf(value).let { if (it < 0) list.size else it }

    private val comparator = compareBy<PlaybackSource>(
        { LANG_RANK[it.language] ?: 9 },
        { categoryRank(it) },
        { rank(PROVIDER_RANK, it.provider) },
        { rank(HOST_RANK, it.host) },
    )

    /**
     * Sources jouables rangées, doublons retirés (même flux, ou même lecteur
     * embed servi par deux routes). L'ordre est celui des essais successifs.
     */
    fun playable(all: List<PlaybackSource>): List<PlaybackSource> {
        val seenStream = HashSet<String>()
        val seenEmbed = HashSet<String>()
        return all.filter { it.playable }.sortedWith(comparator).filter { s ->
            seenStream.add(s.streamUrl!!) && (s.embedUrl == null || seenEmbed.add(s.embedUrl))
        }
    }

    /** Hébergeurs que le userscript sait extraire (`EMBED_PATTERNS`). */
    val DEVICE_HOSTS = setOf(
        "voe", "vidmoly", "uqload", "sibnet", "doodstream", "lulustream", "veev", "vidara", "seekstreaming", "vidzy", "fsvid",
    )

    /**
     * Lecteurs à extraire sur la télé, dans l'ordre des essais : hébergeurs
     * connus d'abord, puis les inconnus (domaines tournants de Voe, que le
     * userscript reconnaît à leur page).
     *
     * Vidzy n'est pas pénalisé sans Cronet : son CDN refuse les clients qui se
     * présentent comme okhttp/Dalvik ou dont l'empreinte TLS est celle de
     * Java ou Python, mais accepte la pile TLS d'Android avec l'identité
     * Chrome de l'appli (vérifié en 1080p sur Android TV 9, Cronet coupé).
     */
    fun deviceCandidates(device: List<PlaybackSource>): List<PlaybackSource> =
        device.filter { it.embedUrl != null && (it.host == null || it.host in DEVICE_HOSTS) }
            .sortedWith(compareBy(
                { LANG_RANK[it.language] ?: 9 },
                { if (it.host == null) 1 else 0 },
            ))

    /** Lecteurs sans flux résolu par le serveur, à extraire sur la télé. */
    fun deviceOnly(all: List<PlaybackSource>): List<PlaybackSource> {
        val resolvedEmbeds = all.filter { it.playable }.mapNotNullTo(HashSet()) { it.embedUrl }
        return all.filter { !it.playable && it.embedUrl != null && it.embedUrl !in resolvedEmbeds }
            .sortedWith(comparator).distinctBy { it.embedUrl }
    }

    /**
     * Lecteurs à ouvrir dans le lecteur web (souris virtuelle), dernier
     * recours : chaque page embed une fois, ceux que la télé ne sait pas
     * extraire d'abord (c'est pour eux que le lecteur web existe), puis les autres.
     */
    fun webCandidates(all: List<PlaybackSource>): List<PlaybackSource> =
        all.filter { it.embedUrl?.startsWith("http") == true }
            .distinctBy { it.embedUrl }
            .sortedWith(compareBy<PlaybackSource>(
                { LANG_RANK[it.language] ?: 9 },
                { if (it.host != null && it.host in DEVICE_HOSTS) 1 else 0 },
            ).then(comparator))

    /**
     * Source à lancer. Un film ne démarre jamais sur KissKH (catalogue de
     * séries asiatiques, correspondances de films peu sûres) ni sur Coflix
     * (pubs dans ses lecteurs), sauf s'il n'y a rien d'autre.
     */
    fun pick(playable: List<PlaybackSource>, isTv: Boolean): PlaybackSource? =
        playable.firstOrNull { startable(it, isTv) } ?: playable.firstOrNull()

    private fun startable(s: PlaybackSource, isTv: Boolean) =
        s.provider != Provider.COFLIX && (isTv || s.provider != Provider.KISSKH)

    /** Hauteur équivalente (voir [HlsMaster.equivalentHeight]) à partir de laquelle une source est « HD ». */
    const val HD_HEIGHT = 720

    /**
     * Flux dont on lit la playlist HLS ou l'en-tête MP4 avant de lancer :
     * ceux de la langue de la source qu'on lancerait, au plus [limit]. Les
     * autres langues ne passent jamais devant (VF avant VOSTFR, même en 360p).
     */
    fun probeCandidates(playable: List<PlaybackSource>, isTv: Boolean, limit: Int = 12): List<PlaybackSource> {
        val lang = pick(playable, isTv)?.language ?: return emptyList()
        return playable.filter { it.language == lang && startable(it, isTv) }.take(limit)
    }

    /**
     * Ce qu'on sait d'une source après lecture : hauteur de la meilleure
     * variante lisible, et types MIME que l'appareil ne sait pas décoder
     * quand aucune variante n'est lisible.
     */
    data class Rating(val height: Int?, val unsupported: List<String> = emptyList()) {
        val playableHere: Boolean get() = unsupported.isEmpty()
    }

    /**
     * Note de [variants] pour un appareil qui lit les types MIME acceptés
     * par [supports]. Un codec inconnu est supposé lisible. `null` sans variante.
     */
    fun rate(variants: List<Variant>, supports: (String) -> Boolean): Rating? {
        if (variants.isEmpty()) return null
        fun missing(v: Variant) = v.codecs.mapNotNull(Codecs::mimeOf).filterNot(supports).distinct()
        val ok = variants.filter { missing(it).isEmpty() }
        if (ok.isNotEmpty()) return Rating(ok.mapNotNull { it.height }.maxOrNull())
        val best = variants.maxBy { it.height ?: 0 }
        return Rating(best.height, missing(best))
    }

    private val DECLARED = Regex("""(?<![\d])(2160|1440|1080|720|576|480|360|240)[pP]""")

    /**
     * Hauteur annoncée par la route dans la qualité ou le libellé
     * (« Bravo - pulse - 1080p - MULTI », « 4K », « FHD »). « HD » seul ne
     * dit rien (le serveur le met partout) : `null`.
     */
    fun declaredHeight(s: PlaybackSource): Int? {
        val text = listOfNotNull(s.quality, s.label).joinToString(" ")
        DECLARED.find(text)?.let { return it.groupValues[1].toInt() }
        val words = text.uppercase().split(Regex("[^A-Z0-9]+"))
        return when {
            "4K" in words || "UHD" in words -> 2160
            "FHD" in words -> 1080
            else -> null
        }
    }

    /**
     * Range à nouveau [playable] d'après [ratings] (par [PlaybackSource.id]),
     * ou à défaut la hauteur annoncée. Dans une même langue : les sources HD
     * d'abord, puis les inconnues, puis les autres de la meilleure à la pire,
     * puis celles que l'appareil ne sait pas décoder. Le reste de l'ordre
     * (catégorie, route, hébergeur) départage. La langue reste le premier critère.
     */
    fun byQuality(playable: List<PlaybackSource>, ratings: Map<String, Rating>): List<PlaybackSource> {
        fun height(s: PlaybackSource) = ratings[s.id]?.height ?: declaredHeight(s)
        return playable.sortedWith(compareBy(
            { LANG_RANK[it.language] ?: 9 },
            {
                val h = height(it)
                when {
                    ratings[it.id]?.playableHere == false -> 3
                    h == null -> 1
                    h >= HD_HEIGHT -> 0
                    else -> 2
                }
            },
            { height(it)?.takeIf { h -> h < HD_HEIGHT }?.let { h -> -h } ?: 0 },
        ))
    }
}
