'use strict';

// PLATFORM-06 — readable moderation proposal diff. Unit tests for the pure
// formatting helpers in src/lib/moderationFormatting.js, plus structural
// safety-net tests (fs.readFileSync + regex, this project's existing
// convention) for app/internal/moderation/page.js's own wiring.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  NO_CURRENT_VALUE_LABEL,
  formatFieldName,
  formatSourceLabel,
  formatPrice,
  formatAllergens,
  humanizeValue,
  formatFieldValue,
} = require('./moderationFormatting');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MODERATION_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/moderation/page.js');

// ─── formatPrice ────────────────────────────────────────────────────────

test('formatPrice: priceDisplay is used verbatim when present', () => {
  assert.equal(formatPrice({ priceValue: 19.5, priceDisplay: '€19,50' }), '€19,50');
});

test('formatPrice: derives a Dutch-style comma display from priceValue when priceDisplay is absent', () => {
  assert.equal(formatPrice({ priceValue: 21 }), '€21,00');
  assert.equal(formatPrice({ priceValue: 7.5 }), '€7,50');
});

test('formatPrice: priceOnRequest renders as plain text, not a number', () => {
  assert.equal(formatPrice({ priceOnRequest: true }), 'Price on request');
});

test('formatPrice: returns null (never a guess) for anything that isn\'t a recognizable price shape', () => {
  assert.equal(formatPrice(null), null);
  assert.equal(formatPrice(undefined), null);
  assert.equal(formatPrice('€19,50'), null);
  assert.equal(formatPrice(19.5), null);
  assert.equal(formatPrice([{ priceValue: 1 }]), null);
  assert.equal(formatPrice({}), null);
});

// ─── formatAllergens ────────────────────────────────────────────────────

test('formatAllergens: a {scheme, code}[] array renders as a plain comma-separated code list', () => {
  assert.equal(
    formatAllergens([{ scheme: 'EU-14', code: 'gluten' }, { scheme: 'EU-14', code: 'lactose' }]),
    'gluten, lactose'
  );
});

test('formatAllergens: returns null for anything that isn\'t an array of {code}-carrying objects', () => {
  assert.equal(formatAllergens(null), null);
  assert.equal(formatAllergens([]), null);
  assert.equal(formatAllergens(['gluten']), null);
  assert.equal(formatAllergens([{ scheme: 'EU-14' }]), null);
  assert.equal(formatAllergens('gluten, lactose'), null);
});

// ─── humanizeValue — the generic, schema-agnostic fallback ─────────────

test('humanizeValue: primitives render plainly, never as JSON', () => {
  assert.equal(humanizeValue('Di–Za 18:00–22:00'), 'Di–Za 18:00–22:00');
  assert.equal(humanizeValue(42), '42');
  assert.equal(humanizeValue(true), 'Yes');
  assert.equal(humanizeValue(false), 'No');
});

test('humanizeValue: null/undefined render as empty string, never the literal word "null"', () => {
  assert.equal(humanizeValue(null), '');
  assert.equal(humanizeValue(undefined), '');
});

test('humanizeValue: a plain object becomes readable "Key: value" segments, never {}-wrapped JSON', () => {
  const result = humanizeValue({ whatsapp: '+31 76 201 4975', verified: false });
  assert.doesNotMatch(result, /[{}]/);
  assert.doesNotMatch(result, /"/);
  assert.match(result, /Whatsapp: \+31 76 201 4975/);
  assert.match(result, /Verified: No/);
});

test('humanizeValue: an empty object or array reads as a plain, non-alarming placeholder', () => {
  assert.equal(humanizeValue({}), '(no details)');
  assert.equal(humanizeValue([]), '(none)');
});

test('humanizeValue: an object with only null/undefined/empty-string values still reads as "(no details)", not blank', () => {
  assert.equal(humanizeValue({ note: null, extra: undefined, empty: '' }), '(no details)');
});

test('humanizeValue: an array of primitives joins as a comma-separated readable list', () => {
  assert.equal(humanizeValue(['gluten', 'lactose']), 'gluten, lactose');
});

test('humanizeValue: camelCase keys are split into readable words, capitalized', () => {
  const result = humanizeValue({ openingHoursSummary: 'closed today' });
  assert.match(result, /Opening Hours Summary: closed today/);
});

// ─── formatFieldValue — the single entry point the page uses ──────────

test('formatFieldValue: dispatches to formatPrice for the "price" field', () => {
  assert.equal(formatFieldValue('price', { priceValue: 21 }), '€21,00');
});

test('formatFieldValue: dispatches to formatAllergens for the "allergens" field', () => {
  assert.equal(formatFieldValue('allergens', [{ scheme: 'EU-14', code: 'noten' }]), 'noten');
});

test('formatFieldValue: falls back to the generic humanizer for openingHours/reservationMethod/itemAvailability and any unrecognized field_name', () => {
  assert.equal(formatFieldValue('openingHours', 'Di–Za 18:00–22:00'), 'Di–Za 18:00–22:00');
  assert.match(formatFieldValue('reservationMethod', { type: 'phone', phone: '+31 6 1234 5678' }), /Type: phone/);
  assert.match(formatFieldValue('itemAvailability', { available: false }), /Available: No/);
  assert.equal(formatFieldValue('someFutureFieldName', 'plain text value'), 'plain text value');
});

test('formatFieldValue: falls back to the generic humanizer when a "price"/"allergens" value doesn\'t match the expected shape', () => {
  assert.equal(formatFieldValue('price', 'on request, call us'), 'on request, call us');
  assert.match(formatFieldValue('allergens', { note: 'ask staff' }), /Note: ask staff/);
});

test('formatFieldValue: returns null only when there is truly no value — never an empty string', () => {
  assert.equal(formatFieldValue('price', null), null);
  assert.equal(formatFieldValue('price', undefined), null);
});

// ─── formatFieldName / formatSourceLabel ───────────────────────────────

test('formatFieldName: every known field_name gets its exact, hand-written label', () => {
  assert.equal(formatFieldName('price'), 'Price');
  assert.equal(formatFieldName('openingHours'), 'Opening hours');
  assert.equal(formatFieldName('reservationMethod'), 'Reservation method');
  assert.equal(formatFieldName('itemAvailability'), 'Item availability');
  assert.equal(formatFieldName('allergens'), 'Allergens');
});

test('formatFieldName: an unrecognized field_name still renders as readable text via the camelCase fallback', () => {
  assert.equal(formatFieldName('someNewFieldName'), 'Some New Field Name');
  assert.equal(formatFieldName(null), 'Field');
  assert.equal(formatFieldName(''), 'Field');
});

test('formatSourceLabel: every known source value gets its exact, hand-written label', () => {
  assert.equal(formatSourceLabel('owner'), 'Owner');
  assert.equal(formatSourceLabel('community'), 'Community');
  assert.equal(formatSourceLabel('editor'), 'Editor');
  assert.equal(formatSourceLabel('imported'), 'Imported');
  assert.equal(formatSourceLabel('unknown'), 'Unknown');
});

test('formatSourceLabel: a missing or unrecognized source still renders safely, never null/undefined text', () => {
  assert.equal(formatSourceLabel(null), 'Unknown');
  assert.equal(formatSourceLabel(undefined), 'Unknown');
  assert.equal(formatSourceLabel('someNewSource'), 'Some New Source');
});

test('NO_CURRENT_VALUE_LABEL is the exact, non-alarming Dutch string this ticket specifies', () => {
  assert.equal(NO_CURRENT_VALUE_LABEL, 'Geen huidige waarde');
});

// ─── Structural safety net: app/internal/moderation/page.js ────────────

test('structural safety net: the moderation page imports and uses the shared formatting helpers, never re-implementing its own JSON-to-text logic', () => {
  const source = fs.readFileSync(MODERATION_PAGE_PATH, 'utf8');
  assert.match(source, /from ['"]@\/src\/lib\/moderationFormatting['"]/);
  assert.match(source, /formatFieldValue/);
  assert.match(source, /formatFieldName/);
  assert.match(source, /formatSourceLabel/);
  assert.match(source, /NO_CURRENT_VALUE_LABEL/);
});

test('structural safety net: raw JSON.stringify output only ever appears inside a closed <details> "Technical details" section — never as default visible content', () => {
  const source = fs.readFileSync(MODERATION_PAGE_PATH, 'utf8');
  const detailsBlocks = source.match(/<details\b[\s\S]*?<\/details>/g) || [];
  assert.ok(detailsBlocks.length > 0, 'expected at least one <details> block');
  for (const block of detailsBlocks) {
    assert.match(block, /<summary[^>]*>\s*Technical details\s*<\/summary>/, 'each <details> must be labeled exactly "Technical details"');
  }
  const outsideDetails = detailsBlocks.reduce((acc, block) => acc.split(block).join(''), source);
  // Excludes JSON.stringify({}) specifically — the pre-existing, unrelated
  // empty-body serialization the reject POST requests already use
  // (decide/decideClaim); this test is about raw *data* never rendering
  // outside <details>, not about every JSON.stringify call in the file.
  assert.doesNotMatch(
    outsideDetails,
    /JSON\.stringify\((?!\{\}\))/,
    'JSON.stringify must never render proposal/current data outside a <details> block'
  );
});

test('structural safety net: the moderation page never shows a raw "null"/"none" placeholder for a missing current value', () => {
  const source = fs.readFileSync(MODERATION_PAGE_PATH, 'utf8');
  assert.doesNotMatch(source, />\s*null\s*</, 'must never render the literal word "null" as visible text');
  assert.doesNotMatch(source, /current\?\.source ?? ['"]none['"]/, 'the old raw "(none)" source label must be gone');
});

test('structural safety net: Approve/Reject actions, their endpoints, and the decide() handler are byte-for-byte unchanged', () => {
  const source = fs.readFileSync(MODERATION_PAGE_PATH, 'utf8');
  assert.match(source, /async function decide\(pendingId, action\)/);
  assert.match(source, /fetch\(`\/api\/internal\/v1\/moderation\/\$\{pendingId\}\/\$\{action\}`/);
  assert.match(source, /onClick=\{\(\) => decide\(pending\.id, 'approve'\)\}/);
  assert.match(source, /onClick=\{\(\) => decide\(pending\.id, 'reject'\)\}/);
  assert.match(source, />\s*Approve\s*</);
  assert.match(source, />\s*Reject\s*</);
});

test('structural safety net: Owner claims stays a distinct, unchanged section — not touched by the proposal-formatting rework', () => {
  const source = fs.readFileSync(MODERATION_PAGE_PATH, 'utf8');
  assert.match(source, />Owner claims</);
  assert.match(source, /No pending claims\./);
  assert.match(source, /\/api\/internal\/v1\/claims\/pending/);
  assert.match(source, /async function decideClaim\(claimId, action\)/);
});

test('structural safety net: the proposal grid uses a responsive auto-fit layout, matching this project\'s existing no-media-query stacking pattern (coverage.js\'s metric cards, /internal\'s module grid)', () => {
  const source = fs.readFileSync(MODERATION_PAGE_PATH, 'utf8');
  assert.match(source, /repeat\(auto-fit, ?minmax\(/);
});
