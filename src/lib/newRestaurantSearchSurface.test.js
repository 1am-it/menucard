'use strict';

// BE-34 (#81, criterion 2) — structural proof that the add form really offers
// "✨ Zoek op internet: <naam>, Breda", that the proposal carries name, address,
// website, menu link and provenance, that it opens the existing onboarding and
// that nothing is created automatically. Structure only, not a browser check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('the name search reuses the existing route family and the same engine', () => {
  const route = read('app/api/internal/v1/source-discovery/name/route.js');
  assert.match(route, /sourceDiscoveryHandlers\.searchByName\(request\)/);
  assert.match(route, /export const maxDuration = 300/);
  // One engine: the route never talks to Supabase, the provider or OSM itself.
  assert.doesNotMatch(route, /getSupabaseAdmin|create_source_triage_proposal|fetch\(|Anthropic/);

  const handlers = read('src/lib/sourceDiscoveryHandlers.js');
  assert.match(handlers, /async function searchByName\(request\)/);
  assert.match(handlers, /validateSearchAnswer\(/);
  assert.match(handlers, /findOsmBusinessByName\(/);
  // No write path: the name search never saves a proposal or a restaurant.
  const start = handlers.indexOf('async function searchByName');
  const end = handlers.indexOf('/** POST /api/internal/v1/source-discovery —');
  const body = handlers.slice(start, end);
  assert.doesNotMatch(body, /saveProposal|create_source_triage_proposal|insert\(/);
});

test('the add form offers the search only for a name that is not in our list', () => {
  const page = read('app/internal/toevoegen/page.js');
  assert.match(page, /const NAME_API = '\/api\/internal\/v1\/source-discovery\/name'/);
  // BE-37 (#89): the star is decoration and goes through <Emoji>; the label is
  // the same text as before, so the button still reads "Zoek op internet: …".
  assert.match(page, /<Emoji glyph="✨" \/>\{' '\}/);
  assert.match(page, /`Zoek op internet: \$\{restaurantQuery\.trim\(\)\.slice\(0, 120\)\}, Breda`/);
  assert.match(page, /restaurantQuery\.trim\(\)\.length >= 2 && restaurantChoices\.length === 0/);
  assert.match(page, /body: JSON\.stringify\(\{ name \}\)/);
});

test('the proposal shows name, address, website, menu link, provenance and cost', () => {
  const page = read('app/internal/toevoegen/page.js');
  assert.match(page, /nameSearch\.proposal\.name/);
  assert.match(page, /nameSearch\.proposal\.address/);
  assert.match(page, /nameSearch\.proposal\.website\.url/);
  assert.match(page, /nameSearch\.proposal\.menu/);
  assert.match(page, /Herkomst: \{nameSearch\.proposal\.originLabel \|\| 'zoekactie'\}/);
  assert.match(page, /costLine\(\{/);
  assert.match(page, /Toevoegen als nieuw restaurant/);
  assert.match(page, /href=\{nameSearch\.proposal\.onboardingHref\}/);
  assert.match(page, /Er wordt niets automatisch aangemaakt/);
  assert.match(page, /Lees met AI/);
});

test('the existing onboarding receives the name, the address and the website', () => {
  const page = read('app/internal/onboarding-restaurant/page.js');
  assert.match(page, /params\.get\('naam'\)/);
  assert.match(page, /params\.get\('adres'\)/);
  assert.match(page, /params\.get\('website'\)/);
  assert.match(page, /params\.get\('menu'\)/);
  assert.match(page, /Nieuw restaurant uit de zoekactie/);
  assert.match(page, /er is nog\s+niets aangemaakt/i);
  // The URL field is prefilled; nothing starts by itself.
  assert.match(page, /else if \(menu && \/\^https\?:\\\/\\\/\/i\.test\(menu\)/);
  assert.match(page, /else if \(website && \/\^https\?:\\\/\\\/\/i\.test\(website\)/);
});

test('the onboarding address is built in one tested place', () => {
  const discovery = read('src/lib/sourceDiscovery.js');
  assert.match(discovery, /const ONBOARDING_HREF = '\/internal\/onboarding-restaurant'/);
  assert.match(discovery, /function newRestaurantHref\(/);
  assert.match(discovery, /new URLSearchParams\(\{ naam: value \}\)/);
  assert.match(discovery, /params\.set\('adres'/);
  assert.match(discovery, /params\.set\('website'/);
  assert.match(discovery, /params\.set\('menu'/);
});
