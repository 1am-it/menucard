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
    assert.match(src, /import \{ todayOpening, openingBadge \} from '@\/src\/lib\/openingStatus'/, f);
    assert.match(src, /<span className=\{`status-badge status-badge--\$\{(todayBadge|openBadge)\.role\}`\}[^>]*>\s*<StatusIcon name=\{(todayBadge|openBadge)\.icon\}[^>]*\/>\s*\{(todayBadge|openBadge)\.text\}/, f);
    assert.doesNotMatch(src, /status-badge--positive/, `${f}: positive only via openingBadge (open at this moment)`);
    assert.doesNotMatch(src, /`Open · \$\{/, `${f}: no "Open · hours" from opening hours alone`);
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

// ── Herstelronde: statusrollen alleen waar de inhoud een status is ─────────

const jsFiles = () => execSync('git ls-files app src', { cwd: ROOT }).toString().trim().split('\n')
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && fs.existsSync(path.join(ROOT, f)));

// Every custom property used as a text colour must be a known, reviewed
// token. A new page-scoped "secondary" colour (such as the former
// coverage-only variable) fails here instead of silently escaping the
// Kleurtaal v2 rule that readable secondary text is --text-secondary.
const TEXT_COLOUR_TOKENS = new Set([
  'text-primary', 'text-secondary',
  'accent', 'accent-dim', 'on-accent', 'on-accent-fill', 'wordmark', 'wordmark-icon', 'mark-text',
  'status-positive', 'status-blocked', 'status-neutral', 'status-file', 'status-old', 'status-action',
  'danger',
  'tag-featured', 'tag-info', 'tag-halal', 'tag-gluten', 'allergy', 'allergy-strong', 'wine',
  'bg-card', // only as text on a full --accent fill (.swq-count), never as readable text on a surface
]);

test('every text colour custom property is a reviewed token (CSS and inline styles)', () => {
  const offenders = [];
  const scan = (label, src, re) => {
    let m;
    while ((m = re.exec(src))) {
      for (const v of m[1].matchAll(/var\(--([a-z0-9-]+)/g)) if (!TEXT_COLOUR_TOKENS.has(v[1])) offenders.push(`${label}: --${v[1]}`);
    }
  };
  scan('app/globals.css', css(), /(?<![-\w])color\s*:\s*([^;}\n]*)/g);
  for (const f of jsFiles()) scan(f, read(f), /(?<![-\w])color\s*:\s*([^,;}\n]*)/g);
  assert.deepEqual(offenders, []);
});

test('"Actie nodig" is reserved: no business status is linked to --status-action', () => {
  const s = css();
  const uses = s.split('\n').filter((l) => /var\(--status-action/.test(l) && !/^\s*--/.test(l));
  assert.deepEqual(uses.map((l) => l.trim().split(' ')[0]), ['.status-badge--action,'], 'only the generic role class may use it');
  for (const f of jsFiles()) {
    assert.doesNotMatch(read(f), /status-badge--action|swq-badge--action|di-chip--action|tone: 'action'/, f);
  }
  assert.doesNotMatch(read('docs/guides/design-reference.md'), /Nieuw\s*→\s*action/, 'the canonical design reference does not map Nieuw to Actie nodig');
});

test('shared chips use role classes, never raw business-state names', () => {
  const s = css();
  assert.doesNotMatch(s, /\.di-chip--(new|needs_enrichment|approved_internal|deferred|rejected|complete|incomplete|muted)\b/);
  assert.doesNotMatch(s, /\.di-summary-icon--(new|needs_enrichment|approved_internal|deferred|rejected)\b/);
  assert.doesNotMatch(s, /\.di-status-icon--(warning|danger|info|muted)\b/);
  for (const f of jsFiles()) {
    assert.doesNotMatch(read(f), /di-chip--(new|needs_enrichment|approved_internal|deferred|rejected|complete|incomplete|muted)\b|di-chip--\$\{(c|s|d)\.|di-summary-icon--\$\{status\}/, f);
  }
  assert.match(s, /\.di-chip \{[^}]*border-radius: var\(--status-radius\);/, 'status chips follow the status shape (light pill, dark 6px)');
});

test('confidence (hoog/middel/laag) is a neutral label, not a positive/blocked status', () => {
  const src = read('app/internal/onboarding-restaurant/page.js');
  assert.doesNotMatch(src, /CONFIDENCE_CHIP_CLASS/);
  assert.match(src, /<span className="di-chip di-chip--label">\s*Betrouwbaarheid: \{evidence\.confidence\}\s*<\/span>/, 'explicit label, no status icon');
  const label = css().match(/\.di-chip--label\s*\{([^}]*)\}/);
  assert.ok(label);
  assert.doesNotMatch(label[1], /status|green|danger/);
});

test('in-progress, not yet reviewed, concept and incomplete states are not success/error/action', () => {
  const restaurant = read('app/internal/onboarding-restaurant/page.js');
  const menu = read('app/internal/onboarding-menu/page.js');
  for (const src of [restaurant, menu]) {
    assert.match(src, /di-chip--\$\{proposalRequestRole\(status\)\}/);
    assert.match(src, /pending: 'clock'/, '"Bezig…" shows a clock, not a status colour');
  }
  assert.match(menu, /di-chip--\$\{reviewStatusRole\(s\.effective_status\)\}/);
  assert.match(read('app/internal/profile-drafts/page.js'), /di-chip--\$\{profileDraftRole\(d\.status\)\}/);
  const inbox = read('app/internal/import-inbox/page.js');
  assert.match(inbox, /di-chip di-chip--\$\{qualityStatusRole\(c\.quality_status\)\}/, 'list');
  assert.match(inbox, /di-status-icon--\$\{qualityStatusRole\(c\.quality_status\)\}/, 'detail uses the same role as the list');
  assert.match(inbox, /<span className="di-chip di-chip--neutral">\s*<IconInfo \/>\s*possible duplicate/);
  assert.match(inbox, /di-summary-icon--\$\{reviewStatusRole\(status\)\}/);
  assert.match(inbox, /const statusTone = reviewStatusRole\(c\.review_status\)/);
  assert.match(inbox, /di-status-icon--\$\{profileDraftRole\(draftLineage\.state\)\}/);
  assert.match(inbox, /di-chip--\$\{importRunRole\(run\.status\)\}/);
});

test('status chips on onboarding and profile drafts show an icon next to the text', () => {
  for (const f of ['app/internal/onboarding-restaurant/page.js', 'app/internal/onboarding-menu/page.js', 'app/internal/profile-drafts/page.js']) {
    const src = read(f);
    const re = /<span className=\{?[`"]di-chip di-chip--(?!label)[^>]*>/g;
    let m;
    let count = 0;
    while ((m = re.exec(src))) {
      count += 1;
      assert.match(src.slice(m.index + m[0].length, m.index + m[0].length + 160), /^\s*<StatusIcon /, `${f}: ${m[0]}`);
    }
    assert.ok(count > 0, f);
  }
});

test('today in the opening hours is a presentation marker, never a positive status', () => {
  const s = css();
  const today = s.match(/\.hours-today[^{]*\{[^}]*\}/g) || [];
  assert.ok(today.length > 0);
  for (const rule of today) assert.doesNotMatch(rule, /status-|green/, rule);
  assert.match(s, /\.hours-today \.hours-day \{ color: var\(--accent\); \}/);
  assert.match(read('app/restaurant/[id]/RestaurantDetailView.js'), /aria-current=\{isToday \? 'date' : undefined\}/);
});

test('incomplete data and uncertainty use the neutral role — never an error and never --warning (alias of --status-old)', () => {
  const tone = read('app/nvwa/[id]/NvwaView.js').match(/const COMPLIANCE_TONE = \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(tone, /--danger|--warning|--status-old/);
  assert.match(tone, /partial: \{ color: 'var\(--status-neutral\)'/);
  assert.match(tone, /none: +\{ color: 'var\(--status-neutral\)'/);
  assert.match(read('app/internal/onboarding-restaurant/page.js'), /color: 'var\(--status-neutral\)', marginTop: 2 \}\}>\s*Afwijkende waarde/);
  const inbox = read('app/internal/import-inbox/page.js');
  assert.match(inbox, /color: 'var\(--status-neutral\)', marginTop: 6 \}\}>Missing:/);
  assert.match(inbox, /color: 'var\(--status-neutral\)', marginTop: 4 \}\}>Phone format not recognized/);
  assert.match(inbox, /color: 'var\(--status-neutral\)' \}\}>\s*This looks like a possible duplicate/);
  assert.match(inbox, /color: 'var\(--status-neutral\)', marginBottom: 8 \}\}>\s*robots\.txt could not be confirmed/);
  assert.match(inbox, /color: 'var\(--status-old\)', marginBottom: 8 \}\}>\s*This page is disallowed by the site's robots\.txt/, 'a real access limitation keeps the old role, explicitly');
  assert.match(inbox, /di-banner-\$\{importRunRole\(selectedRun\.status\) === 'blocked' \? 'danger' : 'neutral'\}/);
  assert.match(read('app/internal/profile-drafts/page.js'), /color: 'var\(--status-neutral\)', marginTop: 6 \}\}>\s*Possibly a duplicate/);
  const s = css();
  for (const rule of ['.nvwa-warning {', '.allergen-unknown {', '.mc-badge-unknown ', '.low-coverage-note {']) {
    const body = s.slice(s.indexOf(rule), s.indexOf('}', s.indexOf(rule)));
    assert.ok(s.includes(rule), rule);
    assert.doesNotMatch(body, /--warning|--status-old|--danger/, rule);
    assert.match(body, /--status-neutral/, rule);
  }
  assert.match(s, /\.mc-unknown \{ border-color: var\(--input-border\) !important; \}/);
  assert.match(s, /\.low-coverage-note--error \{[^}]*var\(--status-blocked\)/, 'a real load error in the same slot keeps the error role');
  assert.match(read('app/search/page.js'), /className="low-coverage-note low-coverage-note--error">\{restaurantError\}/);
  assert.doesNotMatch(read('app/internal/coverage/page.js'), /--warning/);
});

test('--warning (alias of --status-old) is used by no UI any more', () => {
  const s = css();
  const uses = s.split('\n').filter((l) => /var\(--warning/.test(l) && !/^\s*--/.test(l));
  assert.deepEqual(uses, []);
  assert.doesNotMatch(s, /\.di-banner-warning|\.badge-warning/);
  for (const f of jsFiles()) assert.doesNotMatch(read(f), /var\(--warning|di-banner-warning|badge-warning/, f);
});

test('moderation: neutral claim states use a neutral icon, not the attention icon', () => {
  const src = read('app/internal/moderation/page.js');
  assert.match(src, /<StatusIcon name=\{claim\.domain_match \? 'check' : 'dot'\} size=\{12\} \/>/);
  assert.doesNotMatch(src, /StatusIcon name="alert"|: 'alert'/);
});

test('moderation: only a domain match is positive; mismatch and existing owner stay neutral', () => {
  const src = read('app/internal/moderation/page.js');
  assert.match(src, /status-badge--\$\{domainMatchRole\(claim\.domain_match\)\}/);
  assert.doesNotMatch(src, /status-badge--old/);
});

test('dark: only approved refinements — the error border keeps its former 20% alpha', () => {
  const { dark } = blocks();
  assert.equal(tokenIn(dark, 'danger-border'), 'rgba(255, 107, 107, 0.20)');
});

test('dead open-dot and dish-result-status CSS is gone and nothing references it', () => {
  const s = css();
  assert.doesNotMatch(s, /\.rc-open-(dot|label|status)\b|\.dish-result-status\b/);
  for (const f of jsFiles()) assert.doesNotMatch(read(f), /rc-open-(dot|label|status)|dish-result-status/, f);
});
