'use strict';

// Onze Menukaarten — gekozen Claude Design-richting "5 · Oker licht —
// uitgewerkt (okergeel)". Zelfde conventie als de andere tests in dit
// project: fs.readFileSync + regex, geen gerenderde DOM-harness.
// Zie docs/guides/design-reference.md ("Wordmark and brand accent").

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

// Zonder expliciete naam berekende Edge "ONZE Menukaarten" (text-transform).
test('Wordmark: links carry an explicit accessible name that starts with the visible name', () => {
  const src = read('src/components/Wordmark.js');
  assert.match(src, /WORDMARK_HOME_LABEL = 'Onze Menukaarten, naar de startpagina'/);
  assert.match(src, /<Link href=\{href\} className="wordmark" aria-label=\{label\}>/);
  const nav = read('src/components/InternalNav.js');
  assert.match(nav, /className="internal-nav-home"\s+aria-label="Onze Menukaarten, naar het interne overzicht"/);
});

// ── Tokens ──────────────────────────────────────────────────────────────

// Kleurtaal v2 (definitieve ontwerpbron) vervangt de "Oker licht"-waarden;
// de volledige tokenset staat in src/lib/colourLanguage.test.js.
test('tokens: approved light values are used in both light blocks (system + explicit)', () => {
  const { lightMedia, lightAttr } = blocks();
  for (const b of [lightMedia, lightAttr]) {
    assert.equal(tokenIn(b, 'accent'), '#7A4E00');
    assert.equal(tokenIn(b, 'accent-fill'), '#F6C057');
    assert.equal(tokenIn(b, 'on-accent-fill'), '#1F1600');
    assert.equal(tokenIn(b, 'accent-surface'), '#FEF1D5');
    assert.equal(tokenIn(b, 'status-old'), '#5A3A0A');
    assert.equal(tokenIn(b, 'warning'), null, '--warning is an alias of --status-old, defined once in :root');
    assert.equal(tokenIn(b, 'input-border'), '#8E877B');
    assert.equal(tokenIn(b, 'wordmark'), '#1A1410');
    assert.equal(tokenIn(b, 'wordmark-icon'), '#B28110');
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
    ['light status-old on bg', tokenIn(lightAttr, 'status-old'), lightBg, 4.5],
    ['light control border', tokenIn(lightAttr, 'input-border'), lightBg, 3],
    ['dark accent text on bg', tokenIn(dark, 'accent'), darkBg, 4.5],
    ['dark accent on card', tokenIn(dark, 'accent'), tokenIn(dark, 'bg-card'), 4.5],
    ['dark fill text', tokenIn(dark, 'on-accent-fill'), tokenIn(dark, 'accent-fill'), 4.5],
    ['dark accent on accent-surface', tokenIn(dark, 'accent'), tokenIn(dark, 'accent-surface'), 4.5],
    ['dark accent on accent-surface-strong', tokenIn(dark, 'accent'), tokenIn(dark, 'accent-surface-strong'), 4.5],
    ['dark status-old on card', tokenIn(dark, 'status-old'), tokenIn(dark, 'bg-card'), 4.5],
    ['dark control border', tokenIn(dark, 'input-border'), tokenIn(dark, 'bg-card'), 3],
    ['light control border on --bg', tokenIn(lightAttr, 'input-border'), tokenIn(lightAttr, 'bg'), 3],
    ['light control border on --bg-card', tokenIn(lightAttr, 'input-border'), tokenIn(lightAttr, 'bg-card'), 3],
    ['light control border on --bg-elevated', tokenIn(lightAttr, 'input-border'), tokenIn(lightAttr, 'bg-elevated'), 3],
    ['light control border on --bg-hover', tokenIn(lightAttr, 'input-border'), tokenIn(lightAttr, 'bg-hover'), 3],
    ['light control border on --bg-input', tokenIn(lightAttr, 'input-border'), tokenIn(lightAttr, 'bg-input'), 3],
    ['light control border on --bg-panel', tokenIn(lightAttr, 'input-border'), tokenIn(lightAttr, 'bg-panel'), 3],
    ['light control border on --accent-surface', tokenIn(lightAttr, 'input-border'), tokenIn(lightAttr, 'accent-surface'), 3],
    ['dark control border on --bg', tokenIn(dark, 'input-border'), tokenIn(dark, 'bg'), 3],
    ['dark control border on --bg-card', tokenIn(dark, 'input-border'), tokenIn(dark, 'bg-card'), 3],
    ['dark control border on --bg-elevated', tokenIn(dark, 'input-border'), tokenIn(dark, 'bg-elevated'), 3],
    ['dark control border on --bg-hover', tokenIn(dark, 'input-border'), tokenIn(dark, 'bg-hover'), 3],
    ['dark control border on --bg-input', tokenIn(dark, 'input-border'), tokenIn(dark, 'bg-input'), 3],
    ['dark control border on --bg-panel', tokenIn(dark, 'input-border'), tokenIn(dark, 'bg-panel'), 3],
    ['dark control border on --accent-surface', tokenIn(dark, 'input-border'), tokenIn(dark, 'accent-surface'), 3],
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

test('status colours stay semantic: open/ok use --status-positive, brand controls use --accent*', () => {
  const s = css();
  assert.match(s, /\.status-badge--positive, \.swq-badge--positive \{ color: var\(--status-positive\);/);
  assert.match(s, /\.swq-badge--positive \{ color: var\(--status-positive\);/);
  assert.doesNotMatch(s, /\.tag-vegan[^{]*\{[^}]*--status-positive/, 'dietary labels are neutral, not a success status');
  assert.match(s, /\.hero-search-btn \{[^}]*background: var\(--accent-fill\);[^}]*color: var\(--on-accent-fill\);/);
  assert.match(s, /\.primary-nav-link\[aria-current="page"\] \{ background: var\(--accent-surface\); color: var\(--accent\);/);
});

// Handoff "Oker licht": okergeel als vol vlak alleen voor primaire knop,
// markeerstreep en actieve tab-onderstreping. Selectietoestanden zijn zacht.
const SELECTED_STATE_RULES = [
  '.theme-btn.active',
  '.primary-nav-link[aria-current="page"]',
  '.meal-btn.active',
  '.lang-btn.active',
  '.mode-btn.active',
  '.day-btn.active',
  '.home-meal-btn.active',
  '.swq-queue[aria-pressed="true"]',
];

for (const selector of SELECTED_STATE_RULES) {
  test(`selected state ${selector}: soft accent, never the full okergeel fill`, () => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css().match(new RegExp(`\\n${escaped} \\{([^}]*)\\}`));
    assert.ok(m, `${selector} rule exists`);
    assert.match(m[1], /background: var\(--accent-surface\);/);
    assert.match(m[1], /color: var\(--accent\);/);
    assert.doesNotMatch(m[1], /--accent-fill/);
  });
}

test('legacy reservation button (/restaurants) is outlined, not a filled primary action', () => {
  const m = css().match(/\n\.rc-reserve-btn \{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /background: transparent;/);
  assert.match(m[1], /border: 1\.5px solid var\(--accent\);/);
  assert.doesNotMatch(m[1], /--accent-fill/);
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
  assert.match(src, /<ExternalLinkIcon \/>/);
  assert.match(read('src/components/ExternalLinkIcon.js'), /className = 'rp-btn-external-icon'/);
});
