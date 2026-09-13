'use strict';

// Targeted correction: app/nvwa/[id]/NvwaView.js's allergen-matrix/print copy
// previously implied MenuCard itself certifies or guarantees NVWA/EU 1169/2011
// legal compliance ("✓ NVWA-compliant", a fine amount tied to the app's own
// score, a reference to a non-existent "restaurant-dashboard"). These are
// structural safety-net tests (fs.readFileSync + regex, this project's
// existing convention — see src/lib/moderationFormatting.test.js) that read
// the actual page source rather than rendering it, since this project has no
// browser/DOM test harness. They assert the misleading phrasing is gone and
// the new, honest product copy is present, without touching or re-testing
// the underlying allergen data, matrix computation, print mechanism, or any
// authorization/provenance/API contract — none of those changed.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const NVWA_VIEW_PATH = path.join(REPO_ROOT, 'app/nvwa/[id]/NvwaView.js');

function readNvwaViewSource() {
  return fs.readFileSync(NVWA_VIEW_PATH, 'utf8');
}

// ─── Forbidden: language claiming automatic legal compliance/certification ──

test('NvwaView: never claims the app itself makes a restaurant "compliant"', () => {
  const source = readNvwaViewSource();
  // Targets the specific, previously-rendered claims — not the internal
  // ComplianceScore/COMPLIANCE_TONE identifiers, which are pure JS names
  // never shown to a user and are deliberately left unrenamed this round.
  assert.equal(/NVWA-compliant/i.test(source), false);
  assert.equal(/Gedeeltelijk compliant/i.test(source), false);
  assert.equal(/Niet compliant/i.test(source), false);
});

test('NvwaView: never frames a fine/penalty as a consequence of the app\'s own score', () => {
  const source = readNvwaViewSource();
  assert.equal(/boete/i.test(source), false, 'no fine/penalty amount should be tied to this page\'s own display or score');
  assert.equal(/€\s?525/.test(source), false);
});

test('NvwaView: never refers to a restaurant-facing "dashboard" that does not exist in this codebase', () => {
  const source = readNvwaViewSource();
  assert.equal(/restaurant-dashboard/i.test(source), false);
});

test('NvwaView: the page title no longer brands the matrix as an NVWA-issued document', () => {
  const source = readNvwaViewSource();
  assert.equal(/NVWA Allergenenmatrix/i.test(source), false, 'the eyebrow title must not read as if NVWA itself issued this matrix');
});

test('NvwaView: never implies MenuCard performs an inspection/keuring itself', () => {
  const source = readNvwaViewSource();
  // The one legitimate use is the explicit denial "voert zelf geen keuring of
  // inspectie uit" — assert that exact denial is present rather than banning
  // the words outright (they are needed to state the negative).
  assert.match(source, /MenuCard voert zelf geen keuring of inspectie uit/);
});

// ─── Required: the new, honest, calm product copy ───────────────────────────

test('NvwaView: states MenuCard helps record and share allergen information, not certify it', () => {
  const source = readNvwaViewSource();
  assert.match(source, /MenuCard helpt .* deze informatie overzichtelijk vast te leggen en te delen/);
});

test('NvwaView: states the restaurant remains responsible for accuracy, recipes, suppliers, and cross-contamination', () => {
  const source = readNvwaViewSource();
  assert.match(source, /blijft zelf verantwoordelijk voor de juistheid en/);
  assert.match(source, /recepturen/);
  assert.match(source, /leveranciersinformatie/);
  assert.match(source, /kruisbesmettingsrisico/i);
});

test('NvwaView: a printed/downloaded view is explicitly labeled a snapshot, never a certification or legal guarantee', () => {
  const source = readNvwaViewSource();
  assert.match(source, /momentopname/);
  assert.match(source, /geen certificering, keuring of juridische\s*\n?\s*garantie van naleving/);
});

test('NvwaView: missing/unknown allergen data is never framed as absent or safe', () => {
  const source = readNvwaViewSource();
  // The incomplete-data warning banner (shown when an item's allergens are
  // literally null) must explicitly deny that missing data means "free of".
  assert.match(source, /Dit betekent niet dat deze gerechten vrij zijn van deze allergenen/);
  // The legend's own explanatory note must carry the same disclaimer for the
  // per-cell "—" / "?" symbols.
  assert.match(source, /is geen garantie dat een gerecht vrij is van dit allergeen/);
});

// ─── Follow-up correction: the 100%-tak must read as a data shape, not a ────
// ─── completeness/verification/safety judgment (the `[]`-ambiguity finding) ─
//
// Every item in the current data has an array (`known === items.length`
// always, since `allergens` is never actually `null` in data/menus.json —
// see the previous review), so the `pct === 100` branch is, in practice, the
// *only* branch a real visitor ever sees. It must never claim more than "a
// value exists," because `[]` conflates "confirmed no allergens" with
// "never checked."

test('NvwaView: the 100%-branch never uses completeness/verification/safety/compliance/certification language', () => {
  const source = readNvwaViewSource();
  assert.equal(/volledig vastgelegd/i.test(source), false);
  assert.equal(/geverifieerd/i.test(source), false);
  assert.equal(/\bveilig\b/i.test(source), false);
  assert.equal(/\bcompliant\b/i.test(source), false);
  assert.equal(/certificaat/i.test(source), false);
});

test('NvwaView: the 100%-branch is presented as a neutral data shape, not a graded outcome', () => {
  const source = readNvwaViewSource();
  assert.match(source, /pct === 100 \? 'Elke gerechtregel heeft een waarde voor allergenen'/);
});

test('NvwaView: the 100%-branch uses a neutral tone, never the green "success" treatment', () => {
  const source = readNvwaViewSource();
  const toneBlockMatch = source.match(/const COMPLIANCE_TONE = \{[\s\S]*?\n\}/);
  assert.ok(toneBlockMatch, 'COMPLIANCE_TONE definition must exist');
  const toneBlock = toneBlockMatch[0];
  // No entry in the tone palette may reference green at all — the ambiguous
  // 100% case must not borrow a "this is fine" color from anywhere.
  assert.equal(/var\(--green/.test(toneBlock), false);
  // The neutral entry reuses the same informative-pill tokens as
  // /internal/moderation's SourceTag — not a bespoke or invented color.
  assert.match(toneBlock, /neutral:\s*\{\s*color:\s*'var\(--text-secondary\)',\s*bg:\s*'var\(--bg-elevated\)',\s*border:\s*'var\(--border\)'\s*\}/);
  // And the pct === 100 case must actually select that neutral entry.
  assert.match(source, /pct === 100 \? COMPLIANCE_TONE\.neutral/);
});

test('NvwaView: every row is stated to have a value, but an empty value never confirms absence', () => {
  const source = readNvwaViewSource();
  assert.match(source, /hebben een waarde voor allergenen \(ingevuld of leeg\)/);
  assert.match(source, /een lege waarde bevestigt geen afwezigheid van allergenen/);
});

// ─── Unchanged behavior — regression guard ──────────────────────────────────

test('NvwaView: the print mechanism itself is untouched (window.print(), no new dependency)', () => {
  const source = readNvwaViewSource();
  assert.match(source, /const handlePrint = \(\) => window\.print\(\)/);
  // Only the four pre-existing imports remain — no PDF/email library added.
  const importLines = source.split('\n').filter((line) => line.trim().startsWith('import '));
  assert.equal(importLines.length, 3);
  assert.ok(importLines.some((line) => line.includes("'react'")));
  assert.ok(importLines.some((line) => line.includes("next/link")));
  assert.ok(importLines.some((line) => line.includes('ThemeToggle')));
});

test('NvwaView: the completeness calculation itself is unchanged (same fields, same formula)', () => {
  const source = readNvwaViewSource();
  assert.match(source, /const known = items\.filter\(i => i\.allergens !== null\)\.length/);
  assert.match(source, /const pct = Math\.round\(\(known \/ items\.length\) \* 100\)/);
});

test('NvwaView: the allergen cell logic (✓ / — / ?) is unchanged', () => {
  const source = readNvwaViewSource();
  assert.match(source, /function AllergenCell\(\{ itemAllergens, allergenId \}\)/);
  assert.match(source, /if \(itemAllergens === null\) \{/);
  assert.match(source, /if \(Array\.isArray\(itemAllergens\) && itemAllergens\.includes\(allergenId\)\)/);
});

test('NvwaView: no email/send functionality was introduced', () => {
  const source = readNvwaViewSource();
  assert.equal(/mailto:|sendEmail|nodemailer|resend\(|sendgrid/i.test(source), false);
});
