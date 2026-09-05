'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseRobotsTxtDisallowRules,
  isPathAllowedByRobots,
  classifyRobotsGate,
  extractFromJsonLd,
  extractFromFallbackMarkup,
  parseContactSuggestionsFromHtml,
  composeAddressFromSchemaOrg,
  namesLikelyMatch,
  postcodesLikelyMatch,
  compareFieldValue,
  buildSuggestionResult,
} = require('./candidateSuggestions');

const { normalizeAddressNL } = require('./candidateNormalization');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');
}

// ─── robots.txt parsing — a product policy gate, never legal advice ────

test('parseRobotsTxtDisallowRules: collects Disallow rules only from the User-agent: * group', () => {
  const robots = [
    'User-agent: SomeOtherBot',
    'Disallow: /only-for-that-bot',
    '',
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /private',
  ].join('\n');
  assert.deepEqual(parseRobotsTxtDisallowRules(robots), ['/admin', '/private']);
});

test('parseRobotsTxtDisallowRules: an empty Disallow value means "allow everything" — represented as no rule', () => {
  const robots = 'User-agent: *\nDisallow:\n';
  assert.deepEqual(parseRobotsTxtDisallowRules(robots), []);
});

test('parseRobotsTxtDisallowRules: no robots.txt content at all means no rules', () => {
  assert.deepEqual(parseRobotsTxtDisallowRules(''), []);
  assert.deepEqual(parseRobotsTxtDisallowRules(null), []);
  assert.deepEqual(parseRobotsTxtDisallowRules(undefined), []);
});

test('parseRobotsTxtDisallowRules: ignores comments and malformed lines, never throws', () => {
  const robots = '# a comment\nUser-agent: *\n# another comment\nDisallow: /secret\nNotAColonLine\n';
  assert.doesNotThrow(() => parseRobotsTxtDisallowRules(robots));
  assert.deepEqual(parseRobotsTxtDisallowRules(robots), ['/secret']);
});

test('isPathAllowedByRobots: allows anything when there are no rules', () => {
  assert.equal(isPathAllowedByRobots([], '/anything'), true);
  assert.equal(isPathAllowedByRobots([], '/'), true);
});

test('isPathAllowedByRobots: blocks exact and prefix matches, allows everything else', () => {
  const rules = ['/admin', '/private'];
  assert.equal(isPathAllowedByRobots(rules, '/admin'), false);
  assert.equal(isPathAllowedByRobots(rules, '/admin/settings'), false);
  assert.equal(isPathAllowedByRobots(rules, '/contact'), true);
  assert.equal(isPathAllowedByRobots(rules, '/'), true);
});

// ─── classifyRobotsGate: the fail-closed gate (2026-09-05 fix) ─────────
// A failed robots.txt fetch must never be treated as "no restriction
// declared" — it must block the page fetch exactly like an explicit
// Disallow, while still being reported as a distinct status.

test('classifyRobotsGate: a failed robots.txt fetch fails closed — status "unconfirmed", page fetch never allowed', () => {
  const result = classifyRobotsGate({ robotsFetchFailed: true, robotsTxtBody: '', pathname: '/contact' });
  assert.deepEqual(result, { status: 'unconfirmed', shouldFetchPage: false });
});

test('classifyRobotsGate: a failed fetch fails closed even if a stale/leftover robotsTxtBody happens to be present', () => {
  const result = classifyRobotsGate({
    robotsFetchFailed: true,
    robotsTxtBody: 'User-agent: *\n',
    pathname: '/contact',
  });
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.shouldFetchPage, false);
});

test('classifyRobotsGate: an explicit Disallow covering the path is reported as "disallowed", page fetch not allowed', () => {
  const robotsTxtBody = 'User-agent: *\nDisallow: /contact\n';
  const result = classifyRobotsGate({ robotsFetchFailed: false, robotsTxtBody, pathname: '/contact' });
  assert.deepEqual(result, { status: 'disallowed', shouldFetchPage: false });
});

test('classifyRobotsGate: a confirmed robots.txt that does not disallow the path is "allowed", page fetch permitted', () => {
  const robotsTxtBody = 'User-agent: *\nDisallow: /admin\n';
  const result = classifyRobotsGate({ robotsFetchFailed: false, robotsTxtBody, pathname: '/contact' });
  assert.deepEqual(result, { status: 'allowed', shouldFetchPage: true });
});

test('classifyRobotsGate: an empty (but successfully fetched) robots.txt is "allowed" — absence of rules is not absence of confirmation', () => {
  const result = classifyRobotsGate({ robotsFetchFailed: false, robotsTxtBody: '', pathname: '/contact' });
  assert.deepEqual(result, { status: 'allowed', shouldFetchPage: true });
});

// ─── JSON-LD extraction (real fixture files, never a real website) ─────

test('extractFromJsonLd: extracts name/address/phone/website from a real Restaurant JSON-LD block', () => {
  const html = loadFixture('website-with-jsonld.html');
  const result = extractFromJsonLd(html);
  assert.equal(result.name, 'Fixture Restaurant Inside');
  assert.equal(result.phone, '+31 76 1111111');
  assert.equal(result.website, 'https://fixture-inside.example/');
  assert.equal(result.address, 'Fixturestraat 1, 4811AA Breda');
});

test('extractFromJsonLd: never reads menu/price/image fields, even though they are present on the same schema.org node', () => {
  const html = loadFixture('website-with-jsonld.html');
  const result = extractFromJsonLd(html);
  assert.deepEqual(Object.keys(result).sort(), ['address', 'name', 'phone', 'website']);
});

test('extractFromJsonLd: ignores an irrelevant schema type (e.g. BlogPosting) and returns null', () => {
  const html = loadFixture('website-irrelevant-jsonld.html');
  assert.equal(extractFromJsonLd(html), null);
});

test('extractFromJsonLd: returns null when there is no JSON-LD at all, never throws', () => {
  const html = loadFixture('website-fallback-contact.html');
  assert.doesNotThrow(() => extractFromJsonLd(html));
  assert.equal(extractFromJsonLd(html), null);
});

test('extractFromJsonLd: malformed JSON-LD is skipped, never crashes the whole parse', () => {
  const html = '<script type="application/ld+json">{ not valid json </script>';
  assert.doesNotThrow(() => extractFromJsonLd(html));
  assert.equal(extractFromJsonLd(html), null);
});

test('composeAddressFromSchemaOrg: composes street + postcode/locality, never invents a missing component', () => {
  assert.equal(
    composeAddressFromSchemaOrg({ streetAddress: 'Fixturestraat 1', postalCode: '4811AA', addressLocality: 'Breda' }),
    'Fixturestraat 1, 4811AA Breda'
  );
  assert.equal(composeAddressFromSchemaOrg({ streetAddress: 'Fixturestraat 1' }), 'Fixturestraat 1');
  assert.equal(composeAddressFromSchemaOrg({}), null);
  assert.equal(composeAddressFromSchemaOrg(null), null);
  assert.equal(composeAddressFromSchemaOrg('Plain string address'), 'Plain string address');
});

// ─── Fallback markup extraction (tel: links / <address> tag only) ──────

test('extractFromFallbackMarkup: extracts a tel: link and <address> tag content, nothing else', () => {
  const html = loadFixture('website-fallback-contact.html');
  const result = extractFromFallbackMarkup(html);
  assert.equal(result.phone, '+31762222222');
  assert.match(result.address, /Cafestraat 5/);
  assert.match(result.address, /4812 BB Breda/);
  assert.equal(result.name, null, 'the fallback path never guesses a name from page text');
  assert.equal(result.website, null);
});

test('extractFromFallbackMarkup: never crashes and returns all-null when nothing is present', () => {
  assert.doesNotThrow(() => extractFromFallbackMarkup('<html><body>nothing here</body></html>'));
  const result = extractFromFallbackMarkup('<html><body>nothing here</body></html>');
  assert.deepEqual(result, { name: null, address: null, phone: null, website: null });
});

// ─── parseContactSuggestionsFromHtml — prefers JSON-LD, falls back ─────

test('parseContactSuggestionsFromHtml: prefers JSON-LD when present', () => {
  const html = loadFixture('website-with-jsonld.html');
  const result = parseContactSuggestionsFromHtml(html);
  assert.equal(result.source, 'json-ld');
  assert.equal(result.phone, '+31 76 1111111');
});

test('parseContactSuggestionsFromHtml: falls back to markup when no relevant JSON-LD is found', () => {
  const html = loadFixture('website-fallback-contact.html');
  const result = parseContactSuggestionsFromHtml(html);
  assert.equal(result.source, 'fallback-markup');
  assert.equal(result.phone, '+31762222222');
});

// ─── namesLikelyMatch / postcodesLikelyMatch ───────────────────────────

test('namesLikelyMatch: exact and substring matches are true; unrelated names are false; missing data is null', () => {
  assert.equal(namesLikelyMatch('Fixture Restaurant', 'fixture restaurant'), true);
  assert.equal(namesLikelyMatch('De Kroeg', 'Café De Kroeg'), true);
  assert.equal(namesLikelyMatch('Fixture Restaurant', 'Totally Different Business'), false);
  assert.equal(namesLikelyMatch(null, 'Something'), null);
  assert.equal(namesLikelyMatch('Something', null), null);
  assert.equal(namesLikelyMatch('', ''), null);
});

test('postcodesLikelyMatch: compares extracted NL postcodes; missing data on either side is null, never false', () => {
  assert.equal(postcodesLikelyMatch('Fixturestraat 1, 4811AA Breda', 'Fixturestraat 1, 4811 aa Breda'), true);
  assert.equal(postcodesLikelyMatch('Fixturestraat 1, 4811AA Breda', 'Anderestraat 99, 1000AA Amsterdam'), false);
  assert.equal(postcodesLikelyMatch('Fixturestraat 1, no postcode here', 'Fixturestraat 1, 4811AA Breda'), null);
  assert.equal(postcodesLikelyMatch(null, '4811AA'), null);
});

// ─── compareFieldValue ──────────────────────────────────────────────────

test('compareFieldValue: no_data when nothing was suggested', () => {
  assert.equal(compareFieldValue('06 12345678', null, require('./candidateNormalization').normalizePhoneNL), 'no_data');
  assert.equal(compareFieldValue('06 12345678', '', require('./candidateNormalization').normalizePhoneNL), 'no_data');
});

test('compareFieldValue: "new" when the candidate has no existing value', () => {
  assert.equal(compareFieldValue(null, '06 12345678', require('./candidateNormalization').normalizePhoneNL), 'new');
  assert.equal(compareFieldValue(undefined, '06 12345678', require('./candidateNormalization').normalizePhoneNL), 'new');
});

test('compareFieldValue: "match" when the suggestion agrees with the existing value after normalization', () => {
  const { normalizePhoneNL } = require('./candidateNormalization');
  assert.equal(compareFieldValue('06-12345678', '06 12345678', normalizePhoneNL), 'match');
});

test('compareFieldValue: "needs_review" when the suggestion conflicts with the existing value — never silently preferred', () => {
  const { normalizePhoneNL } = require('./candidateNormalization');
  assert.equal(compareFieldValue('06 12345678', '06 99999999', normalizePhoneNL), 'needs_review');
});

// ─── buildSuggestionResult — the full, combined output the route returns

test('buildSuggestionResult: a clean match — new fields, no warnings', () => {
  const parsed = parseContactSuggestionsFromHtml(loadFixture('website-with-jsonld.html'));
  const result = buildSuggestionResult({
    parsed,
    candidateFields: { name: 'Fixture Restaurant Inside' }, // no address/phone/website yet
    sourceUrl: 'https://fixture-inside.example/',
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.suggestions.phone.status, 'new');
  assert.equal(result.suggestions.address.status, 'new');
  assert.equal(result.suggestions.website.status, 'new');
  assert.equal(result.suggestions.phone.source_url, 'https://fixture-inside.example/');
});

test('buildSuggestionResult: confirms an already-correct existing value as "match"', () => {
  const parsed = parseContactSuggestionsFromHtml(loadFixture('website-with-jsonld.html'));
  const result = buildSuggestionResult({
    parsed,
    candidateFields: { name: 'Fixture Restaurant Inside', phone: '076-1111111' },
    sourceUrl: 'https://fixture-inside.example/',
  });
  assert.equal(result.suggestions.phone.status, 'match');
});

test('buildSuggestionResult: a name/address mismatch flags every present suggestion as needs_review, with a clear warning', () => {
  const parsed = parseContactSuggestionsFromHtml(loadFixture('website-mismatched-jsonld.html'));
  const result = buildSuggestionResult({
    parsed,
    candidateFields: { name: 'Fixture Restaurant Inside', address: 'Fixturestraat 1, 4811AA Breda' },
    sourceUrl: 'https://mismatched.example/',
  });
  assert.ok(result.warnings.length >= 2, 'expected both a name and an address warning');
  assert.equal(result.suggestions.phone.status, 'needs_review', 'even an otherwise-plain new phone value is downgraded');
  assert.equal(result.suggestions.address.status, 'needs_review');
});

test('buildSuggestionResult: a direct field-level conflict is needs_review even without a name/address mismatch', () => {
  const parsed = { name: null, address: null, phone: '+31 76 9999999', website: null, source: 'json-ld' };
  const result = buildSuggestionResult({
    parsed,
    candidateFields: { phone: '06 12345678' },
    sourceUrl: 'https://example.test/',
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.suggestions.phone.status, 'needs_review');
});

test('buildSuggestionResult: never returns anything beyond address/phone/website — no menu, price, or other content leaks through', () => {
  const parsed = parseContactSuggestionsFromHtml(loadFixture('website-with-jsonld.html'));
  const result = buildSuggestionResult({ parsed, candidateFields: {}, sourceUrl: 'https://fixture-inside.example/' });
  assert.deepEqual(Object.keys(result.suggestions).sort(), ['address', 'phone', 'website']);
});
