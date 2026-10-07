'use strict';

// Kleurtaal v2 — definitieve ontwerpbron "Onze Menukaarten — Kleurtaal v2
// (Brontriage)". Zelfde conventie als de andere tests in dit project:
// fs.readFileSync + regex, geen gerenderde DOM-harness. Zie
// docs/guides/design-reference.md ("Kleurtaal v2") en
// planning/specs/tickets/theme-design-tokens.md (addendum Kleurtaal v2).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const css = () => read('app/globals.css');

// ── WCAG 2.x helpers ──────────────────────────────────────────────────────
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
function contrastRgb(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const contrast = (a, b) => contrastRgb(rgb(a), rgb(b));
// Effen kleur van een rgba()-vlak over een ondergrond (zoals de browser mengt).
function over(rgba, baseHex) {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(m, `expected rgba(), got ${rgba}`);
  const a = Number(m[4]);
  const base = rgb(baseHex);
  return [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + base[k] * (1 - a)));
}
const round2 = (x) => Math.round(x * 100) / 100;

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

// ── Globale tokens ────────────────────────────────────────────────────────

const LIGHT = {
  bg: '#FCFAF4',
  'bg-card': '#FFFDF9',
  'bg-elevated': '#F5F3EE',
  'text-primary': '#1A1410',
  'text-secondary': '#5C5650',
  'input-border': '#8E877B',
  accent: '#7A4E00',
  'accent-fill': '#F6C057',
  'on-accent-fill': '#1F1600',
  'accent-surface': '#FEF1D5',
  border: '#EFE8D8',
  wordmark: '#1A1410',
  'wordmark-icon': '#B28110',
  'nav-indicator': '#D8BC7A',
};
const DARK = {
  bg: '#0a0a0a',
  'bg-card': '#111111',
  'bg-elevated': '#181818',
  'text-primary': '#ffffff',
  'text-secondary': '#aaaaaa',
  'input-border': '#6b7280',
  accent: '#F2C35B',
  'accent-fill': '#F2C35B',
  'on-accent-fill': '#1F1600',
  'accent-surface': '#2A2109',
};

test('global tokens: light matches Kleurtaal v2 in both light blocks (kept in sync)', () => {
  const { lightMedia, lightAttr } = blocks();
  for (const b of [lightMedia, lightAttr]) {
    for (const [name, value] of Object.entries(LIGHT)) {
      assert.equal((tokenIn(b, name) || '').toUpperCase(), value.toUpperCase(), `light --${name}`);
    }
  }
});

test('global tokens: dark stays unchanged and is the base :root', () => {
  const { dark } = blocks();
  for (const [name, value] of Object.entries(DARK)) {
    assert.equal((tokenIn(dark, name) || '').toUpperCase(), value.toUpperCase(), `dark --${name}`);
  }
  assert.match(dark, /--border-focus:\s*var\(--accent\);/);
});

test('theme contract unchanged: dark stays the runtime default, explicit Licht/Donker, no system option', () => {
  const layout = read('app/layout.js');
  assert.match(layout, /'dark'/);
  const toggle = read('src/components/ThemeToggle.js');
  assert.match(toggle, /\{ value: 'light', label: 'Licht' \},\s*\{ value: 'dark', label: 'Donker' \},/);
  assert.doesNotMatch(toggle, /value: 'system'/);
});

// ── Statusrollen ──────────────────────────────────────────────────────────

const ROLES = {
  blocked: { light: ['#8A1C12', '#FCE0DA'], dark: '#FF6B6B' },
  neutral: { light: ['#2A2E36', '#EFEFEF'], dark: '#AAAAAA' },
  file: { light: ['#5A3A0A', '#FEF0D3'], dark: '#64B4FF' },
  old: { light: ['#5A3A0A', '#FEF0D3'], dark: '#FF9E6B' },
  positive: { light: ['#2A2E36', '#EFEFEF'], dark: '#06C167' },
  action: { light: ['#5A3A0A', '#FEF1D5'], dark: '#FFD27A' },
};

test('status roles: light is a borderless pill in red, oker or grey only (no blue, no green)', () => {
  const { lightMedia, lightAttr } = blocks();
  for (const b of [lightMedia, lightAttr]) {
    for (const [role, { light }] of Object.entries(ROLES)) {
      assert.equal(tokenIn(b, `status-${role}`), light[0], `light --status-${role}`);
      assert.equal(tokenIn(b, `status-${role}-bg`), light[1], `light --status-${role}-bg`);
      assert.equal(tokenIn(b, `status-${role}-border`), 'transparent', `light --status-${role}-border`);
    }
    assert.equal(tokenIn(b, 'status-radius'), 'var(--radius-pill)');
  }
});

test('status roles: dark uses the role colour as text and 1px border, 10% fill, 6px radius', () => {
  const { dark } = blocks();
  for (const [role, { dark: colour }] of Object.entries(ROLES)) {
    assert.equal(tokenIn(dark, `status-${role}`), colour, `dark --status-${role}`);
    assert.equal(tokenIn(dark, `status-${role}-border`), colour, `dark --status-${role}-border`);
    const [r, g, b] = rgb(colour);
    assert.equal(tokenIn(dark, `status-${role}-bg`), `rgba(${r}, ${g}, ${b}, 0.10)`, `dark --status-${role}-bg`);
  }
  assert.equal(tokenIn(dark, 'status-radius'), 'var(--radius-sm)');
});

test('contrast: light status text on its own fill meets the measured minima', () => {
  const { lightAttr } = blocks();
  const min = { blocked: 7.45, neutral: 11.84, file: 9.11, old: 9.11, positive: 11.84, action: 9.18 };
  for (const role of Object.keys(ROLES)) {
    const r = contrast(tokenIn(lightAttr, `status-${role}`), tokenIn(lightAttr, `status-${role}-bg`));
    assert.ok(round2(r) >= min[role], `light ${role}: ${r.toFixed(2)}:1 < ${min[role]}`);
  }
});

test('contrast: dark status text on its 10% fill, over card, elevated surface and soft accent', () => {
  const { dark } = blocks();
  const surfaces = ['bg-card', 'bg-elevated', 'accent-surface'].map((n) => tokenIn(dark, n));
  const min = { blocked: 4.96, neutral: 5.71, file: 6.05, old: 6.43, positive: 5.77, action: 8.70 };
  for (const role of Object.keys(ROLES)) {
    const fg = rgb(tokenIn(dark, `status-${role}`));
    const lowest = Math.min(...surfaces.map((s) => contrastRgb(fg, over(tokenIn(dark, `status-${role}-bg`), s))));
    assert.ok(round2(lowest) >= min[role], `dark ${role}: minimum ${lowest.toFixed(2)}:1 < ${min[role]}`);
    assert.ok(lowest >= 4.5, `dark ${role} stays AA`);
  }
});

test('contrast: "Actie nodig" in dark is at least 8,70:1 (documented minimum)', () => {
  const { dark } = blocks();
  const fg = rgb(tokenIn(dark, 'status-action'));
  // #29241C op kaart, #2F2B22 op verhoogd vlak (ontwerpbron); zacht accentvlak is het minimum.
  assert.deepEqual(over(tokenIn(dark, 'status-action-bg'), tokenIn(dark, 'bg-card')), rgb('#29241C'));
  assert.deepEqual(over(tokenIn(dark, 'status-action-bg'), tokenIn(dark, 'bg-elevated')), rgb('#2F2B22'));
  const onSoft = contrastRgb(fg, over(tokenIn(dark, 'status-action-bg'), tokenIn(dark, 'accent-surface')));
  assert.equal(round2(onSoft), 8.7);
});

// ── Leesbare tekst en controls ────────────────────────────────────────────

test('contrast: --text-secondary meets AA on every surface it sits on (light >= 6.46, dark >= 6.85)', () => {
  const { dark, lightAttr } = blocks();
  for (const [b, min] of [[lightAttr, 6.46], [dark, 6.85]]) {
    for (const s of ['bg', 'bg-card', 'bg-elevated', 'accent-surface']) {
      const r = contrast(tokenIn(b, 'text-secondary'), tokenIn(b, s));
      assert.ok(round2(r) >= min, `--text-secondary on --${s}: ${r.toFixed(2)}:1`);
    }
  }
});

test('contrast: accent text, button text, control borders and focus ring', () => {
  const { dark, lightAttr } = blocks();
  for (const b of [lightAttr, dark]) {
    for (const s of ['bg', 'bg-card', 'bg-elevated', 'accent-surface']) {
      assert.ok(contrast(tokenIn(b, 'accent'), tokenIn(b, s)) >= 4.5, `--accent on --${s}`);
    }
    assert.ok(contrast(tokenIn(b, 'on-accent-fill'), tokenIn(b, 'accent-fill')) >= 4.5, 'button text');
    for (const s of ['bg', 'bg-card', 'bg-elevated', 'bg-input', 'bg-hover', 'accent-surface']) {
      assert.ok(contrast(tokenIn(b, 'input-border'), tokenIn(b, s)) >= 3, `--input-border on --${s}`);
    }
    // Focusring = --accent (via --border-focus).
    assert.ok(contrast(tokenIn(b, 'accent'), tokenIn(b, 'bg')) >= 3, 'focus ring');
  }
  // Okergeel is vulling, nooit tekst op wit of een licht vlak.
  assert.ok(contrast(LIGHT['accent-fill'], LIGHT.bg) < 4.5);
});

test('contrast: light content tags (Aanbevolen, Dagspecial, Halal, Glutenvrij) meet AA on their tint over the card', () => {
  const { lightAttr } = blocks();
  for (const tag of ['featured', 'info', 'halal', 'gluten']) {
    const fg = tokenIn(lightAttr, `tag-${tag}`);
    const r = contrastRgb(rgb(fg), over(tokenIn(lightAttr, `tag-${tag}-bg`), tokenIn(lightAttr, 'bg-card')));
    assert.ok(r >= 4.5, `--tag-${tag}: ${r.toFixed(2)}:1`);
  }
});

test('readable text never uses --text-muted, --text-dim or --text-faint (CSS and inline styles)', () => {
  assert.doesNotMatch(css(), /(^|[^-])color: var\(--text-(muted|dim|faint)\)/m);
  const files = execSync('git ls-files app src', { cwd: ROOT }).toString().trim().split('\n')
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  for (const f of files) {
    assert.doesNotMatch(read(f), /color: [^,}\n]*'var\(--text-(muted|dim|faint)\)'/, f);
  }
});

// ── Groen is geen merkaccent ──────────────────────────────────────────────

test('green: no UI uses the legacy --green* names; they only exist as aliases in the dark :root', () => {
  const s = css();
  const defs = s.match(/\n\s*--green[a-z-]*:/g) || [];
  assert.deepEqual(defs.map((d) => d.trim()), ['--green:', '--green-faint:', '--green-border:']);
  assert.match(s, /--green:\s*var\(--status-positive\);/);
  assert.doesNotMatch(s.replace(/\n\s*--green[a-z-]*:[^;]+;/g, ''), /var\(--green/);
  const files = execSync('git ls-files app src', { cwd: ROOT }).toString().trim().split('\n')
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  for (const f of files) assert.doesNotMatch(read(f), /var\(--green/, f);
  assert.doesNotMatch(s, /--whatsapp-/, 'no green WhatsApp tint tokens');
});

test('approvals and primary actions use oker, not green', () => {
  const mod = read('app/internal/moderation/page.js');
  assert.equal((mod.match(/background: 'var\(--accent-fill\)',\n\s*color: 'var\(--on-accent-fill\)'/g) || []).length, 2);
  assert.doesNotMatch(mod, /'#fff'/);
});

test('information is not success: the import-inbox info banner uses the soft accent', () => {
  assert.match(css(), /\.di-banner-info \{ background: var\(--accent-surface\); border: 1px solid var\(--accent\); color: var\(--text-primary\); \}/);
});

test('dietary labels are neutral outlined tags with a leaf icon, not a success status', () => {
  const s = css();
  const m = s.match(/\.tag-vegetarisch,\n\.tag-vegan\s*\{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /color: var\(--text-secondary\)/);
  assert.doesNotMatch(m[1], /status|green/);
  assert.match(read('app/menu/[id]/MenuView.js'), /NEUTRAL_DIET_TAG_KEYS\.has\(t\) && <StatusIcon name="leaf"/);
});

test('coverage dashboard: header tint is neutral and the headline number is primary text', () => {
  const src = read('app/internal/coverage/page.js');
  assert.doesNotMatch(src, /--green/);
  assert.match(src, /lineHeight: 1\.05, color: 'var\(--text-primary\)'/);
  assert.match(src, /complete: \{ label: 'Complete', color: 'var\(--status-positive\)' \}/);
});

// ── Status is nooit alleen kleur ──────────────────────────────────────────

test('Bronwerkvoorraad: BE-23 statuses map to the Kleurtaal v2 roles', () => {
  const src = read('app/internal/source-workqueue/page.js');
  const expect = {
    reachable: 'positive', unreachable: 'blocked', access_limited: 'old', identity_changed: 'old',
    ready_for_review: 'file', structure_not_recognized: 'old', no_menu_found: 'neutral', not_assessed: 'neutral',
  };
  for (const [status, role] of Object.entries(expect)) {
    assert.match(src, new RegExp(`${status}: \\{ tone: '${role}', icon: ICON_[A-Z]+ \\}`), status);
  }
  for (const role of Object.keys(ROLES)) {
    assert.match(css(), new RegExp(`\\.swq-badge--${role}\\s*\\{ color: var\\(--status-${role}\\);`));
  }
});

test('open indicators show an icon plus text, never a coloured dot alone', () => {
  for (const f of ['app/menu/[id]/MenuView.js', 'app/restaurant/[id]/RestaurantDetailView.js', 'app/restaurants/page.js']) {
    const src = read(f);
    assert.match(src, /status-badge--positive/, f);
    assert.match(src, /<StatusIcon name=\{[^}]*'check' : 'clock'\}/, f);
    assert.doesNotMatch(src, /borderRadius: '50%'[^}]*var\(--/, `${f}: no colour-only dot`);
  }
  assert.match(read('src/components/RestaurantBrowseCard.js'), /<StatusIcon name=\{restaurant\.openStatus === 'open' \? 'check' : 'clock'\}/);
  assert.doesNotMatch(read('app/search/page.js'), /borderRadius: '50%'/);
});

test('status icons are decorative inline SVG (aria-hidden, currentColor), no asset', () => {
  const src = read('src/components/StatusIcon.js');
  assert.match(src, /aria-hidden="true"/);
  assert.match(src, /stroke="currentColor"/);
  assert.doesNotMatch(src, /<img|\.svg['"]|\.png['"]/);
});

test('import-inbox status chips carry an icon next to the text', () => {
  const src = read('app/internal/import-inbox/page.js');
  assert.match(src, /\{c\.quality_status === 'complete' \? <IconCheck \/> : <IconInfo \/>\}/);
  assert.match(src, /const ChipIcon = TRIAGE_STATUS_ICONS\[c\.review_status\] \|\| IconDocument/);
});

test('no gradients and no photography were introduced', () => {
  assert.doesNotMatch(css(), /linear-gradient|radial-gradient/);
});
