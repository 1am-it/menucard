'use strict';

// BE-11 Fase 2 — structural source tests for the joint dish + restaurant
// search page. Same convention as app/alle-restaurants/page.test.js /
// src/lib/nvwaComplianceCopy.test.js: fs.readFileSync + regex, since this
// project has no rendered-DOM test harness for app/ pages. These tests
// check the wiring and the literal, required copy this ticket specifies —
// they do not replace manual/Playwright verification of actual rendered
// behavior (see the BE-11 ticket's own verification notes for that).

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app/search/page.js');
const API_SEARCH_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/search/route.js');
const DISH_SEARCH_SERVICE_PATH = path.join(REPO_ROOT, 'src/services/dishSearch.js');

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

test('dish search still fetches the existing, unmodified /api/search endpoint, unrelated to the new restaurant fetch', () => {
  const source = readPageSource();
  assert.match(source, /fetch\(`\/api\/search\?\$\{params\.toString\(\)\}`\)/, 'the dish search request must still target /api/search exactly as before');
});

test('the restaurant group fetches the existing GET /api/restaurants endpoint', () => {
  const source = readPageSource();
  assert.match(source, /fetch\(`\/api\/restaurants\?\$\{params\.toString\(\)\}`\)/);
});

test('the restaurant fetch is gated on the free-text query alone, not on filtersKey (BE-11 Fase 2 §3) — toggling a filter with no query must never trigger it', () => {
  const source = readPageSource();
  assert.match(source, /useEffect\(\(\) => \{\s*const trimmedQ = filters\.q\.trim\(\)/, 'expected a restaurant-search effect keyed on filters.q');
  assert.match(source, /\}, \[filters\.q\]\)/, 'the restaurant-search effect must depend on filters.q only, never on filtersKey');
});

test('the restaurant fetch requires a meaningful (2+ character) query, matching this project\'s existing minimum-length convention', () => {
  const source = readPageSource();
  assert.match(source, /MEANINGFUL_QUERY_MIN_LENGTH\s*=\s*2/);
  assert.match(source, /trimmedQ\.length < MEANINGFUL_QUERY_MIN_LENGTH/);
});

test('imports the shared RestaurantBrowseCard component rather than duplicating it', () => {
  const source = readPageSource();
  assert.match(source, /import RestaurantBrowseCard from ['"]@\/src\/components\/RestaurantBrowseCard['"]/);
});

test('renders both required, literally-named result groups — "Gerechten gevonden" and "Restaurants gevonden"', () => {
  const source = readPageSource();
  assert.match(source, />\s*Gerechten gevonden/);
  assert.match(source, />\s*Restaurants gevonden/);
});

test('the restaurant group is only ever rendered when it actually has results — never a bare "0 restaurants" block', () => {
  const source = readPageSource();
  assert.match(source, /const restaurantsGroup = meaningfulQuery && restaurantResults\.length > 0 &&/);
});

test('group order is driven by the server-computed uniqueNameMatch flag from GET /api/restaurants, never re-derived client-side from a result list', () => {
  const source = readPageSource();
  assert.match(source, /const restaurantsFirst = meaningfulQuery && uniqueNameMatch && restaurantResults\.length > 0/);
  assert.match(source, /setUniqueNameMatch\(!!data\.uniqueNameMatch\)/, 'uniqueNameMatch must come directly from the endpoint response');
});

test('default order is dishes first: dishesGroup renders before restaurantsGroup unless restaurantsFirst is true', () => {
  const source = readPageSource();
  assert.match(source, /restaurantsFirst \? \(\s*<>\s*\{restaurantsGroup\}\s*\{dishesGroup\}\s*<\/>\s*\) : \(\s*<>\s*\{dishesGroup\}\s*\{restaurantsGroup\}\s*<\/>\s*\)/);
});

test('honest copy: when only restaurants (no dishes) are found, the page says so explicitly rather than showing a bare "no dishes" message', () => {
  const source = readPageSource();
  assert.match(source, /Geen gerechten gevonden voor.*wel.*restaurant.*gevonden/);
});

test('honest copy: the default empty state and search placeholder mention restaurant\/buurt as real, working search forms', () => {
  const source = readPageSource();
  assert.match(source, /restaurantnaam of buurt/);
  assert.match(source, /placeholder="Zoek steak, sushi, een restaurant of een buurt…"/);
});

test('dishSearch.js is untouched by this ticket — it exists and still exports searchDishes', () => {
  const source = fs.readFileSync(DISH_SEARCH_SERVICE_PATH, 'utf8');
  assert.match(source, /module\.exports\s*=\s*\{[^}]*searchDishes/);
});

test('app/api/search/route.js is untouched by this ticket — it still only calls searchDishes, with no restaurant-index import', () => {
  const source = fs.readFileSync(API_SEARCH_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /restaurantIndex/, 'the existing dish-search API route must not import or depend on the restaurant index');
});

// ─── Regression fix: heading hierarchy (a pre-commit review found h3-before-
// h2, and restaurant names as sibling h2s to the group headings) ──────────

test('the page has a real <h1>, so the group <h2>s below it nest correctly', () => {
  const source = readPageSource();
  assert.match(source, /<h1 className="vh">Zoeken<\/h1>/, 'expected a (visually hidden, visual design unchanged) page-level <h1>');
});

test('restaurant cards inside the "Restaurants gevonden" group render as <h3>, not sibling <h2>s to the group heading', () => {
  const source = readPageSource();
  assert.match(source, /<RestaurantBrowseCard key=\{restaurant\.restaurantId\} restaurant=\{restaurant\} headingLevel=\{3\} \/>/);
});

test('the dish-results-empty status message is not a heading (no <h3> inside that branch), so it never sits out of order next to the group <h2>/restaurant <h3>s', () => {
  const source = readPageSource();
  assert.match(source, /<p className="empty-state-title">\{meaningfulQuery && restaurantResults\.length > 0 \? 'Geen gerechten gevonden' : 'Niets gevonden'\}<\/p>/);
});

// ─── Regression fix: honest filter-scope copy + de-duplicated empty copy ──

test('when active dish filters are shown alongside restaurant results, a neutral note clarifies filters do not apply to restaurants', () => {
  const source = readPageSource();
  assert.match(source, /\{active && \(/);
  assert.match(source, /Filters gelden alleen voor gerechtresultaten, niet voor restaurants\./);
});

test('when the restaurant group already renders above the dish-empty message (restaurantsFirst), the redundant "wel N restaurant(en) gevonden" clause is dropped', () => {
  const source = readPageSource();
  assert.match(source, /restaurantsFirst \? \(\s*(?:\/\/[^\n]*\n\s*)*<>Geen gerechten gevonden voor &quot;\{filters\.q\}&quot;\.<\/>/, 'expected a short, non-repetitive message specifically for the restaurantsFirst case');
});

test('when the restaurant group renders below the dish-empty message (not restaurantsFirst), the "wel N restaurant(en) gevonden" clause is kept — it is not yet visible above', () => {
  const source = readPageSource();
  assert.match(source, /<>Geen gerechten gevonden voor &quot;\{filters\.q\}&quot; — wel \{restaurantTotal\} restaurant\{restaurantTotal !== 1 \? 's' : ''\} gevonden met deze naam of buurt\.<\/>/);
});

// ─── Regression fix: close the last two h1→h3 heading-level skips ────────
// A later review found the page's simplest two states — the default
// "Waar heb je zin in?" landing state and the "Er ging iets mis" error
// state — still rendered a bare <h3> directly under the page's new <h1>,
// with no <h2> in between. Fixed by promoting both to <h2> (nested
// correctly under the <h1>) using the existing .empty-state-title class,
// never a bare tag-selector, so this doesn't also restyle an unrelated
// <h2> inside .empty-state elsewhere in the app (e.g. app/menu/[id]/
// MenuView.js's "Menu niet gevonden" state).

test('the default "Waar heb je zin in?" state is an <h2> (not <h3>), closing the h1→h3 skip', () => {
  const source = readPageSource();
  assert.match(source, /<h2 className="empty-state-title">Waar heb je zin in\?<\/h2>/);
});

test('the "Er ging iets mis" error state is an <h2> (not <h3>), closing the h1→h3 skip', () => {
  const source = readPageSource();
  assert.match(source, /<h2 className="empty-state-title">Er ging iets mis<\/h2>/);
});

test('no <h3> JSX element remains anywhere in this file — only the restaurant-name headings inside a rendered group are <h3>, and those live in RestaurantBrowseCard, not here', () => {
  const source = readPageSource();
  // Strip comments first: this file's own explanatory comments legitimately
  // mention "<h3>" as text while describing the fix, which a raw source
  // scan would otherwise misinterpret as a rendered element.
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(withoutComments, /<h3[ >]/, 'app/search/page.js must not render any <h3> of its own — restaurant-name <h3>s come from RestaurantBrowseCard, not from this file');
});

// ─── BE-11 primary navigation slice — PrimaryNav mounted, "← Home" removed ──
// First navigation slice: PrimaryNav is mounted only on /search and
// /alle-restaurants (never on the homepage, /restaurants, or any detail
// page — see src/components/PrimaryNav.js and the BE-11 ticket's own
// "Primary navigation" section for the full, decided scope). The
// previously duplicate "← Home" link is removed here since the existing,
// already-accessible BredaEats logo link to "/" already covers it.

test('imports and renders the shared PrimaryNav component, before ThemeToggle, inside the existing header-right group', () => {
  const source = readPageSource();
  assert.match(source, /import PrimaryNav from ['"]@\/src\/components\/PrimaryNav['"]/);
  assert.match(source, /<div className="header-right">\s*<PrimaryNav \/>\s*<ThemeToggle \/>\s*<\/div>/);
});

test('the duplicate "← Home" link is removed; the BredaEats logo remains the only link to "/"', () => {
  const source = readPageSource();
  assert.doesNotMatch(source, /← Home/, 'the redundant back-link must be gone now that the logo already links to "/"');
  const logoMatches = source.match(/<Link href="\/"[^>]*>/g) || [];
  assert.equal(logoMatches.length, 1, 'exactly one link to "/" should remain — the logo');
  assert.match(source, /<Link href="\/" className="logo">Breda<span>Eats<\/span><\/Link>/, 'the logo link itself must stay fully intact and unchanged');
});

test('the header-right group uses the shared .header-right class, not an inline style, so it inherits the existing mobile flex-wrap treatment', () => {
  const source = readPageSource();
  assert.doesNotMatch(source, /style=\{\{\s*display:\s*'flex',\s*gap:\s*8/, 'the old inline right-hand header style must be gone');
});

// ─── BE-13 provenance-copy correction — restaurant name is no longer a
// dish-search match field (src/services/dishSearch.js), so the old
// "gevonden via restaurantnaam" hint became factually wrong for every
// remaining case it could still fire on (a real, currently-shipped
// example: q=Chablis matches six dishes only via their internal wine
// field, at a restaurant whose own name never contains "Chablis" — that
// hint text described a cause that was never true even for this pre-
// existing case). Replaced with neutral, honest copy that names the real
// mechanism (an internal, non-public supplement/wine field) without
// exposing its raw text. ─────────────────────────────────────────────────

test('the old, now-inaccurate "gevonden via restaurantnaam" hint text is gone', () => {
  const source = readPageSource();
  assert.doesNotMatch(source, /gevonden via restaurantnaam/, 'restaurant name can no longer cause a dish match (BE-13) — this text must not remain');
});

test('the weak-match hint uses the new, neutral, factually accurate copy', () => {
  const source = readPageSource();
  assert.match(source, /\{weakMatch && <span className="dish-result-match-hint"> · Gevonden in aanvullende menudetails<\/span>\}/);
});

test('isWeakMatch\'s own comment no longer assumes restaurant name or a ranking tier 4 as a possible cause', () => {
  const source = readPageSource();
  const commentMatch = source.match(/\/\/ Display-only heuristic:[\s\S]*?function isWeakMatch/);
  assert.ok(commentMatch, 'expected to find the isWeakMatch heuristic comment block');
  const comment = commentMatch[0];
  assert.doesNotMatch(comment, /tier 4/i, 'the comment must not still reference the removed ranking tier 4');
  assert.doesNotMatch(comment, /restaurant'?s name/i, 'the comment must not still claim restaurant name can cause a weak match');
});

test('nowhere in this file does any comment or visible copy claim a dish\'s own restaurant name can cause it to match', () => {
  const source = readPageSource();
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  // Visible JSX/copy only (comments already stripped): the page may still
  // legitimately *display* dish.restaurantName as plain restaurant
  // context (unrelated to why a dish matched) — this checks no remaining
  // string literal frames restaurant name as a match reason.
  assert.doesNotMatch(withoutComments, /restaurantnaam.*(?:gevonden|matcht|reden)/i, 'no visible copy may claim restaurant name is why a dish matched');
});
