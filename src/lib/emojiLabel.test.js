'use strict';

// BE-37 (#89, criterium 3) — decoratieve emoji zijn aria-hidden. De labels
// komen uit de data met hun emoji erin; splitLeadingEmoji haalt alleen het
// leidende teken eraf zodat de weergave het via <Emoji> kan tonen.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { splitLeadingEmoji } = require('./emojiLabel');

test('splits a leading dish emoji from the menu label', () => {
  assert.deepEqual(splitLeadingEmoji('🥗 Lunchkaart'), { glyph: '🥗', text: 'Lunchkaart' });
  assert.deepEqual(splitLeadingEmoji('🍽 Dinerkaart'), { glyph: '🍽', text: 'Dinerkaart' });
  assert.deepEqual(splitLeadingEmoji('⭐ Specialiteiten'), { glyph: '⭐', text: 'Specialiteiten' });
});

test('keeps the variation selector of a combined emoji', () => {
  assert.deepEqual(splitLeadingEmoji('🍽️ Dinerkaart'), { glyph: '🍽️', text: 'Dinerkaart' });
  assert.deepEqual(splitLeadingEmoji('✍️ Handmatig toevoegen'), { glyph: '✍️', text: 'Handmatig toevoegen' });
  assert.deepEqual(splitLeadingEmoji('⚠️ Menukopjes controleren'), { glyph: '⚠️', text: 'Menukopjes controleren' });
});

test('splits the read-outcome and status lines too', () => {
  assert.deepEqual(splitLeadingEmoji('✅ 42 gerechten gelezen · 3 controle nodig'), {
    glyph: '✅',
    text: '42 gerechten gelezen · 3 controle nodig',
  });
  assert.deepEqual(splitLeadingEmoji('⏳ AI leest de kaart…'), { glyph: '⏳', text: 'AI leest de kaart…' });
  assert.deepEqual(splitLeadingEmoji('✓ Fictief Brasserie Noord'), { glyph: '✓', text: 'Fictief Brasserie Noord' });
  assert.deepEqual(splitLeadingEmoji('🆕 Nieuw gevonden (2)'), { glyph: '🆕', text: 'Nieuw gevonden (2)' });
});

test('leaves text without a leading emoji untouched — a trailing arrow is typography', () => {
  assert.deepEqual(splitLeadingEmoji('Alles →'), { glyph: null, text: 'Alles →' });
  assert.deepEqual(splitLeadingEmoji('Bekijk alle restaurants →'), { glyph: null, text: 'Bekijk alle restaurants →' });
  assert.deepEqual(splitLeadingEmoji('Opnieuw controleren'), { glyph: null, text: 'Opnieuw controleren' });
  assert.deepEqual(splitLeadingEmoji('— geen actie'), { glyph: null, text: '— geen actie' });
});

test('handles empty and missing values without throwing', () => {
  assert.deepEqual(splitLeadingEmoji(''), { glyph: null, text: '' });
  assert.deepEqual(splitLeadingEmoji(null), { glyph: null, text: '' });
  assert.deepEqual(splitLeadingEmoji(undefined), { glyph: null, text: '' });
  assert.deepEqual(splitLeadingEmoji(42), { glyph: null, text: '42' });
});

test('a label that is only an emoji keeps an empty text', () => {
  assert.deepEqual(splitLeadingEmoji('🗄️'), { glyph: '🗄️', text: '' });
});
