package com.movix.tv.data.tmdb

import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Registre des rangées TMDB et ordre des rangées de chaque page.
 *
 * Porté de `MovixTv-main/src/tv/data/rowRegistry.ts` (ancienne appli React). Les rangées
 * personnalisées déclarées par une édition (`CustomRowDefinition`, `registerCustomRows`) ne
 * sont pas portées.
 *
 * L'ordre de [rows] n'a pas d'importance ; ce sont les listes [home], [movies], [series] et
 * [anime] qui font l'affichage.
 *
 * Les pages proposent les rangées classiques de toute plateforme de streaming (tendances,
 * nouveautés, populaires, mieux notés, grands genres). Les rangées régionales et thématiques
 * — Nollywood, l'Inde, l'Afrique, la Corée, Ghibli… — restent au registre, prêtes, mais
 * n'entrent dans aucune page.
 *
 * Trois paramètres méritent un mot :
 *
 * - `with_origin_country` filtre sur le pays de production, là où `with_original_language`
 *   filtre sur la langue. Pour le Nigéria c'est décisif : une large part de Nollywood est
 *   tournée en anglais, et un filtre par langue la manquerait entièrement. Si ce paramètre
 *   venait à ne rien renvoyer, le repli est `with_original_language=yo|ig|ha`, moins complet
 *   mais sûr. La barre verticale vaut « ou » pour TMDB.
 *
 * - `vote_count.gte` écarte les fiches sans aucun vote. Sur les catalogues de niche,
 *   `discover` remonte sinon des entrées vides ou en double, avec des affiches de mauvaise
 *   qualité. Le seuil descend à 3 sur les catalogues africains, où un seuil à 15 ne
 *   laisserait presque rien.
 *
 * - `with_genres=28|12|53` (action, aventure, thriller) sur le Nigéria et l'Afrique, là où la
 *   Corée et l'Inde se contentent de l'action seule : le genre est renseigné de façon inégale
 *   sur Nollywood, et une rangée « action » stricte y tombait sous la dizaine de titres.
 */
object RowRegistry {

    /** Rangées affichées d'office sur une page : les premières de sa liste (`TV_SHOWN_BY_DEFAULT`). */
    const val DEFAULT_VISIBLE_ROWS: Int = 6

    /**
     * Pays de production retenus pour « africain ». Une seule liste pour les films et les
     * séries : deux listes finiraient par diverger, et « Films d'action africains » ne
     * couvrirait plus les mêmes pays que « Séries africaines ».
     */
    const val AFRICAN_COUNTRIES: String = "NG|ZA|GH|KE|EG|MA|DZ|TN|SN|CI|CM|ET|UG|TZ|RW|CD"

    /** Date ISO (`yyyy-MM-dd`, UTC) d'il y a [days] jours. */
    internal fun daysAgo(days: Long): String =
        LocalDate.now(ZoneOffset.UTC).minusDays(days).toString()

    /** Date ISO (`yyyy-MM-dd`, UTC) du jour. */
    internal fun today(): String = LocalDate.now(ZoneOffset.UTC).toString()

    /** Paramètres fixes, convertis en chaînes une fois pour toutes. */
    private fun fixed(vararg pairs: Pair<String, Any>): () -> Map<String, String> {
        val map: Map<String, String> = linkedMapOf(*pairs.map { it.first to it.second.toString() }.toTypedArray())
        return { map }
    }

    private val rows: List<RowSpec> = listOf(
        /* ------------------------------------------------------------ *
         * Accueil
         * ------------------------------------------------------------ */
        RowSpec(
            id = "tendances",
            title = "Tendances du jour",
            path = "/trending/all/day",
            fallbackType = MediaType.MOVIE,
            tier = 1,
        ),
        RowSpec(
            id = "nollywood",
            collection = true,
            title = "Nollywood, le meilleur du Nigéria",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 1,
            params = fixed(
                "with_origin_country" to "NG",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 3,
            ),
        ),
        RowSpec(
            id = "k-series",
            collection = true,
            title = "Séoul à l’écran",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 1,
            params = fixed(
                "with_original_language" to "ko",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
        RowSpec(
            id = "animes",
            collection = true,
            title = "Animés",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 1,
            params = fixed(
                "with_genres" to "16",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
        // Partagée entre l'accueil et la page Films : même identifiant, même collection
        // derrière « Voir plus ».
        RowSpec(
            id = "action-inde",
            collection = true,
            title = "Films d’action indiens",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed(
                "with_origin_country" to "IN",
                "with_genres" to "28",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 15,
            ),
        ),
        // L'Inde est volontairement absente de cette liste : elle a sa rangée juste au-dessus,
        // et deux rangées partageant 60 % de leurs titres donnent l'impression d'un catalogue
        // vide plutôt que d'un catalogue large.
        RowSpec(
            id = "action-asie",
            collection = true,
            title = "Action asiatique",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed(
                "with_origin_country" to "KR|JP|CN|HK|TW|TH|ID|VN",
                "with_genres" to "28",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 15,
            ),
        ),
        RowSpec(
            id = "films-recents",
            collection = true,
            title = "Films récents",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = {
                linkedMapOf(
                    "primary_release_date.gte" to daysAgo(120),
                    "primary_release_date.lte" to today(),
                    "sort_by" to "popularity.desc",
                    "vote_count.gte" to "20",
                )
            },
        ),
        RowSpec(
            id = "series-recentes",
            collection = true,
            title = "Séries récentes",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = {
                linkedMapOf(
                    "first_air_date.gte" to daysAgo(180),
                    "first_air_date.lte" to today(),
                    "sort_by" to "popularity.desc",
                    "vote_count.gte" to "10",
                )
            },
        ),
        RowSpec(
            id = "films",
            title = "Films populaires",
            path = "/movie/popular",
            fallbackType = MediaType.MOVIE,
            tier = 2,
        ),
        RowSpec(
            id = "series",
            title = "Séries populaires",
            path = "/tv/popular",
            fallbackType = MediaType.TV,
            tier = 2,
        ),
        RowSpec(
            id = "top-films",
            title = "Films les mieux notés",
            path = "/movie/top_rated",
            fallbackType = MediaType.MOVIE,
            tier = 2,
        ),

        /* ------------------------------------------------------------ *
         * Films
         * ------------------------------------------------------------ */
        // Alimente aussi la bannière de la page Films : cinq diapositives en tête, la rangée
        // reprend à la sixième.
        RowSpec(
            id = "films-selection",
            title = "Notre sélection du jour",
            path = "/trending/movie/week",
            fallbackType = MediaType.MOVIE,
            tier = 1,
        ),
        // Le classement de TMDB est mondial, pas français : le titre ne promet donc pas
        // « en France ». Il recoupe la sélection au-dessus, comme le Top 10 de Netflix
        // recoupe sa propre sélection — c'est le prix de rangs qui restent vrais.
        RowSpec(
            id = "films-top10",
            title = "Top 10 des films aujourd’hui",
            path = "/trending/movie/day",
            fallbackType = MediaType.MOVIE,
            tier = 1,
            layout = RowLayout.RANK,
            limit = 10,
            dedupe = false,
        ),
        RowSpec(
            id = "action-coree",
            collection = true,
            title = "Films d’action coréens",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 1,
            params = fixed(
                "with_origin_country" to "KR",
                "with_genres" to "28",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 15,
            ),
        ),
        RowSpec(
            id = "action-nigeria",
            collection = true,
            title = "Films d’action nigérians",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 1,
            params = fixed(
                "with_origin_country" to "NG",
                "with_genres" to "28|12|53",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 3,
            ),
        ),
        // Le Nigéria est dans la liste, mais sa rangée passe avant : le dédoublonnage retire
        // d'ici ce qu'elle a déjà montré, tant qu'il en reste assez. Pas besoin d'exclure le
        // pays côté requête.
        RowSpec(
            id = "action-afrique",
            collection = true,
            title = "Films d’action africains",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed(
                "with_origin_country" to AFRICAN_COUNTRIES,
                "with_genres" to "28|12|53",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 3,
            ),
        ),
        RowSpec(
            id = "comedies",
            collection = true,
            title = "Comédies",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "35", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "thrillers",
            collection = true,
            title = "Thrillers",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "53", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "science-fiction",
            collection = true,
            title = "Science-fiction",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "878", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "animation",
            collection = true,
            title = "Animation",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "16", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "horreur",
            collection = true,
            title = "Horreur",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "27", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "drames",
            collection = true,
            title = "Drames",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "18", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "documentaires",
            collection = true,
            title = "Documentaires",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "99", "sort_by" to "popularity.desc", "vote_count.gte" to 20),
        ),
        RowSpec(
            id = "films-francais",
            collection = true,
            title = "Films français",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_origin_country" to "FR", "sort_by" to "popularity.desc", "vote_count.gte" to 20),
        ),
        // Les grands genres sans filtre de pays : ceux de toutes les plateformes.
        RowSpec(
            id = "action",
            collection = true,
            title = "Films d’action",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 1,
            params = fixed("with_genres" to "28", "sort_by" to "popularity.desc", "vote_count.gte" to 100),
        ),
        RowSpec(
            id = "romance",
            collection = true,
            title = "Romance",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "10749", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        /* Rangées 11 à 20 de la page Films : grands genres et populaires. */
        RowSpec(
            id = "aventure",
            collection = true,
            title = "Aventure",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "12", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "films-policier",
            collection = true,
            title = "Policier",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "80", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "films-fantastique",
            collection = true,
            title = "Fantastique",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "14", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "films-famille",
            collection = true,
            title = "En famille",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "10751", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "films-guerre",
            collection = true,
            title = "Guerre",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "10752", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        // C'est l'ancienne grille « Films », un « Voir plus » plus loin : la même requête,
        // dans la page de collection.
        RowSpec(
            id = "catalogue-films",
            collection = true,
            title = "Tout le catalogue",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("sort_by" to "popularity.desc"),
        ),

        /* ------------------------------------------------------------ *
         * Séries
         *
         * Les genres télé de TMDB ne sont pas ceux des films : pas d'« Action » (28) mais
         * « Action et aventure » (10759), et Policier 80, Science-fiction et fantastique
         * 10765. Les rangées par pays n'ont pas de genre : filtrer les séries nigérianes ou
         * africaines sur un genre les viderait, TMDB renseignant peu ces fiches.
         * ------------------------------------------------------------ */
        // Alimente la bannière de la page Séries, comme `films-selection` celle des films.
        RowSpec(
            id = "series-selection",
            title = "Notre sélection du jour",
            path = "/trending/tv/week",
            fallbackType = MediaType.TV,
            tier = 1,
        ),
        RowSpec(
            id = "series-top10",
            title = "Top 10 des séries aujourd’hui",
            path = "/trending/tv/day",
            fallbackType = MediaType.TV,
            tier = 1,
            layout = RowLayout.RANK,
            limit = 10,
            dedupe = false,
        ),
        RowSpec(
            id = "series-nigeria",
            collection = true,
            title = "Séries nigérianes",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 1,
            params = fixed(
                "with_origin_country" to "NG",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 3,
            ),
        ),
        RowSpec(
            id = "series-inde",
            collection = true,
            title = "Séries indiennes",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_origin_country" to "IN",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 10,
            ),
        ),
        // Même logique que les films : le Nigéria passe avant, le dédoublonnage retire d'ici
        // ce qu'il a déjà montré.
        RowSpec(
            id = "series-afrique",
            collection = true,
            title = "Séries africaines",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_origin_country" to AFRICAN_COUNTRIES,
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 3,
            ),
        ),
        RowSpec(
            id = "top-series",
            title = "Séries les mieux notées",
            path = "/tv/top_rated",
            fallbackType = MediaType.TV,
            tier = 2,
        ),
        RowSpec(
            id = "series-action",
            collection = true,
            title = "Action et aventure",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "10759", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "series-policier",
            collection = true,
            title = "Policier",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "80", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "series-sf-fantastique",
            collection = true,
            title = "Science-fiction et fantastique",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "10765", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "series-comedies",
            collection = true,
            title = "Comédies",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "35", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "series-drames",
            collection = true,
            title = "Drames",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "18", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "series-documentaires",
            collection = true,
            title = "Documentaires",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "99", "sort_by" to "popularity.desc", "vote_count.gte" to 20),
        ),
        RowSpec(
            id = "series-francaises",
            collection = true,
            title = "Séries françaises",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_origin_country" to "FR", "sort_by" to "popularity.desc", "vote_count.gte" to 20),
        ),
        /* Rangées 11 à 20 de la page Séries. */
        RowSpec(
            id = "series-en-cours",
            title = "En cours de diffusion",
            path = "/tv/on_the_air",
            fallbackType = MediaType.TV,
            tier = 2,
        ),
        RowSpec(
            id = "series-animees",
            collection = true,
            title = "Séries animées",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "16", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "series-mystere",
            collection = true,
            title = "Mystère",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "9648", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "series-familiales",
            collection = true,
            title = "En famille",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "10751", "sort_by" to "popularity.desc", "vote_count.gte" to 30),
        ),
        RowSpec(
            id = "series-jeunesse",
            collection = true,
            title = "Jeunesse",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "10762", "sort_by" to "popularity.desc", "vote_count.gte" to 20),
        ),
        // `with_type` 2 : mini-séries, au sens de TMDB (une seule saison prévue).
        RowSpec(
            id = "series-mini",
            collection = true,
            title = "Mini-séries",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_type" to "2", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "series-telerealite",
            collection = true,
            title = "Téléréalité",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "10764", "sort_by" to "popularity.desc", "vote_count.gte" to 10),
        ),
        RowSpec(
            id = "series-guerre-politique",
            collection = true,
            title = "Guerre et politique",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "10768", "sort_by" to "popularity.desc", "vote_count.gte" to 20),
        ),
        // L'ancienne grille « Séries », un « Voir plus » plus loin.
        RowSpec(
            id = "catalogue-series",
            collection = true,
            title = "Tout le catalogue",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("sort_by" to "popularity.desc"),
        ),

        /* ------------------------------------------------------------ *
         * Animés
         *
         * Japonais par défaut : genre 16 et langue originale `ja`, comme la rangée `animes`
         * de l'accueil. Le donghua et l'animation coréenne ont chacun leur rangée, par langue.
         *
         * Il n'existe pas de `trending` filtré sur l'animation : la sélection et le Top 10 ne
         * peuvent pas venir des tendances comme sur Films et Séries. La bannière prend donc
         * ce qui se diffuse en ce moment, et le Top 10 se base sur la note — avec un plancher
         * de 500 votes, c'est le classement que les amateurs connaissent, et il ne recoupe
         * pas la popularité du moment.
         *
         * `with_genres=16,10759` : la virgule vaut « et » pour TMDB, là où la barre verticale
         * vaut « ou ». Les rangées par genre restent donc dans l'animation.
         * ------------------------------------------------------------ */
        // Alimente la bannière : ce qui se diffuse cette saison. `air_date` filtre sur la date
        // des épisodes, donc une série de 1999 encore en cours y figure — c'est voulu.
        RowSpec(
            id = "animes-en-cours",
            collection = true,
            title = "Diffusion en cours",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 1,
            params = {
                linkedMapOf(
                    "with_genres" to "16",
                    "with_original_language" to "ja",
                    "air_date.gte" to daysAgo(30),
                    "air_date.lte" to today(),
                    "sort_by" to "popularity.desc",
                    "vote_count.gte" to "5",
                )
            },
        ),
        RowSpec(
            id = "animes-top10",
            title = "Top 10 des animés les mieux notés",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 1,
            layout = RowLayout.RANK,
            limit = 10,
            dedupe = false,
            params = fixed(
                "with_genres" to "16",
                "with_original_language" to "ja",
                "sort_by" to "vote_average.desc",
                "vote_count.gte" to 500,
            ),
        ),
        // `first_air_date`, cette fois : les séries nées dans l'année, pas les nouvelles
        // saisons d'anciennes séries — c'est la rangée du dessus.
        RowSpec(
            id = "animes-nouveaux",
            collection = true,
            title = "Nouveaux animés",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 1,
            params = {
                linkedMapOf(
                    "with_genres" to "16",
                    "with_original_language" to "ja",
                    "first_air_date.gte" to daysAgo(365),
                    "first_air_date.lte" to today(),
                    "sort_by" to "popularity.desc",
                    "vote_count.gte" to "5",
                )
            },
        ),
        RowSpec(
            id = "animes-films",
            collection = true,
            title = "Films d’animation japonais",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 1,
            params = fixed(
                "with_genres" to "16",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 50,
            ),
        ),
        // Seuil bas : le donghua est peu voté sur TMDB, et un seuil à 20 ne laisserait que
        // trois titres.
        RowSpec(
            id = "donghua",
            collection = true,
            title = "Donghua, l’animation chinoise",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16",
                "with_original_language" to "zh",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 5,
            ),
        ),
        RowSpec(
            id = "animation-coreenne",
            collection = true,
            title = "L’animation coréenne",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16",
                "with_original_language" to "ko",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 5,
            ),
        ),
        RowSpec(
            id = "animes-classiques",
            collection = true,
            title = "Les classiques",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16",
                "with_original_language" to "ja",
                "first_air_date.lte" to "2009-12-31",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 100,
            ),
        ),
        RowSpec(
            id = "animes-action",
            collection = true,
            title = "Action et aventure",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16,10759",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
        RowSpec(
            id = "animes-sf-fantastique",
            collection = true,
            title = "Science-fiction et fantastique",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16,10765",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
        // 10342 est l'identifiant TMDB du Studio Ghibli. Filmographie courte, une vingtaine de
        // titres : la collection existe pour les cinq qui ne tiennent pas dans la première page.
        RowSpec(
            id = "ghibli",
            collection = true,
            title = "Studio Ghibli",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed(
                "with_companies" to 10342,
                "sort_by" to "popularity.desc",
            ),
        ),
        // TMDB n'a pas de genre « hentai » : c'est le mot-clé 198385 qui le porte, et ces
        // fiches sont marquées adultes. Dans l'appli React, `include_adult` était forcé à faux
        // par le chargeur, mais les `params` de la rangée passaient après et le surchargeaient
        // — sans quoi la requête ne renvoie que dix titres, contre près de mille avec (mesuré
        // le 14/09/2026). Le chargeur Kotlin doit garder cet ordre. Seuil de votes à 1 : les
        // fiches ici sont peu votées, et une affiche manquante est déjà écartée.
        RowSpec(
            id = "hentai",
            collection = true,
            title = "Hentai",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_keywords" to 198385,
                "with_genres" to "16",
                "with_original_language" to "ja",
                "include_adult" to "true",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 1,
            ),
        ),
        RowSpec(
            id = "animes-comedies",
            collection = true,
            title = "Comédies",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16,35",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
        RowSpec(
            id = "animes-drames",
            collection = true,
            title = "Drames",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16,18",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
        RowSpec(
            id = "animes-mystere",
            collection = true,
            title = "Mystère",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16,9648",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
        RowSpec(
            id = "animes-jeunesse",
            collection = true,
            title = "Jeunesse",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16,10762",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
        /* Rangées 11 à 20 de la page Animés. */
        RowSpec(
            id = "animes-populaires",
            collection = true,
            title = "Les plus populaires",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "16", "with_original_language" to "ja", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        RowSpec(
            id = "animes-policier",
            collection = true,
            title = "Policier",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "16,80", "with_original_language" to "ja", "sort_by" to "popularity.desc", "vote_count.gte" to 20),
        ),
        RowSpec(
            id = "animes-familial",
            collection = true,
            title = "En famille",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "16,10751", "with_original_language" to "ja", "sort_by" to "popularity.desc", "vote_count.gte" to 10),
        ),
        RowSpec(
            id = "animes-mieux-notes",
            collection = true,
            title = "Les mieux notés",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "16", "with_original_language" to "ja", "sort_by" to "vote_average.desc", "vote_count.gte" to 200),
        ),
        RowSpec(
            id = "animes-annees-2010",
            collection = true,
            title = "Les années 2010",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16",
                "with_original_language" to "ja",
                "first_air_date.gte" to "2010-01-01",
                "first_air_date.lte" to "2019-12-31",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 50,
            ),
        ),
        // `with_status` 3 : séries terminées, à regarder d'une traite.
        RowSpec(
            id = "animes-termines",
            collection = true,
            title = "Séries terminées",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed("with_genres" to "16", "with_original_language" to "ja", "with_status" to "3", "sort_by" to "popularity.desc", "vote_count.gte" to 50),
        ),
        // Pas de borne haute dans le TS d'origine : seule la date minimale glisse.
        RowSpec(
            id = "animes-films-recents",
            collection = true,
            title = "Films d’animation récents",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = {
                linkedMapOf(
                    "with_genres" to "16",
                    "with_original_language" to "ja",
                    "primary_release_date.gte" to daysAgo(730),
                    "sort_by" to "popularity.desc",
                    "vote_count.gte" to "10",
                )
            },
        ),
        RowSpec(
            id = "animes-films-cultes",
            collection = true,
            title = "Films d’animation cultes",
            path = "/discover/movie",
            fallbackType = MediaType.MOVIE,
            tier = 2,
            params = fixed("with_genres" to "16", "with_original_language" to "ja", "sort_by" to "vote_average.desc", "vote_count.gte" to 300),
        ),
        // Même requête que la rangée `animes` de l'accueil, sous le titre que cette page
        // attend en fin de parcours.
        RowSpec(
            id = "catalogue-animes",
            collection = true,
            title = "Tout le catalogue",
            path = "/discover/tv",
            fallbackType = MediaType.TV,
            tier = 2,
            params = fixed(
                "with_genres" to "16",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to 20,
            ),
        ),
    )

    /** Toutes les rangées du registre, par identifiant (ordre de déclaration conservé). */
    val all: Map<String, RowSpec> = rows.associateBy { it.id }.also { map ->
        check(map.size == rows.size) {
            val doublons = rows.groupBy { it.id }.filterValues { it.size > 1 }.keys
            "Identifiants de rangée en double : $doublons"
        }
    }

    private fun resolve(ids: List<String>): List<RowSpec> =
        ids.map { id -> all[id] ?: error("Rangée inconnue : $id") }

    /**
     * Accueil, dans l'ordre d'affichage : dix rangées disponibles, les six premières
     * affichées d'office. La première alimente la bannière.
     */
    val home: List<RowSpec> = resolve(
        listOf(
            "tendances",
            "films-recents",
            "series-recentes",
            "films",
            "series",
            "top-films",
            "top-series",
            "action",
            "comedies",
            "animes",
        ),
    )

    /**
     * Page Films : la sélection (bannière), le Top 10, les nouveautés, puis les grands genres.
     * Vingt rangées ; l'accueil, lui, en garde dix.
     */
    val movies: List<RowSpec> = resolve(
        listOf(
            "films-selection",
            "films-top10",
            "films-recents",
            "action",
            "comedies",
            "thrillers",
            "horreur",
            "science-fiction",
            "romance",
            "top-films",
            "films",
            "aventure",
            "animation",
            "drames",
            "films-policier",
            "films-fantastique",
            "films-famille",
            "films-guerre",
            "documentaires",
            "films-francais",
        ),
    )

    /** Page Séries : même construction que les films, avec les genres télé de TMDB. */
    val series: List<RowSpec> = resolve(
        listOf(
            "series-selection",
            "series-top10",
            "series-recentes",
            "series-action",
            "series-policier",
            "series-comedies",
            "series-drames",
            "series-sf-fantastique",
            "top-series",
            "series-documentaires",
            "series",
            "series-en-cours",
            "series-animees",
            "series-mystere",
            "series-familiales",
            "series-jeunesse",
            "series-mini",
            "series-telerealite",
            "series-guerre-politique",
            "series-francaises",
        ),
    )

    /**
     * Page Animés : la saison en cours (bannière), le classement, les nouveautés, puis les
     * genres. Le donghua, l'animation coréenne, Ghibli et le hentai restent au registre, hors
     * des pages.
     */
    val anime: List<RowSpec> = resolve(
        listOf(
            "animes-en-cours",
            "animes-top10",
            "animes-nouveaux",
            "animes-action",
            "animes-films",
            "animes-comedies",
            "animes-sf-fantastique",
            "animes-drames",
            "animes-classiques",
            "animes-mystere",
            "animes-populaires",
            "animes-mieux-notes",
            "animes-jeunesse",
            "animes-policier",
            "animes-familial",
            "animes-annees-2010",
            "animes-termines",
            "animes-films-recents",
            "animes-films-cultes",
            "catalogue-animes",
        ),
    )

    /**
     * Rangées en plus que l'utilisateur peut ajouter à l'accueil (réglage « Rangées de
     * l'accueil »). Hors de [home] : elles n'apparaissent que si elles sont dans `order`.
     */
    private val homeExtras: List<RowSpec> = resolve(
        listOf(
            "films-top10",
            "series-top10",
            "k-series",
            "nollywood",
            "action-inde",
            "action-asie",
            "thrillers",
            "horreur",
            "science-fiction",
            "romance",
            "documentaires",
            "films-francais",
            "series-francaises",
            "ghibli",
        ),
    )

    /** Ordre par défaut des rangées de l'accueil (identifiants de [home]). */
    val homeDefaultOrder: List<String> = home.map { it.id }

    /**
     * Toutes les rangées proposées pour l'accueil, `id` → titre : d'abord celles de [home]
     * dans leur ordre par défaut, puis les rangées en plus.
     */
    fun homeChoices(): List<Pair<String, String>> = (home + homeExtras).map { it.id to it.title }

    /**
     * Rangées de l'accueil à afficher selon le réglage de l'utilisateur.
     *
     * - [order] vide (jamais personnalisé) : [home] sans les rangées de [hidden], limitée
     *   aux [DEFAULT_VISIBLE_ROWS] premières ;
     * - sinon : les rangées de [order] connues, dans cet ordre, puis les autres rangées de
     *   [home] dans l'ordre par défaut, sans celles de [hidden], toutes affichées. Une
     *   rangée en plus n'est affichée que si elle est dans [order].
     *
     * Tout caché : la disposition par défaut revient (un accueil vide serait une page d'erreur).
     */
    fun homeRows(order: List<String>, hidden: Set<String>): List<RowSpec> {
        val rows = if (order.isEmpty()) {
            home.filter { it.id !in hidden }.take(DEFAULT_VISIBLE_ROWS)
        } else {
            val choices = (home + homeExtras).associateBy { it.id }
            val picked = order.distinct().mapNotNull { choices[it] }
            val rest = home.filter { spec -> picked.none { it.id == spec.id } }
            (picked + rest).filter { it.id !in hidden }
        }
        return rows.ifEmpty { home.take(DEFAULT_VISIBLE_ROWS) }
    }

    /** Une rangée du registre, ou `null` si l'identifiant est inconnu. */
    fun find(id: String): RowSpec? = all[id]
}
