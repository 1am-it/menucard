'use strict';

// #62 — the internal navigation model (labels, placements, real counts, the one
// landing rule, roles) plus structural safety nets for the files this issue
// touches. Unit tests for the pure logic in src/lib/internalNav.js first; the
// structural tests use this project's existing fs.readFileSync + regex
// convention (see src/lib/importInbox.test.js).
//
// Every expectation here comes from the approved contract and the Lead's review:
// the top bar shows Dekking, Werkvoorraad (N) and "+ Restaurant of menu
// toevoegen"; the menu shows the counted open work first, a separating line, then
// Stadsoverzicht and Restaurantgegevens (concept); /internal, the login and the
// logo use one landing rule; a missing count never becomes a number.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  isEditorRole,
  isOwnerRole,
  hasAnyKnownRole,
  COVERAGE_HREF,
  ADD_ENTRY_HREF,
  INTERNAL_MODULES,
  resolveVisibleModules,
  groupModulesByPlacement,
  resolveCount,
  sortOpenWork,
  resolveOpenWorkTotal,
  resolveLandingHref,
} = require('./internalNav');

const REPO_ROOT = path.join(__dirname, '..', '..');
const INTERNAL_HOME_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/page.js');
const LOGIN_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/login/page.js');
const ME_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/me/route.js');
const COUNT_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/workqueue-counts/route.js');
const NAV_COMPONENT_PATH = path.join(REPO_ROOT, 'src/components/InternalNav.js');
const GLOBALS_CSS_PATH = path.join(REPO_ROOT, 'app/globals.css');
const ADD_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/toevoegen/page.js');
const BATCH_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/bronnen/batch/page.js');
const COVERAGE_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/coverage/page.js');
const IMPORT_INBOX_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/import-inbox/page.js');
const PROFILE_DRAFTS_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/profile-drafts/page.js');
const MODERATION_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/moderation/page.js');
const LAYOUT_PATH = path.join(REPO_ROOT, 'app/internal/layout.js');

// ─── isEditorRole / isOwnerRole / hasAnyKnownRole ──────────────────────

test('isEditorRole: true only when the editor role is present', () => {
  assert.equal(isEditorRole([{ role: 'editor', restaurant_id: null }]), true);
  assert.equal(isEditorRole([{ role: 'internal' }, { role: 'editor' }]), true);
});

test('isEditorRole: false for internal-only, owner-only, or no roles at all, and never throws on malformed input', () => {
  assert.equal(isEditorRole([{ role: 'internal' }]), false);
  assert.equal(isEditorRole([{ role: 'owner', restaurant_id: '6' }]), false);
  assert.equal(isEditorRole([]), false);
  assert.equal(isEditorRole(null), false);
  assert.equal(isEditorRole(undefined), false);
  assert.equal(isEditorRole('not-an-array'), false);
});

test('isOwnerRole: true only when the owner role is present', () => {
  assert.equal(isOwnerRole([{ role: 'owner', restaurant_id: '6' }]), true);
  assert.equal(isOwnerRole([{ role: 'internal' }, { role: 'owner', restaurant_id: '6' }]), true);
  assert.equal(isOwnerRole([{ role: 'internal' }]), false);
  assert.equal(isOwnerRole([]), false);
  assert.equal(isOwnerRole(null), false);
});

// ─── The navigation model: labels, routes, placements, roles ───────────

test('the top bar has exactly one primary item: "Dekking" (was Dekkingsoverzicht), on its unchanged route', () => {
  const primary = INTERNAL_MODULES.filter((m) => m.placement === 'primary');
  assert.deepEqual(primary.map((m) => m.id), ['coverage']);
  assert.equal(primary[0].label, 'Dekking');
  assert.equal(primary[0].href, '/internal/coverage');
  assert.equal(COVERAGE_HREF, '/internal/coverage');
});

test('"Onboarding Restaurant" and the old "Beheer" tile page are no longer navigation items at all', () => {
  const ids = INTERNAL_MODULES.map((m) => m.id);
  assert.ok(!ids.includes('onboarding-restaurant'), 'the contract removes it as a top-bar item; it is reached through the add screen');
  assert.ok(!ids.includes('manage'), 'the /internal tile page ceases to be a destination');
  assert.ok(!INTERNAL_MODULES.some((m) => m.href === '/internal'), 'no nav item links to the tile page');
});

test('open work has the contract order and the contract labels, each with its real count key and unchanged route', () => {
  const openWork = INTERNAL_MODULES.filter((m) => m.placement === 'open-work');
  assert.deepEqual(
    openWork.map((m) => [m.id, m.label, m.href, m.countKey]),
    [
      ['menu-concepts', 'Menuconcepten beoordelen', '/internal/menu-concepts', 'menu-concepts'],
      ['source-triage', 'Bronnen beoordelen', '/internal/bronnen', 'source-triage'],
      ['import-inbox', 'Nieuwe aanleveringen', '/internal/import-inbox', 'import-inbox'],
      ['moderation', 'Beoordelen', '/internal/moderation', 'moderation'],
    ],
  );
});

test('below the separating line: Stadsoverzicht (was Bronwerkvoorraad), Restaurantgegevens (concept) (was Profielconcepten) and Tellers (BE-45), routes and ids unchanged, never counted', () => {
  const secondary = INTERNAL_MODULES.filter((m) => m.placement === 'secondary');
  assert.deepEqual(
    secondary.map((m) => [m.id, m.label, m.href]),
    [
      ['source-workqueue', 'Stadsoverzicht', '/internal/source-workqueue'],
      ['profile-drafts', 'Restaurantgegevens (concept)', '/internal/profile-drafts'],
      // BE-55 deel 4 (#135): de werkvoorraad van daghap en seizoensgerecht.
      ['daghap-beheer', 'Aanbod in controle', '/internal/aanbod'],
      ['tellers', 'Tellers', '/internal/tellers'],
      // BE-58 (#143): de wijzigingen van houders, onder de scheidingslijn.
      ['menukaart-wijzigingen', 'Wijzigingen van houders', '/internal/menukaart-wijzigingen'],
    ],
  );
  for (const module of secondary) assert.ok(!('countKey' in module), `${module.id} must never show a count`);
  const tellers = secondary.find((m) => m.id === 'tellers');
  assert.equal(tellers.requiredRole, 'internal', 'BE-45: only the internal role sees Tellers');
});

test('every module keeps an existing internal route, a non-empty label, a recognized role and a recognized placement', () => {
  for (const m of INTERNAL_MODULES) {
    assert.match(m.href, /^\/internal(\/|$)/);
    assert.ok(m.label.length > 0);
    assert.ok(['internal', 'editor'].includes(m.requiredRole));
    assert.ok(['primary', 'open-work', 'secondary'].includes(m.placement), `${m.id} must have a recognized placement`);
  }
});

test('every open-work entry carries a subtitle for the menu; a module without a recognized placement is never shown', () => {
  for (const m of INTERNAL_MODULES.filter((module) => module.placement === 'open-work')) {
    assert.ok(typeof m.subtitle === 'string' && m.subtitle.length > 0, `${m.id} must have a subtitle`);
  }
  const { primary, openWork, secondary } = groupModulesByPlacement([
    { id: 'no-placement', href: '/internal/x', requiredRole: 'internal' },
    { id: 'other', href: '/internal/y', requiredRole: 'internal', placement: 'somewhere' },
  ]);
  assert.deepEqual([primary, openWork, secondary], [[], [], []]);
});

test('resolveVisibleModules: an internal-only account sees Dekking, the three internal open-work sections and the three secondary ones — not Beoordelen', () => {
  const ids = resolveVisibleModules([{ role: 'internal' }]).map((m) => m.id).sort();
  assert.deepEqual(ids, ['coverage', 'daghap-beheer', 'import-inbox', 'menu-concepts', 'menukaart-wijzigingen', 'profile-drafts', 'source-triage', 'source-workqueue', 'tellers']);
});

test('resolveVisibleModules: an editor-only account sees exactly Beoordelen (moderation)', () => {
  assert.deepEqual(resolveVisibleModules([{ role: 'editor' }]).map((m) => m.id), ['moderation']);
  // BE-45 (#114): Tellers staat niet in de navigatie van een editor of owner.
  assert.ok(!resolveVisibleModules([{ role: 'editor' }]).some((m) => m.id === 'tellers'));
  assert.ok(!resolveVisibleModules([{ role: 'owner', restaurant_id: '6' }]).some((m) => m.id === 'tellers'));
  assert.deepEqual(groupModulesByPlacement(resolveVisibleModules([{ role: 'owner' }])), { primary: [], openWork: [], secondary: [] });
});

test('resolveVisibleModules: an owner-only account and a role-less account see zero modules — no invented destination', () => {
  assert.deepEqual(resolveVisibleModules([{ role: 'owner', restaurant_id: '6' }]), []);
  assert.deepEqual(resolveVisibleModules([]), []);
  assert.deepEqual(resolveVisibleModules(null), []);
});

test('resolveVisibleModules: a multi-role (internal + editor) account sees the full union, not one role\'s subset', () => {
  const ids = resolveVisibleModules([{ role: 'internal' }, { role: 'editor' }]).map((m) => m.id).sort();
  assert.deepEqual(ids, ['coverage', 'daghap-beheer', 'import-inbox', 'menu-concepts', 'menukaart-wijzigingen', 'moderation', 'profile-drafts', 'source-triage', 'source-workqueue', 'tellers']);
});

test('onboarding-menu stays out of the shared nav for every role (route and deep links untouched)', () => {
  for (const roles of [[{ role: 'internal' }], [{ role: 'editor' }], [{ role: 'internal' }, { role: 'editor' }]]) {
    assert.ok(!resolveVisibleModules(roles).some((m) => m.id === 'onboarding-menu'));
  }
  assert.ok(!INTERNAL_MODULES.some((m) => m.id === 'onboarding-menu'));
});

// ─── groupModulesByPlacement ──────────────────────────────────────────

test('groupModulesByPlacement: splits the role-filtered list into primary, open work and secondary, keeping contract order', () => {
  const modules = resolveVisibleModules([{ role: 'internal' }, { role: 'editor' }]);
  const { primary, openWork, secondary } = groupModulesByPlacement(modules);
  assert.deepEqual(primary.map((m) => m.id), ['coverage']);
  assert.deepEqual(openWork.map((m) => m.id), ['menu-concepts', 'source-triage', 'import-inbox', 'moderation']);
  assert.deepEqual(secondary.map((m) => m.id), ['source-workqueue', 'profile-drafts', 'daghap-beheer', 'tellers', 'menukaart-wijzigingen']);
});

test('groupModulesByPlacement: never throws and returns empty groups for non-array input', () => {
  assert.deepEqual(groupModulesByPlacement(null), { primary: [], openWork: [], secondary: [] });
  assert.deepEqual(groupModulesByPlacement(undefined), { primary: [], openWork: [], secondary: [] });
  assert.deepEqual(groupModulesByPlacement([]), { primary: [], openWork: [], secondary: [] });
});



test('hasAnyKnownRole: true for any of internal/editor/owner, false for zero rows or unrecognized values', () => {
  assert.equal(hasAnyKnownRole([{ role: 'internal' }]), true);
  assert.equal(hasAnyKnownRole([{ role: 'editor' }]), true);
  assert.equal(hasAnyKnownRole([{ role: 'owner', restaurant_id: '6' }]), true);
  assert.equal(hasAnyKnownRole([]), false);
  assert.equal(hasAnyKnownRole(null), false);
  assert.equal(hasAnyKnownRole(undefined), false);
  assert.equal(hasAnyKnownRole([{ role: 'something-else' }]), false);
});
// --- Real counts: sorting, missing numbers, the bar total ---

test('resolveCount: only a non-negative integer is a number; everything else is not computable', () => {
  assert.equal(resolveCount({ a: 0 }, 'a'), 0);
  assert.equal(resolveCount({ a: 12 }, 'a'), 12);
  assert.equal(resolveCount({ a: null }, 'a'), null);
  assert.equal(resolveCount({ a: '5' }, 'a'), null);
  assert.equal(resolveCount({ a: 1.5 }, 'a'), null);
  assert.equal(resolveCount({ a: -1 }, 'a'), null);
  assert.equal(resolveCount({}, 'a'), null);
  assert.equal(resolveCount(null, 'a'), null);
  assert.equal(resolveCount({ a: 1 }, ''), null);
});

test('sortOpenWork: descending by the real count, equal counts keep the contract order', () => {
  const openWork = INTERNAL_MODULES.filter((m) => m.placement === 'open-work');
  const rows = sortOpenWork(openWork, { 'menu-concepts': 1, 'source-triage': 9, 'import-inbox': 4, moderation: 9 });
  assert.deepEqual(rows.map((row) => [row.module.id, row.count]), [
    ['source-triage', 9],
    ['moderation', 9],
    ['import-inbox', 4],
    ['menu-concepts', 1],
  ]);
});

test('sortOpenWork: modules without a computable count go last, in contract order, without a number', () => {
  const openWork = INTERNAL_MODULES.filter((m) => m.placement === 'open-work');
  const rows = sortOpenWork(openWork, { 'source-triage': 3, 'menu-concepts': null });
  assert.deepEqual(rows.map((row) => [row.module.id, row.count]), [
    ['source-triage', 3],
    ['menu-concepts', null],
    ['import-inbox', null],
    ['moderation', null],
  ]);
  const allUnknown = sortOpenWork(openWork, null);
  assert.deepEqual(allUnknown.map((row) => row.module.id), openWork.map((m) => m.id));
  assert.ok(allUnknown.every((row) => row.count === null));
});

test('sortOpenWork: never mutates the input list or the module objects', () => {
  const openWork = INTERNAL_MODULES.filter((m) => m.placement === 'open-work');
  const before = openWork.map((m) => m.id);
  sortOpenWork(openWork, { 'menu-concepts': 99 });
  assert.deepEqual(openWork.map((m) => m.id), before);
  assert.ok(!('count' in openWork[0]));
});

test('resolveOpenWorkTotal: the bar total adds every visible number, a real 0 included', () => {
  const openWork = INTERNAL_MODULES.filter((m) => m.placement === 'open-work');
  const rows = sortOpenWork(openWork, { 'menu-concepts': 0, 'source-triage': 2, 'import-inbox': 3, moderation: 5 });
  assert.equal(resolveOpenWorkTotal(rows), 10);
  assert.equal(resolveOpenWorkTotal(sortOpenWork(openWork, { 'menu-concepts': 0, 'source-triage': 0, 'import-inbox': 0, moderation: 0 })), 0);
});

test('resolveOpenWorkTotal: one missing number means no total at all, never an understated number', () => {
  const openWork = INTERNAL_MODULES.filter((m) => m.placement === 'open-work');
  const rows = sortOpenWork(openWork, { 'menu-concepts': 2, 'source-triage': 3, 'import-inbox': null, moderation: 5 });
  assert.equal(resolveOpenWorkTotal(rows), null);
  assert.equal(resolveOpenWorkTotal([]), null);
  assert.equal(resolveOpenWorkTotal(null), null);
});

test('resolveLandingHref: the visible open-work section with the most real open work wins', () => {
  const roles = [{ role: 'internal' }];
  assert.equal(resolveLandingHref(roles, { 'menu-concepts': 2, 'source-triage': 8, 'import-inbox': 1 }), '/internal/bronnen');
  assert.equal(resolveLandingHref(roles, { 'menu-concepts': 9, 'source-triage': 8, 'import-inbox': 1 }), '/internal/menu-concepts');
  assert.equal(resolveLandingHref(roles, { 'menu-concepts': 1, 'source-triage': 2, 'import-inbox': 7 }), '/internal/import-inbox');
});

test('resolveLandingHref: a tie follows the contract order (Menuconcepten, Bronnen, Nieuwe aanleveringen, Beoordelen)', () => {
  const both = [{ role: 'internal' }, { role: 'editor' }];
  assert.equal(resolveLandingHref(both, { 'menu-concepts': 5, 'source-triage': 5, 'import-inbox': 5, moderation: 5 }), '/internal/menu-concepts');
  assert.equal(resolveLandingHref(both, { 'menu-concepts': 0, 'source-triage': 5, 'import-inbox': 5, moderation: 5 }), '/internal/bronnen');
  assert.equal(resolveLandingHref(both, { 'menu-concepts': 0, 'source-triage': 0, 'import-inbox': 5, moderation: 5 }), '/internal/import-inbox');
  assert.equal(resolveLandingHref(both, { 'menu-concepts': 0, 'source-triage': 0, 'import-inbox': 0, moderation: 4 }), '/internal/moderation');
});

test('resolveLandingHref: zero open work lands on Dekking', () => {
  assert.equal(
    resolveLandingHref([{ role: 'internal' }], { 'menu-concepts': 0, 'source-triage': 0, 'import-inbox': 0 }),
    COVERAGE_HREF,
  );
});

test('resolveLandingHref: a missing count never invents a winner, it falls back to Dekking', () => {
  assert.equal(resolveLandingHref([{ role: 'internal' }], { 'menu-concepts': 5 }), COVERAGE_HREF);
  assert.equal(resolveLandingHref([{ role: 'internal' }], null), COVERAGE_HREF);
  assert.equal(resolveLandingHref([{ role: 'internal' }], undefined), COVERAGE_HREF);
});

test('resolveLandingHref: roles decide which sections may win, so an internal account never lands on the editor-only queue', () => {
  const counts = { 'menu-concepts': 0, 'source-triage': 0, 'import-inbox': 0, moderation: 99 };
  assert.equal(resolveLandingHref([{ role: 'internal' }], counts), COVERAGE_HREF);
  assert.equal(resolveLandingHref([{ role: 'editor' }], counts), '/internal/moderation');
  assert.equal(resolveLandingHref([{ role: 'editor' }], { moderation: 0 }), COVERAGE_HREF);
});

test('resolveLandingHref: an account with no visible module gets null, so the caller keeps its existing status', () => {
  assert.equal(resolveLandingHref([], {}), null);
  assert.equal(resolveLandingHref([{ role: 'owner', restaurant_id: '9001' }], { 'menu-concepts': 3 }), null);
  assert.equal(resolveLandingHref(null, { 'menu-concepts': 3 }), null);
});

test('the add entry route is a real, known path and never a second Beheer page', () => {
  assert.equal(ADD_ENTRY_HREF, '/internal/toevoegen');
  assert.match(ADD_ENTRY_HREF, /^\/internal\/[a-z-]+$/);
});

// --- Structural safety net: the nav component ---

test('structural safety net: InternalNav is keyboard and screen-reader reachable and reuses the shared model', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /aria-label="Interne navigatie"/);
  for (const fn of ['resolveVisibleModules', 'groupModulesByPlacement', 'sortOpenWork', 'resolveOpenWorkTotal']) {
    assert.match(source, new RegExp(fn));
  }
  assert.doesNotMatch(source, /\.from\(['"]/, 'must never query Supabase data directly from the browser');
});

test('structural safety net: Werkvoorraad is a real button with aria-expanded and aria-controls, never a hover-only or CSS-only menu', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /<button[\s\S]{0,400}className="internal-nav-workqueue-trigger"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{PANEL_ID\}/);
  assert.match(source, /const PANEL_ID = 'internal-nav-workqueue-panel'/);
  assert.match(source, /\{open && \(/);
  assert.doesNotMatch(source, /<details|<summary/);
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  assert.doesNotMatch(css, /\.internal-nav-workqueue[^{]*:hover[^{]*\{[^}]*(display|opacity|visibility)/);
});

test('structural safety net: Escape closes the panel and returns focus to the trigger; a click outside closes it', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /if \(event\.key !== 'Escape'\) return/);
  assert.match(source, /setOpen\(false\)/);
  assert.match(source, /triggerRef\.current\.focus\(\)/);
  assert.match(source, /wrapperRef\.current\.contains\(event\.target\)/);
});

test('structural safety net: a route change closes the panel, so a navigation from inside it never leaves it stuck open', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /\}, \[pathname\]\)/);
});

test('structural safety net: the menu items are real links with aria-current, without a fake menu role fighting normal link behaviour', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /className="internal-nav-workqueue-item"[\s\S]{0,240}aria-current=\{isCurrent\(pathname, (module|m)\.href\) \? 'page' : undefined\}/);
  assert.match(source, /className="internal-nav-link"[\s\S]{0,140}aria-current=\{isCurrent\(pathname, m\.href\) \? 'page' : undefined\}/);
  assert.match(source, /className="internal-nav-add"[\s\S]{0,240}aria-current=\{isCurrent\(pathname, '\/internal\/toevoegen'\) \? 'page' : undefined\}/);
  assert.doesNotMatch(source, /role="menu"/);
});

test('structural safety net: no count means no number, and the total uses the shared rule', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /\{total !== null && <span className="internal-nav-workqueue-total">\(\{total\}\)<\/span>\}/);
  assert.match(source, /\{count !== null && \(/);
  assert.match(source, /className="internal-nav-workqueue-item-count"/);
});

test('structural safety net: the counts are one request per shell load to the dedicated read route, never a per-open request and never a write', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /const COUNT_API = '\/api\/internal\/v1\/workqueue-counts'/);
  assert.equal((source.match(/fetch\(COUNT_API/g) || []).length, 1);
  assert.match(source, /\}, \[accessToken, openWorkCount\]\)/);
  assert.doesNotMatch(source, /method: 'POST'|method: 'PUT'|method: 'PATCH'|method: 'DELETE'/);
});

test('structural safety net: the bar carries Dekking, Werkvoorraad, the add entry, Licht/Donker and Sign out; the menu adds them at the bottom', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /<span className="internal-nav-workqueue-title-full">Werkvoorraad<\/span>/);
  assert.match(source, /<span className="internal-nav-workqueue-title-short">Werk<\/span>/);
  assert.match(source, /internal-nav-add-text">Restaurant of menu toevoegen/);
  assert.match(source, /aria-label="Restaurant of menu toevoegen"/);
  assert.match(source, /className="internal-nav-actions"[\s\S]{0,220}<ThemeToggle \/>/);
  assert.match(source, /className="internal-nav-workqueue-actions"[\s\S]{0,220}<ThemeToggle \/>/);
  assert.equal((source.match(/<ThemeToggle \/>/g) || []).length, 2, 'one bar copy and one menu copy, never a second theme implementation');
  assert.equal((source.match(/onClick=\{signOut\}/g) || []).length, 2);
  assert.match(source, /\{narrow && \(/, 'the menu copy exists only on a telephone');
  assert.match(source, /\{!narrow && \(/, 'the bar copy exists only on a wide screen');
});

test('structural safety net (criterion 5): the trigger, every menu row, the add entry and Sign out have a real 44 px touch target', () => {
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  const rule = (selector) => {
    const start = css.indexOf(selector + ' {');
    assert.ok(start >= 0, 'missing CSS rule ' + selector);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
  };
  assert.match(rule('.internal-nav-workqueue-trigger'), /min-height: 44px/);
  assert.match(rule('.internal-nav-workqueue-item'), /min-height: 44px/);
  assert.match(rule('.internal-nav-add'), /min-height: 44px/);
  assert.match(rule('.internal-nav-signout'), /min-height: 44px/);
});

test('structural safety net (criterion 5): at 640 px and below the bar keeps Dekking, Werk (N) and a + button, and the menu gets Licht/Donker + Sign out at the bottom', () => {
  // BE-45 (#114) adds a second 640 px block at the end of app/globals.css for the
  // Tellers page, so this safety net finds the navigation block by its own first
  // rule instead of "the last 640 px block in the file".
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8').replace(/\r\n/g, '\n');
  const start = css.lastIndexOf('@media (max-width: 640px) {\n  .internal-nav {');
  assert.ok(start >= 0, 'expected the 640 px telephone breakpoint (covers 390 and 320)');
  const block = css.slice(start, css.indexOf('\n}', start) + 2);
  assert.match(block, /\.internal-nav-workqueue-title-full \{ display: none; \}/);
  assert.match(block, /\.internal-nav-workqueue-title-short \{ display: inline; \}/);
  assert.match(block, /\.internal-nav-add-text \{ display: none; \}/);
  assert.match(block, /\.internal-nav-actions \{ display: none; \}/);
  assert.match(block, /\.internal-nav-workqueue-actions \{ display: flex; \}/);
  assert.match(block, /\.internal-nav-workqueue-panel \{[\s\S]*left: 10px;[\s\S]*right: 10px;/);
  assert.match(css, /\.internal-nav-workqueue-actions \{\r?\n  display: none;/);
});

test('structural safety net: every new interactive element gets a real, visible keyboard-focus style', () => {
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  for (const selector of [
    'internal-nav-workqueue-trigger:focus-visible',
    'internal-nav-workqueue-item:focus-visible',
    'internal-nav-add:focus-visible',
    'internal-nav-signout:focus-visible',
  ]) {
    assert.match(css, new RegExp(selector + '[^{]*\\{[^}]*outline: 2px solid var\\(--border-focus\\)'));
  }
});

test('structural safety net: no photo, illustration or new image asset, only inline SVG', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.doesNotMatch(source, /<img\b|next\/image|\.jpg|\.png|\.webp/i);
  assert.match(source, /<svg/);
});

test('structural safety net: InternalNav renders the one shared ThemeToggle and keeps its own theme logic out', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /import ThemeToggle from '@\/src\/components\/ThemeToggle'/);
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /data-theme|bredaeats_theme|prefers-color-scheme|localStorage/);
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  assert.match(css, /\.internal-nav-actions \.theme-btn,\r?\n\.internal-nav-workqueue-actions \.theme-btn \{ color: var\(--text-secondary\); \}/);
  assert.match(css, /\.internal-nav-actions \.theme-btn\.active,\r?\n\.internal-nav-workqueue-actions \.theme-btn\.active \{ color: var\(--accent\); \}/);
});

test('structural safety net: the theme contract itself stays as decided (explicit Licht/Donker, dark when nothing is stored)', () => {
  const layout = fs.readFileSync(path.join(REPO_ROOT, 'app/layout.js'), 'utf8');
  assert.match(layout, /else\{document\.documentElement\.setAttribute\('data-theme','dark'\);localStorage\.setItem\('bredaeats_theme','dark'\);\}/);
  assert.equal((layout.match(/prefers-color-scheme/g) || []).length, 1);
  const toggle = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ThemeToggle.js'), 'utf8');
  assert.match(toggle, /\{ value: 'light', label: 'Licht' \}/);
  assert.match(toggle, /\{ value: 'dark', label: 'Donker' \}/);
  assert.doesNotMatch(toggle, /value: 'system'/);
});

// --- Structural safety net: /internal redirects by the one rule ---

test('structural safety net: /internal is no longer a tile page, it resolves roles and counts and replaces the route', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(source, /resolveLandingHref\(roles, counts\)/);
  assert.match(source, /router\.replace\(href\)/);
  assert.match(source, /\/api\/internal\/v1\/workqueue-counts/);
  assert.doesNotMatch(source, /modules\.map|gridTemplateColumns/, 'the module tile grid must be gone');
  assert.doesNotMatch(source, /<InternalNav/, 'the redirect page never flashes the bar');
});

test('structural safety net: /internal keeps the unchanged session gate and never queries a table directly', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(source, /getSupabaseBrowser\(\)/);
  assert.match(source, /\.auth\.getSession\(\)/);
  assert.match(source, /router\.replace\('\/internal\/login'\)/);
  assert.match(source, /\/api\/internal\/v1\/me/);
  assert.doesNotMatch(source, /\.from\(['"]/);
});

test('structural safety net: /internal keeps the no-access status and sends an owner-only account on by the tested rule', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  const withoutComments = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  // BE-47 (#111, criterium 5): de owner-only doorsturing komt uit de geteste
  // regel in src/lib/ownerAccess.js; de oude regel "Nog niets te openen" bestaat
  // niet meer en er wordt geen andere bestemming verzonnen.
  assert.match(withoutComments, /resolveInternalOwnerRedirect\(roles\)/);
  assert.match(withoutComments, /router\.replace\(ownerHref\)/);
  // BE-37 (#89): de interne statuspagina is Nederlands, net als de navigatie.
  assert.match(withoutComments, /Dit account heeft geen interne toegang\./);
  assert.doesNotMatch(withoutComments, /Nog niets te openen/);
  assert.match(withoutComments, /signOut/);
  assert.doesNotMatch(withoutComments, /<a\s/, 'no clickable invented owner or module destination on the status page');
});

// --- Structural safety net: login uses the same landing rule ---

test('structural safety net: a successful sign-in uses resolveLandingAfterSignIn and never a hardcoded module or tile page', () => {
  const source = fs.readFileSync(LOGIN_PAGE_PATH, 'utf8');
  assert.match(source, /import \{ resolveLandingAfterSignIn \} from '@\/src\/lib\/internalLandingClient'/);
  assert.match(source, /const href = await resolveLandingAfterSignIn\(/);
  assert.match(source, /router\.replace\(href \|\| '\/internal'\)/);
  assert.doesNotMatch(source, /router\.push\('\/internal\/moderation'\)/);
  assert.doesNotMatch(source, /router\.push\('\/internal'\)/);
});

// --- Structural safety net: the one add entry ---

test('structural safety net: the add page is one form with the existing restaurant search and URL input, under the shared nav', () => {
  const source = fs.readFileSync(ADD_PAGE_PATH, 'utf8');
  assert.match(source, /import InternalNav from '@\/src\/components\/InternalNav'/);
  assert.match(source, /<InternalNav accessToken=\{session\.access_token\} \/>/);
  assert.match(source, /\/api\/internal\/v1\/manual-menu-import\/restaurants/);
  assert.match(source, /decideAddEntry\(\{ restaurant, urls \}\)/);
  assert.match(source, /manualImportHref\(selectedRestaurant\)/);
  assert.match(source, /Restaurant of menu toevoegen/);
  assert.match(source, /Liever zelf invoeren of plakken/);
  assert.match(source, /getSupabaseBrowser\(\)/);
  assert.match(source, /\.auth\.getSession\(\)/);
  assert.doesNotMatch(source, /\.from\(['"]/, 'the page never queries Supabase directly');
});

test('structural safety net: the add page reuses the existing analysis and onboarding routes and starts nothing else', () => {
  const source = fs.readFileSync(ADD_PAGE_PATH, 'utf8');
  assert.match(source, /const BATCH_API = '\/api\/internal\/v1\/batch-analysis'/);
  assert.match(source, /method: 'POST'/);
  assert.match(source, /router\.push\(decision\.href\)/);
  // BE-31 (#74): the result stays under the form as the same rows; the batch
  // screen is only the fallback link, never a forced destination.
  assert.match(source, /await loadBatch\(body\.batch\.id\)/);
  assert.match(source, /SourceResultRow/);
  assert.match(source, /setFallbackHref\(decision\.href\)/);
  // BE-33 (#79): the page only *reads* the existing AI status, because the
  // image/scan row may offer "Lees met AI (afbeelding)" only when AI can read
  // it. It never calls the AI reading route and starts nothing by itself.
  assert.match(source, /const AI_API = '\/api\/internal\/v1\/menu-ai-import'/);
  assert.doesNotMatch(source, /method:\s*'POST'[\s\S]{0,200}AI_API/);
  assert.doesNotMatch(source, /fetch\(AI_API,\s*\{[^}]*method/);
});

test('structural safety net: the batch page accepts the prefill without starting anything by itself', () => {
  const source = fs.readFileSync(BATCH_PAGE_PATH, 'utf8');
  assert.match(source, /const prefill = params\.get\('urls'\)/);
  assert.match(source, /setText\(prefill\)/);
  assert.match(source, /setShowInput\(true\)/);
});

// --- Structural safety net: the read-only routes and the other pages ---

test('structural safety net: GET /api/internal/v1/me still reuses authenticateInternalRequest exactly', () => {
  const source = fs.readFileSync(ME_ROUTE_PATH, 'utf8');
  assert.match(source, /import \{ authenticateInternalRequest \} from '@\/src\/lib\/internalAuth'/);
  assert.match(source, /authenticateInternalRequest\(request\)/);
  assert.doesNotMatch(source, /\.from\(['"]staff_roles['"]\)/);
  assert.match(source, /auth\.status === 403/);
  assert.match(source, /roles:\s*\[\]/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/);
});

test('structural safety net: the counts route exists next to the roles route, authenticated and read-only', () => {
  assert.equal(fs.existsSync(COUNT_ROUTE_PATH), true);
  const source = fs.readFileSync(COUNT_ROUTE_PATH, 'utf8');
  assert.match(source, /authenticate: authenticateInternalRequest/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/);
});

test('structural safety net: the existing internal pages still mount the shared nav and keep their own data calls and content', () => {
  const cases = [
    { file: COVERAGE_PAGE_PATH, mustStillContain: [/\/api\/internal\/v1\/coverage/, /Dekking/] },
    { file: IMPORT_INBOX_PAGE_PATH, mustStillContain: [/\/api\/internal\/v1\/import-inbox\/candidates/, /di-topbar/] },
    { file: PROFILE_DRAFTS_PAGE_PATH, mustStillContain: [/\/api\/internal\/v1\/profile-drafts/, /Restaurant Profile Drafts/] },
    { file: MODERATION_PAGE_PATH, mustStillContain: [/\/api\/internal\/v1\/moderation\/pending/, /\/api\/internal\/v1\/claims\/pending/] },
  ];
  for (const item of cases) {
    const source = fs.readFileSync(item.file, 'utf8');
    assert.match(source, /import InternalNav from ['"]@\/src\/components\/InternalNav['"]/);
    assert.match(source, /<InternalNav\s+accessToken=\{session\.access_token\}\s*\/>/);
    for (const pattern of item.mustStillContain) assert.match(source, pattern, item.file + ' must keep ' + pattern);
  }
});

test('structural safety net: app/internal/layout.js keeps its existing noindex metadata unchanged', () => {
  const source = fs.readFileSync(LAYOUT_PATH, 'utf8');
  assert.match(source, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
});
