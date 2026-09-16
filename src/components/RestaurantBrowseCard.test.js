'use strict';

// BE-11 Fase 2 — these structural source tests moved here from
// app/alle-restaurants/page.test.js when RestaurantBrowseCard was
// extracted into its own shared component (src/components/
// RestaurantBrowseCard.js) so /search (BE-11 Fase 2) could reuse it
// without duplicating the markup. Same convention as before: fs
// .readFileSync + regex, this project's existing pattern for a
// component with no browser/DOM test harness (see
// src/lib/nvwaComplianceCopy.test.js / moderationFormatting.test.js).

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMPONENT_PATH = path.join(REPO_ROOT, 'src/components/RestaurantBrowseCard.js');
const GLOBALS_CSS_PATH = path.join(REPO_ROOT, 'app/globals.css');

function readComponentSource() {
  return fs.readFileSync(COMPONENT_PATH, 'utf8');
}

function readGlobalsCss() {
  return fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
}

test('address-less fallback explicitly labels the buurt value, not a bare neighbourhood name', () => {
  const source = readComponentSource();
  assert.match(source, /Buurt: \{restaurant\.buurt\}/, 'the fallback branch must render an explicit "Buurt:" prefix');
});

test('the fallback span carries no aria-label — its accessible name must equal its visible "Buurt: X" text, not an overridden one', () => {
  const source = readComponentSource();
  const fallbackLineMatch = source.match(/<span className="lrc-address">Buurt: \{restaurant\.buurt\}<\/span>/);
  assert.ok(fallbackLineMatch, 'expected the exact fallback element, with no aria-label or other accessible-name override applied to it');
});

test('a real, valid address is still rendered as-is, never prefixed with "Buurt:"', () => {
  const source = readComponentSource();
  assert.match(source, /<span className="lrc-address">\{restaurant\.address\}<\/span>/, 'a valid address must render unprefixed and unchanged');
});

test('exactly one primary action per card: hasMenu renders one "Bekijk...menukaart(en)" link, no-menu renders one "Bekijk restaurant" link plus a non-actionable note — never two links', () => {
  const source = readComponentSource();
  assert.match(source, /Bekijk \{restaurant\.menuLinks\.length\} menukaart/, 'menu variant must offer exactly one primary action');
  assert.match(source, /Bekijk restaurant/, 'menu-less variant must still offer exactly one primary action');
  assert.match(source, /Nog geen menukaart beschikbaar/, 'menu-less variant must say so, not silently show nothing');
});

test('no contact, reservation, phone, chat, or website action exists on this card', () => {
  const source = readComponentSource();
  // Checked as concrete markup patterns, not loose words — this file's
  // own header comment legitimately discusses "reservation" and
  // "website" as things the card must NOT offer, which a bare keyword
  // search would misfire on.
  assert.doesNotMatch(source, /href=["']tel:|href=["']mailto:|href=\{`?whatsapp|>Reserveer|>Chat met|>Bekijk website/i);
});

test('price level uses aria-hidden glyph plus a visually-hidden accessible label, never an aria-label override on a non-interactive element', () => {
  const source = readComponentSource();
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /className="vh">, prijsniveau: \{priceLabel\}/);
  assert.doesNotMatch(source, /aria-label=\{`.*prijsniveau/i);
});

// ─── Regression fix: configurable heading level (a pre-commit review found
// this card's own hardcoded <h2> restaurant name became a sibling to
// /search's new "Restaurants gevonden" <h2> group heading, flattening the
// group→item hierarchy) ─────────────────────────────────────────────────

test('accepts an optional headingLevel prop, defaulting to 2 — the unchanged behavior /alle-restaurants relies on (h1 > h2)', () => {
  const source = readComponentSource();
  assert.match(source, /function RestaurantBrowseCard\(\{ restaurant, headingLevel = 2 \}\)/, 'default must stay 2 so /alle-restaurants (which passes no headingLevel) is completely unaffected');
});

test('renders <h3> instead of <h2> only when headingLevel is explicitly 3, purely via a class-styled tag choice (no styling change)', () => {
  const source = readComponentSource();
  assert.match(source, /const NameHeading = headingLevel === 3 \? 'h3' : 'h2'/);
  assert.match(source, /<NameHeading className="lrc-name">\{restaurant\.name\}<\/NameHeading>/, 'the name heading tag must be dynamic, and still carry the same .lrc-name class regardless of level');
});

// ─── BE-11 — quiet, uniform primary-action styling (both variants share
// the exact same lrc-primary-btn class, size, href, and link text; only
// app/globals.css's own .lrc-primary-btn rule changes fill/border color —
// no modifier class, since both branches never needed one). ──────────────

test('both hasMenu and menu-less branches use the exact same, unmodified lrc-primary-btn class — no variant-specific modifier class exists', () => {
  const source = readComponentSource();
  const primaryLinkMatches = [...source.matchAll(/<Link href=\{`\/restaurant\/\$\{restaurant\.restaurantId\}`\}\s+className="([^"]+)">/g)];
  assert.equal(primaryLinkMatches.length, 2, 'expected exactly one primary-action Link per branch (hasMenu and menu-less)');
  for (const match of primaryLinkMatches) {
    assert.equal(match[1], 'lrc-primary-btn', 'every primary-action link must carry exactly the "lrc-primary-btn" class, unmodified — the same class for every restaurant, with or without a menu');
  }
});

test('both primary-action links point at the same, unchanged deep link target — /restaurant/[id]', () => {
  const source = readComponentSource();
  const hrefMatches = [...source.matchAll(/<Link href=\{`\/restaurant\/\$\{restaurant\.restaurantId\}`\}/g)];
  assert.equal(hrefMatches.length, 2, 'both branches must still link to /restaurant/{restaurantId}, unchanged');
});

test('link text for both variants is unchanged: "Bekijk N menukaart(en)" and "Bekijk restaurant"', () => {
  const source = readComponentSource();
  assert.match(source, />\s*Bekijk \{restaurant\.menuLinks\.length\} menukaart\{restaurant\.menuLinks\.length !== 1 \? 'en' : ''\}\s*<\/Link>/, 'hasMenu link text must be unchanged');
  assert.match(source, />\s*Bekijk restaurant\s*<\/Link>/, 'menu-less link text must be unchanged');
});

// ─── app/globals.css — the actual quiet-styling contract ──────────────────

test('globals.css: .lrc-header and .lrc-footer no longer draw an internal divider line', () => {
  const css = readGlobalsCss();
  assert.match(css, /\.lrc-header \{ padding: 14px 16px 12px; \}/, 'the border-bottom must be gone, padding unchanged');
  assert.doesNotMatch(css, /\.lrc-header[^}]*border-bottom/, 'no border-bottom must remain on .lrc-header');
  assert.match(css, /\.lrc-footer \{ padding: 12px 16px 14px; margin-top: auto; \}/, 'the border-top must be gone, padding and margin-top:auto unchanged');
  assert.doesNotMatch(css, /\.lrc-footer[^}]*border-top/, 'no border-top must remain on .lrc-footer');
});

test('globals.css: .lrc-primary-btn uses the quiet, tinted green treatment — no full-saturation fill — for every restaurant card', () => {
  const css = readGlobalsCss();
  const ruleMatch = css.match(/\.lrc-primary-btn \{([^}]*)\}/);
  assert.ok(ruleMatch, 'expected a single .lrc-primary-btn base rule');
  const rule = ruleMatch[1];
  assert.match(rule, /background:\s*var\(--green-faint\)/, 'background must be the tinted, not full-saturation, green');
  assert.match(rule, /border:\s*1px solid var\(--green\)/, 'border must be a visible, accessible green outline');
  assert.match(rule, /color:\s*var\(--green\)/, 'text must be green, not var(--on-accent) white/black-on-solid-fill');
  assert.doesNotMatch(rule, /background:\s*var\(--green\)[,;\s]/, 'must not use the old full-saturation --green fill');
});

test('globals.css: .lrc-primary-btn is compact and left-aligned (not full-width), matching the dish-result card\'s own restrained action pattern, while keeping its padding/shape unchanged', () => {
  const css = readGlobalsCss();
  const ruleMatch = css.match(/\.lrc-primary-btn \{([^}]*)\}/);
  const rule = ruleMatch[1];
  assert.match(rule, /display:\s*inline-block/, 'must be compact, not a full-width block');
  assert.match(rule, /width:\s*auto/, 'must size to its own content, not stretch to fill the footer');
  assert.match(rule, /padding:\s*10px 14px/);
  assert.match(rule, /font-size:\s*13\.5px/);
  assert.match(rule, /font-weight:\s*700/);
  assert.match(rule, /border-radius:\s*var\(--radius-md\)/, '.lrc-primary-btn\'s own radius-md is unrelated to .lrc-card\'s radius-lg and must stay unchanged');
});

test('globals.css: .lrc-primary-btn:focus-visible keeps its existing, unchanged visible focus style', () => {
  const css = readGlobalsCss();
  assert.match(css, /\.lrc-primary-btn:focus-visible \{ outline: 2px solid var\(--green\); outline-offset: 2px; \}/);
});

test('globals.css: .lrc-card\'s border-radius token (--radius-lg) is untouched by this slice', () => {
  const css = readGlobalsCss();
  const cardRuleMatch = css.match(/\.lrc-card \{([^}]*)\}/);
  assert.ok(cardRuleMatch, 'expected a .lrc-card rule');
  assert.match(cardRuleMatch[1], /border-radius:\s*var\(--radius-lg\)/, '.lrc-card must keep --radius-lg, unchanged');
});
