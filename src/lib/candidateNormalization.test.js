'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWebsite, normalizePhoneNL, normalizeAddressNL, extractNlPostcode } = require('./candidateNormalization');

// ─── normalizeWebsite ──────────────────────────────────────────────────

test('normalizeWebsite: lowercases scheme and host, leaves path/query/fragment byte-for-byte untouched', () => {
  const result = normalizeWebsite('HTTP://Example.COM/Menu?Table=1#Top');
  assert.equal(result.valid, true);
  assert.equal(result.normalized, 'http://example.com/Menu?Table=1#Top');
  assert.equal(result.changed, true);
});

test('normalizeWebsite: an already-normalized URL is left unchanged (changed: false)', () => {
  const result = normalizeWebsite('https://restaurant.example/contact');
  assert.equal(result.valid, true);
  assert.equal(result.normalized, 'https://restaurant.example/contact');
  assert.equal(result.changed, false);
});

test('normalizeWebsite: preserves a meaningful path and query string exactly', () => {
  const result = normalizeWebsite('HTTPS://Restaurant.Example/Menu/Special-Offer?Lang=NL&Ref=ABC');
  assert.equal(result.normalized, 'https://restaurant.example/Menu/Special-Offer?Lang=NL&Ref=ABC');
});

test('normalizeWebsite: preserves userinfo case (case-sensitive per RFC 3986) while still lowering the host', () => {
  const result = normalizeWebsite('http://User:Pass@Example.COM/path');
  assert.equal(result.normalized, 'http://User:Pass@example.com/path');
});

test('normalizeWebsite: preserves an explicit port', () => {
  const result = normalizeWebsite('HTTP://Example.COM:8080/path');
  assert.equal(result.normalized, 'http://example.com:8080/path');
});

test('normalizeWebsite: rejects non-http(s) schemes, never guesses', () => {
  for (const bad of ['ftp://example.com', 'mailto:x@example.com', 'javascript:alert(1)']) {
    const result = normalizeWebsite(bad);
    assert.equal(result.valid, false, `expected ${bad} to be rejected`);
    assert.equal(result.changed, false);
    assert.equal(result.normalized, bad);
  }
});

test('normalizeWebsite: rejects a bare domain with no scheme, never guesses one', () => {
  const result = normalizeWebsite('example.com');
  assert.equal(result.valid, false);
  assert.equal(result.normalized, 'example.com');
});

test('normalizeWebsite: rejects garbage input safely, never throws', () => {
  assert.doesNotThrow(() => normalizeWebsite('not a url at all'));
  assert.equal(normalizeWebsite('not a url at all').valid, false);
  assert.equal(normalizeWebsite('').valid, false);
  assert.equal(normalizeWebsite(null).valid, false);
  assert.equal(normalizeWebsite(undefined).valid, false);
  assert.equal(normalizeWebsite(123).valid, false);
});

test('normalizeWebsite: trims surrounding whitespace', () => {
  const result = normalizeWebsite('  https://example.com/x  ');
  assert.equal(result.normalized, 'https://example.com/x');
});

// ─── normalizePhoneNL ──────────────────────────────────────────────────

test('normalizePhoneNL: a national mobile number normalizes to +31 canonical and a "06 ########" display', () => {
  const result = normalizePhoneNL('06 12345678');
  assert.equal(result.valid, true);
  assert.equal(result.normalized, '+31612345678');
  assert.equal(result.display, '06 12345678');
});

test('normalizePhoneNL: accepts common cosmetic punctuation (spaces, hyphens, parens, dots)', () => {
  for (const variant of ['06-12345678', '06.12.34.56.78', '(06) 12345678', '06 1234 5678']) {
    const result = normalizePhoneNL(variant);
    assert.equal(result.valid, true, `expected ${variant} to be recognized`);
    assert.equal(result.normalized, '+31612345678');
  }
});

test('normalizePhoneNL: a +31 international mobile number normalizes identically to its national form', () => {
  const intl = normalizePhoneNL('+31 6 12345678');
  const national = normalizePhoneNL('06 12345678');
  assert.equal(intl.normalized, national.normalized);
  assert.equal(intl.display, national.display);
});

test('normalizePhoneNL: a 0031-prefixed number is recognized the same way as +31', () => {
  const result = normalizePhoneNL('0031612345678');
  assert.equal(result.valid, true);
  assert.equal(result.normalized, '+31612345678');
});

test('normalizePhoneNL: a geographic/landline number normalizes to +31 canonical and an ungrouped "0" display', () => {
  const result = normalizePhoneNL('010 1234567');
  assert.equal(result.valid, true);
  assert.equal(result.normalized, '+31101234567');
  assert.equal(result.display, '0101234567', 'landline display is deliberately ungrouped — see module comment on why');
});

test('normalizePhoneNL: rejects a wrong digit count — never pads or truncates to fit', () => {
  for (const bad of ['0612345', '06123456789', '+3161234567', '0']) {
    const result = normalizePhoneNL(bad);
    assert.equal(result.valid, false, `expected ${bad} to be rejected`);
    assert.equal(result.changed, false);
    assert.equal(result.normalized, bad.trim());
  }
});

test('normalizePhoneNL: rejects letters or otherwise garbled input, never guesses', () => {
  for (const bad of ['call us: 0612345678', '06-CALL-NOW', 'n/a', '+1 555 0100']) {
    const result = normalizePhoneNL(bad);
    assert.equal(result.valid, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('normalizePhoneNL: never throws on malformed input', () => {
  assert.doesNotThrow(() => normalizePhoneNL(''));
  assert.equal(normalizePhoneNL('').valid, false);
  assert.equal(normalizePhoneNL(null).valid, false);
  assert.equal(normalizePhoneNL(undefined).valid, false);
  assert.equal(normalizePhoneNL(42).valid, false);
});

test('normalizePhoneNL: an unrecognized short-rate number (fewer than 9 digits after the trunk) is left unchanged, not guessed at', () => {
  // A real class of Dutch numbers (some 0800 numbers) that this
  // conservative implementation deliberately does not attempt to
  // classify — see the module's own comment.
  const result = normalizePhoneNL('0800 1234');
  assert.equal(result.valid, false);
  assert.equal(result.normalized, '0800 1234');
});

// ─── normalizeAddressNL ────────────────────────────────────────────────

test('normalizeAddressNL: collapses internal whitespace runs to a single space', () => {
  const result = normalizeAddressNL('Fixturestraat   1,\t\n4811AA   Breda');
  assert.equal(result.normalized, 'Fixturestraat 1, 4811 AA Breda');
});

test('normalizeAddressNL: uppercases the postcode letters and normalizes their spacing', () => {
  assert.equal(normalizeAddressNL('4811aa Breda').normalized, '4811 AA Breda');
  assert.equal(normalizeAddressNL('4811  AA Breda').normalized, '4811 AA Breda');
  assert.equal(normalizeAddressNL('4811AA Breda').normalized, '4811 AA Breda');
  assert.equal(normalizeAddressNL('4811 aa Breda').normalized, '4811 AA Breda');
});

test('normalizeAddressNL: leaves an address with no postcode-shaped substring otherwise unchanged (beyond whitespace)', () => {
  const result = normalizeAddressNL('Fixturestraat 1, Breda');
  assert.equal(result.normalized, 'Fixturestraat 1, Breda');
  assert.equal(result.changed, false);
});

test('normalizeAddressNL: never reorders components or invents missing ones', () => {
  const result = normalizeAddressNL('Breda, 4811aa, Fixturestraat 1');
  assert.equal(result.normalized, 'Breda, 4811 AA, Fixturestraat 1', 'order of the original text is preserved exactly');
});

test('normalizeAddressNL: trims surrounding whitespace and never throws on malformed input', () => {
  assert.equal(normalizeAddressNL('  Fixturestraat 1  ').normalized, 'Fixturestraat 1');
  assert.doesNotThrow(() => normalizeAddressNL(null));
  assert.equal(normalizeAddressNL(null).valid, false);
  assert.equal(normalizeAddressNL(undefined).valid, false);
  assert.equal(normalizeAddressNL('').valid, false);
});

// ─── extractNlPostcode ─────────────────────────────────────────────────

test('extractNlPostcode: extracts and normalizes the postcode from free text', () => {
  assert.equal(extractNlPostcode('Fixturestraat 1, 4811aa Breda'), '4811 AA');
  assert.equal(extractNlPostcode('4811AA'), '4811 AA');
});

test('extractNlPostcode: null when no postcode-shaped substring is present', () => {
  assert.equal(extractNlPostcode('Fixturestraat 1, Breda'), null);
  assert.equal(extractNlPostcode(''), null);
  assert.equal(extractNlPostcode(null), null);
});

// ─── Idempotency — the central, cross-cutting guarantee for all three ───

const WEBSITE_SAMPLES = [
  'HTTP://Example.COM/Menu?Table=1',
  'https://restaurant.example/contact',
  'http://User:Pass@Example.COM:8080/path?x=1#frag',
];

const PHONE_SAMPLES = ['06 12345678', '06-12345678', '+31 6 12345678', '0031612345678', '010 1234567', '+31101234567'];

const ADDRESS_SAMPLES = [
  'Fixturestraat   1,\t4811AA   Breda',
  '4811aa Breda',
  'Fixturestraat 1, Breda',
  'Breda, 4811aa, Fixturestraat 1',
];

test('idempotency: normalizeWebsite(normalizeWebsite(x).normalized).normalized === normalizeWebsite(x).normalized', () => {
  for (const sample of WEBSITE_SAMPLES) {
    const once = normalizeWebsite(sample);
    const twice = normalizeWebsite(once.normalized);
    assert.equal(twice.normalized, once.normalized, `not idempotent for ${sample}`);
    assert.equal(twice.valid, once.valid);
  }
});

test('idempotency: normalizePhoneNL is idempotent on its own normalized (canonical) output', () => {
  for (const sample of PHONE_SAMPLES) {
    const once = normalizePhoneNL(sample);
    const twice = normalizePhoneNL(once.normalized);
    assert.equal(twice.normalized, once.normalized, `not idempotent for ${sample}`);
  }
});

test('idempotency: normalizePhoneNL is also idempotent on its own display output', () => {
  for (const sample of PHONE_SAMPLES) {
    const once = normalizePhoneNL(sample);
    const twice = normalizePhoneNL(once.display);
    assert.equal(twice.normalized, once.normalized, `display round-trip not idempotent for ${sample}`);
  }
});

test('idempotency: normalizeAddressNL(normalizeAddressNL(x).normalized).normalized === normalizeAddressNL(x).normalized', () => {
  for (const sample of ADDRESS_SAMPLES) {
    const once = normalizeAddressNL(sample);
    const twice = normalizeAddressNL(once.normalized);
    assert.equal(twice.normalized, once.normalized, `not idempotent for ${sample}`);
  }
});

test('idempotency: an invalid/uncertain value stays unchanged even when normalized again (never drifts)', () => {
  const invalidWebsite = normalizeWebsite('not-a-url');
  assert.equal(normalizeWebsite(invalidWebsite.normalized).valid, false);
  const invalidPhone = normalizePhoneNL('call us now');
  assert.equal(normalizePhoneNL(invalidPhone.normalized).valid, false);
});

// ─── Raw-value preservation — value passed through untouched ───────────

test('every normalizer preserves the trimmed raw value in .value, distinct from .normalized when they differ', () => {
  const website = normalizeWebsite('HTTP://Example.COM/x');
  assert.equal(website.value, 'HTTP://Example.COM/x');
  assert.notEqual(website.value, website.normalized);

  const phone = normalizePhoneNL('06-12345678');
  assert.equal(phone.value, '06-12345678');
  assert.notEqual(phone.value, phone.normalized);

  const address = normalizeAddressNL('4811aa   Breda');
  assert.equal(address.value, '4811aa   Breda');
  assert.notEqual(address.value, address.normalized);
});
