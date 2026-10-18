const test = require('node:test');
const assert = require('node:assert/strict');

const { getTable, getTablesByGroup, renderCreateTable, TABLE_OPTIONS } = require('../schema');

test('le groupe history contient les 6 tables de l\'historique', () => {
  const names = getTablesByGroup('history').map((table) => table.name).sort();
  assert.deepEqual(names, [
    'tmdb_episodes',
    'tmdb_media',
    'watch_history',
    'watch_history_imports',
    'watch_marks',
    'watch_progress',
  ]);
  for (const table of getTablesByGroup('history')) {
    assert.equal(table.options, TABLE_OPTIONS);
  }
});

test('watch_progress a une clé primaire propriétaire + titre + épisode', () => {
  const sql = renderCreateTable(getTable('watch_progress'));
  assert.ok(
    sql.includes('PRIMARY KEY (`user_type`, `user_id`, `profile_id`, `media_type`, `tmdb_id`, `season`, `episode`)'),
    sql,
  );
});

test('les clés primaires et l\'index récent suivent le plan', () => {
  assert.deepEqual(getTable('tmdb_media').primaryKey, ['media_type', 'tmdb_id', 'language']);
  assert.deepEqual(getTable('tmdb_episodes').primaryKey, ['tmdb_id', 'season', 'episode', 'language']);
  assert.deepEqual(getTable('watch_history').primaryKey, ['user_type', 'user_id', 'profile_id', 'media_type', 'tmdb_id']);
  assert.deepEqual(getTable('watch_history_imports').primaryKey, ['user_type', 'user_id', 'profile_id']);
  const recent = getTable('watch_history').indexes.find((index) => index.name === 'idx_history_recent');
  assert.deepEqual(recent?.columns, ['user_type', 'user_id', 'profile_id', 'last_watched_at']);
});

test('watch_marks : une ligne par marque « Déjà vu », 0/0 pour le titre entier', () => {
  const marks = getTable('watch_marks');
  assert.equal(marks.group, 'history');
  assert.deepEqual(marks.primaryKey, ['user_type', 'user_id', 'profile_id', 'media_type', 'tmdb_id', 'season', 'episode']);
  const sql = renderCreateTable(marks);
  assert.ok(sql.includes("`media_type` ENUM('movie','tv') NOT NULL"), sql);
  assert.ok(sql.includes('`tmdb_id` INT NOT NULL'), sql);
  assert.ok(sql.includes('`season` SMALLINT NOT NULL DEFAULT 0'), sql);
  assert.ok(sql.includes('`episode` SMALLINT NOT NULL DEFAULT 0'), sql);
  assert.ok(sql.includes('`marked_at` DATETIME(3) NOT NULL'), sql);
});
