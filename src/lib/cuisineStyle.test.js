'use strict';

// BE-28b (#68) — de keukenmapping is één kleine, geteste tabel
// (acceptatiecriterium 3). Deze tests dekken de echte, samengestelde labels
// uit data/restaurants.json, de segmentvolgorde en de verplichte terugval
// 🍽️ voor een onbekende keuken.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { cuisineFamily, cuisineEmoji, FALLBACK_EMOJI } = require('./cuisineStyle');

test('bekende families uit de echte dataset worden herkend', () => {
  assert.equal(cuisineFamily('Italiaans · Klassiek'), 'Italiaans');
  assert.equal(cuisineEmoji('Italiaans · Pizza & Pasta'), '🍝');
  assert.equal(cuisineFamily('Frans · Mediterraans'), 'Frans');
  assert.equal(cuisineFamily('Mediterraans · Noord-Afrikaans'), 'Mediterraans');
  assert.equal(cuisineEmoji('Mediterraans · Noord-Afrikaans'), '🥘');
  assert.equal(cuisineFamily('Chinees · Kantonees'), 'Chinees');
  assert.equal(cuisineEmoji('Chinees · Kantonees'), '🥡');
  assert.equal(cuisineFamily('Moluks Indonesisch · Rijsttafel'), 'Indonesisch');
  assert.equal(cuisineEmoji('Moluks Indonesisch · Rijsttafel'), '🍜');
  assert.equal(cuisineFamily('Grill · Steakhouse'), 'Grill');
  assert.equal(cuisineEmoji('Baskisch · Grill'), '🥩');
  assert.equal(cuisineFamily('Indiaas · Curry'), 'Indiaas');
  assert.equal(cuisineEmoji('Indiaas · Curry'), '🍛');
  assert.equal(cuisineFamily('Halal · Midden-Oosters'), 'Midden-Oosters');
  assert.equal(cuisineEmoji('Halal · Midden-Oosters'), '🧆');
  assert.equal(cuisineFamily('Kaasfondue · Hollands'), 'Nederlands');
  assert.equal(cuisineEmoji('Kaasfondue · Hollands'), '🥨');
  assert.equal(cuisineFamily('Scandinavisch · Modern Europees'), 'Modern Europees');
  assert.equal(cuisineEmoji('Scandinavisch · Modern Europees'), '🍴');
  assert.equal(cuisineFamily('Frans · Oosterse Fusion'), 'Frans');
  assert.equal(cuisineEmoji('Modern Frans · Fine Dining'), '🥂');
});

test('het eerste bekende segment wint: Biercafé vóór Amerikaans, Frans vóór Mediterraans', () => {
  assert.equal(cuisineFamily('Biercafé · Amerikaans · Burgers'), 'Biercafé');
  assert.equal(cuisineEmoji('Biercafé · Amerikaans · Burgers'), '🍺');
  assert.equal(cuisineFamily('Franse Brasserie · Wijnbar'), 'Frans');
  assert.equal(cuisineFamily('Frans · Mediterraans'), 'Frans');
  assert.equal(cuisineFamily('Grand Café · Valkenberg Park'), 'Nederlands');
});

test('een onbekende keuken krijgt 🍽️ en houdt zijn eigen naam als familie', () => {
  assert.equal(cuisineFamily('Peruaans · Ceviche'), 'Peruaans');
  assert.equal(cuisineEmoji('Peruaans · Ceviche'), FALLBACK_EMOJI);
  assert.equal(FALLBACK_EMOJI, '🍽️');
  assert.equal(cuisineEmoji(''), FALLBACK_EMOJI);
  assert.equal(cuisineEmoji(null), FALLBACK_EMOJI);
});

test('de mapping is klein en bevat geen dubbele familienamen of emoji-loze regels', () => {
  const { FAMILIES } = require('./cuisineStyle');
  assert.ok(FAMILIES.length <= 14, `expected a small mapping, got ${FAMILIES.length} entries`);
  const names = FAMILIES.map((entry) => entry.family);
  assert.equal(new Set(names).size, names.length, 'family names must be unique');
  for (const entry of FAMILIES) {
    assert.ok(entry.emoji && entry.emoji.length > 0, `${entry.family} must have an emoji`);
    assert.ok(entry.keywords.length > 0, `${entry.family} must have keywords`);
  }
});
