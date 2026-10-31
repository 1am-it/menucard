'use strict';

// BE-59 (#146, punt 6) — de restaurantnaam bij een owner-rol, zoals
// GET /api/internal/v1/me die meestuurt. Puur: geen Supabase, geen React.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { withOwnerRestaurantNames } = require('./ownerRoleNames');

const RESTAURANTS = {
  smelt: { name: 'Smelt' },
  'de-bruine-boon': { name: '  De Bruine Boon  ' },
  leeg: { name: '   ' },
};

test('een owner-rol krijgt de naam uit de index, andere rollen blijven gelijk', () => {
  assert.deepEqual(
    withOwnerRestaurantNames(
      [
        { role: 'owner', restaurant_id: 'smelt' },
        { role: 'internal', restaurant_id: null },
        { role: 'editor', restaurant_id: null },
      ],
      RESTAURANTS,
    ),
    [
      { role: 'owner', restaurant_id: 'smelt', restaurant_name: 'Smelt' },
      { role: 'internal', restaurant_id: null },
      { role: 'editor', restaurant_id: null },
    ],
  );
});

test('een onbekende, lege of ontbrekende id levert geen verzonnen naam op', () => {
  const rows = [
    { role: 'owner', restaurant_id: 'bestaat-niet' },
    { role: 'owner', restaurant_id: 'leeg' },
    { role: 'owner', restaurant_id: null },
    { role: 'owner' },
  ];
  assert.deepEqual(withOwnerRestaurantNames(rows, RESTAURANTS), rows, 'de rijen blijven ongewijzigd');
  assert.deepEqual(withOwnerRestaurantNames(rows, null), rows);
});

test('namen worden getrimd en de rechten (role, restaurant_id) blijven exact', () => {
  const [row] = withOwnerRestaurantNames([{ role: 'owner', restaurant_id: 'de-bruine-boon' }], RESTAURANTS);
  assert.deepEqual(row, { role: 'owner', restaurant_id: 'de-bruine-boon', restaurant_name: 'De Bruine Boon' });
});

test('geen rijen of geen array: een lege lijst, nooit een fout', () => {
  assert.deepEqual(withOwnerRestaurantNames(null, RESTAURANTS), []);
  assert.deepEqual(withOwnerRestaurantNames(undefined, RESTAURANTS), []);
  assert.deepEqual(withOwnerRestaurantNames([], RESTAURANTS), []);
});

test('de /me-route gebruikt de helper en geeft de rollen ongewijzigd door', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs
    .readFileSync(path.join(__dirname, '..', '..', 'app/api/internal/v1/me/route.js'), 'utf8')
    .replace(/\r\n/g, '\n');
  assert.match(source, /withOwnerRestaurantNames\(auth\.roles, restaurantsData\)/);
  assert.match(source, /authenticateInternalRequest/);
});
