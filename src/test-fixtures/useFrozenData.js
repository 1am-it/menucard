'use strict';

// BE-76 (#189) — één vaste kopie van de kaartdata voor alle tests.
//
// Ruim 4400 tests hingen aan data/menus.json en data/restaurants.json: aantallen,
// gerecht-id's, namen, hashes, sitemap-aantallen en benchmark-snapshots. Elke
// nieuwe of ververste kaart brak daardoor tientallen tests. Deze module zet,
// met het require.cache-patroon, een vaste kopie klaar voor elke module die de
// data laadt. Een test die van de inhoud afhangt, laadt deze module als eerste
// regel en roept `useFrozenData()` aan.
//
// Sets (alles onder src/test-fixtures/frozen-data/):
//   current      de data van de merge-commit van BE-74 en BE-75 (f0665ab)
//   maart-2026   de kaarten van maart, waarop BE-71 en BE-74 zijn geschreven
//   before-be75  de 25 restaurants van vóór BE-75 (commit cebfc80)
//
// De levende data wordt door src/lib/liveDataContract.test.js bewaakt: alleen
// regels, nooit aantallen. Zo blijft de echte data gecontroleerd zonder dat een
// nieuwe kaart een test breekt.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_NAMES = ['menus', 'restaurants'];

const SETS = {
  current: path.join(__dirname, 'frozen-data'),
  'maart-2026': path.join(__dirname, 'frozen-data', 'maart-2026'),
  'before-be75': path.join(__dirname, 'frozen-data', 'before-be75'),
};

function frozenPath(set, name) {
  return path.join(SETS[set], `${name}.json`);
}

// Zet de vaste kopie in de modulecache, vóór de module onder test geladen wordt.
// Zonder `names` doet de set mee met de bestanden die hij heeft.
function useFrozenData(set = 'current', names = null) {
  const dir = SETS[set];
  if (!dir) {
    throw new Error(`onbekende set "${set}"; kies uit ${Object.keys(SETS).join(', ')}`);
  }

  const wanted = names ? [].concat(names) : DATA_NAMES.filter((name) => fs.existsSync(frozenPath(set, name)));
  if (!wanted.length) throw new Error(`set "${set}" heeft geen kaartdata`);

  const loaded = {};
  for (const name of wanted) {
    const frozen = frozenPath(set, name);
    if (!fs.existsSync(frozen)) {
      throw new Error(`set "${set}" heeft geen ${name}.json (${frozen})`);
    }
    const real = require.resolve(path.join(REPO_ROOT, 'data', `${name}.json`));
    const copy = require(frozen);
    require.cache[real] = { id: real, filename: real, loaded: true, exports: copy };
    loaded[name] = copy;
  }
  return loaded;
}

module.exports = { useFrozenData, frozenPath, SETS, DATA_NAMES };
