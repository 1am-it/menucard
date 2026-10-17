'use strict';

// Issue #53 — Werkvoorraad task model. Unit tests for the pure decision
// logic in src/lib/internalWorkqueue.js, plus structural safety-net tests
// (fs.readFileSync + regex, this project's existing convention) for the
// page and the legacy-screen deep-link adapters this round adds.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  WORKQUEUE_PROVIDERS,
  resolveWorkqueueProviders,
  buildWorkqueue,
} = require('./internalWorkqueue');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKQUEUE_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/workqueue/page.js');
const SOURCE_WORKQUEUE_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/source-workqueue/page.js');
const SOURCE_TRIAGE_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/source-triage/page.js');
const IMPORT_INBOX_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/import-inbox/page.js');
const PROFILE_DRAFTS_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/profile-drafts/page.js');
const MODERATION_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/moderation/page.js');

const INTERNAL = [{ role: 'internal' }];
const EDITOR = [{ role: 'editor' }];
const BOTH = [{ role: 'internal' }, { role: 'editor' }];
const OWNER = [{ role: 'owner', restaurant_id: '23' }];

function baseProviders(overrides = {}) {
  return {
    'source-workqueue': { ok: true, data: { rows: [], counts: { total: 0 } } },
    'source-triage': { ok: true, data: { restaurants: [], proposals_available: true } },
    'menu-concepts': { ok: true, data: { items: [] } },
    'profile-drafts': { ok: true, data: { drafts: [] } },
    'import-candidates': { ok: true, data: { candidates: [] } },
    moderation: { ok: true, data: { items: [] } },
    claims: { ok: true, data: { items: [] } },
    ...overrides,
  };
}

function build(roles, providers) {
  return buildWorkqueue({ roles, providers });
}

const menuItem = {
  id: 'concept-1',
  restaurantId: 23,
  restaurantName: 'Bistro Linde',
  menuContext: 'Lunch',
  version: 2,
  status: 'waiting',
  dishCount: 27,
  attentionCount: 2,
  blockerCount: 0,
  createdAt: '2026-10-16T09:00:00Z',
};

const sourceRow = {
  restaurant_id: 24,
  name: 'Brasserie Haven',
  wijk: 'Centrum',
  domain: 'brasserie-haven.example',
  source: 'unreachable',
  menu: 'not_assessed',
  action: 'check_source',
  queue: 'source',
  priority: 1,
  checked_at: '2026-10-15T08:00:00Z',
};

const proposalEntry = {
  restaurant_id: 25,
  name: 'Eethuis De Kade',
  domain: 'eethuis-de-kade.example',
  proposals_known: true,
  open_proposal_id: 'proposal-1',
  proposals: [
    {
      id: 'proposal-1',
      kind: 'replace_source',
      status: 'open',
      proposed_at: '2026-10-14T10:00:00Z',
    },
  ],
};

const candidate = {
  id: 'candidate-1',
  import_run_id: 'run-1',
  review_status: 'new',
  quality_status: 'incomplete',
  missing_fields: ['phone'],
  possible_duplicate: false,
  extracted_fields: { name: 'Café Park', category: 'cafe' },
  created_at: '2026-10-13T12:00:00Z',
};

const draft = {
  id: 'draft-1',
  status: 'draft',
  candidate_name: 'Café Park',
  source_candidate_id: 'candidate-2',
  promoted_at: '2026-10-12T09:00:00Z',
};

test('resolveWorkqueueProviders: internal and editor each get only their own providers', () => {
  assert.deepEqual(
    resolveWorkqueueProviders(INTERNAL).map((p) => p.id),
    ['source-workqueue', 'source-triage', 'menu-concepts', 'profile-drafts', 'import-candidates']
  );
  assert.deepEqual(resolveWorkqueueProviders(EDITOR).map((p) => p.id), ['moderation', 'claims']);
  assert.deepEqual(resolveWorkqueueProviders(BOTH).map((p) => p.id), WORKQUEUE_PROVIDERS.map((p) => p.id));
  assert.deepEqual(resolveWorkqueueProviders(OWNER).map((p) => p.id), []);
  assert.deepEqual(resolveWorkqueueProviders([]).map((p) => p.id), []);
  assert.deepEqual(resolveWorkqueueProviders(null).map((p) => p.id), []);
});

test('role filtering: an internal account never receives editor-only tasks, even if that payload is supplied', () => {
  const result = build(
    INTERNAL,
    baseProviders({
      moderation: {
        ok: true,
        data: { items: [{ pending: { id: 'pending-1', restaurant_id: 23, field_name: 'phone' }, restaurantName: 'Bistro Linde' }] },
      },
      claims: {
        ok: true,
        data: { items: [{ claim: { id: 'claim-1', restaurant_id: 23 }, restaurantName: 'Bistro Linde', hasExistingOwner: false }] },
      },
    })
  );
  assert.equal(result.tasks.length, 0);
  assert.equal(result.providers.some((p) => p.id === 'moderation' || p.id === 'claims'), false);
});

test('role filtering: an editor-only account never receives internal tasks, even if that payload is supplied', () => {
  const result = build(
    EDITOR,
    baseProviders({
      'menu-concepts': { ok: true, data: { items: [menuItem] } },
      moderation: { ok: true, data: { items: [{ pending: { id: 'pending-1', restaurant_id: 23, field_name: 'phone' }, restaurantName: 'Bistro Linde' }] } },
    })
  );
  assert.deepEqual(result.tasks.map((t) => t.id), ['moderation:pending-1']);
  assert.equal(result.providers.some((p) => p.role === 'internal'), false);
});

test('role filtering: owner-only or no roles yields an honest empty workqueue, never editor/internal access', () => {
  const owner = build(OWNER, baseProviders({ 'menu-concepts': { ok: true, data: { items: [menuItem] } } }));
  assert.equal(owner.tasks.length, 0);
  assert.equal(owner.providers.length, 0);
  assert.equal(owner.status, 'empty');

  const none = build([], baseProviders());
  assert.equal(none.tasks.length, 0);
  assert.equal(none.providers.length, 0);
  assert.equal(none.status, 'empty');
});

test('record links: every task opens the exact existing record, including the deep-link adapters', () => {
  const result = build(
    BOTH,
    baseProviders({
      'menu-concepts': { ok: true, data: { items: [menuItem] } },
      'source-workqueue': { ok: true, data: { rows: [sourceRow] } },
      'source-triage': { ok: true, data: { restaurants: [proposalEntry] } },
      'import-candidates': { ok: true, data: { candidates: [candidate] } },
      'profile-drafts': { ok: true, data: { drafts: [draft] } },
      moderation: { ok: true, data: { items: [{ pending: { id: 'pending-1', restaurant_id: 23, field_name: 'phone' }, restaurantName: 'Bistro Linde' }] } },
      claims: { ok: true, data: { items: [{ claim: { id: 'claim-1', restaurant_id: 23 }, restaurantName: 'Bistro Linde', hasExistingOwner: true }] } },
    })
  );

  const byId = Object.fromEntries(result.tasks.map((t) => [t.id, t]));
  assert.equal(byId['menu-concept:concept-1'].href, '/internal/menu-concepts/concept-1#mcr-publication');
  assert.equal(byId['source-workqueue:24'].href, '/internal/source-workqueue?restaurant=24');
  assert.equal(byId['source-proposal:proposal-1'].href, '/internal/source-triage?restaurant=25');
  assert.equal(
    byId['candidate:candidate-1'].href,
    '/internal/import-inbox?run=run-1&candidate=candidate-1#candidate-candidate-1'
  );
  assert.equal(byId['profile-draft:draft-1'].href, '/internal/profile-drafts#draft-draft-1');
  assert.equal(byId['moderation:pending-1'].href, '/internal/moderation#pending-pending-1');
  assert.equal(byId['claim:claim-1'].href, '/internal/moderation#claim-claim-1');
});

test('record links: a candidate without a run still opens its exact card', () => {
  const result = build(INTERNAL, baseProviders({
    'import-candidates': { ok: true, data: { candidates: [{ ...candidate, import_run_id: null }] } },
  }));
  assert.equal(result.tasks[0].href, '/internal/import-inbox?candidate=candidate-1#candidate-candidate-1');
});

test('duplicate handling: the same stable record is listed once and counted, never twice', () => {
  const result = build(INTERNAL, baseProviders({
    'menu-concepts': { ok: true, data: { items: [menuItem, { ...menuItem }] } },
    'source-workqueue': { ok: true, data: { rows: [sourceRow, { ...sourceRow }] } },
  }));
  assert.equal(result.tasks.filter((t) => t.id === 'menu-concept:concept-1').length, 1);
  assert.equal(result.tasks.filter((t) => t.id === 'source-workqueue:24').length, 1);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.counts.total, 2);
});

test('duplicate handling: a ready source row and its menu concept are one review step — the concept record wins', () => {
  const result = build(INTERNAL, baseProviders({
    'menu-concepts': { ok: true, data: { items: [menuItem] } },
    'source-workqueue': {
      ok: true,
      data: { rows: [{ ...sourceRow, restaurant_id: 23, name: 'Bistro Linde', source: 'reachable', menu: 'ready_for_review', action: 'review', queue: 'review' }] },
    },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['menu-concept:concept-1']);
});

test('duplicate handling: a source problem next to a menu review stays an independent task', () => {
  const result = build(INTERNAL, baseProviders({
    'menu-concepts': { ok: true, data: { items: [menuItem] } },
    'source-workqueue': { ok: true, data: { rows: [{ ...sourceRow, restaurant_id: 23, name: 'Bistro Linde' }] } },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['source-workqueue:23', 'menu-concept:concept-1']);
});

test('duplicate handling: an open source proposal replaces the generic source-check row for that restaurant', () => {
  const result = build(INTERNAL, baseProviders({
    'source-triage': { ok: true, data: { restaurants: [proposalEntry] } },
    'source-workqueue': { ok: true, data: { rows: [{ ...sourceRow, restaurant_id: 25, name: 'Eethuis De Kade' }] } },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['source-proposal:proposal-1']);
});

test('duplicate handling: an identity question survives an open source proposal — it is independent work', () => {
  const result = build(INTERNAL, baseProviders({
    'source-triage': { ok: true, data: { restaurants: [proposalEntry] } },
    'source-workqueue': {
      ok: true,
      data: {
        rows: [
          {
            ...sourceRow,
            restaurant_id: 25,
            name: 'Eethuis De Kade',
            source: 'identity_changed',
            action: 'check_identity',
            queue: 'identity',
          },
        ],
      },
    },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['source-workqueue:25', 'source-proposal:proposal-1']);
  assert.equal(result.tasks[0].kind, 'source_identity');
});

test('duplicate handling: several pending changes and claims for one restaurant stay independent records', () => {
  const result = build(EDITOR, baseProviders({
    moderation: {
      ok: true,
      data: {
        items: [
          { pending: { id: 'p1', restaurant_id: 23, field_name: 'phone' } },
          { pending: { id: 'p2', restaurant_id: 23, field_name: 'address' } },
        ],
      },
    },
    claims: {
      ok: true,
      data: {
        items: [
          { claim: { id: 'c1', restaurant_id: 23 }, restaurantName: 'Bistro Linde' },
          { claim: { id: 'c2', restaurant_id: 23 }, restaurantName: 'Bistro Linde' },
        ],
      },
    },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), [
    'moderation:p1',
    'moderation:p2',
    'claim:c1',
    'claim:c2',
  ]);
});

test('duplicate handling: two menu contexts for one restaurant remain two concept records', () => {
  const result = build(INTERNAL, baseProviders({
    'menu-concepts': {
      ok: true,
      data: { items: [menuItem, { ...menuItem, id: 'concept-2', menuContext: 'Diner' }] },
    },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['menu-concept:concept-1', 'menu-concept:concept-2']);
});

test('duplicate handling: a proposal and a menu review for the same restaurant stay independent steps', () => {
  const result = build(INTERNAL, baseProviders({
    'menu-concepts': { ok: true, data: { items: [{ ...menuItem, restaurantId: 25 }] } },
    'source-triage': { ok: true, data: { restaurants: [proposalEntry] } },
    'source-workqueue': {
      ok: true,
      data: { rows: [{ ...sourceRow, restaurant_id: 25, name: 'Eethuis De Kade', source: 'reachable', menu: 'ready_for_review', action: 'review', queue: 'review' }] },
    },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['source-proposal:proposal-1', 'menu-concept:concept-1']);
});

test('duplicate handling: an active profile draft covers its candidate — no second candidate task', () => {
  const result = build(INTERNAL, baseProviders({
    'import-candidates': {
      ok: true,
      data: { candidates: [{ ...candidate, review_status: 'approved_internal', profile_draft: { id: 'draft-1' } }] },
    },
    'profile-drafts': { ok: true, data: { drafts: [draft] } },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['profile-draft:draft-1']);
});

test('duplicate handling: an active draft does not hide a newer, independent candidate review task', () => {
  const result = build(INTERNAL, baseProviders({
    'import-candidates': {
      ok: true,
      data: {
        candidates: [{ ...candidate, id: 'candidate-1', review_status: 'needs_enrichment', profile_draft: { id: 'draft-1' } }],
      },
    },
    'profile-drafts': { ok: true, data: { drafts: [draft] } },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['candidate:candidate-1', 'profile-draft:draft-1']);
});

test('duplicate handling: candidates with the same name but different stable ids are not merged', () => {
  const result = build(INTERNAL, baseProviders({
    'import-candidates': { ok: true, data: { candidates: [candidate, { ...candidate, id: 'candidate-2' }] } },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['candidate:candidate-1', 'candidate:candidate-2']);
});

test('candidate tasks: new, needs_enrichment and approved-internal-without-draft are real work; decided states are history', () => {
  const result = build(INTERNAL, baseProviders({
    'import-candidates': {
      ok: true,
      data: {
        candidates: [
          { ...candidate, id: 'c1', review_status: 'new' },
          { ...candidate, id: 'c2', review_status: 'needs_enrichment' },
          { ...candidate, id: 'c3', review_status: 'approved_internal' },
          { ...candidate, id: 'c4', review_status: 'deferred' },
          { ...candidate, id: 'c5', review_status: 'rejected' },
        ],
      },
    },
  }));
  assert.deepEqual(result.tasks.map((t) => t.id), ['candidate:c1', 'candidate:c2', 'candidate:c3']);
  assert.deepEqual(result.tasks.map((t) => t.kind), ['candidate_review', 'candidate_enrichment', 'candidate_draft']);
});

test('states: a fully loaded, truly empty workqueue is an honest empty state', () => {
  const result = build(INTERNAL, baseProviders());
  assert.equal(result.status, 'empty');
  assert.equal(result.counts.total, 0);
  assert.deepEqual(result.incompleteProviders, []);
});

test('states: one unavailable provider is reported as partial, never as "everything done"', () => {
  const result = build(INTERNAL, baseProviders({
    'source-workqueue': { ok: false, error: 'De bronwerkvoorraad kon niet worden geladen.' },
    'menu-concepts': { ok: true, data: { items: [menuItem] } },
  }));
  assert.equal(result.status, 'partial');
  assert.equal(result.counts.total, 1);
  assert.deepEqual(result.incompleteProviders.map((p) => p.label), ['Bronwerkvoorraad']);
  const summary = result.providers.find((p) => p.id === 'source-workqueue');
  assert.equal(summary.ok, false);
  assert.match(summary.error, /niet worden geladen/);
});

test('states: all providers unavailable is an explicit error state, not an empty queue', () => {
  const failed = {
    'source-workqueue': { ok: false, error: 'x' },
    'source-triage': { ok: false, error: 'x' },
    'menu-concepts': { ok: false, error: 'x' },
    'profile-drafts': { ok: false, error: 'x' },
    'import-candidates': { ok: false, error: 'x' },
  };
  const result = build(INTERNAL, baseProviders(failed));
  assert.equal(result.status, 'error');
  assert.equal(result.counts.total, 0);
});

test('states: a provider that answered only partially still contributes its real tasks and marks the list incomplete', () => {
  const result = build(INTERNAL, baseProviders({
    'source-triage': { ok: true, partial: true, error: 'Voorstellen zijn tijdelijk niet beschikbaar.', data: { restaurants: [proposalEntry] } },
  }));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.tasks.map((t) => t.id), ['source-proposal:proposal-1']);
});

test('states: unavailable internal providers do not make an editor-only workqueue look partial', () => {
  const result = build(EDITOR, baseProviders({
    'source-workqueue': { ok: false, error: 'not requested for this role' },
    moderation: { ok: true, data: { items: [{ pending: { id: 'pending-1', restaurant_id: 23, field_name: 'phone' } }] } },
  }));
  assert.equal(result.status, 'ready');
  assert.equal(result.incompleteProviders.length, 0);
});

test('states: malformed or missing payloads never throw and never invent tasks', () => {
  const result = build(INTERNAL, {
    'source-workqueue': { ok: true, data: null },
    'source-triage': { ok: true, data: { restaurants: null } },
    'menu-concepts': { ok: true, data: { items: [null, {}, { id: 'x', status: 'rejected' }] } },
    'profile-drafts': { ok: true, data: { drafts: null } },
    'import-candidates': { ok: true, data: { candidates: [null] } },
  });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.status, 'empty');
});

test('ordering and counts: urgent source work first, publication and editor decisions last, with honest per-provider counts', () => {
  const result = build(BOTH, baseProviders({
    'menu-concepts': {
      ok: true,
      data: { items: [menuItem, { ...menuItem, id: 'concept-2', status: 'approved', restaurantId: 30, restaurantName: 'Restaurant Park' }] },
    },
    'source-workqueue': { ok: true, data: { rows: [sourceRow] } },
    'source-triage': { ok: true, data: { restaurants: [proposalEntry] } },
    'import-candidates': { ok: true, data: { candidates: [candidate] } },
    'profile-drafts': { ok: true, data: { drafts: [draft] } },
    moderation: { ok: true, data: { items: [{ pending: { id: 'pending-1', restaurant_id: 23, field_name: 'phone' } }] } },
    claims: { ok: true, data: { items: [{ claim: { id: 'claim-1', restaurant_id: 23 } }] } },
  }));
  assert.deepEqual(result.tasks.map((t) => t.kind), [
    'source_check',
    'source_proposal',
    'menu_review',
    'candidate_review',
    'profile_draft',
    'menu_publication',
    'moderation_change',
    'owner_claim',
  ]);
  assert.equal(result.counts.total, 8);
  assert.equal(result.counts.byProvider['menu-concepts'], 2);
  assert.equal(result.counts.byProvider['source-workqueue'], 1);
  assert.equal(result.counts.byProvider.moderation, 1);
  assert.equal(result.providers.find((p) => p.id === 'claims').count, 1);
});

test('publication readiness: Publiceren only with proven checks; blocked/active states stay explicit', () => {
  const base = { ...menuItem, status: 'approved', export: null };
  const result = build(INTERNAL, baseProviders({
    'menu-concepts': {
      ok: true,
      data: {
        items: [
          {
            ...base,
            id: 'ready',
            publication: { state: 'ready', label: 'Klaar voor publicatie', reasons: [], actionLabel: 'Publiceren' },
          },
          {
            ...base,
            id: 'blocked',
            publication: { state: 'blocked', label: 'Nog niet klaar voor publicatie', reasons: ['Bron bevestigd', 'Geen blokkades'], actionLabel: 'Controleer concept' },
          },
          {
            ...base,
            id: 'active',
            export: { status: 'opened' },
            publication: { state: 'export_active', label: 'Review-PR open · nog niet gemerged', reasons: [], actionLabel: 'Bekijk publicatie' },
          },
          {
            ...base,
            id: 'failed',
            export: { status: 'failed' },
            publication: { state: 'export_attention', label: 'Publicatie mislukt · controleer de oorzaak', reasons: [], actionLabel: 'Controleer publicatie' },
          },
          {
            ...base,
            id: 'merged',
            export: { status: 'merged' },
            publication: { state: 'export_merged', label: 'Review-PR gemerged · productie nog niet bevestigd' },
          },
        ],
      },
    },
  }));

  const byId = Object.fromEntries(result.tasks.map((t) => [t.id, t]));
  assert.equal(byId['menu-concept:ready'].title, 'Klaar voor publicatie');
  assert.equal(byId['menu-concept:ready'].actionLabel, 'Publiceren');
  assert.equal(byId['menu-concept:ready'].href, '/internal/menu-concepts/ready#mcr-publication');
  assert.equal(byId['menu-concept:blocked'].title, 'Nog niet klaar voor publicatie');
  assert.match(byId['menu-concept:blocked'].reason, /Bron bevestigd/);
  assert.equal(byId['menu-concept:blocked'].actionLabel, 'Controleer concept');
  assert.equal(byId['menu-concept:active'].actionLabel, 'Bekijk publicatie');
  assert.equal(byId['menu-concept:failed'].actionLabel, 'Controleer publicatie');
  assert.equal(byId['menu-concept:merged'], undefined);
});

test('publication: a merged export is not open work; open/failed/closed exports keep their real status', () => {
  const approved = { ...menuItem, status: 'approved' };
  const result = build(INTERNAL, baseProviders({
    'menu-concepts': {
      ok: true,
      data: {
        items: [
          { ...approved, id: 'merged', restaurantId: 31, export: { status: 'merged' } },
          { ...approved, id: 'opened', restaurantId: 32, export: { status: 'opened' } },
          { ...approved, id: 'failed', restaurantId: 33, export: { status: 'failed' } },
          { ...approved, id: 'closed', restaurantId: 34, export: { status: 'closed' } },
          { ...approved, id: 'fresh', restaurantId: 35, export: null },
        ],
      },
    },
    // A merged concept still suppresses a stale generic review row for the
    // same restaurant — it is reviewed and live, not waiting.
    'source-workqueue': {
      ok: true,
      data: { rows: [{ ...sourceRow, restaurant_id: 31, source: 'reachable', menu: 'ready_for_review', action: 'review', queue: 'review' }] },
    },
  }));

  const byId = Object.fromEntries(result.tasks.map((t) => [t.id, t]));
  assert.equal(byId['menu-concept:merged'], undefined);
  assert.equal(byId['source-workqueue:31'], undefined);
  assert.match(byId['menu-concept:opened'].reason, /Review-PR open/);
  assert.equal(byId['menu-concept:opened'].actionLabel, 'Bekijk publicatie');
  assert.match(byId['menu-concept:failed'].reason, /mislukt/);
  assert.equal(byId['menu-concept:failed'].actionLabel, 'Controleer publicatie');
  assert.match(byId['menu-concept:closed'].reason, /gesloten/);
  assert.match(byId['menu-concept:fresh'].reason, /publicatiestatus niet vastgesteld/);
  assert.equal(byId['menu-concept:fresh'].actionLabel, 'Controleer publicatie');
  // An approved concept alone never claims publication readiness.
  for (const task of result.tasks) assert.doesNotMatch(task.reason, /Klaar voor publicatie/i);
  assert.equal(result.tasks.length, 4);
});

// ─── Structural safety net: the page and the legacy-screen adapters ─────

test('structural safety net: Werkvoorraad renders one concrete task list and no module cards', () => {
  const source = fs.readFileSync(WORKQUEUE_PAGE_PATH, 'utf8');
  assert.match(source, /buildWorkqueue\(/);
  assert.match(source, /className="wq-tasks"/);
  assert.match(source, /className="wq-task"/);
  assert.doesNotMatch(source, /groupModulesByPlacement|resolveVisibleModules|modules\.map\(/);
  assert.doesNotMatch(source, /\.from\(['"]/);
});

test('structural safety net: Werkvoorraad reports partial/error states and a true empty state instead of "all done"', () => {
  const source = fs.readFileSync(WORKQUEUE_PAGE_PATH, 'utf8');
  assert.match(source, /model\.status === 'partial'/);
  assert.match(source, /model\.status === 'error'/);
  assert.match(source, /model\.status === 'empty'/);
  assert.match(source, /mogelijk onvolledig/);
  assert.match(source, /Geen openstaand werk\./);
  assert.doesNotMatch(source, /Alles klaar|alles klaar/);
});

test('structural safety net: every legacy destination exposes the exact-record deep-link adapter used by the task hrefs', () => {
  const sourceWorkqueue = fs.readFileSync(SOURCE_WORKQUEUE_PAGE_PATH, 'utf8');
  assert.match(sourceWorkqueue, /new URLSearchParams\(window\.location\.search\)\.get\('restaurant'\)/);
  assert.match(sourceWorkqueue, /window\.matchMedia\('\(max-width: 760px\)'\)\.matches/);
  assert.match(sourceWorkqueue, /setOpenRow\(`\$\{mobileCards \? 'c' : 't'\}:\$\{row\.restaurant_id\}`\)/);

  const sourceTriage = fs.readFileSync(SOURCE_TRIAGE_PAGE_PATH, 'utf8');
  assert.match(sourceTriage, /new URLSearchParams\(window\.location\.search\)\.get\('restaurant'\)/);
  assert.match(sourceTriage, /setSelectedId\(entry\.restaurant_id\)/);

  const importInbox = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  assert.match(importInbox, /new URLSearchParams\(window\.location\.search\)\.get\('run'\)/);
  assert.match(importInbox, /new URLSearchParams\(window\.location\.search\)\.get\('candidate'\)/);
  assert.match(importInbox, /id=\{`candidate-\$\{c\.id\}`\}/);

  const profileDrafts = fs.readFileSync(PROFILE_DRAFTS_PAGE_PATH, 'utf8');
  assert.match(profileDrafts, /id=\{`draft-\$\{d\.id\}`\}/);
  assert.match(profileDrafts, /window\.location\.hash/);

  const moderation = fs.readFileSync(MODERATION_PAGE_PATH, 'utf8');
  assert.match(moderation, /id=\{`pending-\$\{pending\.id\}`\}/);
  assert.match(moderation, /id=\{`claim-\$\{claim\.id\}`\}/);
  assert.match(moderation, /window\.location\.hash/);
});
