'use strict';

// BE-42 (#98) — 3B: het donkere prijsvlak is overal een zacht vlak geworden
// (var(--surface-soft) met var(--text-primary)), de prijs blijft vet en rechts
// uitgelijnd en het contrast blijft ≥ 4,5:1 in licht én donker.
//
// Aangepaste plekken (alle vier de bestaande prijsplekken in de publieke UI):
//   1. home, "Vanavond/Straks op de kaart"  → app/HomeView.js, .tonight-price
//   2. zoekresultaten                       → app/search/page.js, .price-label
//   3. menupagina /menu/<id>                → src/components/MenuBody.js, .td-price
//   4. restaurantpagina /restaurant/<id>    → app/restaurant/[id]/RestaurantDetailView.js, .td-price
//
// Zelfde conventie als src/lib/publicStyle.test.js: fs.readFileSync + regex,
// geen gerenderde DOM-harness.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const css = () => read('app/globals.css');

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function lum(c) {
  const v = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a, b) {
  const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function tokenIn(block, name) {
  const m = block.match(new RegExp(`\\n\\s*--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
function blocks() {
  const s = css();
  const darkStart = s.indexOf('\n:root {');
  const mediaStart = s.indexOf('\n@media (prefers-color-scheme: light) {');
  const lightAttrStart = s.indexOf('\n:root[data-theme="light"] {');
  return {
    dark: s.slice(darkStart, mediaStart),
    lightMedia: s.slice(mediaStart, lightAttrStart),
    lightAttr: s.slice(lightAttrStart, s.indexOf('\n}', lightAttrStart)),
  };
}

// Alle declaratieblokken van een selector (dezelfde selector kan vaker
// voorkomen; de laatste wint in de cascade).
function bodies(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped} \\{([^}]*)\\}`, 'g');
  return [...css().matchAll(re)].map((m) => m[1]);
}

const PRICE_SELECTORS = ['.tonight-price', '.price-label', '.td-price'];

test('3B: elke prijsplek gebruikt het zachte vlak met de primaire tekstkleur, niet --price-bg', () => {
  for (const selector of PRICE_SELECTORS) {
    const all = bodies(selector);
    assert.ok(all.length > 0, `expected a ${selector} rule`);
    const withBackground = all.filter((body) => /background:/.test(body));
    assert.ok(withBackground.length > 0, `${selector} must set its own background`);
    for (const body of withBackground) {
      assert.match(body, /background:\s*var\(--surface-soft\)/, `${selector} must use the soft surface`);
      assert.match(body, /color:\s*var\(--text-primary\)/, `${selector} must use the primary text colour`);
      assert.doesNotMatch(body, /var\(--price-bg\)|var\(--price-text\)/, `${selector} must not use the dark price tokens`);
    }
  }
});

test('3B: het donkere prijsvlak bestaat nergens meer', () => {
  assert.doesNotMatch(css(), /var\(--price-bg\)/, 'no rule may still paint the dark price surface');
  assert.doesNotMatch(css(), /var\(--price-text\)/, 'no rule may still use the dark price text colour');
});

test('3B: de prijs blijft vet en rechts uitgelijnd', () => {
  for (const selector of PRICE_SELECTORS) {
    const body = bodies(selector).filter((b) => /background:\s*var\(--surface-soft\)/.test(b))[0];
    assert.ok(body, `${selector} must keep a soft-surface rule`);
    assert.match(body, /font-weight:\s*(700|800)/, `${selector} must stay bold`);
  }
  // Rechts uitgelijnd: de prijs zit in een flexrij waarin de naam de vrije
  // ruimte vult (.td-name flex: 1) of de prijs zelf `flex: none` is.
  assert.match(css(), /\.td-name \{[^}]*flex:\s*1/);
  assert.match(css(), /\.td-price \{[^}]*flex:\s*none/);
  assert.match(css(), /\.tonight-price \{[^}]*flex:\s*none/);
});

test('3B: de vier prijsplekken bestaan nog en gebruiken deze klassen', () => {
  const places = [
    ['app/HomeView.js', /<span className="tonight-price">\{dish\.priceDisplay\}<\/span>/],
    ['app/search/page.js', /<span className="price-label">\{example\.priceDisplay\}<\/span>/],
    ['src/components/MenuBody.js', /className=\{`td-price \$\{!item\.price \? 'no-price' : ''\}`\}/],
    ['app/restaurant/[id]/RestaurantDetailView.js', /<div className="td-price">\{item\.price\}<\/div>/],
  ];
  for (const [file, pattern] of places) {
    assert.match(read(file), pattern, `${file} must still render the price with its own class`);
  }
});

test('3B: het zachte prijsvlak haalt ≥ 4,5:1 contrast in licht en donker', () => {
  const measured = {};
  for (const [theme, blockName] of [['dark', 'dark'], ['light', 'lightAttr']]) {
    const block = blocks()[blockName];
    const fg = tokenIn(block, 'text-primary');
    const bg = tokenIn(block, 'surface-soft');
    assert.ok(fg && bg, `${theme}: --text-primary and --surface-soft must exist`);
    const ratio = contrast(fg, bg);
    measured[theme] = `${fg} on ${bg} = ${ratio.toFixed(2)}:1`;
    assert.ok(ratio >= 4.5, `${theme}: ${measured[theme]} < 4.5:1`);
  }
  // Dezelfde tokens gelden voor de zachte "op aanvraag"-variant.
  assert.match(css(), /\.price-label--soft \{[^}]*background: var\(--surface-soft\)/);
});
