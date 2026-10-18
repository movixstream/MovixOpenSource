'use strict';

// Faux pool mysql2 pour les magasins de l'historique : chaque appel est
// enregistré ({ sql, params }, SQL aux espaces normalisés) et le résultat
// vient d'un gestionnaire fourni par le test. Un gestionnaire qui ne renvoie
// rien donne `{ affectedRows: 1 }`, comme une écriture réussie.

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

// `method` de chaque appel : `execute` (requête préparée, texte fixe) ou
// `query` (liste IN/VALUES de longueur variable, toujours avec des `?`).
function createFakeHistoryPool(handler = () => undefined) {
  const calls = [];
  const run = (method) => async (sql, params = []) => {
    const call = { method, sql: normalizeSql(sql), params: [...params] };
    calls.push(call);
    const result = await handler(call.sql, call.params);
    if (result === undefined) return [{ affectedRows: 1 }, []];
    return [result, []];
  };
  const pool = { execute: run('execute'), query: run('query') };

  return {
    pool,
    calls,
    // Appels dont le SQL contient le fragment donné (chaîne ou RegExp).
    callsMatching(fragment) {
      return calls.filter((call) => (
        fragment instanceof RegExp ? fragment.test(call.sql) : call.sql.includes(fragment)
      ));
    },
  };
}

module.exports = { createFakeHistoryPool, normalizeSql };
