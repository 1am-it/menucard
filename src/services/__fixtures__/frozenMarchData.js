'use strict';

// BE-74 (#185): de kaarten van maart als vaste kopie.
//
// Tests en de benchmark die zijn geschreven op de kaarten van maart (de
// gerecht-id's, de aantallen, de vier-kaarten-manifest) horen niet te breken
// zodra de levende data wordt ververst. Ze draaien daarom op deze bevroren
// kopie in plaats van op data/menus.json en data/restaurants.json.
//
// Patroon: dezelfde require.cache-truc als src/services/dishSearch.test.js.
// Wie `freezeMarchData()` aanroept vóór het laden van een module die de data
// leest, krijgt hier de kopie. De verwachtingen in die tests blijven gelijk.

const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, 'dishSearch-data');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function freezeMarchData(names = ['menus', 'restaurants']) {
  for (const name of names) {
    const real = require.resolve(path.join(REPO_ROOT, 'data', `${name}.json`));
    const frozen = path.join(FIXTURE_DIR, `${name}.json`);
    require.cache[real] = { id: real, filename: real, loaded: true, exports: require(frozen) };
  }
}

module.exports = { freezeMarchData };
