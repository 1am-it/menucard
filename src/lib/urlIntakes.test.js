'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_RESTAURANT_MATCH_TYPES,
  ALLOWED_RESTAURANT_CANDIDATE_FIELDS,
  RECEIPT_TTL_MS,
  canonicalizeSourceUrl,
  isReceiptExpired,
  computeReceiptExpiry,
  buildRestaurantCandidateSummary,
  buildMenuCandidateSummary,
  buildCandidateSummary,
} = require('./urlIntakes');

test('ALLOWED_RESTAURANT_MATCH_TYPES matches src/lib/restaurantHostMatch.js exactly', () => {
  assert.deepEqual(ALLOWED_RESTAURANT_MATCH_TYPES, ['exact', 'none', 'multiple']);
});

test('ALLOWED_RESTAURANT_CANDIDATE_FIELDS matches restaurant_profile_draft_field_facts.field_name exactly', () => {
  assert.deepEqual(ALLOWED_RESTAURANT_CANDIDATE_FIELDS, ['name', 'category', 'address', 'phone', 'website']);
});

// ─── canonicalizeSourceUrl — the URL data-minimisation boundary ───────────

test('canonicalizeSourceUrl: strips query string and fragment, keeps scheme/host/path', () => {
  const result = canonicalizeSourceUrl('https://example.nl/menu/lunch?utm_source=fb&ref=123#section-2');
  assert.deepEqual(result, { canonicalUrl: 'https://example.nl/menu/lunch', hostname: 'example.nl' });
});

test('canonicalizeSourceUrl: never leaks the original query string anywhere in the result', () => {
  const result = canonicalizeSourceUrl('https://example.nl/?token=SECRET123');
  assert.ok(!JSON.stringify(result).includes('SECRET123'), 'the query string must never survive canonicalization');
});

test('canonicalizeSourceUrl: a URL with no query/fragment is unchanged apart from normalization', () => {
  const result = canonicalizeSourceUrl('https://example.nl/menu');
  assert.equal(result.canonicalUrl, 'https://example.nl/menu');
});

test('canonicalizeSourceUrl: lowercases the hostname', () => {
  const result = canonicalizeSourceUrl('https://EXAMPLE.NL/menu');
  assert.equal(result.hostname, 'example.nl');
});

test('canonicalizeSourceUrl: rejects a non-http(s) protocol', () => {
  assert.equal(canonicalizeSourceUrl('ftp://example.nl/menu'), null);
  assert.equal(canonicalizeSourceUrl('javascript:alert(1)'), null);
});

test('canonicalizeSourceUrl: rejects unparseable input, never throws', () => {
  assert.equal(canonicalizeSourceUrl('not a url'), null);
  assert.equal(canonicalizeSourceUrl(''), null);
  assert.equal(canonicalizeSourceUrl(null), null);
  assert.equal(canonicalizeSourceUrl(undefined), null);
  assert.equal(canonicalizeSourceUrl(42), null);
});

// ─── isReceiptExpired / computeReceiptExpiry ──────────────────────────────

test('isReceiptExpired: true when expiresAt is in the past', () => {
  assert.equal(isReceiptExpired('2020-01-01T00:00:00.000Z', new Date('2026-01-01T00:00:00.000Z')), true);
});

test('isReceiptExpired: false when expiresAt is in the future', () => {
  assert.equal(isReceiptExpired('2030-01-01T00:00:00.000Z', new Date('2026-01-01T00:00:00.000Z')), false);
});

test('isReceiptExpired: true (fail closed) at the exact expiry instant', () => {
  const t = '2026-01-01T00:00:00.000Z';
  assert.equal(isReceiptExpired(t, new Date(t)), true);
});

test('isReceiptExpired: true (fail closed) for a malformed value, never throws', () => {
  assert.equal(isReceiptExpired('not-a-date'), true);
  assert.equal(isReceiptExpired(null), true);
  assert.equal(isReceiptExpired(undefined), true);
});

test('computeReceiptExpiry: returns now + RECEIPT_TTL_MS exactly', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const expiry = computeReceiptExpiry(now);
  assert.equal(new Date(expiry).getTime() - now.getTime(), RECEIPT_TTL_MS);
});

test('computeReceiptExpiry output is itself never expired relative to the same "now"', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const expiry = computeReceiptExpiry(now);
  assert.equal(isReceiptExpired(expiry, now), false);
});

// ─── buildRestaurantCandidateSummary ──────────────────────────────────────

test('buildRestaurantCandidateSummary: keeps only the allowed fields', () => {
  const summary = buildRestaurantCandidateSummary({
    name: 'Test Eetcafe',
    address: 'Teststraat 1',
    phone: '0612345678',
    website: 'https://example.nl',
    email: 'owner@example.nl', // never allowed — must be dropped
    ownerName: 'Jan Jansen', // never allowed — must be dropped
  });
  assert.deepEqual(summary, {
    name: 'Test Eetcafe',
    address: 'Teststraat 1',
    phone: '0612345678',
    website: 'https://example.nl',
  });
});

test('buildRestaurantCandidateSummary: never invents a personal/owner field, even if present on the input', () => {
  const summary = buildRestaurantCandidateSummary({ name: 'X', email: 'a@b.nl', ownerPhone: '0600000000' });
  assert.ok(!('email' in summary));
  assert.ok(!('ownerPhone' in summary));
});

test('buildRestaurantCandidateSummary: omits blank/whitespace-only fields entirely — never an empty-string placeholder', () => {
  const summary = buildRestaurantCandidateSummary({ name: '  ', address: 'Real Address 1' });
  assert.ok(!('name' in summary));
  assert.equal(summary.address, 'Real Address 1');
});

test('buildRestaurantCandidateSummary: returns an empty object given no input, never throws', () => {
  assert.deepEqual(buildRestaurantCandidateSummary(null), {});
  assert.deepEqual(buildRestaurantCandidateSummary(undefined), {});
});

// ─── buildMenuCandidateSummary ─────────────────────────────────────────────

test('buildMenuCandidateSummary: keeps only the bounded shape (name, contextSlug, categories/items)', () => {
  const summary = buildMenuCandidateSummary([
    { name: 'Dinerkaart', contextSlug: 'diner', categories: [{ name: 'Voorgerechten', items: [{ name: 'Soep', desc: 'Warm', price: '6.50' }] }] },
  ]);
  assert.deepEqual(summary, [
    { name: 'Dinerkaart', contextSlug: 'diner', categories: [{ name: 'Voorgerechten', items: [{ name: 'Soep', desc: 'Warm', price: '6.50' }] }] },
  ]);
});

test('buildMenuCandidateSummary: returns an empty array given non-array input, never throws', () => {
  assert.deepEqual(buildMenuCandidateSummary(null), []);
  assert.deepEqual(buildMenuCandidateSummary(undefined), []);
  assert.deepEqual(buildMenuCandidateSummary('not-an-array'), []);
});

test('buildMenuCandidateSummary: tolerates malformed entries without throwing', () => {
  const summary = buildMenuCandidateSummary([null, {}, { categories: 'not-an-array' }]);
  assert.equal(summary.length, 3);
  assert.deepEqual(summary[2].categories, []);
});

// ─── buildCandidateSummary — the full receipt payload shape ───────────────

test('buildCandidateSummary: combines restaurant + menus under the exact two top-level keys the RPCs expect', () => {
  const summary = buildCandidateSummary({
    restaurantCandidateFields: { name: 'Test Eetcafe' },
    menus: [{ name: 'Diner', contextSlug: 'diner', categories: [] }],
  });
  assert.deepEqual(Object.keys(summary).sort(), ['menus', 'restaurant']);
  assert.equal(summary.restaurant.name, 'Test Eetcafe');
  assert.equal(summary.menus[0].contextSlug, 'diner');
});

test('buildCandidateSummary: never includes raw HTML, a full JSON-LD document, or PDF-related fields', () => {
  const summary = buildCandidateSummary({
    restaurantCandidateFields: { name: 'X', html: '<div>should never appear</div>' },
    menus: [],
  });
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes('<div>'));
  assert.ok(!serialized.toLowerCase().includes('pdf'));
});
