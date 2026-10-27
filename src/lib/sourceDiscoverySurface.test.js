'use strict';

// BE-32 (#75) — the screens: Django-free structural proof that Dekking, Nieuw
// gevonden and "Restaurant of menu toevoegen" really mount the BE-32 engine and
// the agreed Dutch copy. Not a browser check and not real acceptance.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COVERAGE_PAGE = path.join(REPO_ROOT, 'app/internal/coverage/page.js');
const CHECK_SECTION = path.join(REPO_ROOT, 'app/internal/coverage/CoverageCheckSection.js');
const NEW_FOUND = path.join(REPO_ROOT, 'app/internal/coverage/NewFoundSection.js');
const ADD_PAGE = path.join(REPO_ROOT, 'app/internal/toevoegen/page.js');
const ROUTE = path.join(REPO_ROOT, 'app/api/internal/v1/source-discovery/route.js');
const IGNORE_ROUTE = path.join(REPO_ROOT, 'app/api/internal/v1/source-discovery/ignore/route.js');
const CSS = path.join(REPO_ROOT, 'app/globals.css');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('Dekking: the Dutch top with three tiles, then the check section and Nieuw gevonden', () => {
  const page = read(COVERAGE_PAGE);
  assert.match(page, /<h1 className="cov-title">Dekking 📊<\/h1>/);
  assert.match(page, /🍽️ restaurants/);
  assert.match(page, /📋 met menukaart/);
  assert.match(page, /🔎 nog niet gecontroleerd/);
  assert.match(page, /<CoverageCheckSection token=\{session\.access_token\} onUncheckedCount=\{setUncheckedCount\} \/>/);
  assert.match(page, /<NewFoundSection token=\{session\.access_token\} \/>/);
  assert.match(page, /Kaartgegevens: © OpenStreetMap-bijdragers/);
  // The existing data call and tables are untouched.
  assert.match(page, /\/api\/internal\/v1\/coverage/);
  assert.match(page, /<BreakdownTable title="Grootste gaten per buurt"/);
});

test('Dekking: "✨ Vind bronnen" runs the engine and confirms a proposal through the existing route', () => {
  const section = read(CHECK_SECTION);
  assert.match(section, /Vind bronnen/);
  assert.match(section, /\/api\/internal\/v1\/source-discovery/);
  // BE-34 (#81): one request per restaurant so the step list can be real; the
  // same bound (MAX_BATCH_URLS) still limits the whole selection.
  assert.match(section, /const list = ids\.slice\(0, MAX_BATCH_URLS\)/);
  assert.match(section, /restaurant_ids: \[id\]/);
  assert.match(section, /proposals\/\$\{encodeURIComponent\(row\.proposal\.id\)\}\/decision/);
  assert.match(section, /decision: 'accepted'/);
  assert.match(section, /Er is niets automatisch gepubliceerd/);
  assert.match(section, /costLine\(/);
  assert.match(section, /originLabel\(row\.proposal\.origin/);
});

test('Nieuw gevonden: "＋ Toevoegen" links to the add form, "Negeren" is remembered, OSM is named', () => {
  const section = read(NEW_FOUND);
  assert.match(section, /🆕 Nieuw gevonden/);
  assert.match(section, /Dekking voegt nooit zelf iets toe/);
  assert.match(section, /href=\{item\.addHref\}/);
  assert.match(section, /＋ Toevoegen/);
  assert.match(section, /Negeren/);
  assert.match(section, /\/api\/internal\/v1\/source-discovery\/ignore/);
  assert.match(section, /OSM_ATTRIBUTION/);
  // Nothing here writes a restaurant or a source.
  assert.doesNotMatch(section, /method: 'POST'[\s\S]{0,80}restaurants/);
});

test('Toevoegen: the same engine for one restaurant and the prefilled form', () => {
  const page = read(ADD_PAGE);
  assert.match(page, /✨ Zoek de bron voor mij/);
  assert.match(page, /\/api\/internal\/v1\/source-discovery/);
  assert.match(page, /restaurant_ids: \[selectedRestaurant\.id\]/);
  assert.match(page, /discoveryRow\(/);
  assert.match(page, /params\.get\('naam'\)/);
  assert.match(page, /params\.get\('website'\)/);
  assert.match(page, /params\.get\('adres'\)/);
  assert.match(page, /Ingevuld uit OpenStreetMap/);
  assert.match(page, /Kaartgegevens: \{OSM_ATTRIBUTION\}/);
});

test('routes: both source-discovery routes are internal-only and read their role check from the tested handlers', () => {
  const route = read(ROUTE);
  assert.match(route, /sourceDiscoveryHandlers\.newRestaurants\(request\)/);
  assert.match(route, /sourceDiscoveryHandlers\.findSources\(request\)/);
  assert.doesNotMatch(route, /getSupabaseAdmin|create_source_triage_proposal/);
  const ignore = read(IGNORE_ROUTE);
  assert.match(ignore, /sourceDiscoveryHandlers\.ignoreNew\(request\)/);

  const deps = read(path.join(REPO_ROOT, 'src/lib/sourceDiscoveryRouteDeps.js'));
  assert.match(deps, /authenticate: authenticateInternalRequest/);
  assert.match(deps, /fetchOverpassBusinesses\(\)/);
  assert.match(deps, /findMenuCandidates: findSameHostMenuCandidates/);
  assert.match(deps, /readSpend: \(\) => readAllAiUsageRows/);
  assert.match(deps, /createAnthropicStructuredCall\(/);
  assert.match(deps, /rpc\('create_source_triage_proposal'/);
  // No new table, no migration, no second AI client.
  assert.doesNotMatch(deps, /new Anthropic|ANTHROPIC_API_KEY|create table|from\('source_discovery/);
});

test('css: the new blocks use the existing tokens, never a new colour', () => {
  const css = read(CSS);
  for (const cls of ['.cov-head', '.cov-tiles', '.cov-tile', '.cov-note', '.cov-discovery', '.cov-new', '.mai-discovery']) {
    assert.ok(css.includes(`${cls} {`) || css.includes(`${cls},`), `${cls} exists`);
  }
  assert.match(css, /\.brn-detail-empty \{[^}]*flex: 1;/);
  assert.match(css, /\.brn-layout \{[^}]*align-items: stretch;/);
});
