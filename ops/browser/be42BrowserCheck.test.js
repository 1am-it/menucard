'use strict';

// BE-42 (#98) — de browsercheck van deel 1 (1A + 3B) is de bewijsvorm voor
// /alle-restaurants en het prijsvlak. Een browsercheck zelf is geen unit-test,
// maar de bedrading en de afspraken eromheen zijn dat wel: deze test bewaakt
// dat de check bestaat, via npm bereikbaar blijft, de echte acceptatiepunten
// meet en de eerder vastgelegde BE-28b-regel ("de hele kaart is één link")
// niet opnieuw als eis terugzet in de publieke stijlcheck.
//
// Zelfde conventie als src/lib/be42PriceSurface.test.js: fs.readFileSync +
// regex, geen browser en geen netwerk.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BE42_CHECK = 'ops/browser/run-be42-browser-check.js';
const PUBLIC_STYLE_CHECK = 'ops/browser/run-public-style-browser-check.js';

test('BE-42: de browsercheck van deel 1 is via npm bereikbaar', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:browser:be42'], `node ${BE42_CHECK}`);
});

test('BE-42 1A: de check meet de knoppen, de naamlink, de focus en 44 px', () => {
  const source = read(BE42_CHECK);
  assert.match(source, /article\.ar-card|article ar-card/, 'the list card is an article, not a link');
  assert.match(source, /a\.ar-name-link/, 'the restaurant name is the link');
  assert.match(source, /\.ar-menu-button/, 'each menu card is its own button');
  assert.match(source, /\.ar-cta/, 'the check must assert that the big CTA is gone');
  assert.match(source, />= 44/, 'tap targets are at least 44 px');
  assert.match(source, /focus-visible|outlineWidth/, 'the focus ring is measured');
  assert.match(source, /het was/, 'a card without a menu stays as it was');
});

test('BE-42 3B: de check meet het zachte prijsvlak en het contrast in licht en donker', () => {
  const source = read(BE42_CHECK);
  assert.match(source, /--surface-soft/, 'the soft surface token is measured');
  assert.match(source, /--text-primary/, 'the primary text token is measured');
  assert.match(source, /4\.5/, 'the contrast bound is 4.5:1');
  assert.match(source, /for \(const theme of \['light', 'dark'\]\)/, 'both themes are measured');
  assert.match(source, /\.tonight-price/, 'the home "Vanavond op de kaart" price is measured');
});

test('BE-42: de screenshots dekken 1280, 390 en 320 px en de overdracht is gemeten', () => {
  const source = read(BE42_CHECK);
  assert.match(source, /\[\[1280, 900\], \[390, 844\], \[320, 720\]\]/, 'three widths per page');
  assert.match(source, /restaurant-6/, 'Bardot (four menu cards) is captured');
  assert.match(source, /restaurant-1/, 'the smallest real case is captured too');
  assert.match(source, /measureTransfer/, 'the cold first transfer is measured');
  assert.match(source, /< 250/, 'the 250 KB bound is asserted');
});

test('BE-42: de check noemt de echte gap (geen restaurant met één kaart) in zijn bewijs', () => {
  const source = read(BE42_CHECK);
  assert.match(source, /gaps:/, 'the evidence records its gaps');
  assert.match(source, /precies één menukaart/, 'the missing one-menu restaurant is recorded honestly');
});

test('BE-42: de publieke stijlcheck eist de oude hele-kaart-link niet meer', () => {
  const source = read(PUBLIC_STYLE_CHECK);
  assert.doesNotMatch(source, /the whole card is one link/, 'the BE-28b rule was replaced by BE-42 1A');
  assert.doesNotMatch(source, /nestedActions/, 'no stale whole-card-link measurement');
  assert.match(source, /a\.ar-name-link/, 'the name link is measured instead');
  assert.match(source, /a\.ar-menu-button/, 'the menu buttons are measured instead');
});

// ─── BE-42 deel 2 (#98) — de hele menukaart in tabbladen (2A) ────────────────

test('BE-42 2A: de check meet de tabbladen, de standaardkaart en het wisselen', () => {
  const source = read(BE42_CHECK);
  assert.match(source, /nav\.rpm-tabs a/, 'the tabs are measured as real links');
  assert.match(source, /aria-current/, 'the active tab is measured');
  assert.match(source, /meal-btn active/, 'the server HTML names the default tab');
  assert.match(source, /Lunchkaart · \$\{LUNCH_COUNT\} gerechten/, 'the default tab is the first in the fixed order (lunch)');
  assert.match(source, /rpm-tab-count/, 'the dish count per tab is measured');
  assert.match(source, /performance\.getEntriesByType\('navigation'\)/, 'switching must not reload the whole page');
  assert.match(source, /rpm-source/, 'the source line per menu is measured');
  assert.match(source, /\/menu\/6-lunch|menuPageHref/, 'the separate menu page stays reachable');
});

test('BE-42 2A: de check bewijst op de server-HTML dat er maar één kaart in zit', () => {
  const source = read(BE42_CHECK);
  assert.match(source, /async function serverHtmlCheck/, 'the server response itself is inspected');
  assert.match(source, /self\.__next_f/, 'both the markup and the RSC payload are inspected');
  assert.match(source, /maar één kaart in de HTML/, 'one menu only is asserted');
  assert.match(source, /ook niet in de RSC-payload/, 'no dishes of the other menus travel along');
  assert.match(source, /onbekende \?kaart=/, 'an unknown ?kaart= falls back to the default menu');
  assert.match(source, /zonder JavaScript/, 'the no-JavaScript path is asserted too');
});

test('BE-42 2A: de overdracht vóór en na staat in hetzelfde bewijs', () => {
  const source = read(BE42_CHECK);
  assert.match(source, /TRANSFER_BEFORE_RESTAURANT6_KB = 169\.9/, 'the part 1 measurement is pinned');
  assert.match(source, /na 2A \(Bardot, 4 kaarten\)/, 'the after-measurement is taken on the same page');
  assert.match(source, /groei[t]* hooguit met één kaart/, 'the growth bound is asserted');
  assert.match(source, /< 250/, 'the 250 KB bound is still asserted');
});

test('BE-42 2A: de screenshots dekken het gewisselde tabblad', () => {
  const source = read(BE42_CHECK);
  assert.match(source, /restaurant-6-borrel/, 'Bardot is captured with the borrel tab active');
  assert.match(source, /\/restaurant\/6\?kaart=6-borrel/, 'the switched tab is the real URL');
});

test('BE-42: de browser-README beschrijft de check en de gap', () => {
  const readme = read('ops/browser/README.md');
  assert.match(readme, /BE-42 part 1/, 'the README has a BE-42 section');
  assert.match(readme, /run-be42-browser-check\.js/, 'the check is named');
  assert.match(readme, /two cards|twee kaarten/, 'the one-menu gap is documented');
});
