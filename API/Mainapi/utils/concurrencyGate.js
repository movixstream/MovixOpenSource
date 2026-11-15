'use strict';

// Porte à places limitées : au plus `max` tâches en cours, les suivantes
// attendent leur tour dans l'ordre d'arrivée. Une place libérée passe
// directement à la tâche qui attend (jamais plus de `max` à la fois, même si
// une nouvelle tâche arrive au même instant).
function createGate(max) {
  let active = 0;
  const waiting = [];
  return async function run(task) {
    if (active >= max) {
      await new Promise((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

module.exports = { createGate };
