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

test('resolveVisibleModules: an internal-only account sees exactly Dekkingsoverzicht, Onboarding Restaurant, Beheer, Nieuwe aanleveringen, and Profielconcepten — not Beoordelen (editor-only)', () => {
  const modules = resolveVisibleModules([{ role: 'internal' }]);
  const ids = modules.map((m) => m.id);
  assert.deepEqual(ids.sort(), ['coverage', 'import-inbox', 'manage', 'onboarding-restaurant', 'profile-drafts']);
});

test('resolveVisibleModules: an editor-only account sees exactly Beoordelen (moderation) — not any internal-only module', () => {
  const modules = resolveVisibleModules([{ role: 'editor' }]);
  assert.deepEqual(modules.map((m) => m.id), ['moderation']);
});

test('resolveVisibleModules: an owner-only account sees zero modules — no invented destination', () => {
  assert.deepEqual(resolveVisibleModules([{ role: 'owner', restaurant_id: '6' }]), []);
});

test('resolveVisibleModules: an account with no roles at all sees zero modules', () => {
  assert.deepEqual(resolveVisibleModules([]), []);
  assert.deepEqual(resolveVisibleModules(null), []);
});

test('resolveVisibleModules: a multi-role (internal + editor) account sees the full union, not just one role\'s subset', () => {
  const modules = resolveVisibleModules([{ role: 'internal' }, { role: 'editor' }]);
  const ids = modules.map((m) => m.id).sort();
  assert.deepEqual(ids, ['coverage', 'import-inbox', 'manage', 'moderation', 'onboarding-restaurant', 'profile-drafts']);
});

test('resolveVisibleModules: every entry links to an existing internal route with a non-empty label and a recognized required role', () => {
  for (const m of INTERNAL_MODULES) {
    assert.match(m.href, /^\/internal(\/|$)/);
    assert.ok(m.label.length > 0);
    assert.ok(['internal', 'editor'].includes(m.requiredRole));
    assert.ok(['primary', 'workqueue'].includes(m.placement), `${m.id} must have a recognized placement`);
  }
});

test('resolveVisibleModules: onboarding-menu is no longer a nav module at all — reachable only from within the Onboarding Restaurant page\'s own content, not the shared nav, for any role', () => {
  const internalIds = resolveVisibleModules([{ role: 'internal' }]).map((m) => m.id);
  const editorIds = resolveVisibleModules([{ role: 'editor' }]).map((m) => m.id);
  assert.ok(!internalIds.includes('onboarding-menu'));
  assert.ok(!editorIds.includes('onboarding-menu'));
  assert.ok(!INTERNAL_MODULES.some((m) => m.id === 'onboarding-menu'));
});

// ─── groupModulesByPlacement — the primary/Werkvoorraad split ──────────

test('groupModulesByPlacement: splits Dekkingsoverzicht and Onboarding Restaurant into primary, everything else into workqueue', () => {
  const modules = resolveVisibleModules([{ role: 'internal' }, { role: 'editor' }]);
  const { primary, workqueue } = groupModulesByPlacement(modules);
  assert.deepEqual(primary.map((m) => m.id), ['coverage', 'onboarding-restaurant']);
  assert.deepEqual(workqueue.map((m) => m.id), ['manage', 'import-inbox', 'profile-drafts', 'moderation']);
});

test('groupModulesByPlacement: an internal-only account never sees Beoordelen in the workqueue group — role boundaries hold through the grouping step too', () => {
  const modules = resolveVisibleModules([{ role: 'internal' }]);
  const { workqueue } = groupModulesByPlacement(modules);
  assert.ok(!workqueue.some((m) => m.id === 'moderation'), 'an internal-only account must never see the editor-only Beoordelen entry');
});

test('groupModulesByPlacement: both groups are empty for a role with no visible modules — never a default/fallback placement', () => {
  assert.deepEqual(groupModulesByPlacement([]), { primary: [], workqueue: [] });
});

test('groupModulesByPlacement: never throws and returns empty groups for non-array input', () => {
  assert.deepEqual(groupModulesByPlacement(null), { primary: [], workqueue: [] });
  assert.deepEqual(groupModulesByPlacement(undefined), { primary: [], workqueue: [] });
});

test('groupModulesByPlacement: every workqueue module carries a non-empty subtitle for the Werkvoorraad panel', () => {
  const { workqueue } = groupModulesByPlacement(INTERNAL_MODULES);
  for (const m of workqueue) {
    assert.ok(typeof m.subtitle === 'string' && m.subtitle.length > 0, `${m.id} must have a subtitle`);
  }
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

// ─── Structural safety net: the Werkvoorraad disclosure (BE-20) ────────

test('structural safety net: Werkvoorraad reuses groupModulesByPlacement and renders both the top-level primary links and the grouped items — never a second, separately re-implemented module list', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /groupModulesByPlacement/);
  assert.match(source, /primary\.map/);
  assert.match(source, /workqueue\.map/);
});

test('structural safety net: Werkvoorraad is a native <details>/<summary> disclosure — real keyboard/click toggling for free, never a hover-only or purely CSS-driven menu', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /<details[^>]*className="internal-nav-workqueue"/);
  assert.match(source, /<summary[^>]*className="internal-nav-workqueue-trigger"/);
  assert.doesNotMatch(source, /:hover\s*\{[^}]*display/, 'must never rely on a CSS :hover rule to open the menu');
  const cssSource = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  const workqueueCss = cssSource.slice(cssSource.indexOf('.internal-nav-workqueue'));
  assert.doesNotMatch(workqueueCss.slice(0, 3000), /:hover[^{]*\{[^}]*(display|opacity|visibility)/, 'the Werkvoorraad panel must never open on hover alone');
});

test('structural safety net: Werkvoorraad closes on Escape and restores focus to its own trigger — never leaves focus stranded on a hidden panel', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  const fnStart = source.indexOf('function handleKeyDown')
  const fnBody = source.slice(fnStart, source.indexOf('\n    }', fnStart))
  assert.match(fnBody, /event\.key !== 'Escape'/)
  assert.match(fnBody, /details\.open = false/)
  assert.match(fnBody, /summary\.focus\(\)/)
});

test('structural safety net: Werkvoorraad closes on an outside click — checks containment before closing, never closes on a click inside its own panel', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  const fnStart = source.indexOf('function handleClickOutside')
  const fnBody = source.slice(fnStart, source.indexOf('\n    }', fnStart))
  assert.match(fnBody, /!details\.contains\(event\.target\)/)
});

test('structural safety net: Werkvoorraad closes on every route change, so a client-side navigation from inside the panel never leaves it stuck open', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /workqueueRef\.current\.open = false/);
  assert.match(source, /\}, \[pathname\]\)/);
});

test('structural safety net: every workqueue item marks the active route with aria-current, matching the existing primary-link pattern exactly', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.match(source, /className="internal-nav-workqueue-item"[\s\S]{0,120}aria-current=\{pathname === m\.href \? 'page' : undefined\}/);
});

test('structural safety net: no photo, illustration, or new image asset — the wordmark and workqueue icons are inline SVG only', () => {
  const source = fs.readFileSync(NAV_COMPONENT_PATH, 'utf8');
  assert.doesNotMatch(source, /<img\b|next\/image|\.jpg|\.png|\.webp/i);
  assert.match(source, /<svg/);
});

test('structural safety net: every new interactive element gets a real, visible keyboard-focus style, not only a browser default', () => {
  const cssSource = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  assert.match(cssSource, /internal-nav-workqueue-trigger:focus-visible/);
  assert.match(cssSource, /internal-nav-workqueue-item:focus-visible/);
});

test('structural safety net: the Werkvoorraad panel never causes page-level horizontal overflow on a narrow viewport — constrained width plus a static, full-width fallback below 420px', () => {
  const cssSource = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  assert.match(cssSource, /max-width:\s*min\(320px,\s*calc\(100vw - 32px\)\)/);
  const narrowBlocks = cssSource.match(/@media \(max-width: 420px\) \{[\s\S]*?\n\}/g) || [];
  const workqueueNarrowBlock = narrowBlocks.find((block) => block.includes('.internal-nav-workqueue-panel'));
  assert.ok(workqueueNarrowBlock, 'expected a max-width: 420px media query block covering .internal-nav-workqueue-panel');
  assert.match(workqueueNarrowBlock, /\.internal-nav-workqueue-panel\s*\{[^}]*position:\s*static/);
});

// ─── Structural safety net: existing pages adopt the shared nav shell,
// their own content/logic otherwise untouched ───────────────────────────

test('structural safety net: every existing internal page adopts the shared InternalNav shell without losing its own preserved content markers', () => {
  const cases = [
    { file: COVERAGE_PAGE_PATH, mustStillContain: [/MenuCard — \{data\.city\} Coverage Dashboard/, /BreakdownTable/] },
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
