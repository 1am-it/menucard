'use strict';

// BE-14 — canonical back-navigation correction. Same convention as
// app/search/page.test.js: fs.readFileSync + regex, since this project has
// no rendered-DOM test harness for app/ pages. This is this component's
// first test file; it exists solely to pin the honest structural parent
// link this ticket adds — see
// be-14-fix-alle-restaurants-back-navigation.md.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const COMPONENT_PATH = path.join(REPO_ROOT, 'app/menu/[id]/MenuView.js');
const GLOBALS_CSS_PATH = path.join(REPO_ROOT, 'app/globals.css');

function readComponentSource() {
  return fs.readFileSync(COMPONENT_PATH, 'utf8');
}

function readGlobalsCss() {
  return fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
}

test('BE-14: the back-link is a real Link element pointing at this menu\'s own restaurant (/restaurant/{baseId}), not the browse-level /restaurants', () => {
  const source = readComponentSource();
  assert.match(
    source,
    /<Link href=\{`\/restaurant\/\$\{baseId\}`\} className="back-btn">← \{r\.name \|\| restaurant\.name\}<\/Link>/,
    'expected an honest structural parent link naming the restaurant and pointing at its own /restaurant/[id] route'
  );
});

test('BE-14: baseId is the same, already-existing restaurant id this file already derives — no new computation added', () => {
  const source = readComponentSource();
  assert.match(source, /const baseId\s*=\s*id\.split\('-'\)\[0\]/, 'baseId must remain this file\'s existing, unmodified derivation');
});

test('BE-14: the restaurant name source (r.name || restaurant.name) matches the pattern already used elsewhere in this file', () => {
  const source = readComponentSource();
  const occurrences = source.match(/r\.name \|\| restaurant\.name/g) || [];
  assert.ok(occurrences.length >= 2, 'expected the back-link to reuse the same r.name || restaurant.name source already read elsewhere in this file');
});

test('BE-14: the old browse-level "← Alle restaurants" back-link to /restaurants no longer exists on this page', () => {
  const source = readComponentSource();
  assert.doesNotMatch(source, /<Link href="\/restaurants"/, 'the old, mislabelled /restaurants target must be fully gone');
  assert.doesNotMatch(source, /← Alle restaurants/, 'the generic "Alle restaurants" back-link text must be replaced by the honest restaurant-name link');
});

test('BE-14: the back-link remains a real, accessible <Link> element — never a <div> or <span> with a click handler standing in for a link', () => {
  const source = readComponentSource();
  const backLinkMatch = source.match(/<Link href=\{`\/restaurant\/\$\{baseId\}`\}[^]*?<\/Link>/);
  assert.ok(backLinkMatch, 'expected to find the back-link as a real <Link> element');
  assert.doesNotMatch(backLinkMatch[0], /onClick/, 'the back-link itself must not rely on a click handler in place of real link semantics');
});

// ─── BE-12 — dish result deep link: scroll, focus, highlight, back-link ──
// Real validation logic (resolveDishTarget) is unit-tested with real data
// in src/lib/dishDeepLink.test.js — this file only checks the wiring:
// that /menu/[id] actually uses it, keeps `?q=` fully independent, and
// never introduces origin-tracking of any kind.

test('BE-12: imports the shared, unit-tested resolveDishTarget rather than duplicating validation logic here', () => {
  const source = readComponentSource();
  assert.match(source, /import \{ resolveDishTarget \} from ['"]@\/src\/lib\/dishDeepLink['"]/);
});

test('BE-12: dish/name/cat/fromQuery are read as their own, separate params — never merged into the existing query/excludeAllergens filter state', () => {
  const source = readComponentSource();
  assert.match(source, /const dishParam\s*=\s*searchParams\.get\('dish'\)/);
  assert.match(source, /const nameParam\s*=\s*searchParams\.get\('name'\)/);
  assert.match(source, /const catParam\s*=\s*searchParams\.get\('cat'\)/);
  assert.match(source, /const fromQueryParam\s*=\s*searchParams\.get\('fromQuery'\)/);
  // The existing `?q=`-driven filter state must still be seeded only from
  // `q`, never from any of the four new params.
  assert.match(source, /const \[query,\s*setQuery\]\s*=\s*useState\(urlQuery\)/);
});

test('BE-12: dishTarget is resolved against this route\'s own unfiltered r.categories, not the already-filtered list', () => {
  const source = readComponentSource();
  assert.match(
    source,
    /resolveDishTarget\(dishParam, nameParam, catParam, id, r\.categories\)/,
    'must validate against r.categories (unfiltered), never filteredCategories'
  );
});

test('BE-12: the scroll/focus/highlight effect is keyed only on dishTarget, so typing in the existing ?q= filter afterwards never re-triggers it', () => {
  const source = readComponentSource();
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*if \(!dishTarget \|\| !resolvedTargetItem\) return[\s\S]*?\}, \[dishTarget\]\)/);
  assert.ok(effectMatch, 'expected the highlight effect to depend on [dishTarget] only');
});

test('BE-12: the scroll respects prefers-reduced-motion — the first such check in this codebase', () => {
  const source = readComponentSource();
  assert.match(source, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(source, /behavior: prefersReducedMotion \? 'auto' : 'smooth'/);
});

test('BE-12: focus moves to the resolved item itself (not left at the top of the page)', () => {
  const source = readComponentSource();
  assert.match(source, /node\.focus\(\)/);
  assert.match(source, /tabIndex=\{isResolvedTarget \? -1 : undefined\}/);
});

test('BE-12: an aria-live region exists to announce the resolved dish once', () => {
  const source = readComponentSource();
  assert.match(source, /<div aria-live="polite" className="vh">\{dishAnnouncement\}<\/div>/);
});

test('BE-12: at most one item can ever be the resolved/highlighted target — matched by object identity against a single resolvedTargetItem, never by a filtered-list index', () => {
  const source = readComponentSource();
  assert.match(source, /const isResolvedTarget = item === resolvedTargetItem/);
  // Only one ref is ever handed out — never one per item.
  const refAssignments = source.match(/innerRef=\{isResolvedTarget \? highlightedItemRef : undefined\}/g) || [];
  assert.equal(refAssignments.length, 1);
});

test('BE-12: the substring mark for the resolved item comes from fromQuery, never the shared ?q= filter state, and only for that one item', () => {
  const source = readComponentSource();
  assert.match(source, /const displayQuery = isResolvedTarget && highlightQuery \? highlightQuery : query/);
});

test('BE-12: the back-to-search link is built only via URLSearchParams, as a same-origin relative path — never an absolute URL, returnTo, document.referrer, or sessionStorage', () => {
  const source = readComponentSource();
  assert.match(source, /const backToSearchHref = fromQueryParam\s*\n\s*\? `\/search\?\$\{new URLSearchParams\(\{ q: fromQueryParam \}\)\.toString\(\)\}`\s*\n\s*: null/);
  // Strip comments first: this file's own explanatory comments
  // legitimately *name* these forbidden mechanisms as negations
  // ("never a free returnTo value...") — a raw source scan would
  // otherwise misinterpret documenting the rule as breaking it.
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(withoutComments, /returnTo/i, 'no returnTo mechanism of any kind may exist in actual code');
  assert.doesNotMatch(withoutComments, /document\.referrer/, 'document.referrer must not be used for this or any other purpose');
  assert.doesNotMatch(withoutComments, /sessionStorage/, 'sessionStorage must not be used for this or any other purpose');
});

test('BE-12: the back-to-search link is shown alongside, not instead of, the existing restaurant back-link', () => {
  const source = readComponentSource();
  const headerBlock = source.match(/<header>[\s\S]*?<\/header>/)[0];
  assert.match(headerBlock, /<Link href=\{`\/restaurant\/\$\{baseId\}`\} className="back-btn">← \{r\.name \|\| restaurant\.name\}<\/Link>/, 'the BE-14 restaurant back-link must still be present');
  assert.match(headerBlock, /backToSearchHref && \(/, 'the new link must be conditionally additive, never replacing the one above');
});

test('BE-12: the existing ?q= filter state (query/excludeAllergens/dietTags/maxPrice) is completely unmodified by this ticket', () => {
  const source = readComponentSource();
  // The exact, pre-existing filteredCategories computation must still key
  // only off its original five dependencies — dish/name/cat/fromQuery are
  // not among them.
  assert.match(source, /\}, \[r, query, excludeAllergens, dietTags, maxPrice\]\)/);
});

test('BE-12: the header group wraps on narrow viewports — a real, measured 390px overflow was found and fixed when the second back-link was added, matching decision 014 item 5\'s mobile-overflow rule', () => {
  const source = readComponentSource();
  const headerBlock = source.match(/<header>[\s\S]*?<\/header>/)[0];
  assert.match(headerBlock, /flexWrap:\s*'wrap'/, 'the header-right group must wrap, not overflow, now that it can hold two back-links');
});

// ─── BE-12 — the dish+?q= edge case: a valid dish context whose item is
// excluded by an active ?q=/allergen/diet/price filter. Existing ?q=
// behavior stays authoritative — no crash, no misplaced focus, no
// highlight, no announcement for an item that isn't even rendered.
// Verified live (see task report): with a `?q=` value that excludes the
// resolved target, the effect below becomes a no-op. This test pins the
// exact guard that makes that true, so a future refactor can't silently
// drop it. ─────────────────────────────────────────────────────────────

test('BE-12: the highlight effect is a no-op whenever the resolved item has no rendered DOM node (filtered out by an active ?q=/allergen/diet/price filter) — never assumes the ref is set', () => {
  const source = readComponentSource();
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*if \(!dishTarget \|\| !resolvedTargetItem\) return\s*const node = highlightedItemRef\.current[\s\S]*?if \(!node\) return/);
  assert.ok(effectMatch, 'expected the effect to read the ref and bail out immediately when no node is attached');
});

test('BE-12: innerRef is only ever attached to the actually-rendered target — filteredCategories (not r.categories) drives what gets a ref, so a filtered-out target legitimately never receives one', () => {
  const source = readComponentSource();
  // The ref-wiring lives inside the filteredCategories.map(...) render
  // loop, not a loop over the unfiltered r.categories — confirmed by the
  // same isResolvedTarget/innerRef wiring already pinned above living
  // inside the `cat.items.map((item, j) => {` block under
  // `filteredCategories.map((cat, i) => {`.
  assert.match(source, /filteredCategories\.map\(\(cat, i\) => \{[\s\S]*?cat\.items\.map\(\(item, j\) => \{[\s\S]*?innerRef=\{isResolvedTarget \? highlightedItemRef : undefined\}/);
});

// BE-12 — live production check (see task report) found that
// .menu-card-highlighted silently inherited .menu-card's own
// `transition: border-color 0.15s`, so the highlight faded in instead of
// appearing instantly, in both normal and reduced-motion contexts. This
// pins the fix: an explicit `transition: none` override on
// .menu-card-highlighted itself, and confirms it doesn't leak onto the
// plain .menu-card rule.
test('BE-12: .menu-card-highlighted overrides the inherited .menu-card transition so the highlight is always instant, in both normal and reduced-motion contexts', () => {
  const css = readGlobalsCss();
  assert.match(css, /\.menu-card \{[^}]*transition: border-color 0\.15s;[^}]*\}/, 'the base .menu-card transition must be unchanged');
  const highlightRuleMatch = css.match(/\.menu-card-highlighted \{([^}]*)\}/);
  assert.ok(highlightRuleMatch, 'expected a single .menu-card-highlighted base rule');
  assert.match(highlightRuleMatch[1], /transition: none;/, 'the highlight rule must explicitly disable the inherited transition');
});

test('BE-16: the highlight stays visible for exactly 4000ms (was 2750ms/BE-12) — the only deliberate change to this effect', () => {
  const source = readComponentSource();
  assert.match(source, /setTimeout\(\(\) => setShowPulse\(false\), 4000\)/, 'expected the highlight-removal timer to use the new, decided 4000ms duration');
  assert.doesNotMatch(source, /setTimeout\(\(\) => setShowPulse\(false\), 2750\)/, 'the old 2750ms timer call must be fully gone, not left alongside the new one');
});

test('BE-16: keyboard focus is moved independently of, and before, the highlight timer starts — tabbing away or waiting past 4 seconds only removes the highlight class, never focus itself', () => {
  const source = readComponentSource();
  const effectMatch = source.match(/node\.scrollIntoView\([^)]*\)\s*node\.focus\(\)\s*setShowPulse\(true\)[\s\S]*?const timer = setTimeout/);
  assert.ok(effectMatch, 'expected node.focus() to run unconditionally before the highlight timer is created, with no dependency between them');
});
