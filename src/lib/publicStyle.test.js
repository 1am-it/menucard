'use strict';

// BE-28 (#65) — de publieke stijl als gemeten contract. Deze test bewaakt
// de tokenwaarden uit het goedgekeurde besluit (owner 2026-10-25), de
// contrastparen van de nieuwe publieke oppervlakken in licht en donker, en
// de "geen nieuwe dependencies, fonts of afbeeldingen"-regel.
// Zelfde conventie als src/lib/colourLanguage.test.js: fs.readFileSync +
// regex, geen gerenderde DOM-harness.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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

// ── De goedgekeurde waarden ──────────────────────────────────────────────

test('BE-28: dark is antraciet with the exact approved surface and text tokens', () => {
  const { dark } = blocks();
  assert.equal(tokenIn(dark, 'bg'), '#1F2328');
  assert.equal(tokenIn(dark, 'bg-card'), '#2A2F35');
  assert.equal(tokenIn(dark, 'border'), '#3A4048');
  assert.equal(tokenIn(dark, 'text-primary'), '#F2F3F4');
  assert.equal(tokenIn(dark, 'text-secondary'), '#B6BCC3');
  assert.equal(tokenIn(dark, 'card-border-color'), '#3A4048');
});

test('BE-28: dark buttons, active chips and the active tab are white (#F2F3F4 / #1F2328); the logo tile stays oker', () => {
  const { dark } = blocks();
  for (const prefix of ['button-primary', 'chip-active', 'tabbar-active', 'nav-active']) {
    assert.equal(tokenIn(dark, `${prefix}-bg`), '#F2F3F4', `--${prefix}-bg`);
    assert.equal(tokenIn(dark, `${prefix}-text`), '#1F2328', `--${prefix}-text`);
  }
  assert.equal(tokenIn(dark, 'accent-fill'), '#F2C35B', 'the wordmark tile keeps the oker fill');
  assert.equal(tokenIn(dark, 'on-accent-fill'), '#1F1600');
});

test('BE-28: dark prices are a label with oker text on the soft dark surface', () => {
  const { dark } = blocks();
  assert.equal(tokenIn(dark, 'price-bg'), '#353A41');
  assert.equal(tokenIn(dark, 'price-text'), '#F2C35B');
});

test('BE-28: light follows the fresh mockup (white surfaces, soft tints, oker primary button) in both blocks', () => {
  const { lightMedia, lightAttr } = blocks();
  for (const b of [lightMedia, lightAttr]) {
    assert.equal(tokenIn(b, 'bg'), '#FFFFFF');
    assert.equal(tokenIn(b, 'bg-card'), '#FFFFFF');
    assert.equal(tokenIn(b, 'surface-soft'), '#F3F1EC');
    assert.equal(tokenIn(b, 'surface-warm'), '#FFF6E2');
    assert.equal(tokenIn(b, 'card-border-color'), '#EEEAE2');
    assert.equal(tokenIn(b, 'button-primary-bg'), '#F6C057');
    assert.equal(tokenIn(b, 'button-primary-text'), '#1F1600');
    assert.equal(tokenIn(b, 'price-bg'), '#1A1410');
    assert.equal(tokenIn(b, 'price-text'), '#FFFFFF');
  }
});

test('BE-28: the theme contract is unchanged — dark is still the first-visit default', () => {
  const layout = read('app/layout.js');
  assert.match(layout, /document\.documentElement\.setAttribute\('data-theme','dark'\)/);
  assert.match(layout, /localStorage\.setItem\('bredaeats_theme','dark'\)/);
});


// ── Contrast (WCAG 2.x AA) ───────────────────────────────────────────────

const TEXT_PAIRS = [
  ['primary text on bg', 'text-primary', 'bg'],
  ['primary text on card', 'text-primary', 'bg-card'],
  ['primary text on the warm panel', 'text-primary', 'surface-warm'],
  ['secondary text on bg', 'text-secondary', 'bg'],
  ['secondary text on card', 'text-secondary', 'bg-card'],
  ['secondary text on the warm panel', 'text-secondary', 'surface-warm'],
  ['secondary text on a soft chip', 'text-secondary', 'surface-soft'],
  ['accent text on bg', 'accent', 'bg'],
  ['accent text on card', 'accent', 'bg-card'],
  ['accent text on the warm panel', 'accent', 'surface-warm'],
  ['primary button text', 'button-primary-text', 'button-primary-bg'],
  ['chip text', 'chip-text', 'chip-bg'],
  ['active chip text', 'chip-active-text', 'chip-active-bg'],
  ['price label text', 'price-text', 'price-bg'],
  ['tab bar text', 'tabbar-text', 'tabbar-bg'],
  ['active tab text', 'tabbar-active-text', 'tabbar-active-bg'],
  ['active header nav text', 'nav-active-text', 'nav-active-bg'],
];

for (const [theme, blockName] of [['dark', 'dark'], ['light', 'lightAttr']]) {
  test(`BE-28 contrast: every public text pair meets AA in the ${theme} theme`, () => {
    const block = blocks()[blockName];
    for (const [label, fg, bg] of TEXT_PAIRS) {
      const fgValue = tokenIn(block, fg);
      const bgValue = tokenIn(block, bg);
      assert.ok(fgValue && bgValue, `${theme} ${label}: tokens must exist`);
      const ratio = contrast(fgValue, bgValue);
      assert.ok(ratio >= 4.5, `${theme} ${label}: ${fgValue} on ${bgValue} = ${ratio.toFixed(2)}:1 < 4.5:1`);
    }
  });

  test(`BE-28 contrast: control borders and the focus ring reach 3:1 in the ${theme} theme`, () => {
    const block = blocks()[blockName];
    const border = tokenIn(block, 'input-border');
    for (const surface of ['bg', 'bg-card', 'bg-elevated', 'bg-input']) {
      const ratio = contrast(border, tokenIn(block, surface));
      assert.ok(ratio >= 3, `${theme} border ${border} on --${surface} = ${ratio.toFixed(2)}:1 < 3:1`);
    }
    assert.match(css(), /--border-focus:\s*var\(--accent\);/);
    for (const surface of ['bg', 'bg-card']) {
      const ratio = contrast(tokenIn(block, 'accent'), tokenIn(block, surface));
      assert.ok(ratio >= 3, `${theme} focus ring on --${surface} = ${ratio.toFixed(2)}:1 < 3:1`);
    }
  });
}

// ── Structuur: alleen tokens, geen nieuwe assets ─────────────────────────

test('BE-28: the public surfaces are token-only — no hard-coded colour in the components', () => {
  const files = execSync('git ls-files app src', { cwd: ROOT }).toString().trim().split('\n')
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && fs.existsSync(path.join(ROOT, f)))
    .filter((f) => f.startsWith('app/') && !f.startsWith('app/api/') && !f.startsWith('app/internal/'))
    .filter((f) => !f.includes('/nvwa/'));
  const offenders = [];
  for (const file of files) {
    const src = read(file);
    for (const line of src.split('\n')) {
      // Kleurletters in JSX/style alleen via var(--token); hexwaarden horen
      // in app/globals.css.
      if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !line.includes('//')) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], 'every public colour must come from a token');
});

test('BE-28: rounded cards and the floating phone tab bar are token-driven and big enough to tap', () => {
  const s = css();
  assert.match(s, /--radius-card:\s*20px;/);
  assert.match(s, /--radius-panel:\s*28px;/);
  assert.match(s, /\.menu-card, \.lrc-card, \.restaurant-card, \.menu-overview-card, \.rc-card, \.dish-group-card \{[^}]*border-radius: var\(--radius-card\);[^}]*box-shadow: var\(--card-shadow\);/);
  const bar = s.slice(s.indexOf('.mobile-tabbar {'), s.indexOf('.mobile-tab-link {'));
  assert.match(bar, /position: fixed;/);
  assert.match(bar, /display: none;/, 'hidden on desktop, the header nav rules there');
  assert.match(s, /@media \(max-width: 720px\) \{\s*\.mobile-tabbar \{ display: flex; \}/);
  assert.match(s, /\.mobile-tab-link \{[^}]*min-height: 48px;/);
  assert.match(s, /\.mobile-tab-link\[aria-current="page"\] \{[^}]*background: var\(--tabbar-active-bg\);[^}]*color: var\(--tabbar-active-text\);/);
});

test('BE-28: no gradient, no new dependency, font or image was added', () => {
  const s = css().replace(/\/\*[\s\S]*?\*\//g, '');
  const section = s.slice(s.lastIndexOf('.emoji { font-style: normal;'));
  assert.doesNotMatch(section, /gradient/i);
  assert.doesNotMatch(section, /@font-face|url\(|\.png|\.jpg/);
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    '@anthropic-ai/sdk', '@supabase/supabase-js', 'next', 'pdfjs-dist', 'react', 'react-dom',
  ]);
});

test('BE-28: the shared Emoji component is decorative and adds no asset', () => {
  const src = read('src/components/Emoji.js');
  assert.match(src, /aria-hidden="true"/);
  assert.match(src, /export default function Emoji\(\{ glyph, className \}\)/);
  assert.doesNotMatch(src, /<img|\.png|\.svg|dangerouslySetInnerHTML|@font-face/);
});
