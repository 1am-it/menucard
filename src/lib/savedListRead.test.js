'use strict';

// BE-65 (#157, ronde 2) — de kleine lezer van het bewaarlijstje.
//
// De bewaar- en deelknoppen staan op / en /search meteen in de eerste lading;
// hun logica komt pas bij de klik. De stand van "Bewaren" moet wél meteen
// kloppen. Daarom leest de knop `localStorage` via src/lib/savedListRead.js en
// niet via de zware dishList. Deze test bewijst dat beide precies dezelfde
// stand geven, en dat een ontbrekende of kapotte opslag nooit een fout is.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const savedRead = require('./savedListRead');
const dishList = require('./dishList');

/** Een opslag die zich als localStorage gedraagt; `fail` gooit bij elke actie. */
function storageOf(initial, { fail = false } = {}) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      if (fail) throw new Error('geen opslag');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (fail) throw new Error('geen opslag');
      map.set(key, String(value));
    },
    removeItem(key) {
      if (fail) throw new Error('geen opslag');
      map.delete(key);
    },
  };
}

const ENTRY = {
  id: '6-diner-2-3',
  menuId: '6-diner',
  catIdx: 2,
  itemIdx: 3,
  name: 'Steak met pepersaus',
  category: 'Hoofdgerechten',
  price: '€ 24,50',
  restaurant: 'Testrestaurant',
};

test('de sleutel, het event en het limiet zijn gelijk aan dishList (geen tweede waarheid)', () => {
  assert.equal(savedRead.SAVED_LIST_KEY, dishList.SAVED_LIST_KEY);
  assert.equal(savedRead.SAVED_LIST_EVENT_NAME, dishList.SAVED_LIST_EVENT);
  assert.equal(savedRead.SAVED_LIST_LIMIT, dishList.SAVED_LIST_LIMIT);
});

test('dezelfde stand als isDishSaved() in dishList', () => {
  const storage = storageOf({});
  assert.equal(savedRead.hasSavedId(storage, ENTRY.id), false);
  dishList.toggleSavedDish(storage, ENTRY);
  assert.equal(savedRead.hasSavedId(storage, ENTRY.id), true);
  assert.equal(savedRead.hasSavedId(storage, ENTRY.id), dishList.isDishSaved(storage, ENTRY.id));
  assert.equal(savedRead.savedCount(storage), 1);
  dishList.toggleSavedDish(storage, ENTRY);
  assert.equal(savedRead.hasSavedId(storage, ENTRY.id), false);
  assert.equal(savedRead.hasSavedId(storage, ENTRY.id), dishList.isDishSaved(storage, ENTRY.id));
  assert.equal(savedRead.savedCount(storage), 0);
});

test('een id wordt net zo genormaliseerd als in dishList', () => {
  const storage = storageOf({ [savedRead.SAVED_LIST_KEY]: JSON.stringify([ENTRY]) });
  const variants = ['6-diner-2-3', ' 6-diner-02-03 ', '6-diner-2-3-extra', '', null, 'geen-id'];
  for (const id of variants) {
    assert.equal(
      savedRead.normalizeDishId(id),
      dishList.parseDishId(id) ? dishList.dishIdOf(dishList.parseDishId(id)) : null,
      `genormaliseerde id voor ${JSON.stringify(id)}`
    );
    assert.equal(savedRead.hasSavedId(storage, id), dishList.isDishSaved(storage, id), `stand voor ${JSON.stringify(id)}`);
  }
});

test('zonder opslag, met een weigerende opslag of met kapotte JSON: geen fout en niets bewaard', () => {
  for (const storage of [null, undefined, storageOf({}, { fail: true }), storageOf({ [savedRead.SAVED_LIST_KEY]: '{geen json' }), storageOf({ [savedRead.SAVED_LIST_KEY]: '{"niet":"een lijst"}' })]) {
    assert.deepEqual(savedRead.readSavedIds(storage), []);
    assert.equal(savedRead.hasSavedId(storage, ENTRY.id), false);
    assert.equal(savedRead.savedCount(storage), 0);
  }
  assert.equal(savedRead.browserStorage(), null, 'geen venster in node: geen opslag, geen fout');
});

test('de lezer telt niet meer dan het limiet van 20 en slaat dubbelen over', () => {
  const entries = [];
  for (let index = 0; index < 25; index += 1) {
    entries.push({ ...ENTRY, id: `6-diner-0-${index}`, itemIdx: index, name: `Gerecht ${index}` });
  }
  const storage = storageOf({ [savedRead.SAVED_LIST_KEY]: JSON.stringify([...entries, entries[0]]) });
  const ids = savedRead.readSavedIds(storage);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
  assert.equal(savedRead.savedCount(storage), dishList.normalizeEntries(JSON.parse(storage.getItem(savedRead.SAVED_LIST_KEY))).length);
});
