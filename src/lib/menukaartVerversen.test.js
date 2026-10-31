'use strict';

// BE-58 deel 3 (#143) — bewijs dat een goedkeuring of bevestiging precies de
// twee publieke pagina's van dat restaurant ververst, en niets anders.
//
// De handler geeft `{menuId, restaurantId}` aan een geïnjecteerde `revalidate`;
// hier staat de echte invulling: `revalidatePath` voor /menu/<id> en
// /restaurant/<id>, plus de cache-tag van de overlay van dat restaurant.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { maakMenukaartVerversen, overlayTag, publiekePaden } = require('./menukaartVerversen');

test('BE-58: de paden van een wijziging zijn /menu/<id> en /restaurant/<id>', () => {
  assert.deepEqual(publiekePaden({ menuId: '9-lunch', restaurantId: '9' }), [
    '/menu/9-lunch',
    '/restaurant/9',
  ]);
  assert.deepEqual(publiekePaden({ restaurantId: '9' }), ['/restaurant/9'], 'geen leeg /menu/-pad');
  assert.deepEqual(publiekePaden({}), []);
  assert.deepEqual(publiekePaden(null), []);
  assert.deepEqual(publiekePaden({ menuId: '  ', restaurantId: null }), []);
});

test('BE-58: de overlay-tag is per restaurant en nooit leeg', () => {
  assert.equal(overlayTag('9'), 'menukaart-overlay-9');
  assert.equal(overlayTag(' 12 '), 'menukaart-overlay-12');
  assert.equal(overlayTag(''), '');
  assert.equal(overlayTag(undefined), '');
});

test('BE-58: de ververser roept revalidatePath twee keer en de tag één keer aan', () => {
  const paden = [];
  const tags = [];
  const ververs = maakMenukaartVerversen({
    revalidatePath: (pad) => paden.push(pad),
    revalidateTag: (tag) => tags.push(tag),
  });

  ververs({ menuId: '9-lunch', restaurantId: '9' });

  assert.deepEqual(paden, ['/menu/9-lunch', '/restaurant/9']);
  assert.deepEqual(tags, ['menukaart-overlay-9']);
});

test('BE-58: zonder restaurant ververst de ververser geen pad en geen tag', () => {
  const paden = [];
  const tags = [];
  const ververs = maakMenukaartVerversen({
    revalidatePath: (pad) => paden.push(pad),
    revalidateTag: (tag) => tags.push(tag),
  });

  ververs({});
  ververs();
  ververs(null);

  assert.deepEqual(paden, []);
  assert.deepEqual(tags, []);
});

test('BE-58: een ontbrekende Next-afhankelijkheid laat de ververser niet stuklopen', () => {
  assert.doesNotThrow(() => maakMenukaartVerversen()({ menuId: '9-lunch', restaurantId: '9' }));
  assert.doesNotThrow(() => maakMenukaartVerversen({ revalidatePath() {} })({ restaurantId: '9' }));
});
