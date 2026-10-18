const helpers = require('./helpers');
const { coreTables } = require('./core');
const { communityTables } = require('./community');
const { oauthTables } = require('./oauth');
const { vipTables } = require('./vip');
const { wrappedTables } = require('./wrapped');
const { historyTables } = require('./history');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

const schema = Object.freeze(
  [...coreTables, ...communityTables, ...oauthTables, ...vipTables, ...wrappedTables, ...historyTables]
    .map((table) => deepFreeze({ ...table })),
);
function getTable(name) { return schema.find((table) => table.name === name) || null; }
function getTablesByGroup(group) { return schema.filter((table) => table.group === group); }
module.exports = { ...helpers, schema, getTable, getTablesByGroup };
