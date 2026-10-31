'use strict';

// BE-63 (#155, ronde 3) — de teller in de kop telt precies zoals het lijstje.
//
// De kop toont bij "Mijn lijstje" alleen een aantal en mag daarvoor niet het
// hele src/lib/dishList.js laden (dat sleept de deellinks mee, zie de review van
// ronde 2). Daarom leest src/lib/savedListStorage.js zelf de opslag. Deze test
// legt vast dat die korte weg hetzelfde telt als `readSavedList`: dezelfde
// sleutel, dezelfde geldigheid, dezelfde dubbelenregel en hetzelfde limiet.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { readSavedList, SAVED_LIST_EVENT, SAVED_LIST_KEY, SAVED_LIST_LIMIT, safeBrowserStorage } = require('./dishList');
const storage = require('./savedListStorage');

/** Een opslagobject met precies één waarde, zoals localStorage zich gedraagt. */
function fakeStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      values[key] = String(value);
    },
    removeItem(key) {
      delete values[key];
    },
  };
}

function entry(menuId, catIdx, itemIdx, name) {
  return { id: `${menuId}-${catIdx}-${itemIdx}`, menuId, catIdx, itemIdx, name, category: 'Broodjes', price: '€ 6,50', restaurant: 'Test' };
}

test('de sleutel, het event en het limiet staan op één plek en dishList geeft ze door', () => {
  assert.equal(storage.SAVED_LIST_KEY, 'bredaeats_bewaard');
  assert.equal(storage.SAVED_LIST_EVENT, 'bredaeats:bewaard');
  assert.equal(storage.SAVED_LIST_LIMIT, 20);
  // dishList exporteert dezelfde waarden: één bron van waarheid.
  assert.equal(SAVED_LIST_KEY, storage.SAVED_LIST_KEY);
  assert.equal(SAVED_LIST_EVENT, storage.SAVED_LIST_EVENT);
  assert.equal(SAVED_LIST_LIMIT, storage.SAVED_LIST_LIMIT);
  // En dishList gebruikt ook dezelfde veilige opslagtoegang.
  assert.equal(safeBrowserStorage, storage.safeBrowserStorage);
});

test('zonder opslag, met een fout of met kapotte JSON telt de helper 0, net als readSavedList', () => {
  assert.equal(storage.savedListCount(null), 0);
  assert.equal(storage.savedListCount(undefined), 0);
  assert.equal(storage.savedListCount({}), 0);
  const throwing = {
    getItem() {
      throw new Error('geblokkeerde opslag');
    },
  };
  assert.equal(storage.savedListCount(throwing), 0);
  for (const raw of ['', '{', '{"id":"6-0-1"}', 'null', '"tekst"', '42']) {
    const store = fakeStorage({ [SAVED_LIST_KEY]: raw });
    assert.equal(storage.savedListCount(store), readSavedList(store).length, `opslagwaarde ${JSON.stringify(raw)}`);
  }
});

test('de helper telt hetzelfde als readSavedList, ook met ongeldige en dubbele gerechten', () => {
  const cases = [
    [],
    [entry('6', 0, 0, 'Boterham')],
    [entry('6', 0, 0, 'Boterham'), entry('6', 0, 1, 'Tosti'), entry('6-diner', 1, 2, 'Soep')],
    // Dubbelen tellen één keer, net als in readSavedList.
    [entry('6', 0, 0, 'Boterham'), entry('6', 0, 0, 'Boterham')],
    // Ongeldige id's en gerechten zonder naam tellen niet mee.
    [{ id: 'geen-gerecht', name: 'Iets' }, { id: '6-0-1', name: '   ' }, { name: 'Zonder id' }, null, 'tekst', 42],
    // Het limiet van 20 geldt ook voor de teller.
    Array.from({ length: 25 }, (unused, index) => entry('6', 0, index, `Gerecht ${index}`)),
  ];
  for (const list of cases) {
    const store = fakeStorage({ [SAVED_LIST_KEY]: JSON.stringify(list) });
    assert.equal(
      storage.savedListCount(store),
      readSavedList(store).length,
      `lijst van ${list.length} waarden: de teller en readSavedList horen gelijk te zijn`
    );
  }
});

test('de helper leest alleen de sleutel en geen andere waarde', () => {
  const asked = [];
  const store = {
    getItem(key) {
      asked.push(key);
      return null;
    },
  };
  storage.savedListCount(store);
  assert.deepEqual(asked, [SAVED_LIST_KEY]);
});
