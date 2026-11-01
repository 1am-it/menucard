'use strict';

// BE-75 (#187) — vier gesloten restaurants (3 Con Fuego, 10 Salon de
// Provence, 14 The Chai Affairs, 18 Masala) zijn uit data/restaurants.json
// verdwenen. Tests die van die vier of van het oude totaal (25) afhangen,
// draaien daarom op deze vaste kopie van de data van vóór die wijziging
// (`restaurants.json`, gelijk aan commit cebfc80).
//
// Zelfde patroon als src/services/dishSearch.test.js: de modulecache krijgt de
// kopie vóór de module onder test geladen wordt. De verwachtingen in die tests
// zijn niet veranderd; alleen de bron van de data is vastgezet.
//
// De echte, levende data blijft de bron voor de nieuwe BE-75-regressies in
// src/lib/be75ClosedRestaurants.test.js.

const path = require('node:path');

const FIXTURE = path.join(__dirname, 'restaurants.json');

function useRestaurantsBeforeBe75() {
  const real = require.resolve(path.resolve(__dirname, '..', '..', '..', '..', 'data', 'restaurants.json'));
  require.cache[real] = {
    id: real,
    filename: real,
    loaded: true,
    exports: require(FIXTURE),
  };
  return require.cache[real].exports;
}

module.exports = { FIXTURE, useRestaurantsBeforeBe75 };
