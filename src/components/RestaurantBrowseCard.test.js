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

function readComponentSource() {
  return fs.readFileSync(COMPONENT_PATH, 'utf8');
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
