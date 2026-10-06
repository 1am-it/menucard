'use strict';

// Onze Menukaarten — gekozen Claude Design-richting "5 · Oker licht —
// uitgewerkt (okergeel)". Zelfde conventie als de andere tests in dit
// project: fs.readFileSync + regex, geen gerenderde DOM-harness.
// Zie docs/guides/design-reference.md ("Woordmerk" en "Merkaccent").

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = () => read('app/globals.css');

// ── WCAG 2.x contrast helper ────────────────────────────────────────────
function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Pull one token's value out of a theme block.
function tokenIn(block, name) {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
function blocks() {
  const s = css();
  // Anchor on line starts: the header comment also mentions the media query.
  const darkStart = s.indexOf('\n:root {');
  const mediaStart = s.indexOf('\n@media (prefers-color-scheme: light) {');
  const lightAttrStart = s.indexOf('\n:root[data-theme="light"] {');
  const dark = s.slice(darkStart, mediaStart);
  const lightMedia = s.slice(mediaStart, lightAttrStart);
  const lightAttr = s.slice(lightAttrStart, s.indexOf('}', lightAttrStart));
  return { dark, lightMedia, lightAttr };
}

// ── Wordmark component ──────────────────────────────────────────────────

test('Wordmark: stacked "Onze / Menukaarten" as real text, one link to "/" by default', () => {
  const src = read('src/components/Wordmark.js');
  assert.match(src, /<span className="wordmark-top">Onze<\/span>/);
  assert.match(src, /<span className="wordmark-main">Menukaarten<\/span>/);
  assert.match(src, /href = '\/'/);
  assert.doesNotMatch(src, /BredaEats/, 'the wordmark must not render the old name');
});

test('Wordmark: the menukaart motif is decorative (aria-hidden, currentColor) and no external asset is used', () => {
  const src = read('src/components/Wordmark.js');
  assert.match(src, /aria-hidden="true"/);
  assert.match(src, /stroke="currentColor"/);
  assert.doesNotMatch(src, /<img|\.svg['"]|\.png['"]|fonts\.googleapis/);
});

test('Wordmark: descriptor is "Menukaarten in Breda" and sits outside the link', () => {
  const src = read('src/components/Wordmark.js');
  assert.match(src, /<\/Link>\s*\{descriptor && <span className="wordmark-descriptor">Menukaarten in Breda<\/span>\}/);
});

test('Wordmark CSS: one colour (--wordmark), no split accent on a word part', () => {
  const s = css();
  assert.match(s, /\.wordmark \{[^}]*color: var\(--wordmark\);/);
  assert.doesNotMatch(s, /\.logo span \{/, 'the old split-colour .logo span rule must be gone');
  assert.doesNotMatch(s, /\.wordmark-(top|main) \{[^}]*color:/, 'no part of the wordmark gets its own colour');
});

const PUBLIC_HEADERS = [
  'app/page.js',
  'app/search/page.js',
  'app/alle-restaurants/page.js',
  'app/restaurants/page.js',
  'app/menu/[id]/MenuView.js',
  'app/restaurant/[id]/RestaurantDetailView.js',
  'app/nvwa/[id]/NvwaView.js',
];

for (const file of PUBLIC_HEADERS) {
  test(`${file}: renders the shared <Wordmark /> and no visible BredaEats logo`, () => {
    const src = read(file);
    assert.match(src, /import Wordmark from '@\/src\/components\/Wordmark'/);
    assert.equal((src.match(/<Wordmark \/>/g) || []).length, 1);
    assert.doesNotMatch(src, /Breda<span>Eats<\/span>/);
  });
}

test('InternalNav: the home link shows the shared wordmark instead of the BredaEats text', () => {
  const src = read('src/components/InternalNav.js');
  assert.match(src, /<WordmarkInline \/>/);
  assert.doesNotMatch(src, /<span>BredaEats<\/span>/);
});

// ── Tokens ──────────────────────────────────────────────────────────────

test('tokens: approved light values are used in both light blocks (system + explicit)', () => {
  const { lightMedia, lightAttr } = blocks();
  for (const b of [lightMedia, lightAttr]) {
    assert.equal(tokenIn(b, 'accent'), '#7A4E00');
    assert.equal(tokenIn(b, 'accent-fill'), '#F2C35B');
    assert.equal(tokenIn(b, 'on-accent-fill'), '#1F1600');
    assert.equal(tokenIn(b, 'accent-surface'), '#FDF3D8');
    assert.equal(tokenIn(b, 'warning'), '#9A3412');
    assert.equal(tokenIn(b, 'input-border'), '#8A919C');
    assert.equal(tokenIn(b, 'wordmark'), '#7A4E00');
  }
});

test('tokens: dark (runtime default) never uses the light-only ink or warning as text', () => {
  const { dark } = blocks();
  for (const name of ['accent', 'accent-dim', 'wordmark', 'warning', 'mark-text']) {
    const v = tokenIn(dark, name);
    assert.ok(v, `--${name} must be defined in the dark :root`);
    assert.notEqual(v.toUpperCase(), '#7A4E00');
    assert.notEqual(v.toUpperCase(), '#9A3412');
  }
});

test('tokens: --border-focus follows the accent, so focus rings are oker in both themes', () => {
  assert.match(blocks().dark, /--border-focus:\s*var\(--accent\);/);
});

test('contrast: every accent pairing meets WCAG AA (text 4.5:1, focus/UI 3:1) in light and dark', () => {
  const { dark, lightAttr } = blocks();
  const lightBg = tokenIn(lightAttr, 'bg');
  const darkBg = tokenIn(dark, 'bg');
  const checks = [
    ['light accent text on bg', tokenIn(lightAttr, 'accent'), lightBg, 4.5],
    ['light fill text', tokenIn(lightAttr, 'on-accent-fill'), tokenIn(lightAttr, 'accent-fill'), 4.5],
    ['light accent on accent-surface', tokenIn(lightAttr, 'accent'), tokenIn(lightAttr, 'accent-surface'), 4.5],
    ['light accent on accent-surface-strong', tokenIn(lightAttr, 'accent'), tokenIn(lightAttr, 'accent-surface-strong'), 4.5],
    ['light warning on bg', tokenIn(lightAttr, 'warning'), lightBg, 4.5],
    ['light control border', tokenIn(lightAttr, 'input-border'), lightBg, 3],
    ['dark accent text on bg', tokenIn(dark, 'accent'), darkBg, 4.5],
    ['dark accent on card', tokenIn(dark, 'accent'), tokenIn(dark, 'bg-card'), 4.5],
    ['dark fill text', tokenIn(dark, 'on-accent-fill'), tokenIn(dark, 'accent-fill'), 4.5],
    ['dark accent on accent-surface', tokenIn(dark, 'accent'), tokenIn(dark, 'accent-surface'), 4.5],
    ['dark accent on accent-surface-strong', tokenIn(dark, 'accent'), tokenIn(dark, 'accent-surface-strong'), 4.5],
    ['dark warning on card', tokenIn(dark, 'warning'), tokenIn(dark, 'bg-card'), 4.5],
    ['dark control border', tokenIn(dark, 'input-border'), tokenIn(dark, 'bg-card'), 3],
    ['dark hero mark text', tokenIn(dark, 'mark-text'), tokenIn(dark, 'mark-bg'), 4.5],
  ];
  for (const [label, fg, bg, min] of checks) {
    const r = contrast(fg, bg);
    assert.ok(r >= min, `${label}: ${fg} on ${bg} = ${r.toFixed(2)}:1, needs ${min}:1`);
  }
});

test('contrast guard: okergeel is never valid text on white (documented rule)', () => {
  assert.ok(contrast('#F2C35B', '#FFFFFF') < 4.5);
});

// ── Brand vs status separation ─────────────────────────────────────────

test('status colours stay semantic: open/ok/vegan keep --green, brand controls use --accent*', () => {
  const s = css();
  assert.match(s, /\.dish-result-status\.is-open\s*\{ color: var\(--green\);/);
  assert.match(s, /\.swq-badge--ok svg \{ color: var\(--green\); \}/);
  assert.match(s, /\.hero-search-btn \{[^}]*background: var\(--accent-fill\);[^}]*color: var\(--on-accent-fill\);/);
  assert.match(s, /\.primary-nav-link\[aria-current="page"\] \{ background: var\(--accent-fill\); color: var\(--on-accent-fill\); \}/);
});

// ── No gradients, external reservation, homepage marker ─────────────────

test('no gradients remain in globals.css (hero surfaces are flat)', () => {
  assert.doesNotMatch(css(), /linear-gradient|radial-gradient/);
});

test('restaurant detail hero no longer paints a restaurant-colour gradient', () => {
  const src = read('app/restaurant/[id]/RestaurantDetailView.js');
  assert.doesNotMatch(src, /linear-gradient/);
});

test('homepage: the keyword uses the marker class (no inline green) and meal shortcuts carry no emoji', () => {
  const src = read('app/page.js');
  assert.match(src, /<span className="hero-title-mark">eten<\/span>/);
  assert.doesNotMatch(src, /var\(--green\)/);
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}]/u, 'no emoji in the homepage source');
});

test('reservation button on the menu page is an outlined, visibly external action', () => {
  const s = css();
  assert.match(s, /\.rp-btn-reserveer \{[^}]*background: transparent;[^}]*border: 2px solid var\(--accent\);/);
  const src = read('app/menu/[id]/MenuView.js');
  assert.match(src, /className="rp-btn-external-icon"/);
});
