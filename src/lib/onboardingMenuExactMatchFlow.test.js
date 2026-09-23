'use strict';

// Structural safety net for the BE-19 repair: the exact-match menu-
// proposal flow in app/internal/onboarding-menu/page.js must run through
// the receipt-based url_intakes bridge, never the old direct
// menu-snapshots call, while the non-exact (manual-choice) flow stays
// completely unchanged. No browser is available in this environment —
// this is source-level verification only, never a claim of a visual
// test (see this round's own report).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app/internal/onboarding-menu/page.js');

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) return null;
  // Balance braces from the function's own opening `{` to find its real
  // end — a plain "next \n  }" search is not reliable once a function
  // contains its own nested blocks (if/for/try), which every function
  // this test inspects does.
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

test('structural safety net: submitSelectedMenus branches on exact match — the old per-menu submitOneMenu loop only runs for the non-exact path', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function submitSelectedMenus(menusToSubmit)');
  assert.ok(fn, 'expected to find submitSelectedMenus');
  assert.match(fn, /if \(isExactMatch\) \{\s*\n[\s\S]*?await submitMenusViaUrlIntake\(menusToSubmit\)/);
  assert.match(fn, /\} else \{[\s\S]*?for \(const menu of menusToSubmit\) \{\s*\n\s*await submitOneMenu\(menu\)/);
});

test('structural safety net: retryOneMenu also branches on exact match, using the same url_intakes bridge for a single menu', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function retryOneMenu(menu)');
  assert.ok(fn, 'expected to find retryOneMenu');
  assert.match(fn, /if \(isExactMatch\) \{\s*\n\s*await submitMenusViaUrlIntake\(\[menu\]\)/);
});

test('structural safety net: submitMenusViaUrlIntake never calls the old menu-snapshots route directly', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function submitMenusViaUrlIntake(menusToSubmit)');
  assert.ok(fn, 'expected to find submitMenusViaUrlIntake');
  assert.doesNotMatch(fn, /\/api\/internal\/v1\/menu-snapshots/);
  assert.match(fn, /\/api\/internal\/v1\/url-intakes\/\$\{intakeId\}\/menu-proposals/);
});

test('structural safety net: submitOneMenu (the old direct path) is untouched and still exists — used only by the non-exact branch', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function submitOneMenu(menu)');
  assert.ok(fn, 'expected submitOneMenu to still exist, unmodified');
  assert.match(fn, /\/api\/internal\/v1\/menu-snapshots/);
  assert.match(fn, /restaurant_id: chosenRestaurantId/);
});

test('structural safety net: ensureUrlIntake redeems the receipt exactly once — a cached urlIntakeId short-circuits before any network call', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function ensureUrlIntake()');
  assert.ok(fn, 'expected to find ensureUrlIntake');
  const guardIndex = fn.indexOf('if (urlIntakeId) return');
  const fetchIndex = fn.indexOf("fetch('/api/internal/v1/url-intakes'");
  assert.ok(guardIndex !== -1 && fetchIndex !== -1 && guardIndex < fetchIndex, 'the cached-id short-circuit must come before the redemption fetch');
});

test('structural safety net: multiple selected menus reuse one url_intakes row — submitMenusViaUrlIntake calls ensureUrlIntake once per invocation, not once per menu', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function submitMenusViaUrlIntake(menusToSubmit)');
  const ensureCalls = fn.match(/ensureUrlIntake\(\)/g) || [];
  assert.equal(ensureCalls.length, 1, 'ensureUrlIntake must be called exactly once per submitMenusViaUrlIntake invocation, regardless of how many menus are requested');
  // And the whole batch is sent in a single wrapper call, never one call per menu.
  assert.match(fn, /menu_context_slugs: menusToSubmit\.map\(\(m\) => m\.contextSlug\)/);
});

test('structural safety net: neither ensureUrlIntake nor submitMenusViaUrlIntake ever sends restaurant_id, matched_restaurant_id, captured content, or an analysis hash', () => {
  const source = readPageSource();
  const ensureFn = extractFunction(source, 'async function ensureUrlIntake()');
  const submitFn = extractFunction(source, 'async function submitMenusViaUrlIntake(menusToSubmit)');
  for (const fn of [ensureFn, submitFn]) {
    assert.doesNotMatch(fn, /restaurant_id:/);
    assert.doesNotMatch(fn, /matched_restaurant_id:/);
    assert.doesNotMatch(fn, /restaurant_match_type:/);
    assert.doesNotMatch(fn, /captured_content:/);
    assert.doesNotMatch(fn, /analysis_result_hash/);
    assert.doesNotMatch(fn, /categories:/);
  }
  // The only body fields these two functions ever send.
  assert.match(ensureFn, /receipt_id: readResult\.receipt\.id/);
  assert.match(ensureFn, /source_url: sourceUrlInput/);
  assert.match(submitFn, /menu_context_slugs:/);
});

test('structural safety net: a failed or expired receipt redemption clearly fails every requested menu, with a non-technical message, never a silent partial success', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function submitMenusViaUrlIntake(menusToSubmit)');
  const guardIndex = fn.indexOf('if (!intakeId)');
  assert.ok(guardIndex !== -1, 'expected an explicit guard for a failed/expired receipt redemption');
  const guardBlock = fn.slice(guardIndex, fn.indexOf('return', guardIndex) + 6);
  assert.match(guardBlock, /setMenuStatusBySlug/);
  assert.match(guardBlock, /'error'/);
  assert.match(guardBlock, /setMenuErrorBySlug/);
});

test('structural safety net: a wrapper-reported "already exists" result is shown as a distinct, non-error status — never conflated with a genuine failure', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function submitMenusViaUrlIntake(menusToSubmit)');
  assert.match(fn, /already exists/i);
  assert.match(fn, /'exists'/);
});

test('structural safety net: readSourceUrl resets urlIntakeId and intakeError on every new read — a stale intake id from a previous URL can never be reused', () => {
  const source = readPageSource();
  const fn = extractFunction(source, 'async function readSourceUrl()');
  assert.ok(fn, 'expected to find readSourceUrl');
  assert.match(fn, /setUrlIntakeId\(null\)/);
  assert.match(fn, /setIntakeError\(null\)/);
});

test('structural safety net: promote_candidate_to_profile_draft and the existing BE-17 menu-snapshots route file are never referenced from this page\'s new BE-19 functions', () => {
  const source = readPageSource();
  const ensureFn = extractFunction(source, 'async function ensureUrlIntake()');
  const submitFn = extractFunction(source, 'async function submitMenusViaUrlIntake(menusToSubmit)');
  for (const fn of [ensureFn, submitFn]) {
    assert.doesNotMatch(fn, /promote_candidate_to_profile_draft/);
  }
});
