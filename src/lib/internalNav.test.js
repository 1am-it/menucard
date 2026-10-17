'use strict';

// PLATFORM-11 — role-aware internal navigation (Phase 1/2: /internal home
// + shared nav shell + decided login redirect). Unit tests for the pure
// decision logic in src/lib/internalNav.js, plus structural safety-net
// tests (fs.readFileSync + regex, this project's existing convention —
// see src/lib/importInbox.test.js/src/lib/restaurantProfileDrafts.test.js)
// for the new/modified files this ticket's Phase 1/2 touches.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  isEditorRole,
  isOwnerRole,
  hasAnyKnownRole,
  INTERNAL_MODULES,
  resolveVisibleModules,
  groupModulesByPlacement,
  isCurrentModule,
} = require('./internalNav');

const REPO_ROOT = path.join(__dirname, '..', '..');
const INTERNAL_HOME_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/page.js');
const LOGIN_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/login/page.js');
const ME_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/me/route.js');
const NAV_COMPONENT_PATH = path.join(REPO_ROOT, 'src/components/InternalNav.js');
const GLOBALS_CSS_PATH = path.join(REPO_ROOT, 'app/globals.css');
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

test('isEditorRole: false for internal-only, owner-only, or no roles at all', () => {
  assert.equal(isEditorRole([{ role: 'internal' }]), false);
  assert.equal(isEditorRole([{ role: 'owner', restaurant_id: '6' }]), false);
  assert.equal(isEditorRole([]), false);
});

test('isEditorRole: never throws on malformed input', () => {
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

test('hasAnyKnownRole: true for any of internal/editor/owner, false for zero rows or unrecognized values', () => {
  assert.equal(hasAnyKnownRole([{ role: 'internal' }]), true);
  assert.equal(hasAnyKnownRole([{ role: 'editor' }]), true);
  assert.equal(hasAnyKnownRole([{ role: 'owner', restaurant_id: '6' }]), true);
  assert.equal(hasAnyKnownRole([]), false);
  assert.equal(hasAnyKnownRole(null), false);
  assert.equal(hasAnyKnownRole(undefined), false);
  // Defensive case: the `staff_roles.role` check constraint should already
  // prevent this, but the nav must still treat it as "no usable role,"
  // never throw or silently unlock a module.
  assert.equal(hasAnyKnownRole([{ role: 'something-else' }]), false);
});

// ─── resolveVisibleModules — the route/role matrix, enforced in code ───

test('resolveVisibleModules: an internal-only account sees the primary, work, Beheer and contextual modules — not Beoordelen (editor-only)', () => {
  const ids = resolveVisibleModules([{ role: 'internal' }]).map((m) => m.id);
  assert.deepEqual(ids.sort(), ['coverage', 'import-inbox', 'manage', 'menu-concepts', 'new-import', 'onboarding-restaurant', 'profile-drafts', 'source-triage', 'source-workqueue', 'workqueue']);
});

test('resolveVisibleModules: an editor-only account sees Werkvoorraad (with Beoordelen) and Beheer — no internal-only module, no Nieuwe import', () => {
  const ids = resolveVisibleModules([{ role: 'editor' }]).map((m) => m.id);
  assert.deepEqual(ids, ['workqueue', 'manage', 'moderation']);
});

test('resolveVisibleModules: an owner-only account sees zero modules — no invented destination', () => {
  assert.deepEqual(resolveVisibleModules([{ role: 'owner', restaurant_id: '6' }]), []);
});

test('resolveVisibleModules: an account with no roles at all sees zero modules', () => {
  assert.deepEqual(resolveVisibleModules([]), []);
  assert.deepEqual(resolveVisibleModules(null), []);
});

test('resolveVisibleModules: a multi-role (internal + editor) account sees the full union, not just one role\'s subset', () => {
  const ids = resolveVisibleModules([{ role: 'internal' }, { role: 'editor' }]).map((m) => m.id).sort();
  assert.deepEqual(ids, ['coverage', 'import-inbox', 'manage', 'menu-concepts', 'moderation', 'new-import', 'onboarding-restaurant', 'profile-drafts', 'source-triage', 'source-workqueue', 'workqueue']);
});

test('resolveVisibleModules: every entry links to an existing internal route with a non-empty label, a recognized required role and placement', () => {
  for (const m of INTERNAL_MODULES) {
    assert.match(m.href, /^\/internal(\/|$)/);
    assert.ok(m.label.length > 0);
    assert.ok(['internal', 'editor', 'staff'].includes(m.requiredRole));
    assert.ok(['primary', 'work', 'beheer', 'contextual'].includes(m.placement), `${m.id} must have a recognized placement`);
    assert.ok(typeof m.subtitle === 'string' && m.subtitle.length > 0, `${m.id} must have a subtitle`);
  }
});

test('resolveVisibleModules: onboarding-menu is no nav module at all', () => {
  assert.ok(!INTERNAL_MODULES.some((m) => m.id === 'onboarding-menu'));
});

// ─── groupModulesByPlacement — Werkvoorraad | Nieuwe import | Beheer ───

test('primary navigation is exactly Werkvoorraad, Nieuwe import, Beheer — in that order, with the decided routes', () => {
  const { primary } = groupModulesByPlacement(resolveVisibleModules([{ role: 'internal' }]));
  assert.deepEqual(primary.map((m) => [m.label, m.href]), [
    ['Werkvoorraad', '/internal/workqueue'],
    ['Nieuwe import', '/internal/nieuwe-import'],
    ['Beheer', '/internal'],
  ]);
});

test('Onboarding Restaurant is contextual: never in the primary navigation and never a Beheer card', () => {
  const grouped = groupModulesByPlacement(resolveVisibleModules([{ role: 'internal' }, { role: 'editor' }]));
  for (const list of [grouped.primary, grouped.beheer]) {
    assert.ok(!list.some((m) => m.id === 'onboarding-restaurant'));
  }
  const entry = INTERNAL_MODULES.find((m) => m.id === 'onboarding-restaurant');
  assert.equal(entry.placement, 'contextual');
  assert.equal(entry.href, '/internal/onboarding-restaurant', 'the existing route stays');
});

test('Werkvoorraad lists the daily action queues with their existing destinations; Nieuwe import is not duplicated there', () => {
  const { work } = groupModulesByPlacement(resolveVisibleModules([{ role: 'internal' }, { role: 'editor' }]));
  assert.deepEqual(work.map((m) => [m.label, m.href]), [
    ['Bronwerkvoorraad', '/internal/source-workqueue'],
    ['Nieuwe aanleveringen', '/internal/import-inbox'],
    ['Bronnen beoordelen', '/internal/source-triage'],
    ['Menuconcepten beoordelen', '/internal/menu-concepts'],
    ['Profielconcepten', '/internal/profile-drafts'],
    ['Beoordelen', '/internal/moderation'],
  ]);
  assert.ok(!work.some((m) => m.id === 'new-import'));
});

test('Werkvoorraad is role-aware: internal-only never sees Beoordelen; editor-only sees only Beoordelen', () => {
  const internal = groupModulesByPlacement(resolveVisibleModules([{ role: 'internal' }])).work.map((m) => m.id);
  assert.ok(!internal.includes('moderation'));
  const editor = groupModulesByPlacement(resolveVisibleModules([{ role: 'editor' }])).work.map((m) => m.id);
  assert.deepEqual(editor, ['moderation']);
});

test('Beheer lists only overview, history and reference modules — no daily review queue', () => {
  const { beheer } = groupModulesByPlacement(resolveVisibleModules([{ role: 'internal' }, { role: 'editor' }]));
  assert.deepEqual(beheer.map((m) => m.id), ['coverage']);
  const editorOnly = groupModulesByPlacement(resolveVisibleModules([{ role: 'editor' }])).beheer;
  assert.deepEqual(editorOnly, []);
});

test('groupModulesByPlacement: an internal-only account never sees Beoordelen — role boundaries hold through the grouping step too', () => {
  const { primary, work, beheer } = groupModulesByPlacement(resolveVisibleModules([{ role: 'internal' }]));
  assert.ok(![...primary, ...work, ...beheer].some((m) => m.id === 'moderation'));
});

test('groupModulesByPlacement: an editor-only account gets Werkvoorraad and Beheer as primary items', () => {
  const { primary } = groupModulesByPlacement(resolveVisibleModules([{ role: 'editor' }]));
  assert.deepEqual(primary.map((m) => m.id), ['workqueue', 'manage']);
});

test('groupModulesByPlacement: empty or non-array input yields empty groups', () => {
  assert.deepEqual(groupModulesByPlacement([]), { primary: [], work: [], beheer: [] });
  assert.deepEqual(groupModulesByPlacement(null), { primary: [], work: [], beheer: [] });
  assert.deepEqual(groupModulesByPlacement(undefined), { primary: [], work: [], beheer: [] });
});

test('isCurrentModule: old routes keep orienting on the right primary item; the most specific item wins', () => {
  const byId = (id) => INTERNAL_MODULES.find((m) => m.id === id);
  const primary = INTERNAL_MODULES.filter((m) => m.placement === 'primary');
  const current = (pathname) => primary.filter((m) => isCurrentModule(pathname, m, primary)).map((m) => m.id);
  assert.deepEqual(current('/internal'), ['manage']);
  assert.deepEqual(current('/internal/workqueue'), ['workqueue']);
  assert.deepEqual(current('/internal/source-workqueue'), ['workqueue']);
  assert.deepEqual(current('/internal/moderation'), ['workqueue']);
  assert.deepEqual(current('/internal/source-triage'), ['workqueue']);
  assert.deepEqual(current('/internal/onboarding-restaurant'), ['workqueue']);
  assert.deepEqual(current('/internal/nieuwe-import'), ['new-import']);
  assert.deepEqual(current('/internal/source-triage/batch'), ['new-import']);
  assert.deepEqual(current('/internal/coverage'), ['manage']);
  assert.deepEqual(current('/internal/login'), []);
  assert.equal(isCurrentModule(null, byId('manage'), primary), false);
});

// ─── Structural safety net: /internal home page ────────────────────────

test('structural safety net: /internal exists and gates on a signed-in session only, matching every other internal page\'s pattern', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(source, /getSupabaseBrowser\(\)\.auth\.getSession\(\)/, 'must use the same session-check pattern as every other internal page');
  assert.match(source, /router\.replace\(['"]\/internal\/login['"]\)/, 'an unauthenticated visitor must be redirected to /internal/login');
  assert.doesNotMatch(source, /isInternalOnly|isEditorRole/, 'the page itself must not gate on a specific role — /internal is session-gated only, per PLATFORM-11\'s decided matrix row');
});

test('structural safety net: /internal resolves roles via the shared, read-only /api/internal/v1/me endpoint — no direct Supabase staff_roles query from the browser', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(source, /\/api\/internal\/v1\/me/);
  assert.doesNotMatch(source, /\.from\(['"]/, 'must never query a Supabase table directly from the browser');
});

test('structural safety net: /internal passes its own already-resolved roles into InternalNav — never a second, independent fetch racing the page\'s own one', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(
    source,
    /<InternalNav\s+accessToken=\{session\.access_token\}\s+roles=\{roles\}\s*\/>/,
    'expected <InternalNav accessToken={session.access_token} roles={roles} /> — passing the page\'s own resolved roles down'
  );
});

test('structural safety net: /internal shows an explicit "no internal access" status with sign out as its only action when no usable role is present', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(source, /hasAnyKnownRole/, 'must use the shared, tested role classifier — never a separately re-implemented check');
  assert.match(source, /no internal access/i);
  assert.match(source, /signOut/);
});

test('structural safety net: /internal renders InternalNav only when the no-access status is not shown, so a role-less account never sees the nav\'s own "Internal" link or sign out alongside the status box\'s one action', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(
    source,
    /\{!showNoAccessStatus && <InternalNav\s+accessToken=\{session\.access_token\}\s+roles=\{roles\}\s*\/>\}/,
    'InternalNav must be conditionally gated on !showNoAccessStatus, not rendered unconditionally'
  );
  assert.match(source, /showNoAccessStatus = noAccess && !error/);
});

test('structural safety net: /internal never invents an owner destination — the owner section is worded as not-yet-available, not a link', () => {
  const source = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(source, /isOwnerRole/);
  const ownerBlockMatch = source.match(/\{showOwnerSection && \([\s\S]*?\n {10}\)\}/);
  assert.ok(ownerBlockMatch, 'expected to find the conditionally-rendered owner section block');
  assert.doesNotMatch(ownerBlockMatch[0], /<a\s/, 'the owner section must never render as a clickable link to an invented page');
  assert.match(ownerBlockMatch[0], /not.*yet|nothing.*yet/i, 'must plainly say there is nothing to open yet, never imply a real destination');
});

// ─── Structural safety net: decided login redirect ─────────────────────

test('structural safety net: /internal/login redirects every successful sign-in to /internal — never hardcoded to /internal/moderation', () => {
  const source = fs.readFileSync(LOGIN_PAGE_PATH, 'utf8');
  assert.match(source, /router\.push\(['"]\/internal['"]\)/, 'must redirect to /internal, per PLATFORM-11\'s decided design (Design decision #1)');
  assert.doesNotMatch(source, /router\.push\(['"]\/internal\/moderation['"]\)/, 'the old hardcoded, role-blind redirect must be fully gone');
});

// ─── Structural safety net: /api/internal/v1/me ────────────────────────

test('structural safety net: GET /api/internal/v1/me reuses authenticateInternalRequest exactly — no second, parallel way to resolve staff_roles', () => {
  const source = fs.readFileSync(ME_ROUTE_PATH, 'utf8');
  assert.match(source, /import \{ authenticateInternalRequest \} from ['"]@\/src\/lib\/internalAuth['"]/);
  assert.match(source, /authenticateInternalRequest\(request\)/);
  assert.doesNotMatch(source, /\.from\(['"]staff_roles['"]\)/, 'must never issue its own staff_roles query — that stays exclusively inside authenticateInternalRequest');
});

test('structural safety net: GET /api/internal/v1/me turns a zero-role account\'s 403 into a normal 200 with an empty roles array — a valid session with no staff_roles row is not an API error for navigation purposes', () => {
  const source = fs.readFileSync(ME_ROUTE_PATH, 'utf8');
  assert.match(source, /auth\.status === 403/);
  assert.match(source, /roles:\s*\[\]/);
});

test('structural safety net: GET /api/internal/v1/me never writes and never mutates any table', () => {
  const source = fs.readFileSync(ME_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/, 'must expose GET only');
});

// ─── Structural safety net: shared nav component ───────────────────────

test('structural safety net: InternalNav is keyboard/screen-reader reachable and reuses resolveVisibleModules — never a separately re-implemented module list', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /aria-label=["'][^"']*[Nn]avigation/);
  assert.match(source, /resolveVisibleModules/);
  assert.doesNotMatch(source, /\.from\(['"]/, 'must never query Supabase data directly from the browser');
});

test('structural safety net: InternalNav marks the active route with aria-current, and offers sign out', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /aria-current/);
  assert.match(source, /signOut|sign out/i);
});

test('structural safety net: InternalNav accepts an optional roles prop and skips its own fetch when the caller already resolved roles', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /roles:\s*rolesProp/, 'must destructure an optional roles prop');
  assert.match(source, /if \(rolesProp !== undefined\) return/, 'must skip its own fetch when the caller already provided roles');
});

// ─── Structural safety net: the compact three-item navigation (#53) ────

test('structural safety net: InternalNav renders the primary items as plain links from the shared module list — no disclosure panel', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /groupModulesByPlacement/);
  assert.match(source, /primary\.map/);
  assert.match(source, /className="internal-nav-link"[\s\S]{0,80}aria-current=\{isCurrentModule\(pathname, m, primary\)/);
  assert.doesNotMatch(source, /<details|<summary|role="menu"/);
});

test('structural safety net: no photo or image asset in the nav — inline SVG wordmark only', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.doesNotMatch(source, /<img\b|next\/image|\.jpg|\.png|\.webp/i);
});

test('structural safety net: nav links keep a visible keyboard-focus style, and the nav wraps instead of scrolling on narrow screens', () => {
  const cssSource = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  assert.match(cssSource, /internal-nav-link:focus-visible/);
  assert.match(cssSource, /\.internal-nav \{[^}]*flex-wrap: wrap/);
  assert.doesNotMatch(cssSource, /internal-nav-workqueue/);
});

test('structural safety net: /internal/workqueue shows concrete tasks (issue #53), is session-gated and uses the shared nav with its own roles', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'app/internal/workqueue/page.js'), 'utf8');
  assert.match(source, /buildWorkqueue\(/);
  assert.match(source, /resolveWorkqueueProviders\(/);
  // The first approved round explicitly replaces the module cards.
  assert.doesNotMatch(source, /groupModulesByPlacement|resolveVisibleModules/);
  assert.match(source, /router\.replace\(['"]\/internal\/login['"]\)/);
  assert.match(source, /\/api\/internal\/v1\/me/);
  assert.match(source, /<InternalNav\s+accessToken=\{session\.access_token\}\s+roles=\{roles\}\s*\/>/);
  assert.doesNotMatch(source, /\.from\(['"]/);
});

test('structural safety net: Beheer shows only the Beheer modules and /internal/nieuwe-import fronts the existing batch page', () => {
  const home = fs.readFileSync(INTERNAL_HOME_PAGE_PATH, 'utf8');
  assert.match(home, /groupModulesByPlacement\(resolveVisibleModules\(roles\)\)\.beheer/);
  const importPage = fs.readFileSync(path.join(REPO_ROOT, 'app/internal/nieuwe-import/page.js'), 'utf8');
  assert.match(importPage, /export \{ default \} from '\.\.\/source-triage\/batch\/page'/);
});

// ─── Structural safety net: existing pages adopt the shared nav shell,
// their own content/logic otherwise untouched ───────────────────────────

test('structural safety net: every existing internal page adopts the shared InternalNav shell without losing its own preserved content markers', () => {
  const cases = [
    // PLATFORM-12 Phase 1 (2026-10-04): the page title is now the calmer
    // "Coverage Dashboard" (city moved into the subtitle) — still the same
    // page, still the same BreakdownTable component.
    { file: COVERAGE_PAGE_PATH, mustStillContain: [/<h1[^>]*>Coverage Dashboard<\/h1>/, /\{data\.city\}/, /BreakdownTable/] },
    { file: IMPORT_INBOX_PAGE_PATH, mustStillContain: [/di-topbar/, /Dashboard imported Restaurant Data/] },
    { file: PROFILE_DRAFTS_PAGE_PATH, mustStillContain: [/di-topbar/, /Restaurant Profile Drafts/] },
    { file: MODERATION_PAGE_PATH, mustStillContain: [/Moderation queue/, /Owner claims/] },
  ];
  for (const { file, mustStillContain } of cases) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /import InternalNav from ['"]@\/src\/components\/InternalNav['"]/, `${file} must import the shared nav component`);
    assert.match(source, /<InternalNav\s+accessToken=\{session\.access_token\}\s*\/>/, `${file} must render <InternalNav accessToken={session.access_token} />`);
    for (const pattern of mustStillContain) {
      assert.match(source, pattern, `${file} must still contain its own preserved content: ${pattern}`);
    }
  }
});

test('structural safety net: Moderation, Import Inbox, and Restaurant Profile Drafts no longer carry their own separate sign-out action — InternalNav\'s is the one and only sign-out control on each page', () => {
  for (const file of [MODERATION_PAGE_PATH, IMPORT_INBOX_PAGE_PATH, PROFILE_DRAFTS_PAGE_PATH]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /function signOut/, `${file} must not define its own local signOut function`);
    assert.doesNotMatch(source, /di-signout/, `${file} must not render its own separate "Sign out" button`);
    assert.match(source, /import InternalNav from ['"]@\/src\/components\/InternalNav['"]/, `${file} must still render InternalNav, which is now the sole sign-out control`);
  }
});

test('structural safety net: adopting the nav shell changes no existing route\'s own API calls, data, or actions', () => {
  // The four pages keep calling exactly the same data endpoints they
  // always did — the nav shell is additive chrome, not a rewrite.
  assert.match(fs.readFileSync(COVERAGE_PAGE_PATH, 'utf8'), /\/api\/internal\/v1\/coverage/);
  assert.match(fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8'), /\/api\/internal\/v1\/import-inbox\/candidates/);
  assert.match(fs.readFileSync(PROFILE_DRAFTS_PAGE_PATH, 'utf8'), /\/api\/internal\/v1\/profile-drafts/);
  const moderationSource = fs.readFileSync(MODERATION_PAGE_PATH, 'utf8');
  assert.match(moderationSource, /\/api\/internal\/v1\/moderation\/pending/);
  assert.match(moderationSource, /\/api\/internal\/v1\/claims\/pending/);
});

test('structural safety net: app/internal/layout.js keeps its existing noindex metadata unchanged — PLATFORM-11 mounts the nav per-page, not via the layout', () => {
  const source = fs.readFileSync(LAYOUT_PATH, 'utf8');
  assert.match(source, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
});

// ─── Structural safety net: the shared theme toggle in the internal shell ──

const ROOT_LAYOUT_PATH = path.join(REPO_ROOT, 'app/layout.js');
const THEME_TOGGLE_PATH = path.join(REPO_ROOT, 'src/components/ThemeToggle.js');

test('structural safety net: InternalNav renders the one shared ThemeToggle — no internal copy and no internal theme logic', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /import ThemeToggle from '@\/src\/components\/ThemeToggle'/);
  assert.match(source, /<div className="internal-nav-theme">\s*<ThemeToggle \/>\s*<\/div>/);
  // The nav itself never touches the theme: no data-theme, storage key or media query.
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /data-theme|bredaeats_theme|prefers-color-scheme|localStorage/);
});

test('structural safety net: the theme toggle sits right before Sign out and keeps Sign out on the right', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.ok(source.indexOf('<ThemeToggle />') < source.indexOf('onClick={signOut}'), 'toggle before Sign out');
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  assert.match(css, /\.internal-nav-theme \{ margin-left: auto; display: flex; \}/);
  assert.match(css, /\.internal-nav-theme \+ \.internal-nav-signout \{ margin-left: 0; \}/);
  assert.match(css, /\.internal-nav-theme \.theme-btn:focus-visible \{ outline: 2px solid var\(--border-focus\)/);
  // Contrast of the inactive option inside the internal nav (measured below 4.5:1 with --text-muted).
  assert.match(css, /\.internal-nav-theme \.theme-btn \{ color: var\(--text-secondary\); \}/);
  // Active option uses the soft accent treatment (.theme-btn.active), so its text uses --accent.
  assert.match(css, /\.internal-nav-theme \.theme-btn\.active \{ color: var\(--accent\); \}/);
});

test('structural safety net: the theme contract stays as decided — explicit Licht/Donker choice, dark when nothing is stored, no OS-preference following', () => {
  const layout = fs.readFileSync(ROOT_LAYOUT_PATH, 'utf8');
  // No stored choice resolves to dark (decision 006); only the one-time
  // migration of a legacy stored 'system' value reads the OS preference (BE-09).
  assert.match(layout, /else\{document\.documentElement\.setAttribute\('data-theme','dark'\);localStorage\.setItem\('bredaeats_theme','dark'\);\}/);
  assert.equal((layout.match(/prefers-color-scheme/g) || []).length, 1, 'only the legacy "system" migration reads the OS preference');
  assert.match(layout, /else if\(t==='system'\)\{var r=\(window\.matchMedia&&window\.matchMedia\('\(prefers-color-scheme: light\)'\)\.matches\)/);
  const toggle = fs.readFileSync(THEME_TOGGLE_PATH, 'utf8');
  assert.match(toggle, /\{ value: 'light', label: 'Licht' \}/);
  assert.match(toggle, /\{ value: 'dark', label: 'Donker' \}/);
  assert.doesNotMatch(toggle, /value: 'system'/);
});

// ─── BE-24 Brontriage ──────────────────────────────────────────────────

test('Bronnen beoordelen and Menuconcepten beoordelen stay internal-only Werkvoorraad entries, without a count', () => {
  for (const [id, href] of [['source-triage', '/internal/source-triage'], ['menu-concepts', '/internal/menu-concepts']]) {
    const entry = INTERNAL_MODULES.find((m) => m.id === id);
    assert.equal(entry.href, href);
    assert.equal(entry.requiredRole, 'internal');
    assert.equal(entry.placement, 'work');
    assert.ok(!('count' in entry) && !('badge' in entry));
    assert.ok(!resolveVisibleModules([{ role: 'editor' }]).some((m) => m.id === id));
    assert.ok(!resolveVisibleModules([{ role: 'owner', restaurant_id: '1' }]).some((m) => m.id === id));
  }
});
