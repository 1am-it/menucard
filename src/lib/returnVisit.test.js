'use strict';

// BE-62 (#153) — de teksten en de kop van het terugkomvlak, plus de volgorde
// van de eigen stemmen die de kop ("Jij koos <gerecht>") mogelijk maakt.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HOME_HREF,
  KIES_RETURN_BODY,
  KIES_RETURN_CTA,
  KIES_RETURN_TITLE_FALLBACK,
  SHARED_RETURN_BODY,
  SHARED_RETURN_CTA,
  SHARED_RETURN_TITLE,
  firstLekkerDish,
  firstLekkerDishName,
  kiesReturnTitle,
} = require('./returnVisit');
const {
  nextVotedDishes,
  readKiesProgress,
  undoVotedDishes,
  writeKiesProgress,
} = require('./kiesStemming');

const STEMMER = 'abcdefghijklmnop';
const CODE = 'AbCdEfGhJkLmNoPqRsTuVwX';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

const DISHES = [
  { id: 'm1-0-0', name: 'Poussin' },
  { id: 'm1-0-1', name: 'Risotto' },
  { id: 'm1-0-2', name: 'Tiramisu' },
];

test('BE-62: de teksten staan exact zoals het ontwerp ze vraagt', () => {
  assert.equal(KIES_RETURN_TITLE_FALLBACK, 'Zelf ook een lijstje maken?');
  assert.equal(KIES_RETURN_BODY, 'Zoek op gerecht in alle menukaarten van Breda, altijd met prijs. Geen account nodig.');
  assert.equal(KIES_RETURN_CTA, 'Zoek een gerecht →');
  assert.equal(SHARED_RETURN_TITLE, 'Zelf ook zin in iets?');
  assert.equal(SHARED_RETURN_BODY, 'Zoek op gerecht in alle menukaarten van Breda. Geen app of account nodig.');
  assert.equal(SHARED_RETURN_CTA, 'Zoek een gerecht');
  // Allebei naar de bestaande home; geen nieuwe route.
  assert.equal(HOME_HREF, '/');
});

test('BE-62: de kop noemt het gekozen gerecht en valt netjes terug', () => {
  assert.equal(kiesReturnTitle('Poussin'), 'Jij koos Poussin. Zelf ook een lijstje maken?');
  assert.equal(kiesReturnTitle('  Poussin  '), 'Jij koos Poussin. Zelf ook een lijstje maken?');
  assert.equal(kiesReturnTitle(null), 'Zelf ook een lijstje maken?');
  assert.equal(kiesReturnTitle(''), 'Zelf ook een lijstje maken?');
  assert.equal(kiesReturnTitle('   '), 'Zelf ook een lijstje maken?');
  assert.equal(kiesReturnTitle(undefined), KIES_RETURN_TITLE_FALLBACK);
});

test('BE-62: het eerste "lekker"-gerecht is het gerecht uit de kop', () => {
  assert.equal(firstLekkerDishName({ dishes: DISHES, lekker: ['m1-0-1'] }), 'Risotto');
  assert.equal(firstLekkerDishName({ dishes: DISHES, lekker: ['m1-0-2', 'm1-0-0'] }), 'Tiramisu');
  // Een onbekend of verdwenen id telt niet en wordt overgeslagen.
  assert.equal(firstLekkerDishName({ dishes: DISHES, lekker: ['weg-0-0', 'm1-0-1'] }), 'Risotto');
  assert.equal(firstLekkerDishName({ dishes: DISHES, lekker: ['weg-0-0'] }), null);
  assert.equal(firstLekkerDishName({ dishes: DISHES, lekker: [] }), null);
  assert.equal(firstLekkerDishName({}), null);
  assert.equal(firstLekkerDish({ dishes: DISHES, lekker: ['m1-0-0'] }).name, 'Poussin');
});

test('BE-62: "liever niet" haalt een gerecht uit de lekker-volgorde', () => {
  let progress = { stemmer: STEMMER, roepnaam: 'Sam', gestemd: [], lekker: [] };
  progress = { ...progress, ...nextVotedDishes(progress, { dishKey: 'm1-0-0', lekker: true }) };
  assert.deepEqual(progress.lekker, ['m1-0-0']);
  progress = { ...progress, ...nextVotedDishes(progress, { dishKey: 'm1-0-1', lekker: false }) };
  assert.deepEqual(progress.gestemd, ['m1-0-0', 'm1-0-1']);
  assert.deepEqual(progress.lekker, ['m1-0-0']);
  // Opnieuw stemmen op een eerder "lekker"-gerecht houdt de eerste plek.
  progress = { ...progress, ...nextVotedDishes(progress, { dishKey: 'm1-0-0', lekker: true }) };
  assert.deepEqual(progress.gestemd, ['m1-0-1', 'm1-0-0']);
  assert.deepEqual(progress.lekker, ['m1-0-0']);
  // En "liever niet" op datzelfde gerecht haalt het weg.
  progress = { ...progress, ...nextVotedDishes(progress, { dishKey: 'm1-0-0', lekker: false }) };
  assert.deepEqual(progress.lekker, []);
});

test('BE-62: ongedaan maken zet de lekker-volgorde terug', () => {
  const progress = {
    stemmer: STEMMER,
    roepnaam: 'Sam',
    gestemd: ['m1-0-0', 'm1-0-1'],
    lekker: ['m1-0-0'],
  };
  const undone = undoVotedDishes(progress);
  assert.deepEqual(undone.gestemd, ['m1-0-0']);
  assert.deepEqual(undone.lekker, ['m1-0-0']);
  const twice = undoVotedDishes({ ...progress, gestemd: undone.gestemd, lekker: undone.lekker });
  assert.deepEqual(twice.gestemd, []);
  assert.deepEqual(twice.lekker, []);
  // Zonder stemmen gebeurt er niets.
  assert.deepEqual(undoVotedDishes(null), { gestemd: [], lekker: [] });
});

test('BE-62: de volgorde blijft bewaard in localStorage, zonder server', () => {
  const storage = memoryStorage();
  let progress = { stemmer: STEMMER, roepnaam: 'Sam', gestemd: [], lekker: [] };
  progress = { ...progress, ...nextVotedDishes(progress, { dishKey: 'm1-0-2', lekker: true }) };
  progress = { ...progress, ...nextVotedDishes(progress, { dishKey: 'm1-0-0', lekker: true }) };
  const written = writeKiesProgress(storage, CODE, progress);
  assert.equal(written.ok, true);
  const read = readKiesProgress(storage, CODE);
  assert.deepEqual(read.lekker, ['m1-0-2', 'm1-0-0']);
  assert.equal(firstLekkerDishName({ dishes: DISHES, lekker: read.lekker }), 'Tiramisu');
  // Een oude stand zonder `lekker` blijft werken en heeft geen lekker-gerecht.
  const legacy = { stemmer: STEMMER, roepnaam: 'Sam', gestemd: ['m1-0-1'] };
  writeKiesProgress(storage, CODE, legacy);
  const legacyRead = readKiesProgress(storage, CODE);
  assert.deepEqual(legacyRead.lekker, []);
  assert.equal(firstLekkerDishName({ dishes: DISHES, lekker: legacyRead.lekker }), null);
});
