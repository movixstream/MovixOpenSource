const { TABLE_OPTIONS, column: c } = require('./helpers');
const monetizationTables = [
  // Créée au démarrage depuis cette définition (utils/monetizationSettings.js) ; une seule ligne, id = 1.
  { name: 'monetization_settings', group: 'monetization', wrapped: false, columns: [c('id','TINYINT UNSIGNED NOT NULL','tinyint unsigned',false),c('settings_json','LONGTEXT NOT NULL','longtext',false),c('updated_by','VARCHAR(255) DEFAULT NULL','varchar(255)',true),c('created_at','TIMESTAMP DEFAULT CURRENT_TIMESTAMP','timestamp',true,'CURRENT_TIMESTAMP'),c('updated_at','TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP','timestamp',true,'CURRENT_TIMESTAMP','on update CURRENT_TIMESTAMP')], primaryKey: ['id'], indexes: [], foreignKeys: [], options: TABLE_OPTIONS },
  // Ouvertures par jour de Paris, pub (`none` sans pub éligible) et emplacement, gardées sans limite.
  // Créée au démarrage depuis cette définition (utils/monetizationStats.js).
  { name: 'monetization_daily_stats', group: 'monetization', wrapped: false, columns: [c('day','DATE NOT NULL','date',false),c('ad_id','VARCHAR(16) NOT NULL','varchar(16)',false),c('placement','VARCHAR(16) NOT NULL','varchar(16)',false),c('openings','INT UNSIGNED NOT NULL DEFAULT 0','int unsigned',false,'0')], primaryKey: ['day','ad_id','placement'], indexes: [], foreignKeys: [], options: TABLE_OPTIONS },
];
module.exports = { monetizationTables };
