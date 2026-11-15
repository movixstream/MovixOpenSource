const { TABLE_OPTIONS, column: c, index: i } = require('./helpers');
// Index du catalogue d'anime-sama : une ligne par fiche (`/catalogue/<slug>/`),
// avec l'ID TMDB que la fiche publie (à défaut, celui que donne son ID AniList
// ou MyAnimeList), et le planning des sorties de la semaine.
// Rempli par une tâche de fond (utils/animeSamaIndex.js) ; sert la fiche par ID
// TMDB, la page Animes et le calendrier.
// Créées au démarrage depuis cette définition (app.js, groupe `animeSama`).
//
// `genres` et `languages` sont des listes encadrées de barres (`|Action|Drame|`)
// pour filtrer une valeur exacte avec LIKE, sans fonction JSON.
// Les dates sont en millisecondes Unix, sauf `release_at` (secondes, comme sur
// le site) et `day` (`AAAA-MM-JJ`).
const table = (name, columns, primaryKey, indexes = []) => ({ name, group: 'animeSama', wrapped: false, columns, primaryKey, indexes, foreignKeys: [], options: TABLE_OPTIONS });
const animeSamaTables = [
  table('anime_sama_titles',[c('slug','VARCHAR(191) NOT NULL','varchar(191)',false),c('name','VARCHAR(255) NOT NULL','varchar(255)',false),c('alt_names','TEXT DEFAULT NULL','text',true),c('synopsis','TEXT DEFAULT NULL','text',true),c('genres',"VARCHAR(512) NOT NULL DEFAULT ''",'varchar(512)',false,''),c('image','VARCHAR(512) DEFAULT NULL','varchar(512)',true),c('poster_path','VARCHAR(128) DEFAULT NULL','varchar(128)',true),c('tmdb_type','VARCHAR(8) DEFAULT NULL','varchar(8)',true),c('tmdb_id','INT UNSIGNED DEFAULT NULL','int unsigned',true),c('anilist_id','INT UNSIGNED DEFAULT NULL','int unsigned',true),c('mal_id','INT UNSIGNED DEFAULT NULL','int unsigned',true),c('format',"VARCHAR(64) NOT NULL DEFAULT ''",'varchar(64)',false,''),c('status',"VARCHAR(64) NOT NULL DEFAULT ''",'varchar(64)',false,''),c('year','SMALLINT UNSIGNED DEFAULT NULL','smallint unsigned',true),c('languages',"VARCHAR(128) NOT NULL DEFAULT ''",'varchar(128)',false,''),c('season_count','SMALLINT UNSIGNED NOT NULL DEFAULT 0','smallint unsigned',false,'0'),c('hidden_seasons','SMALLINT UNSIGNED NOT NULL DEFAULT 0','smallint unsigned',false,'0'),c('has_scans','TINYINT(1) NOT NULL DEFAULT 0','tinyint(1)',false,'0'),c('first_seen_at','BIGINT UNSIGNED NOT NULL','bigint unsigned',false),c('checked_at','BIGINT UNSIGNED NOT NULL DEFAULT 0','bigint unsigned',false,'0'),c('missing_since','BIGINT UNSIGNED DEFAULT NULL','bigint unsigned',true)],['slug'],[i('idx_anime_sama_titles_tmdb',['tmdb_type','tmdb_id']),i('idx_anime_sama_titles_checked',['checked_at'])]),
  table('anime_sama_planning',[c('day','CHAR(10) NOT NULL','char(10)',false),c('slug','VARCHAR(191) NOT NULL','varchar(191)',false),c('season_path','VARCHAR(100) NOT NULL','varchar(100)',false),c('lang','VARCHAR(16) NOT NULL','varchar(16)',false),c('name','VARCHAR(255) NOT NULL','varchar(255)',false),c('release_at','INT UNSIGNED DEFAULT NULL','int unsigned',true),c('label',"VARCHAR(255) NOT NULL DEFAULT ''",'varchar(255)',false,''),c('state',"VARCHAR(16) NOT NULL DEFAULT 'scheduled'",'varchar(16)',false,'scheduled'),c('updated_at','BIGINT UNSIGNED NOT NULL','bigint unsigned',false)],['day','slug','season_path','lang']),
];
module.exports = { animeSamaTables };
