package com.movix.tv.data.account

/** Une série d'avatars du site (« One Piece »), rangée sous une plateforme. */
data class AvatarCategory(val name: String, val avatars: List<String>)

/** Une plateforme du sélecteur d'avatars du site (« Netflix », « Classiques »). */
data class AvatarGroup(val name: String, val categories: List<AvatarCategory>)

/** Place d'un avatar dans [AvatarCatalog.groups] : plateforme, série, rang dans la série. */
data class AvatarSpot(val group: Int, val category: Int, val index: Int)

/**
 * Catalogue des avatars du site, embarqué dans l'appli : la télé n'a aucune
 * route qui le liste. Repris tel quel, dans l'ordre du sélecteur du site
 * (`src/components/AvatarSelector.tsx`) :
 * - plateformes Crunchyroll, Disney+, HBO, Netflix et Prime Video : `src/data/new_avatars.ts` ;
 * - « Classiques », en dernier : `src/data/avatars.ts`.
 *
 * Chemins `/avatars/<dossier>/<fichier>.png` : ceux que le site range dans le
 * profil, servis par le site depuis `public/avatars/` (AvatarCatalogTest
 * vérifie que chaque fichier y existe). Les noms des séries sont ceux du site.
 * À reprendre quand le site ajoute des avatars, puis refaire leurs vignettes
 * ([AvatarThumbs]) : `node app-tv/scripts/build-avatar-thumbs.mjs`.
 */
object AvatarCatalog {
    /** Plateforme des premiers avatars du site (`avatars.ts`), nommée ainsi dans son sélecteur. */
    const val CLASSICS = "Classiques"

    /** Construit à la première ouverture du choix d'avatar (≈ 1 600 chemins). */
    val groups: List<AvatarGroup> by lazy {
        listOf(crunchyroll(), disneyPlus(), hbo(), netflix(), primeVideo(), classics())
    }

    /** Place de l'avatar [path] (première occurrence) ; `null` s'il n'est pas dans le catalogue. */
    fun locate(path: String?): AvatarSpot? {
        if (path.isNullOrEmpty()) return null
        groups.forEachIndexed { g, group ->
            group.categories.forEachIndexed { c, category ->
                val i = category.avatars.indexOf(path)
                if (i >= 0) return AvatarSpot(g, c, i)
            }
        }
        return null
    }

    /** Série dont les fichiers `<nom>.png` sont dans `/avatars/[folder]/`. */
    private fun cat(name: String, folder: String, vararg files: String) =
        AvatarCategory(name, files.map { "/avatars/$folder/$it.png" })

    /** Série numérotée de `avatars.ts` : `/avatars/[folder]/[prefix]_<n>.png`, sans les numéros [skip]. */
    private fun numbered(name: String, folder: String, prefix: String, numbers: IntRange, skip: Set<Int> = emptySet()) =
        AvatarCategory(name, numbers.filter { it !in skip }.map { "/avatars/$folder/${prefix}_$it.png" })

    // Crunchyroll : `src/data/new_avatars.ts`, platformAvatars["Crunchyroll"].
    private fun crunchyroll() = AvatarGroup(
        "Crunchyroll",
        listOf(
            cat(
                "Aot", "crunchyroll/aot",
                "annie-avatar", "armin-avatar", "conny-avatar", "eren-avatar", "hange-avatar", "jean-avatar", "levi-avatar",
                "mikasa-avatar", "reiner-avatar", "sasha-avatar",
            ),
            cat(
                "Bananya", "crunchyroll/bananya",
                "21", "22", "23", "24", "25",
            ),
            cat(
                "Black Butler", "crunchyroll/black_butler",
                "ciel-avatar", "edgar-avatar", "gregory-avatar", "herman-avatar", "lawrence-avatar", "sebastian-avatar",
            ),
            cat(
                "Black Clover", "crunchyroll/black_clover",
                "1056-black", "1057-black", "1058-black", "1059-black", "1060-black",
            ),
            cat(
                "Blue Lock", "crunchyroll/blue_lock",
                "2bluenagi_nagi_avatar", "bachira_avatar", "bachira_teaser_avatar", "barou_avatar", "bluenagi_chigiri_avatar",
                "bluenagi_isagi_avatar", "bluenagi_kunigami_avatar", "bluenagi_nagi_school_avatar", "bluenagi_reo_avatar",
                "bluenagi_reo_school_avatar", "bluenagi_rin_avatar", "chigiri_avatar", "ego_avatar", "hiori_teaser_avatar", "isagi_avatar",
                "isagi_kv1_avatar", "isagi_teaser_avatar", "karasu_teaser_avatar", "kunigami_avatar", "nagi_avatar", "nagi_teaser_avatar",
                "nanase_teaser_avatar", "oliver_kv1_avatar", "otoya_teaser_avatar", "reo_avatar", "rin_avatar", "rin_kv1_avatar",
                "rin_teaser_avatar", "sae_kv1_avatar", "sae_teaser_avatar", "shidou_teaser_avatar", "yukimiya_teaser_avatar",
                "zantetsu_avatar",
            ),
            cat(
                "Bocchi The Rock !", "crunchyroll/bocchi_the_rock_!",
                "avatar", "bochhi", "iita", "kita", "kv-avatar", "nijika", "ryo-avatar", "ryo",
            ),
            cat(
                "Carnets Apothicaire", "crunchyroll/carnets_apothicaire",
                "2", "3", "4", "5", "6", "7", "8", "png",
            ),
            cat(
                "Chainsawman", "crunchyroll/chainsawman",
                "aki", "chainsawman", "denji", "himeno", "kishibe", "kobeni", "makima", "pochita", "power",
            ),
            cat(
                "Db Daima", "crunchyroll/db_daima",
                "10", "3", "4", "5", "6", "7", "8", "9",
            ),
            cat(
                "Dr. Stone", "crunchyroll/dr._stone",
                "1046", "1047", "1048", "1049", "1050", "dr_stone_s4_avatar_2", "dr_stone_s4_avatar_3", "dr_stone_s4_avatar_4",
            ),
            cat(
                "Fena Pirate Princess", "crunchyroll/fena_pirate_princess",
                "fena_pirateprincess_1011", "fena_pirateprincess_1012", "fena_pirateprincess_1013", "fena_pirateprincess_1014",
                "fena_pirateprincess_1015", "fena_pirateprincess_1016", "fena_pirateprincess_1017", "fena_pirateprincess_1018",
                "fena_pirateprincess_1019", "fena_pirateprincess_1020",
            ),
            cat(
                "Finest Assassin", "crunchyroll/finest_assassin",
                "1001", "1002", "1003", "1004", "1005",
            ),
            cat(
                "Frieren", "crunchyroll/frieren",
                "frieren-10", "frieren-11", "frieren-12", "frieren-13", "frieren-2", "frieren-3", "frieren-4", "frieren-5", "frieren-6",
                "frieren-7", "frieren-8", "frieren-9", "frieren",
            ),
            cat(
                "Girls Band Cry", "crunchyroll/girls_band_cry",
                "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "2", "20", "21", "22", "23", "24", "25", "3", "4", "5", "6",
                "7", "8", "9", "avatar",
            ),
            cat(
                "God High School", "crunchyroll/god_high_school",
                "16", "17", "18", "19", "20",
            ),
            cat(
                "High Card", "crunchyroll/high_card",
                "10", "2", "3", "4", "5", "6", "7", "8", "9", "avatar",
            ),
            cat(
                "Jujutsu Kaisen", "crunchyroll/jujutsu_kaisen",
                "1041", "1042", "1043", "1044", "1045",
            ),
            cat(
                "Love Villainess", "crunchyroll/love_villainess",
                "2", "3", "4", "5", "6", "7", "8", "9", "png",
            ),
            cat(
                "Metallic Rouge", "crunchyroll/metallic_rouge",
                "10", "11", "12", "13", "14", "15", "16", "2", "3", "4", "5", "6", "7", "8", "9", "avatar",
            ),
            cat(
                "Mitrasphere", "crunchyroll/mitrasphere",
                "1006", "1007", "1008", "1009", "1010",
            ),
            cat(
                "One Piece", "crunchyroll/one_piece",
                "bigmomfromonepiece", "brookfromonepiece", "chopperfromonepiece-2", "chopperfromonepiece-3", "chopperfromonepiece-4",
                "chopperfromonepiece", "frankyfromonepiece-2", "frankyfromonepiece-3", "frankyfromonepiece-4", "frankyfromonepiece",
                "jimbeifromonepiece-2", "jimbeifromonepiece-3", "jimbeifromonepiece-4", "jimbeifromonepiece", "jinbeifromonepiece",
                "kaidofromonepiece", "kidfromonepiece", "lawfromonepiece", "luffyfromonepiece-2", "luffyfromonepiece-3",
                "luffyfromonepiece-4", "luffyfromonepiece-5", "luffyfromonepiece-6", "luffyfromonepiece", "namifromonepiece",
                "nicorobinfromonepiece-2", "nicorobinfromonepiece-3", "nicorobinfromonepiece", "onepiece-10", "onepiece-11", "onepiece-12",
                "onepiece-13", "onepiece-2", "onepiece-3", "onepiece-4", "onepiece-5", "onepiece-6", "onepiece-7", "onepiece-8",
                "onepiece-9", "onepiece", "peronafromonepiece", "robinfromonepiece", "roronoazorofromonepiece-2",
                "roronoazorofromonepiece", "sanjifromonepiece-2", "sanjifromonepiece-3", "sanjifromonepiece-4", "sanjifromonepiece",
                "shanksfromonepiece", "usoppfromonepiece-2", "usoppfromonepiece",
            ),
            cat(
                "Op Gear Five", "crunchyroll/op_gear_five",
                "gearfive_l_apogeedeluffy_lfifth", "gearfive_l_apogeedeluffy_lfth-2", "gearfive_l_apogeedeluffy_lfth-3",
                "gearfive_l_apogeedeluffy_lfth-4", "gearfive_l_apogeedeluffy_lfth-5", "gearfive_l_apogeedeluffy_lfth-6",
                "gearfive_l_apogeedeluffy_lfth-7", "gearfive_l_apogeedeluffy_lfth-8", "gearfive_l_apogeedeluffy_lfth-9",
            ),
            cat(
                "Reincarne Slime", "crunchyroll/reincarne_slime",
                "moi_quandjemereincarneenslime_36", "moi_quandjemereincarneenslime_37", "moi_quandjemereincarneenslime_38",
                "moi_quandjemereincarneenslime_39", "moi_quandjemereincarneenslime_40",
            ),
            cat(
                "Shield Hero", "crunchyroll/shield_hero",
                "100001-the", "100002-the", "100003-the", "100004-the", "100005-the",
            ),
            cat(
                "Solo Leveling S1", "crunchyroll/solo_leveling_s1",
                "sololevelings1_sololeveling-2", "sololevelings1_sololeveling-3", "sololevelings1_sololeveling-4",
                "sololevelings1_sololeveling-5", "sololevelings1_sololeveling-6", "sololevelings1_sololeveling-7",
                "sololevelings1_sololeveling-8", "sololevelings1_sololeveling",
            ),
            cat(
                "Solo Leveling S2", "crunchyroll/solo_leveling_s2",
                "sololevelings2-arisefromtheshadow-_eling", "sololevelings2-arisefromtheshadow-_ing-2",
                "sololevelings2-arisefromtheshadow-_ing-3", "sololevelings2-arisefromtheshadow-_ing-4",
                "sololevelings2-arisefromtheshadow-_ing-5",
            ),
            cat(
                "Somali Forest", "crunchyroll/somali_forest",
                "31-somali", "32-somali", "33-somali", "34-somali", "35-somali",
            ),
            cat(
                "Spider So What", "crunchyroll/spider_so_what",
                "soi_maspider_sowhat_1051", "soi_maspider_sowhat_1052", "soi_maspider_sowhat_1053", "soi_maspider_sowhat_1054",
                "soi_maspider_sowhat_1055",
            ),
            cat(
                "Spy X Family", "crunchyroll/spy_x_family",
                "spyxfamily_100006-spy-x", "spyxfamily_100007-spy-x", "spyxfamily_100008", "spyxfamily_100009", "spyxfamily_100010",
            ),
            cat(
                "To Your Eternity", "crunchyroll/to_your_eternity",
                "toyoureternity_1021", "toyoureternity_1022", "toyoureternity_1023", "toyoureternity_1024", "toyoureternity_1025",
                "toyoureternity_1026", "toyoureternity_1027", "toyoureternity_1028", "toyoureternity_1029", "toyoureternity_1030",
            ),
        ),
    )

    // Disney+ : `src/data/new_avatars.ts`, platformAvatars["Disney+"].
    private fun disneyPlus() = AvatarGroup(
        "Disney+",
        listOf(
            cat(
                "Disney", "disney+/disney",
                "asha", "baymax", "elsa", "ethan_clade", "minnie_mouse", "mirabel", "olaf", "penny_proud", "pua", "raya", "sisu",
                "snow_white", "star", "tiana",
            ),
            cat(
                "Disney Channel", "disney+/disney_channel",
                "candace_flynn", "dipper_pines", "dr__doofenshmirtz", "elena", "evie", "ferb_fletcher", "hannah_montana", "k_c__cooper",
                "kim_possible", "louie", "mabel_pines", "mal", "perry_the_platypus", "phineas_flynn", "uma",
            ),
            cat(
                "Disney Classics", "disney+/disney_classics",
                "ariel", "belle", "cheshire_cat", "cinderella", "eeyore", "genie", "jasmine", "lady", "maleficent", "marie", "peter_pan",
                "robin_hood", "tinker_bell", "ursula", "winnie_the_pooh",
            ),
            cat(
                "Disney Princess", "disney+/disney_princess",
                "ariel", "aurora", "belle", "cinderella", "elena", "jasmine", "merida", "mulan", "pocahontas", "rapunzel", "snow_white",
                "tiana",
            ),
            cat(
                "Ice Age", "disney+/ice_age",
                "buck", "diego", "ellie", "manny", "scrat", "sid",
            ),
            cat(
                "Kids", "disney+/kids",
                "bandit", "bingo-2", "bingo", "bluey", "chilli", "doc_mcstuffins", "elena", "gekko_greg", "kai_brightstar", "kion",
                "nash_durango", "nubs", "rolly", "vampirina",
            ),
            cat(
                "Marvel", "disney+/marvel",
                "black_widow", "daredevil", "doctor_strange", "hulk", "kingpin", "loki", "moon_knight", "ms__marvel", "sam_wilson",
                "scarlet_witch", "sersi___eternals_movie_", "shang-chi", "she-hulk", "spider-man", "thor",
            ),
            cat(
                "Mickey And Friends", "disney+/mickey_and_friends",
                "chip", "daisy_duck", "dale", "dewey", "donald_duck", "goofy", "huey", "jose_carioca", "launchpad_mcquack", "louie",
                "mickey_mouse", "minnie_mouse", "pluto", "scrooge_mcduck", "webby_vanderquack",
            ),
            cat(
                "National Geographic", "disney+/national_geographic",
                "dolphin", "elephant", "gibbon", "jaguar", "panda", "penguin", "sharkfest_",
            ),
            cat(
                "Pixar", "disney+/pixar",
                "alberto_scorfano", "anger", "buzz_lightyear", "disgust", "ember", "fear", "joe", "joy", "lightning_mcqueen", "luca_",
                "luca__1", "mater", "meilin_lee", "sadness", "wade",
            ),
            cat(
                "Star Wars", "disney+/star_wars",
                "ahsoka_tano", "bo", "boba_fett", "cassian_andor", "darth_vader", "huyang", "kai_brightstar", "loth-cats", "lys_solay",
                "nash_durango", "nubs", "obi", "reva", "the_child", "the_mandalorian",
            ),
            cat(
                "The Muppets", "disney+/the_muppets",
                "animal", "beaker", "fozzie_bear", "gonzo", "janice", "kermit_the_frog", "miss_piggy", "pepe_the_king_prawn", "scooter",
                "the_swedish_chef",
            ),
            cat(
                "The Simpsons", "disney+/the_simpsons",
                "bart_simpson", "dr__julius_hibbert", "homer_simpson", "krusty_the_clown", "lisa_simpson", "maggie_simpson",
                "marge_simpson", "ralph_wiggum",
            ),
            cat(
                "Villains", "disney+/villains",
                "cruella_de_vil", "cruella_de_vil__e_stone", "dr__doofenshmirtz", "dr__facilier", "gaston", "hades", "jafar", "maleficent",
                "mother_gothel", "queen__snow_white", "queen_of_hearts", "randall_boggs", "scar", "ursula", "yzma",
            ),
        ),
    )

    // HBO : `src/data/new_avatars.ts`, platformAvatars["HBO"].
    private fun hbo() = AvatarGroup(
        "HBO",
        listOf(
            cat(
                "Adult Swim", "hbo/adult_swim",
                "1", "2", "3", "4", "5", "6", "7", "8",
            ),
            cat(
                "Adventure Time", "hbo/adventure_time",
                "1", "10", "11", "2", "3", "4", "5", "6", "7", "8", "9",
            ),
            cat(
                "Bbt", "hbo/bbt",
                "1", "2", "3", "4", "5", "6",
            ),
            cat(
                "Black Council", "hbo/black_council",
                "1", "2", "3", "4", "5", "6", "7",
            ),
            cat(
                "Cartoon Classics", "hbo/cartoon_classics",
                "1", "10", "11", "12", "13", "2", "3", "4", "5", "6", "7", "8", "9",
            ),
            cat(
                "Curb Enthusiasm", "hbo/curb_enthusiasm",
                "1", "2", "3", "4", "5",
            ),
            cat(
                "Dune Part Two", "hbo/dune_part_two",
                "1", "2", "3", "4", "5", "6", "7", "8",
            ),
            cat(
                "Friends", "hbo/friends",
                "1", "2", "3", "4", "5", "6",
            ),
            cat(
                "Game Of Thrones", "hbo/game_of_thrones",
                "1", "10", "11", "12", "13", "14", "15", "16", "2", "3", "4", "5", "6", "7", "8", "9",
            ),
            cat(
                "Gilded Age S3", "hbo/gilded_age_s3",
                "1", "10", "11", "12", "13", "2", "3", "4", "5", "6", "7", "8", "9",
            ),
            cat(
                "Gumball", "hbo/gumball",
                "1", "2", "3", "4", "5", "6",
            ),
            cat(
                "Harry Potter", "hbo/harry_potter",
                "1", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "2", "3", "4", "5", "6", "7", "8", "9",
            ),
            cat(
                "Peacemaker", "hbo/peacemaker",
                "1", "2", "3", "4", "5", "6", "7", "8", "9",
            ),
            cat(
                "Rick Morty", "hbo/rick_morty",
                "1", "2", "3", "4", "5", "6", "7", "8",
            ),
            cat(
                "Shark Week", "hbo/shark_week",
                "1", "2", "3", "4", "5", "6", "7", "8",
            ),
            cat(
                "Succession", "hbo/succession",
                "1", "2", "3", "4", "5", "6", "7",
            ),
            cat(
                "Supers Nanas", "hbo/supers_nanas",
                "1", "2", "3", "4",
            ),
            cat(
                "Task", "hbo/task",
                "1", "2", "3", "4", "5", "6", "7",
            ),
            cat(
                "The Flash", "hbo/the_flash",
                "1", "2", "3", "4", "5",
            ),
            cat(
                "The Green Council", "hbo/the_green_council",
                "1", "2", "3", "4", "5", "6", "7",
            ),
            cat(
                "The Last Of Us", "hbo/the_last_of_us",
                "1", "10", "11", "2", "3", "4", "5", "6", "7", "8", "9",
            ),
            cat(
                "The Sopranos", "hbo/the_sopranos",
                "1", "2", "3", "4", "5", "6", "7",
            ),
            cat(
                "The White Lotus", "hbo/the_white_lotus",
                "1", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "2", "20", "21", "22", "23", "3", "4", "5", "6", "7", "8",
                "9",
            ),
            cat(
                "Ttg", "hbo/ttg",
                "1", "2", "3", "4", "5", "6", "7", "8", "9",
            ),
        ),
    )

    // Netflix : `src/data/new_avatars.ts`, platformAvatars["Netflix"].
    private fun netflix() = AvatarGroup(
        "Netflix",
        listOf(
            cat(
                "Alice In Borderland", "netflix/alice_in_borderland",
                "aib-joker", "aib-jsais", "aib-kazuya", "aib-le", "aib", "aib_1", "aib_2", "aib_3", "aib_4", "aib_5", "aib_6", "aib_7",
            ),
            cat(
                "Arcane", "netflix/arcane",
                "caitlyn", "ekko", "heimerdinger", "jayce", "jinx", "mel", "poro", "sevika", "silco", "vander", "vi", "viktor",
            ),
            cat(
                "Avatar : Le Dernier Maître De L'Air", "netflix/avatar_le_dernier_maitre_de_l_air",
                "aang", "avatar_aang", "toph", "katara", "zuko", "sokka", "appa", "ozai", "momo", "iroh", "suki", "azula",
            ),
            cat(
                "Beauty In Black", "netflix/beauty_in_black",
                "alex", "angel", "charles", "horace", "jules", "kimmie", "mallory", "norman", "olivia", "rain", "roy", "varney",
            ),
            cat(
                "Big Mouth", "netflix/big_mouth",
                "andrew", "coach_steve", "connie", "jay", "jessi", "maury", "missy", "nick", "oreiller",
            ),
            cat(
                "Black Mirror", "netflix/black_mirror",
                "bandersnatch", "foulode", "glyphe", "icne_de_chargement", "poupe", "singe_en_peluche", "visage_moticne_casse", "waldo",
            ),
            cat(
                "Bojack Horseman", "netflix/bojack_horseman",
                "bojack", "diane", "m_peanutbutter", "princesse_carolyn", "todd",
            ),
            cat(
                "Chasseurs De Trolls", "netflix/chasseurs_de_trolls",
                "jim", "claire", "toby", "blinky", "argh", "draal", "nain_chompsky", "amulette",
            ),
            cat(
                "Classiques", "netflix/classiques",
                "scarlet_chilleez", "sunny_chilleez", "robin_chilleez", "dusty_chilleez", "superheros_violet", "moustache", "chien",
                "superheros_rouge", "pingouin_violet", "rire_rose", "poulet", "bandeau_de_pirate", "extraterrestre", "robot", "momie",
                "casque", "sourire_rouge", "sourire_gris_fonce", "sourire_jaune", "sourire_vert", "sourire_violet", "sourire_rose",
            ),
            cat(
                "Cobra Kai", "netflix/cobra_kai",
                "amanda", "anthony", "axel", "carmen", "chozen", "daniel", "devon", "dimitri", "johnny", "kenny", "kreese", "kwon",
                "laigle", "m_miyagi", "miguel", "robby", "samantha", "sensei_kim", "sensei_wolf", "terry_silver", "tory", "zara",
            ),
            cat(
                "Dark", "netflix/dark",
                "claudia", "jeune_jonas", "jeune_martha", "machine_voyager_dans_le_temps", "mikkel", "noah", "nud_de_la_trinit",
                "sombre_matire", "tannhaus", "vieille_martha", "vieux_jonas",
            ),
            cat(
                "Désenchantée", "netflix/désenchantée",
                "bean", "elfo", "luci", "oona", "stan_le_bourreau", "zog",
            ),
            cat(
                "Élite", "netflix/elite",
                "carla", "samuel", "lu", "guzman", "nadia", "polo", "rebeka", "ander", "cayetana", "valerio", "omar",
            ),
            cat(
                "Kpop Demon Hunters", "netflix/kpop_demon_hunters",
                "abby_saja", "baby_saja", "bobby", "derpy", "jinu", "mira", "mystery_saja", "romance_saja", "rumi", "sussie", "zoey",
            ),
            cat(
                "La Casa De Papel", "netflix/la_casa_de_papel",
                "berlin", "denver", "le_professeur", "lisbonne", "masque", "nairobi", "palerme", "rio", "sierra", "tokyo",
            ),
            cat(
                "La Chronique Des Bridgerton", "netflix/la_chronique_des_bridgerton",
                "chronique-des-bridgerton_anthony_brerton", "chronique-des-bridgerton_bndict_brierton",
                "chronique-des-bridgerton_colin_briderton", "chronique-des-bridgerton_daphn_briderton",
                "chronique-des-bridgerton_edwina_sharma", "chronique-des-bridgerton_francesca_erton",
                "chronique-des-bridgerton_kate_sharma", "chronique-des-bridgerton_la_reine_clotte",
                "chronique-des-bridgerton_lady_bridgerton", "chronique-des-bridgerton_lady_danbury",
                "chronique-des-bridgerton_lady_feathngton", "chronique-des-bridgerton_lady_whistedown",
                "chronique-des-bridgerton_lose_bridgerton", "chronique-des-bridgerton_marina_thompson",
                "chronique-des-bridgerton_pnlope_feangton", "chronique-des-bridgerton_simon_basset",
            ),
            cat(
                "Les Affaires Organisées", "netflix/les_affaires_organisees",
                "asim", "saruhan", "nefise", "lerzan", "sado", "riza", "sahbaz", "ziya", "nazli", "bahadir", "champion",
            ),
            cat(
                "Love, Death & Robots", "netflix/love,_death_&_robots",
                "death-&-robots_femme_dore", "death-&", "death-&_1", "death-&_2", "death-&_3", "death-&_4",
            ),
            cat(
                "Lucifer", "netflix/lucifer",
                "amenadiel", "avatar_de_profil", "chloe", "dan", "ella", "linda", "lucifer", "maze",
            ),
            cat(
                "Lupin", "netflix/lupin",
                "assane_lagent_de_scurit", "assane_lboueur", "assane_le_geek", "assane_le_gentleman_cambrioleur", "assane_le_sapeur",
                "assane_le_vieil_homme", "assane_le_voyou", "assane_lhomme_au_chapeau", "assane_lhomme_daffaires",
                "assane_lhomme_de_mnage", "assane_lhomme_lgant", "jaccuse", "la_perle_noire",
            ),
            cat(
                "Mercredi", "netflix/mercredi",
                "enid", "frere-de", "jeudi", "jspcqui", "la-mano", "la", "le-loup", "mere", "meuf-chelou", "nicotine", "pere",
                "sirenejcrois", "zombie",
            ),
            cat(
                "On My Block", "netflix/on_my_block",
                "cesar", "jamal", "jasmine", "juanita", "monse", "ruby", "spooky",
            ),
            cat(
                "One Piece", "netflix/one_piece",
                "arlong", "baggy", "escargophone", "garp", "kobby", "le_vogue_merry", "luffy", "mihawk", "nami", "pavillon", "sanji",
                "shanks", "usopp", "zoro", "luffy_v2", "nami_v2", "zoro_v2", "usopp_v2", "sanji_v2", "miss_wednesday", "chopper",
                "miss_allsunday", "le_vogue_merry_v2", "pavillon_des_chapeaux_de_paille",
            ),
            cat(
                "Orange Is The New Black", "netflix/orange_is_the_new_black",
                "is-the-new-black_black_cindy", "is-the-new-black_poulet_onb", "is-the", "is-the_1", "is-the_2", "is-the_3", "is-the_4",
                "is", "is_1", "is_2",
            ),
            cat(
                "Outer Banks", "netflix/outer_banks",
                "cleo", "jj", "john_b", "kiara", "pope", "rafe", "sarah",
            ),
            cat(
                "Peaky Blinders : L'Immortel", "netflix/peaky_blinders_l_immortel",
                "tommy", "duke", "kaulo", "hayden", "ada", "beckett",
            ),
            cat(
                "Perdus Dans L'Espace", "netflix/perdus_dans_l'espace",
                "dans-l'espace_don_west", "dans-l'espace_dr_smith", "dans-l'espace_john", "dans-l'espace_judy", "dans-l'espace_maureen",
                "dans-l'espace_penny", "dans-l'espace_poulet_lis", "dans-l'espace_robot", "dans-l'espace_will",
            ),
            cat(
                "Raw", "netflix/raw",
                "roman", "cody", "rhea", "oba", "penta", "stephanie", "cm_punk", "liv", "john_cena", "rey",
            ),
            cat(
                "Sandman", "netflix/sandman",
                "dsir", "irving", "johanna", "lucienne", "lucifer", "matthew", "mort", "rve",
            ),
            cat(
                "Sex Education", "netflix/sex_education",
                "adam", "aimee", "anwar", "cal", "eric", "isaac", "jackson", "jean", "lily", "maeve", "ola", "olivia", "otis", "rahim",
                "ruby", "viv",
            ),
            cat(
                "Squid Game", "netflix/squid_game",
                "alvole", "avatar_de_profil", "gi-hun", "gi", "hyun-ju", "in-ho", "jun-hee", "jun-ho", "leader", "manager_masqu",
                "masked_worker", "myung-gi", "no-eul", "officier_masqu", "recruteur", "soldat_masqu", "thanos", "tirelire", "young-hee",
                "squid_game_1",
            ),
            cat(
                "Stranger Things", "netflix/stranger_things",
                "avatar_de_profil", "dmogorgon", "dustin", "jonathan", "joyce", "lucas", "mike", "nancy", "onze", "steve", "will",
                "onze_v2", "mike_v2", "will_v2", "lucas_v2", "max", "dustin_v2", "steve_v2", "nancy_v2", "jonathan_v2", "robin", "hopper",
                "joyce_v2", "holly", "derek", "erica", "henry", "murray", "karen", "dr_kay", "demogorgon", "vecna",
            ),
            cat(
                "The Gentlemen", "netflix/the_gentlemen",
                "eddie_horniman", "susie_glass", "geoff", "bobby_glass", "jack_glass", "lady_sabrina", "jimmy", "stanley_johnston",
                "freddie_horniman", "charlotte_horniman",
            ),
            cat(
                "The Witcher", "netflix/the_witcher",
                "ablette", "ciri", "deux_pes", "geralt", "jaskier", "kikimorrhe", "lchi", "logo_the_witcher", "nivellen", "pe_joyeuse",
                "yennefer",
            ),
            cat(
                "Umbrella Academy", "netflix/umbrella_academy",
                "allison", "ben", "cinq", "diego", "klaus", "luther", "pogo", "viktor",
            ),
        ),
    )

    // Prime Video : `src/data/new_avatars.ts`, platformAvatars["Prime Video"].
    private fun primeVideo() = AvatarGroup(
        "Prime Video",
        listOf(
            cat(
                "Animaux", "prime_video/animaux",
                "chat_couleurdefond_orange", "chien_couleurdefond_jaune", "ecureuil_couleurdefond_rose", "gorille_couleurdefond_violet",
                "hippopotame_couleurdefond_roseclair", "koala_couleurdefond_bleuclair", "lama_couleurdefond_violet",
                "panda_couleurdefond_grisclair", "pingouin_couleurdefond_orangeclair", "poisson_couleurdefond_vertclair",
                "souris_couleurdefond_bleuclair", "yak_couleurdefond_bleuclair",
            ),
            cat(
                "Archétypes", "prime_video/archétypes",
                "artiste_couleurdefond_bleuclair", "astronaute_couleurdefond_roseclair", "athlete_couleurdefond_rouge",
                "chanteuse_couleurdefond_jauneclair", "detective_couleurdefond_bleu", "exploratrice_couleurdefond_jaune",
                "ninja_couleurdefond_violetclair", "pilotedecourse_couleurdefond_vertclair", "punk_couleurdefond_bleuclair",
                "scientifique_couleurdefond_bleuclair", "super-heros_couleurdefond_bleucanard", "vampire_couleurdefond_violet",
            ),
            cat(
                "Borat, Nouvelle Mission Filmée", "prime_video/borat,_nouvelle_mission_filmée",
                "borat_nouvellemissionfilmee_borat_n_rose", "borat_nouvellemissionfilmee_borat_nair_1",
                "borat_nouvellemissionfilmee_borat_nclair",
            ),
            cat(
                "Bosch", "prime_video/bosch",
                "bosch_harrybosch_couleurdefond_oranclair", "bosch_irvinirving_couleurdefond_orafonce",
                "bosch_jerryedgar_couleurdefond_bleufonce", "bosch_lieutenantgracebillets_couleuclair",
                "bosch_maddiebosch_couleurdefond_verclair",
            ),
            cat(
                "Fallout", "prime_video/fallout",
                "armureassistee_couleurdefond_rouge", "betty_couleurdefond_orangeclair", "chet_couleurdefond_orangeclair",
                "cooper_couleurdefond_bleuclair", "cx404_couleurdefond_violet", "dane_couleurd_arriere", "hank_couleurdefond_orangeclair",
                "lagoule_couleurdefond_bleuclair", "lucy_couleurdefond_orangeclair", "majune_couleurdefond_vertfonce",
                "max_couleurdefond_rouge", "moldaver_couleurdefond_vertfonce", "norm_couleurdefond_orangeclair",
                "reg_couleurdefond_orangeclair", "snipsnip_couleurdefond_rose", "steph_couleurdefond_orangeclair",
                "thaddeus_couleurdefond_rouge", "vaultboy_couleurdefond_orangeclair", "wilzig_couleurdefond_violet",
                "woody_couleurdefond_orangeclair",
            ),
            cat(
                "Fleabag", "prime_video/fleabag",
                "fleabag_claire_couleurdefond_bleuclair", "fleabag_fleabag_couleurdefond_orangclair",
                "fleabag_lepretre_couleurdefond_vertclair", "fleabag_marraine_couleurdefond_roseclair",
            ),
            cat(
                "Hazbin Hotel", "prime_video/hazbin_hotel",
                "hazbinhotel_hazbinhotel_adam_couleuiolet", "hazbinhotel_hazbinhotel_alastor_coufonce",
                "hazbinhotel_hazbinhotel_angeldust_c_rose", "hazbinhotel_hazbinhotel_blitzo_coulclair",
                "hazbinhotel_hazbinhotel_charliemornrouge", "hazbinhotel_hazbinhotel_husk_couleuclair",
                "hazbinhotel_hazbinhotel_lucifer_couclair", "hazbinhotel_hazbinhotel_lute_couleu_rose",
                "hazbinhotel_hazbinhotel_sirpentiousfonce", "hazbinhotel_hazbinhotel_vaggie_coulfonce",
                "hazbinhotel_hazbinhotel_valentino_cclair", "hazbinhotel_hazbinhotel_velvette_cofonce",
                "hazbinhotel_hazbinhotel_vox_couleurfonce",
            ),
            cat(
                "Humeurs", "prime_video/humeurs",
                "amoureuse_couleurdefond_jauneclair", "amusee_couleurdefond_grisclair", "bof_couleurdefond_grisclair",
                "concentre_couleurdefond_vert", "confiant_couleurdefond_grisclair", "endormie_couleurdefond_violet",
                "genee_couleurdefond_violetfonce", "heureux_couleurdefond_violetfonce", "joyeux1_couleurdefond_bleu",
                "joyeux2_couleurdefond_grisclair", "satisfait_couleurdefond_jauneclair", "triste_couleurdefond_bleufonce",
            ),
            cat(
                "Invincible", "prime_video/invincible",
                "amber_couleurdefond_rose", "atomeve_couleurdefond_vertclair", "blacksamson_couleurdefond_orangeclair",
                "cecilstedman_couleurdefond_rouge", "debbiegrayson_couleurdefond_violet", "invincible_couleurdefond_bleuclair",
                "monstergirl_couleurdefond_vertclair", "omni-man_couleurdefond_bleufonce", "rexsplode_couleurdefond_orangeclair",
                "robot_couleurdefond_vertfonce",
            ),
            cat(
                "Jack Ryan De Tom Clancy", "prime_video/jack_ryan_de_tom_clancy",
                "jackryandetomclancy_jackryandetomclair_1", "jackryandetomclancy_jackryandetomclair_2",
                "jackryandetomclancy_jackryandetomclclair", "jackryandetomclancy_jackryandetomclfonce",
                "jackryandetomclancy_jackryandetomclnce_1",
            ),
            cat(
                "L'Été Où Je Suis Devenue Jolie", "prime_video/l'été_où_je_suis_devenue_jolie",
                "l_eteoujesuisdevenuejolie_l_eteouje_rose", "l_eteoujesuisdevenuejolie_l_eteoujeair_1",
                "l_eteoujesuisdevenuejolie_l_eteoujeclair", "l_eteoujesuisdevenuejolie_l_eteoujefonce",
                "l_eteoujesuisdevenuejolie_l_eteoujerouge",
            ),
            cat(
                "La Légende De Vox Machina", "prime_video/la_légende_de_vox_machina",
                "lalegendedevoxmachina_lalegendedevo_rose", "lalegendedevoxmachina_lalegendedevoair_1",
                "lalegendedevoxmachina_lalegendedevoair_2", "lalegendedevoxmachina_lalegendedevoclair",
                "lalegendedevoxmachina_lalegendedevofonce", "lalegendedevoxmachina_lalegendedevoiolet",
                "lalegendedevoxmachina_lalegendedevorouge",
            ),
            cat(
                "La Roue Du Temps", "prime_video/la_roue_du_temps",
                "larouedutemps_larouedutemps_egwene_clair", "larouedutemps_larouedutemps_lan_coufonce",
                "larouedutemps_larouedutemps_mat_courouge", "larouedutemps_larouedutemps_moirainclair",
                "larouedutemps_larouedutemps_nynaeveiolet", "larouedutemps_larouedutemps_perrin_clair",
                "larouedutemps_larouedutemps_rand_cofonce",
            ),
            cat(
                "Le Seigneur Des Anneaux Les Anneauxuvoir", "prime_video/le_seigneur_des_anneaux_les_anneauxuvoir",
                "lesanneauxdepouvoir_leseigneurdesanair_1", "lesanneauxdepouvoir_leseigneurdesanair_2",
                "lesanneauxdepouvoir_leseigneurdesanair_3", "lesanneauxdepouvoir_leseigneurdesanair_4",
                "lesanneauxdepouvoir_leseigneurdesanair_5", "lesanneauxdepouvoir_leseigneurdesanair_6",
                "lesanneauxdepouvoir_leseigneurdesanair_7", "lesanneauxdepouvoir_leseigneurdesanclair",
                "lesanneauxdepouvoir_leseigneurdesanfonce", "lesanneauxdepouvoir_leseigneurdesaniolet",
                "lesanneauxdepouvoir_leseigneurdesanlet_1", "lesanneauxdepouvoir_leseigneurdesanlet_2",
                "lesanneauxdepouvoir_leseigneurdesanlet_3", "lesanneauxdepouvoir_leseigneurdesanlet_4",
                "lesanneauxdepouvoir_leseigneurdesannce_1", "lesanneauxdepouvoir_leseigneurdesannce_2",
                "lesanneauxdepouvoir_leseigneurdesannce_3", "lesanneauxdepouvoir_leseigneurdesannce_4",
                "lesanneauxdepouvoir_leseigneurdesanrange", "lesanneauxdepouvoir_leseigneurdesanrouge",
                "lesanneauxdepouvoir_leseigneurdesanuge_1", "lesanneauxdepouvoir_leseigneurdesanuge_2",
            ),
            cat(
                "Mme Maisel, Femme Fabuleuse", "prime_video/mme_maisel,_femme_fabuleuse",
                "mmemaisel_femmefabuleuse_mmemaisel__rose", "mmemaisel_femmefabuleuse_mmemaisel_air_1",
                "mmemaisel_femmefabuleuse_mmemaisel_clair", "mmemaisel_femmefabuleuse_mmemaisel_iolet",
                "mmemaisel_femmefabuleuse_mmemaisel_rouge",
            ),
            cat(
                "Sans Aucun Remords De Tom Clancy", "prime_video/sans_aucun_remords_de_tom_clancy",
                "sansaucunremordsdetomclancy_sansaucair_1", "sansaucunremordsdetomclancy_sansaucair_2",
                "sansaucunremordsdetomclancy_sansaucair_3", "sansaucunremordsdetomclancy_sansaucclair",
                "sansaucunremordsdetomclancy_sansaucfonce", "sansaucunremordsdetomclancy_sansaucnce_1",
                "sansaucunremordsdetomclancy_sansaucnce_2", "sansaucunremordsdetomclancy_sansaucrouge",
                "sansaucunremordsdetomclancy_sansaucuge_1",
            ),
            cat(
                "The Boys", "prime_video/the_boys",
                "theboys_theboys_a-train_couleurdefoclair", "theboys_theboys_billybutcher_couleuclair",
                "theboys_theboys_blacknoir_couleurdeclair", "theboys_theboys_hughiecampbell_coulrouge",
                "theboys_theboys_kimiko_couleurdefoniolet", "theboys_theboys_l_homme-poisson_coufonce",
                "theboys_theboys_lacreme_couleurdefoclair", "theboys_theboys_lefrancais_couleurdfonce",
                "theboys_theboys_leprotecteur_couleurouge", "theboys_theboys_reinemaeve_couleurdclair",
                "theboys_theboys_soldierboy_couleurdfonce", "theboys_theboys_stella_couleurdefonclair",
            ),
            cat(
                "Un Prince À New York 2", "prime_video/un_prince_à_new_york_2",
                "unprinceanewyork2_unprinceanewyork2_rose", "unprinceanewyork2_unprinceanewyork2air_1",
                "unprinceanewyork2_unprinceanewyork2air_2", "unprinceanewyork2_unprinceanewyork2air_3",
                "unprinceanewyork2_unprinceanewyork2clair", "unprinceanewyork2_unprinceanewyork2fonce",
                "unprinceanewyork2_unprinceanewyork2iolet", "unprinceanewyork2_unprinceanewyork2nce_1",
                "unprinceanewyork2_unprinceanewyork2nce_2", "unprinceanewyork2_unprinceanewyork2nce_3",
                "unprinceanewyork2_unprinceanewyork2nce_4", "unprinceanewyork2_unprinceanewyork2range",
                "unprinceanewyork2_unprinceanewyork2rouge",
            ),
            cat(
                "Upload", "prime_video/upload",
                "upload_a_i_guy_couleurdefond_vertclair", "upload_aleesha_couleurdefond_bleuclair", "upload_ingrid_couleurdefond_rose",
                "upload_luke_couleurdefond_rouge", "upload_nathan_couleurdefond_orangeclair", "upload_nora_couleurdefond_violet",
            ),
            cat(
                "With Love", "prime_video/with_love",
                "withlove_withlove_beatrizdiaz_couleiolet", "withlove_withlove_drmilesmurphy_coufonce",
                "withlove_withlove_gladysdelgado_coufonce", "withlove_withlove_henrycruz_couleurclair",
                "withlove_withlove_jorgediazjr_coulefonce", "withlove_withlove_jorgediazsr_couleclair",
                "withlove_withlove_lilydiaz_couleurd_rose", "withlove_withlove_luisdelgado_couleclair",
                "withlove_withlove_martadelgado_coulfonce", "withlove_withlove_nickzhao_couleurdiolet",
                "withlove_withlove_santiagozayas_couclair", "withlove_withlove_solperez_couleurd_rose",
            ),
            cat(
                "À Contre-Sens 2", "prime_video/à_contre-sens_2",
                "acontre-sens2_acontre-sens2_anabel_clair", "acontre-sens2_acontre-sens2_briar_cclair",
                "acontre-sens2_acontre-sens2_jenna_cclair", "acontre-sens2_acontre-sens2_lion_coclair",
                "acontre-sens2_acontre-sens2_michaelfonce", "acontre-sens2_acontre-sens2_nick_cofonce",
                "acontre-sens2_acontre-sens2_noah_corouge", "acontre-sens2_acontre-sens2_rafaell_rose",
                "acontre-sens2_acontre-sens2_sophia_fonce", "acontre-sens2_acontre-sens2_williamfonce",
            ),
        ),
    )

    // « Classiques » : `src/data/avatars.ts`, avatarCategories.
    private fun classics() = AvatarGroup(
        CLASSICS,
        listOf(
            numbered("Disney", "disney", "disney_avatar", 1..53, skip = setOf(16)),
            numbered("Disney Channel", "disney_channel", "disneychannel_avatar", 1..37),
            numbered("Marvel", "marvel", "marvel_avatar", 1..35),
            numbered("Mickey", "mickey", "mickey_avatar", 1..15),
            numbered("Pixar", "pixar", "pixar_avatar", 1..47),
            numbered("Simpsons", "simpsons", "simpson_avatar", 1..8),
            numbered("Star Wars", "starwars", "starwars_avatar", 1..34),
        ),
    )
}
