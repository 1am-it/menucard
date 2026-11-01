'use strict';

// #59 historical-card regression: the existing data/menus.json snapshot must
// map into the current product concept without losing a dish, a section path,
// an order or a price. It deliberately does NOT assert the historical counts
// as current truth: the four websites were not re-fetched, so a green test only
// proves the shape of this pinned snapshot.
//
// The snapshot is pinned by its canonical LF hash and latest scraped date.
// Changing either requires an explicit acceptance-evidence update, not a
// silent refresh.
//
// BE-71 (#176, besluit 021) added two live cards (5-lunch, 22-afhaal) to
// the same file. That is the explicit acceptance-evidence update named above:
// the whole file stays pinned by this hash and the latest scraped date, and the
// four March cards of TARGETS below are still asserted one-for-one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const menus = require('../../data/menus.json');
const { categoryPath } = require('./menuHierarchy');
const { liveMenuLines, normalizePrice, buildMenuConcept } = require('./menuConcept');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
// BE-71 ronde 3 (#176): de kaart van Restaurant Zenza (17-menukaart) kwam erbij,
// met dezelfde vorm en met R1 en R3 toegepast. Ronde 4 herschreef die kaart met
// de echte koppen (R9) en repareerde twee onterechte toeslagen bij Chocolat (5).
const SNAPSHOT_SHA256 = '457bbbcecbd9e50f804eb2346efcea2629b00a348da361d5ec8328864c0c7b1c';
const LATEST_SCRAPED = '2026-11-01';
const TARGETS = [
  { id: '1', name: 'Restaurant Wolfslaar' },
  { id: '6', name: 'Brasserie Bardot' },
  { id: '19', name: 'Restaurant Zuyd' },
  { id: '23', name: 'T-Huis' },
];

function entriesFor(id) {
  return Object.entries(menus).filter(([key, menu]) => key.startsWith(`${id}-`) && menu && Array.isArray(menu.categories));
}

function sourceItems(id) {
  const entries = entriesFor(id);
  const out = [];
  for (const [key, menu] of entries) {
    menu.categories.forEach((category, c) => {
      (Array.isArray(category.items) ? category.items : []).forEach((item, i) => {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) return;
        out.push({ key, menu, category, c, i, item, id: `live:${key}.${c}.${i}` });
      });
    });
  }
  return out;
}

function multiset(list) {
  const map = new Map();
  for (const value of list) map.set(value, (map.get(value) || 0) + 1);
  return map;
}

test('the historical snapshot is pinned by hash and date, never presented as current truth', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'data', 'menus.json'), 'utf8').replace(/\r\n?/g, '\n');
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'), SNAPSHOT_SHA256);
  const dates = Object.values(menus).map((menu) => menu && menu.scraped).filter(Boolean);
  assert.ok(dates.length > 0);
  assert.equal(dates.reduce((latest, date) => (date > latest ? date : latest), ''), LATEST_SCRAPED);
  for (const target of TARGETS) assert.ok(entriesFor(target.id).length > 0, `${target.name} is present`);
});

test('every historical dish and section survives into live menu lines exactly once', () => {
  for (const target of TARGETS) {
    const expected = sourceItems(target.id);
    const lines = liveMenuLines(menus, target.id);
    assert.equal(lines.length, expected.length, `${target.name}: one line per named dish`);
    assert.deepEqual(
      [...multiset(lines.map((line) => line.id))].sort(),
      [...multiset(expected.map((item) => item.id))].sort(),
      `${target.name}: stable live ids`,
    );
    for (const source of expected) {
      const line = lines.find((candidate) => candidate.id === source.id);
      assert.ok(line, `${target.name}: ${source.item.name} exists`);
      assert.equal(line.name, source.item.name.trim(), `${target.name}: name`);
      assert.deepEqual(line.categoryPath, categoryPath(source.category), `${target.name}: ${source.item.name} path`);
      assert.equal(line.category, categoryPath(source.category).at(-1), `${target.name}: ${source.item.name} category`);
      const price = normalizePrice(typeof source.item.priceValue === 'number' ? source.item.priceValue : source.item.price);
      assert.equal(line.price, price, `${target.name}: ${source.item.name} price`);
      assert.notEqual(line.price, '0.00', `${target.name}: unknown price is never zero`);
    }
  }
});

test('keeping every historical dish round-trips through the concept without flattening', () => {
  for (const target of TARGETS) {
    const lines = liveMenuLines(menus, target.id);
    const concept = buildMenuConcept({ menus: [], liveLines: lines, edits: { removed: 'keep' } });
    assert.equal(concept.canSave, true, `${target.name}: an explicit keep decision clears the removals`);
    const kept = concept.content.categories.flatMap((category) => category.items);
    assert.equal(kept.length, lines.length, `${target.name}: no dish disappears`);
    assert.deepEqual(
      [...multiset(kept.map((item) => `${item.name}\u0000${item.price || ''}`))].sort(),
      [...multiset(lines.map((line) => `${line.name}\u0000${line.price || ''}`))].sort(),
      `${target.name}: names and prices survive`,
    );
    const paths = new Set(concept.content.categories.map((category) => (category.path || [category.name]).join('\u0000')));
    for (const line of lines) assert.ok(paths.has(line.categoryPath.join('\u0000')), `${target.name}: path ${line.categoryPath.join(' > ')}`);
  }
});
