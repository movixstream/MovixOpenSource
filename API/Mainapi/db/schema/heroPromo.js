const { TABLE_OPTIONS, column: c, index: i } = require('./helpers');
// Promos du grand carrousel (bannière du haut de l'accueil, des films, des
// séries, des plateformes et des animés) : réglages (une ligne, id = 1), clics par jour de Paris
// et images envoyées depuis l'admin. Les images restent en base pour survivre
// aux redéploiements du conteneur.
// Créées au démarrage depuis cette définition (app.js, groupe `heroPromo`).
const table = (name, columns, primaryKey, indexes = []) => ({ name, group: 'heroPromo', wrapped: false, columns, primaryKey, indexes, foreignKeys: [], options: TABLE_OPTIONS });
const createdAt = () => c('created_at','TIMESTAMP DEFAULT CURRENT_TIMESTAMP','timestamp',true,'CURRENT_TIMESTAMP');
const heroPromoTables = [
  table('hero_promo_settings',[c('id','TINYINT UNSIGNED NOT NULL','tinyint unsigned',false),c('settings_json','LONGTEXT NOT NULL','longtext',false),c('updated_by','VARCHAR(255) DEFAULT NULL','varchar(255)',true),createdAt(),c('updated_at','TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP','timestamp',true,'CURRENT_TIMESTAMP','on update CURRENT_TIMESTAMP')],['id']),
  table('hero_promo_daily_clicks',[c('day','DATE NOT NULL','date',false),c('promo_id','VARCHAR(16) NOT NULL','varchar(16)',false),c('clicks','INT UNSIGNED NOT NULL DEFAULT 0','int unsigned',false,'0')],['day','promo_id'],[i('idx_hero_promo_clicks_promo',['promo_id','day'])]),
  table('hero_promo_images',[c('id','VARCHAR(16) NOT NULL','varchar(16)',false),c('mime_type','VARCHAR(32) NOT NULL','varchar(32)',false),c('byte_size','INT UNSIGNED NOT NULL','int unsigned',false),c('data','MEDIUMBLOB NOT NULL','mediumblob',false),c('created_by','VARCHAR(255) DEFAULT NULL','varchar(255)',true),createdAt()],['id'],[i('idx_hero_promo_images_created',['created_at'])]),
];
module.exports = { heroPromoTables };
