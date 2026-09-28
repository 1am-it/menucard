'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CANDIDATES,
  MENU_KEYWORDS,
  anchorLooksLikeMenuLink,
  collectAnchors,
  findSameHostMenuCandidates,
} = require('./sameHostDiscovery');

// ─── anchorLooksLikeMenuLink ────────────────────────────────────────────

test('anchorLooksLikeMenuLink: matches on visible text keyword, case-insensitive', () => {
  assert.equal(anchorLooksLikeMenuLink('/pagina-1', 'Onze Menukaart'), true);
});

test('anchorLooksLikeMenuLink: matches on href path keyword when text has none', () => {
  assert.equal(anchorLooksLikeMenuLink('/kaart.pdf', 'Klik hier'), true);
});

test('anchorLooksLikeMenuLink: false when neither text nor href contains a known keyword', () => {
  assert.equal(anchorLooksLikeMenuLink('/over-ons', 'Over ons'), false);
});

test('anchorLooksLikeMenuLink: never matched on null/undefined text or href', () => {
  assert.equal(anchorLooksLikeMenuLink(null, null), false);
  assert.equal(anchorLooksLikeMenuLink(undefined, undefined), false);
});

test('MENU_KEYWORDS: fixed, closed list — every entry is already lowercase', () => {
  for (const keyword of MENU_KEYWORDS) {
    assert.equal(keyword, keyword.toLowerCase());
  }
});

// ─── collectAnchors ──────────────────────────────────────────────────────

test('collectAnchors: resolves a relative href against the base URL', () => {
  const html = '<a href="/menukaart">Menukaart</a>';
  const anchors = collectAnchors(html, 'https://example.nl/');
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].url.href, 'https://example.nl/menukaart');
  assert.equal(anchors[0].hrefPath, '/menukaart');
  assert.equal(anchors[0].visibleText, 'Menukaart');
});

test('collectAnchors: strips nested tags from the anchor\'s own visible text', () => {
  const html = '<a href="/kaart"><span>Onze</span> Kaart</a>';
  const anchors = collectAnchors(html, 'https://example.nl/');
  assert.equal(anchors[0].visibleText, 'Onze Kaart');
});

test('collectAnchors: skips a malformed/unparseable href rather than throwing', () => {
  const html = '<a href="http://[not-a-valid-ipv6">Broken</a><a href="/ok">OK</a>';
  const anchors = collectAnchors(html, 'https://example.nl/');
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].hrefPath, '/ok');
});

test('collectAnchors: returns [] given a malformed base URL', () => {
  assert.deepEqual(collectAnchors('<a href="/x">x</a>', 'not a url'), []);
});

test('collectAnchors: returns [] given no HTML', () => {
  assert.deepEqual(collectAnchors('', 'https://example.nl/'), []);
  assert.deepEqual(collectAnchors(null, 'https://example.nl/'), []);
});

test('collectAnchors: preserves document order', () => {
  const html = '<a href="/a">Alpha</a><a href="/b">Beta</a><a href="/c">Gamma</a>';
  const anchors = collectAnchors(html, 'https://example.nl/');
  assert.deepEqual(anchors.map((a) => a.hrefPath), ['/a', '/b', '/c']);
});

// ─── findSameHostMenuCandidates ──────────────────────────────────────────

test('findSameHostMenuCandidates: finds a same-host menu link by visible text', () => {
  const html = '<a href="/menukaart">Bekijk onze menukaart</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://debotanistbreda.nl/');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://debotanistbreda.nl/menukaart');
});

test('findSameHostMenuCandidates: finds a same-host menu link by href-path keyword alone', () => {
  const html = '<a href="/bestanden/kaart-2026.pdf">Download</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://example.nl/');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://example.nl/bestanden/kaart-2026.pdf');
});

test('findSameHostMenuCandidates: never returns a cross-host candidate', () => {
  const html = '<a href="https://elders.nl/menukaart">Menukaart</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://example.nl/');
  assert.deepEqual(candidates, []);
});

test('findSameHostMenuCandidates: treats a www.-prefixed host as the same host (matches restaurantHostMatch.js\'s own convention)', () => {
  const html = '<a href="https://www.example.nl/menukaart">Menukaart</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://example.nl/');
  assert.equal(candidates.length, 1);
});

test('findSameHostMenuCandidates: never proposes the homepage itself as a candidate', () => {
  const html = '<a href="/">Home</a><a href="/menukaart">Menukaart</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://example.nl/');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://example.nl/menukaart');
});

test('findSameHostMenuCandidates: de-duplicates repeated anchors pointing at the same URL', () => {
  const html = '<a href="/menukaart">Menukaart</a><a href="/menukaart">Bekijk kaart</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://example.nl/');
  assert.equal(candidates.length, 1);
});

test('findSameHostMenuCandidates: never exceeds MAX_CANDIDATES, even with many matching anchors', () => {
  const links = [];
  for (let i = 0; i < MAX_CANDIDATES + 10; i += 1) {
    links.push(`<a href="/menukaart-${i}">Menukaart ${i}</a>`);
  }
  const candidates = findSameHostMenuCandidates(links.join(''), 'https://example.nl/');
  assert.equal(candidates.length, MAX_CANDIDATES);
});

test('findSameHostMenuCandidates: returns [] when nothing on the page matches a menu keyword — never guesses', () => {
  const html = '<a href="/over-ons">Over ons</a><a href="/contact">Contact</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://example.nl/');
  assert.deepEqual(candidates, []);
});

test('findSameHostMenuCandidates: returns [] given no HTML at all', () => {
  assert.deepEqual(findSameHostMenuCandidates('', 'https://example.nl/'), []);
});

test('findSameHostMenuCandidates: preserves document order (first-seen match wins, never re-ranked)', () => {
  const html = '<a href="/lunchkaart">Lunch</a><a href="/dinerkaart">Diner</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://example.nl/');
  assert.deepEqual(candidates.map((c) => c.url), [
    'https://example.nl/lunchkaart',
    'https://example.nl/dinerkaart',
  ]);
});

test('findSameHostMenuCandidates: a candidate carries which text/path it matched on, for auditability', () => {
  const html = '<a href="/menukaart">Onze Menukaart 2026</a>';
  const candidates = findSameHostMenuCandidates(html, 'https://example.nl/');
  assert.equal(candidates[0].matchedOn, 'Onze Menukaart 2026');
});
