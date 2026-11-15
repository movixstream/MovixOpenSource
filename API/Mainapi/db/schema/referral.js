const { TABLE_OPTIONS, column: c, index: i, uniqueIndex: u } = require('./helpers');
// Parrainage : réglages (une ligne, id = 1), un code par compte, un parrainage
// par filleul et les jours VIP gagnés, que le site récupère ensuite.
// Créées au démarrage depuis cette définition (app.js, groupe `referral`).
const table = (name, columns, primaryKey, indexes = []) => ({ name, group: 'referral', wrapped: false, columns, primaryKey, indexes, foreignKeys: [], options: TABLE_OPTIONS });
const account = (prefix) => [c(`${prefix}user_type`,'VARCHAR(16) NOT NULL','varchar(16)',false),c(`${prefix}user_id`,'VARCHAR(255) NOT NULL','varchar(255)',false)];
const createdAt = () => c('created_at','TIMESTAMP DEFAULT CURRENT_TIMESTAMP','timestamp',true,'CURRENT_TIMESTAMP');
const referralTables = [
  table('referral_settings',[c('id','TINYINT UNSIGNED NOT NULL','tinyint unsigned',false),c('settings_json','LONGTEXT NOT NULL','longtext',false),c('updated_by','VARCHAR(255) DEFAULT NULL','varchar(255)',true),createdAt(),c('updated_at','TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP','timestamp',true,'CURRENT_TIMESTAMP','on update CURRENT_TIMESTAMP')],['id']),
  // Dernière IP et dernier appareil vus quand le parrain ouvre son code
  // (empreintes HMAC) : un filleul au même endroit n'est pas accepté.
  // `account_created_ms` = création du compte estimée à la création du code,
  // pour ne pas la recalculer à chaque visite (null = inconnue).
  table('referral_codes',[...account(''),c('code','VARCHAR(16) NOT NULL','varchar(16)',false),c('last_ip_hash','VARCHAR(64) DEFAULT NULL','varchar(64)',true),c('last_client_hash','VARCHAR(64) DEFAULT NULL','varchar(64)',true),c('account_created_ms','BIGINT DEFAULT NULL','bigint',true),createdAt()],['user_type','user_id'],[u('uq_referral_codes_code',['code'])]),
  // `watch_seconds` vient du Wrapped (utils/referralProgress.js) ;
  // `last_watch_day` = jour de Paris (AAAA-MM-JJ), indépendant du fuseau MySQL.
  // Les pseudos sont copiés au moment du parrainage pour la liste de l'admin.
  table('referrals',[
    c('id','INT UNSIGNED NOT NULL AUTO_INCREMENT','int unsigned',false,null,'auto_increment'),...account('referrer_'),...account('referee_'),c('code','VARCHAR(16) NOT NULL','varchar(16)',false),
    c('referrer_name','VARCHAR(64) DEFAULT NULL','varchar(64)',true),c('referee_name','VARCHAR(64) DEFAULT NULL','varchar(64)',true),
    c('status',"ENUM('pending','rewarded','cancelled') NOT NULL DEFAULT 'pending'",'enum',false,'pending'),
    c('watch_seconds','INT UNSIGNED NOT NULL DEFAULT 0','int unsigned',false,'0'),c('watch_days','SMALLINT UNSIGNED NOT NULL DEFAULT 0','smallint unsigned',false,'0'),
    c('last_watch_day','VARCHAR(10) DEFAULT NULL','varchar(10)',true),
    c('ip_hash','VARCHAR(64) DEFAULT NULL','varchar(64)',true),c('client_hash','VARCHAR(64) DEFAULT NULL','varchar(64)',true),
    createdAt(),c('rewarded_at','DATETIME DEFAULT NULL','datetime',true),c('cancelled_at','DATETIME DEFAULT NULL','datetime',true),c('cancelled_by','VARCHAR(255) DEFAULT NULL','varchar(255)',true),
  ],['id'],[u('uq_referrals_referee',['referee_user_type','referee_user_id']),i('idx_referrals_referrer',['referrer_user_type','referrer_user_id']),i('idx_referrals_status',['status','created_at']),i('idx_referrals_ip',['ip_hash','created_at']),i('idx_referrals_created',['created_at'])]),
  table('referral_rewards',[
    c('id','INT UNSIGNED NOT NULL AUTO_INCREMENT','int unsigned',false,null,'auto_increment'),c('referral_id','INT UNSIGNED NOT NULL','int unsigned',false),
    c('role',"ENUM('referrer','referee') NOT NULL",'enum',false),...account(''),c('days','SMALLINT UNSIGNED NOT NULL','smallint unsigned',false),
    c('status',"ENUM('available','redeemed') NOT NULL DEFAULT 'available'",'enum',false,'available'),c('access_key','VARCHAR(255) DEFAULT NULL','varchar(255)',true),
    createdAt(),c('redeemed_at','DATETIME DEFAULT NULL','datetime',true),
  ],['id'],[u('uq_referral_rewards_role',['referral_id','role']),i('idx_referral_rewards_owner',['user_type','user_id','status']),i('idx_referral_rewards_cap',['role','user_type','user_id','created_at'])]),
];
module.exports = { referralTables };
