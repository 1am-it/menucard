'use strict';

// BE-24 Brontriage — pure logic. Fictional data only (RFC 2606 example
// domains); no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TRIAGE_NOTICE,
  PROPOSAL_KINDS,
  UNUSABLE_REASONS,
  PROPOSAL_STATUSES,
  STATUS_ROLES,
  TRANSITIONS,
  NEXT_STEPS,
  NEXT_STEP_LABELS,
  KIND_LABELS,
  STATUS_LABELS,
  UNUSABLE_REASON_LABELS,
  validateProposedUrl,
  canonicalizeKnownWebsite,
  normalizeNote,
  validateProposalInput,
  validateDecisionInput,
  canTransition,
  isUuid,
  nextStepFor,
  attentionFor,
  actorRef,
  buildTriageView,
  filterTriage,
  countTriage,
} = require('./sourceTriage');
const { buildSourceWorkqueue } = require('./sourceWorkqueue');

test('the notice is literally the agreed sentence', () => {
  assert.equal(TRIAGE_NOTICE, 'Wijzigingen worden pas na controle verwerkt.');
});

test('every kind, reason, status and next step has a Dutch label', () => {
  for (const k of PROPOSAL_KINDS) assert.ok(KIND_LABELS[k], k);
  for (const r of UNUSABLE_REASONS) assert.ok(UNUSABLE_REASON_LABELS[r], r);
  for (const s of PROPOSAL_STATUSES) assert.ok(STATUS_LABELS[s], s);
  for (const n of NEXT_STEPS) assert.ok(NEXT_STEP_LABELS[n], n);
});

test('the closed lists match migration 0015 exactly', () => {
  assert.deepEqual(PROPOSAL_KINDS, ['add_candidate', 'replace_source', 'mark_unusable']);
  assert.deepEqual(UNUSABLE_REASONS, ['site_offline', 'other_business', 'no_menu_on_source', 'access_blocked', 'other']);
  assert.deepEqual(PROPOSAL_STATUSES, ['open', 'accepted', 'rejected']);
});

// ── URL validation ────────────────────────────────────────────────────────

test('validateProposedUrl accepts http(s) public host names and keeps scheme, host and path only', () => {
  assert.deepEqual(validateProposedUrl('https://fictief-bistro.example.com/menu'), { ok: true, url: 'https://fictief-bistro.example.com/menu', host: 'fictief-bistro.example.com' });
  assert.equal(validateProposedUrl('  HTTPS://WWW.Fictief-Bistro.Example.COM/Menu/  ').url, 'https://www.fictief-bistro.example.com/Menu/');
  assert.equal(validateProposedUrl('http://fictief.example.org').url, 'http://fictief.example.org/');
  assert.equal(validateProposedUrl('https://fictief.example.com/menu?lang=nl#diner').url, 'https://fictief.example.com/menu', 'query and fragment are dropped');
  assert.equal(validateProposedUrl('https://fictief.example.com./a').url, 'https://fictief.example.com/a', 'trailing dot removed');
  assert.match(validateProposedUrl('https://bäckerei-fictief.example.com/').url, /^https:\/\/xn--bckerei-fictief-[a-z0-9]+\.example\.com\/$/, 'IDN arrives as punycode');
  assert.equal(validateProposedUrl('https://fictief.example.com/menu\n').url, 'https://fictief.example.com/menu', 'surrounding whitespace from a paste is trimmed');
  assert.equal(validateProposedUrl('https://fictief.example.xn--p1ai/').ok, true, 'punycode TLD');
});

test('validateProposedUrl refuses everything that is not a plain public web address', () => {
  const cases = {
    missing: ['', '   ', null, undefined, 42],
    whitespace: ['https://fictief.example.com/a b', 'https://fictief.example.com/a\tb', 'https://fictief.example.com/a\nb', 'https://fictief.example.com/\u0000'],
    scheme: ['fictief.example.com', 'ftp://fictief.example.com/', 'javascript:alert(1)', 'data:text/html,x', '//fictief.example.com/', 'file:///etc/passwd'],
    credentials: ['https://user:pass@fictief.example.com/', 'https://user@fictief.example.com/'],
    port: ['https://fictief.example.com:8443/', 'https://fictief.example.com:443/', 'http://fictief.example.com:80/x', 'https://fictief.example.com:/'],
    ip_literal: ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://169.254.169.254/latest'],
    host: ['https://fictief/', 'https://-fictief.example.com/', 'https://fictief_bistro.example.com/', 'https://fictief.example.c0m/', 'https://fictief.example.c/'],
    reserved_host: ['https://localhost/', 'https://fictief.localhost/', 'https://fictief.local/', 'https://fictief.internal/', 'https://fictief.invalid/', 'https://fictief.test/', 'https://fictief.example/', 'https://fictief.onion/', 'https://x.in-addr.arpa/', 'https://router.home/', 'https://nas.lan/', 'https://intranet.corp/'],
    too_long: ['https://fictief.example.com/' + 'a'.repeat(2048)],
  };
  for (const [reason, inputs] of Object.entries(cases)) {
    for (const input of inputs) {
      const result = validateProposedUrl(input);
      assert.equal(result.ok, false, `${String(input).slice(0, 60)} should be refused`);
      assert.equal(result.reason, reason, `${String(input).slice(0, 60)}: expected ${reason}, got ${result.reason}`);
      assert.ok(result.message && typeof result.message === 'string');
    }
  }
});

test('canonicalizeKnownWebsite reads a scheme-less stored website as https and applies the same rules', () => {
  assert.equal(canonicalizeKnownWebsite('fictief-bistro.example.com'), 'https://fictief-bistro.example.com/');
  assert.equal(canonicalizeKnownWebsite('https://www.fictief.example.com/?lang=nl'), 'https://www.fictief.example.com/');
  assert.equal(canonicalizeKnownWebsite('//fictief.example.com/a'), 'https://fictief.example.com/a');
  assert.equal(canonicalizeKnownWebsite(''), null);
  assert.equal(canonicalizeKnownWebsite(null), null);
  assert.equal(canonicalizeKnownWebsite('http://127.0.0.1/'), null);
  assert.equal(canonicalizeKnownWebsite('mailto:info@fictief.example.com'), null);
});

// ── Notes ─────────────────────────────────────────────────────────────────

test('normalizeNote trims, bounds at 280, refuses control characters and enforces "required"', () => {
  assert.deepEqual(normalizeNote('  kort  '), { ok: true, note: 'kort' });
  assert.deepEqual(normalizeNote(''), { ok: true, note: null });
  assert.deepEqual(normalizeNote(undefined), { ok: true, note: null });
  assert.equal(normalizeNote('', { required: true }).ok, false);
  assert.equal(normalizeNote('a'.repeat(280)).ok, true);
  assert.equal(normalizeNote('a'.repeat(281)).reason, 'note_too_long');
  assert.equal(normalizeNote('regel\u0007').reason, 'note_invalid');
  assert.equal(normalizeNote({}).reason, 'note_invalid');
  assert.deepEqual(normalizeNote('een\r\ntwee'), { ok: true, note: 'een\ntwee' });
});

// ── Proposal input ────────────────────────────────────────────────────────

const withSite = { name: 'Fictief Bistro', website: 'https://fictief-bistro.example.com' };
const withoutSite = { name: 'Fictief Eetcafé', website: '' };

test('add_candidate: needs a valid URL, stores current_url from the restaurant entry (never the body)', () => {
  const r = validateProposalInput({ restaurant_id: '7', kind: 'add_candidate', proposed_url: 'https://fictief-bistro.example.com/menukaart', current_url: 'https://evil.example.com/' }, withSite);
  assert.deepEqual(r, { ok: true, value: { restaurant_id: '7', kind: 'add_candidate', proposed_url: 'https://fictief-bistro.example.com/menukaart', current_url: 'https://fictief-bistro.example.com/', unusable_reason: null, note: null } });
  const none = validateProposalInput({ restaurant_id: '8', kind: 'add_candidate', proposed_url: 'https://fictief-eetcafe.example.com/' }, withoutSite);
  assert.equal(none.ok, true);
  assert.equal(none.value.current_url, null);
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'add_candidate', proposed_url: 'http://10.0.0.1/' }, withSite).reason, 'url_ip_literal');
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'add_candidate' }, withSite).reason, 'url_missing');
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'add_candidate', proposed_url: 'https://fictief-bistro.example.com' }, withSite).reason, 'same_url');
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'add_candidate', proposed_url: 'https://a.example.com/', unusable_reason: 'other' }, withSite).reason, 'unexpected_reason');
});

test('replace_source: needs a known source and a different URL', () => {
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'replace_source', proposed_url: 'https://nieuw.example.com/' }, withSite).ok, true);
  assert.equal(validateProposalInput({ restaurant_id: '8', kind: 'replace_source', proposed_url: 'https://nieuw.example.com/' }, withoutSite).reason, 'no_current_url');
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'replace_source', proposed_url: 'https://FICTIEF-bistro.example.com/?x=1' }, withSite).reason, 'same_url');
});

test('mark_unusable: needs a known source and a reason from the fixed list; "other" needs a note; no URL allowed', () => {
  const ok = validateProposalInput({ restaurant_id: '7', kind: 'mark_unusable', unusable_reason: 'site_offline' }, withSite);
  assert.deepEqual(ok.value, { restaurant_id: '7', kind: 'mark_unusable', proposed_url: null, current_url: 'https://fictief-bistro.example.com/', unusable_reason: 'site_offline', note: null });
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'mark_unusable' }, withSite).reason, 'reason');
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'mark_unusable', unusable_reason: 'kapot' }, withSite).reason, 'reason');
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'mark_unusable', unusable_reason: 'other' }, withSite).reason, 'note_required');
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'mark_unusable', unusable_reason: 'other', note: 'Sluit eind deze maand' }, withSite).ok, true);
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'mark_unusable', unusable_reason: 'site_offline', proposed_url: 'https://x.example.com/' }, withSite).reason, 'unexpected_url');
  assert.equal(validateProposalInput({ restaurant_id: '8', kind: 'mark_unusable', unusable_reason: 'site_offline' }, withoutSite).reason, 'no_current_url');
});

test('validateProposalInput refuses malformed bodies, unknown kinds and unknown restaurants', () => {
  assert.equal(validateProposalInput(null, withSite).reason, 'body');
  assert.equal(validateProposalInput([], withSite).reason, 'body');
  assert.equal(validateProposalInput({ restaurant_id: '../x', kind: 'add_candidate' }, withSite).reason, 'restaurant_id');
  assert.equal(validateProposalInput({ restaurant_id: 7, kind: 'add_candidate' }, withSite).reason, 'restaurant_id');
  const unknown = validateProposalInput({ restaurant_id: '99', kind: 'add_candidate', proposed_url: 'https://a.example.com/' }, null);
  assert.equal(unknown.reason, 'restaurant_unknown');
  assert.equal(unknown.status, 404);
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'publish', proposed_url: 'https://a.example.com/' }, withSite).reason, 'kind');
  assert.equal(validateProposalInput({ restaurant_id: '7', kind: 'add_candidate', proposed_url: 'https://a.example.com/', note: 'x'.repeat(281) }, withSite).reason, 'note_too_long');
});

// ── Decisions and transitions ────────────────────────────────────────────

test('validateDecisionInput: accept with an optional note, reject only with a reason', () => {
  assert.deepEqual(validateDecisionInput({ decision: 'accepted' }), { ok: true, decision: 'accepted', note: null });
  assert.deepEqual(validateDecisionInput({ decision: 'accepted', note: ' prima ' }), { ok: true, decision: 'accepted', note: 'prima' });
  assert.equal(validateDecisionInput({ decision: 'rejected' }).reason, 'note_required');
  assert.equal(validateDecisionInput({ decision: 'rejected', note: '   ' }).reason, 'note_required');
  assert.deepEqual(validateDecisionInput({ decision: 'rejected', note: 'Andere zaak' }), { ok: true, decision: 'rejected', note: 'Andere zaak' });
  for (const decision of ['open', 'published', '', undefined, 'ACCEPTED']) assert.equal(validateDecisionInput({ decision }).reason, 'decision');
  assert.equal(validateDecisionInput(null).reason, 'body');
});

test('only open → accepted and open → rejected are allowed; decided proposals are final', () => {
  const allowed = [];
  for (const from of PROPOSAL_STATUSES) for (const to of PROPOSAL_STATUSES) if (canTransition(from, to)) allowed.push(`${from}>${to}`);
  assert.deepEqual(allowed, ['open>accepted', 'open>rejected']);
  assert.deepEqual(TRANSITIONS.accepted, []);
  assert.deepEqual(TRANSITIONS.rejected, []);
  assert.equal(canTransition('unknown', 'accepted'), false);
});

test('proposal status roles: open neutral/clock, accepted positive/check, rejected neutral/cross — never the reserved action role', () => {
  assert.deepEqual(STATUS_ROLES, {
    open: { tone: 'neutral', icon: 'clock' },
    accepted: { tone: 'positive', icon: 'check' },
    rejected: { tone: 'neutral', icon: 'cross' },
  });
});

test('isUuid accepts only canonical UUIDs', () => {
  assert.equal(isUuid('0191f2a0-1234-7abc-8def-0123456789ab'), true);
  for (const v of ['', 'abc', '0191f2a0-1234-7abc-8def-0123456789ab; drop', null, 5]) assert.equal(isUuid(v), false);
});

// ── Next step, attention, actors ─────────────────────────────────────────

test('nextStepFor: open proposal first, then missing website, then broken source, then access, else a manual check', () => {
  assert.equal(nextStepFor({ row: { source: 'unreachable' }, hasOpenProposal: true, knownUrl: 'https://a.example.com/' }), 'review_proposal');
  assert.equal(nextStepFor({ row: { reason: 'no_website' }, hasOpenProposal: false, knownUrl: null }), 'add_candidate');
  assert.equal(nextStepFor({ row: { source: 'unreachable' }, knownUrl: 'https://a.example.com/' }), 'replace_or_mark');
  assert.equal(nextStepFor({ row: { source: 'identity_changed' }, knownUrl: 'https://a.example.com/' }), 'replace_or_mark');
  assert.equal(nextStepFor({ row: { source: 'access_limited' }, knownUrl: 'https://a.example.com/' }), 'inspect_or_mark');
  assert.equal(nextStepFor({ row: { source: 'reachable' }, knownUrl: 'https://a.example.com/' }), 'check_via_onboarding');
  assert.equal(nextStepFor({ row: { reason: 'never_checked' }, knownUrl: 'https://a.example.com/' }), 'check_via_onboarding');
});

test('attentionFor reuses the BE-23 vocabulary and never invents a status', () => {
  assert.equal(attentionFor({ source: 'unreachable', menu: 'not_assessed' }), 'Bron: Niet bereikbaar');
  assert.equal(attentionFor({ source: 'reachable', menu: 'structure_not_recognized' }), 'Menukaart: Structuur niet herkend');
  assert.equal(attentionFor({ source: 'reachable', menu: 'ready_for_review' }), 'Menukaart wacht op beoordeling');
  assert.equal(attentionFor({ reason: 'never_checked' }), 'Nog nooit gecontroleerd');
  assert.equal(attentionFor(null), null);
});

test('actorRef shows "self" or an 8-character reference — never more of the id', () => {
  assert.deepEqual(actorRef('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), { self: true, ref: 'aaaaaaaa' });
  assert.deepEqual(actorRef('11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), { self: false, ref: '11111111' });
  assert.deepEqual(actorRef(null, 'x'), { self: false, ref: null });
});

// ── The view ─────────────────────────────────────────────────────────────

const RESTAURANTS = {
  1: { name: 'Fictief Bistro Haven', buurt: 'Centrum', website: 'https://bistrohaven.example.com' },
  2: { name: 'Fictief Eetcafé Molen', buurt: 'Ginneken', website: '' },
  3: { name: 'Fictief Grillhuis', buurt: 'Noord', website: 'https://grillhuis.example.com/' },
  4: { name: '', website: 'https://naamloos.example.com' },
};
const VIEWER = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';

function queueWithFailedGrillhuis() {
  return buildSourceWorkqueue({
    restaurants: RESTAURANTS,
    jobs: [{ id: 'j1', canonical_source_url: 'https://grillhuis.example.com/', status: 'failed', error_reason: 'fetch_failed', result_receipt_id: null, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:05:00Z' }],
    receipts: [],
  });
}

test('buildTriageView lists every named restaurant once, with status or reason, known URL, check time and next step', () => {
  const view = buildTriageView({ queue: queueWithFailedGrillhuis(), restaurants: RESTAURANTS, proposals: [], viewerId: VIEWER });
  assert.deepEqual(view.restaurants.map((r) => r.restaurant_id).sort(), ['1', '2', '3']);
  const grill = view.restaurants.find((r) => r.restaurant_id === '3');
  assert.equal(grill.source, 'unreachable');
  assert.equal(grill.menu, 'not_assessed');
  assert.equal(grill.checked_at, '2026-10-01T09:05:00Z');
  assert.equal(grill.known_url, 'https://grillhuis.example.com/');
  assert.equal(grill.attention, 'Bron: Niet bereikbaar');
  assert.equal(grill.next_step, 'replace_or_mark');
  const molen = view.restaurants.find((r) => r.restaurant_id === '2');
  assert.equal(molen.not_in_queue_reason, 'no_website');
  assert.equal(molen.known_url, null);
  assert.equal(molen.next_step, 'add_candidate');
  const haven = view.restaurants.find((r) => r.restaurant_id === '1');
  assert.equal(haven.not_in_queue_reason, 'never_checked');
  assert.equal(haven.next_step, 'check_via_onboarding');
});

test('buildTriageView attaches proposals per restaurant, newest first, with events in order and actors reduced to self/ref', () => {
  const proposals = [
    { id: 'p-old', restaurant_id: '1', kind: 'add_candidate', proposed_url: 'https://bistrohaven.example.com/menu', status: 'rejected', proposed_by: OTHER, proposed_at: '2026-10-01T10:00:00Z', decided_by: VIEWER, decided_at: '2026-10-02T10:00:00Z', decision_note: 'Verkeerde pagina', source_triage_proposal_events: [
      { event: 'rejected', actor_user_id: VIEWER, note: 'Verkeerde pagina', created_at: '2026-10-02T10:00:00Z' },
      { event: 'proposed', actor_user_id: OTHER, note: null, created_at: '2026-10-01T10:00:00Z' },
    ] },
    { id: 'p-new', restaurant_id: '1', kind: 'replace_source', proposed_url: 'https://haven-nieuw.example.com/', current_url: 'https://bistrohaven.example.com/', status: 'open', proposed_by: VIEWER, proposed_at: '2026-10-03T10:00:00Z', source_triage_proposal_events: [{ event: 'proposed', actor_user_id: VIEWER, created_at: '2026-10-03T10:00:00Z' }] },
    { id: 'p-orphan', restaurant_id: '99', kind: 'add_candidate', status: 'open', proposed_by: OTHER, proposed_at: '2026-10-03T10:00:00Z' },
  ];
  const view = buildTriageView({ queue: queueWithFailedGrillhuis(), restaurants: RESTAURANTS, proposals, viewerId: VIEWER });
  assert.equal(view.orphanProposals, 1);
  const haven = view.restaurants.find((r) => r.restaurant_id === '1');
  assert.deepEqual(haven.proposals.map((p) => p.id), ['p-new', 'p-old']);
  assert.equal(haven.open_proposal_id, 'p-new');
  assert.equal(haven.next_step, 'review_proposal');
  assert.deepEqual(haven.proposals[0].proposed_by, { self: true, ref: 'aaaaaaaa' });
  const old = haven.proposals[1];
  assert.deepEqual(old.events.map((e) => e.event), ['proposed', 'rejected']);
  assert.deepEqual(old.proposed_by, { self: false, ref: 'bbbbbbbb' });
  assert.deepEqual(old.decided_by, { self: true, ref: 'aaaaaaaa' });
  assert.equal(JSON.stringify(view).includes(OTHER), false, 'a full user id never leaves the view');
  assert.equal(view.restaurants[0].restaurant_id, '1', 'open proposals sort first');
});

test('filterTriage and countTriage agree, and counts never invent work', () => {
  const view = buildTriageView({
    queue: queueWithFailedGrillhuis(),
    restaurants: RESTAURANTS,
    proposals: [{ id: 'p', restaurant_id: '1', kind: 'add_candidate', status: 'open', proposed_by: VIEWER, proposed_at: '2026-10-03T10:00:00Z' }],
    viewerId: VIEWER,
  });
  const counts = countTriage(view.restaurants);
  assert.deepEqual(counts, { all: 3, open_proposal: 1, needs_source: 2, no_check: 2 });
  for (const f of Object.keys(counts)) assert.equal(filterTriage(view.restaurants, { filter: f }).length, counts[f], f);
  assert.deepEqual(filterTriage(view.restaurants, { query: 'grill' }).map((r) => r.restaurant_id), ['3']);
  assert.deepEqual(filterTriage(view.restaurants, { query: 'bistrohaven' }).map((r) => r.restaurant_id), ['1']);
  assert.deepEqual(countTriage([]), { all: 0, open_proposal: 0, needs_source: 0, no_check: 0 });
});

test('the module is pure: no network, database, React or DOM', () => {
  const src = require('node:fs')
    .readFileSync(require.resolve('./sourceTriage'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(src, /\bfetch\(|safeOutboundFetch|restaurantSourceFetch|supabase|require\(['"]react|document\.|window\./i);
});
