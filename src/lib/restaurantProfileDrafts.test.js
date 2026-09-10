'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ALLOWED_DRAFT_STATUSES,
  ALLOWED_DRAFT_FIELD_NAMES,
  ALLOWED_DRAFT_FIELD_ORIGINS,
  MAX_DISCARD_NOTE_LENGTH,
  validateDiscardRequestInput,
  discardValidationMessage,
  pickLatestDraftFactRow,
  buildDraftFieldsByDraftId,
  buildActiveProfileDraftByCandidateId,
  canPromoteCandidateToProfileDraft,
  canDiscardCandidateDraft,
  findPossibleDuplicateDraftId,
} = require('./restaurantProfileDrafts');

// ─── Constants — kept in sync with the migration's own check constraints ──

test('ALLOWED_DRAFT_STATUSES matches the migration exactly', () => {
  assert.deepEqual(ALLOWED_DRAFT_STATUSES, ['draft', 'discarded']);
});

test('ALLOWED_DRAFT_FIELD_NAMES matches the migration exactly — no menu/price/photo/marketing/owner-contact field', () => {
  assert.deepEqual(ALLOWED_DRAFT_FIELD_NAMES, ['name', 'category', 'address', 'phone', 'website']);
});

test('ALLOWED_DRAFT_FIELD_ORIGINS is exactly import/enrichment — never a third, free-form value', () => {
  assert.deepEqual(ALLOWED_DRAFT_FIELD_ORIGINS, ['import', 'enrichment']);
});

// ─── pickLatestDraftFactRow ─────────────────────────────────────────────

test('pickLatestDraftFactRow: returns null given no rows', () => {
  assert.equal(pickLatestDraftFactRow([]), null);
  assert.equal(pickLatestDraftFactRow(null), null);
  assert.equal(pickLatestDraftFactRow(undefined), null);
});

test('pickLatestDraftFactRow: picks the row with the latest recorded_at', () => {
  const rows = [
    { id: 1, recorded_at: '2026-09-01T00:00:00Z', value: 'old' },
    { id: 2, recorded_at: '2026-09-06T00:00:00Z', value: 'new' },
  ];
  assert.equal(pickLatestDraftFactRow(rows).value, 'new');
});

test('pickLatestDraftFactRow: ties on recorded_at are broken by the higher id', () => {
  const rows = [
    { id: 5, recorded_at: '2026-09-06T00:00:00Z', value: 'a' },
    { id: 9, recorded_at: '2026-09-06T00:00:00Z', value: 'b' },
  ];
  assert.equal(pickLatestDraftFactRow(rows).value, 'b');
});

test('pickLatestDraftFactRow: ignores malformed rows without throwing', () => {
  const rows = [null, { recorded_at: null }, { id: 1, recorded_at: '2026-09-06T00:00:00Z', value: 'ok' }];
  assert.equal(pickLatestDraftFactRow(rows).value, 'ok');
});

// ─── buildDraftFieldsByDraftId ──────────────────────────────────────────

test('buildDraftFieldsByDraftId: groups by draft then field, reducing each to its latest fact', () => {
  const rows = [
    { id: 1, draft_id: 'd1', field_name: 'phone', value: '0031612345678', origin: 'import', recorded_at: '2026-09-06T10:00:00Z', recorded_by: 'u1' },
    {
      id: 2,
      draft_id: 'd1',
      field_name: 'phone',
      value: '06 12345678',
      origin: 'enrichment',
      source_enrichment_id: 42,
      recorded_at: '2026-09-06T11:00:00Z',
      recorded_by: 'u1',
    },
    { id: 3, draft_id: 'd1', field_name: 'name', value: 'De Testkamer', origin: 'import', recorded_at: '2026-09-06T10:00:00Z', recorded_by: 'u1' },
    { id: 4, draft_id: 'd2', field_name: 'name', value: 'Other Place', origin: 'import', recorded_at: '2026-09-06T10:00:00Z', recorded_by: 'u1' },
  ];
  const result = buildDraftFieldsByDraftId(rows);
  assert.equal(result.d1.phone.value, '06 12345678');
  assert.equal(result.d1.phone.origin, 'enrichment');
  assert.equal(result.d1.phone.source_enrichment_id, 42);
  assert.equal(result.d1.name.value, 'De Testkamer');
  assert.equal(result.d2.name.value, 'Other Place');
  assert.equal(result.d1.address, undefined, 'a field with no fact at all must not appear, never a placeholder');
});

test('buildDraftFieldsByDraftId: returns an empty object given no rows, never throws', () => {
  assert.deepEqual(buildDraftFieldsByDraftId([]), {});
  assert.deepEqual(buildDraftFieldsByDraftId(null), {});
});

// ─── buildActiveProfileDraftByCandidateId ───────────────────────────────

test('buildActiveProfileDraftByCandidateId: keeps only status="draft" rows, keyed by source_candidate_id', () => {
  const rows = [
    { id: 'd1', source_candidate_id: 'c1', status: 'draft', promoted_by: 'u1', promoted_at: '2026-09-06T10:00:00Z' },
    { id: 'd2', source_candidate_id: 'c2', status: 'discarded', promoted_by: 'u1', promoted_at: '2026-09-05T10:00:00Z' },
  ];
  const result = buildActiveProfileDraftByCandidateId(rows);
  assert.equal(result.c1.id, 'd1');
  assert.equal(result.c2, undefined, 'a discarded draft must never surface here — out of this feature\'s UI scope this round');
});

test('buildActiveProfileDraftByCandidateId: carries restarted_from_draft_id and possible_duplicate_of_draft_id through, null when absent', () => {
  const rows = [
    {
      id: 'd3',
      source_candidate_id: 'c1',
      status: 'draft',
      promoted_by: 'u1',
      promoted_at: '2026-09-06T10:00:00Z',
      restarted_from_draft_id: 'd1',
      possible_duplicate_of_draft_id: null,
    },
  ];
  const result = buildActiveProfileDraftByCandidateId(rows);
  assert.equal(result.c1.restarted_from_draft_id, 'd1');
  assert.equal(result.c1.possible_duplicate_of_draft_id, null);
});

test('buildActiveProfileDraftByCandidateId: returns an empty object given no rows, never throws', () => {
  assert.deepEqual(buildActiveProfileDraftByCandidateId([]), {});
  assert.deepEqual(buildActiveProfileDraftByCandidateId(null), {});
});

// ─── canPromoteCandidateToProfileDraft ──────────────────────────────────

test('canPromoteCandidateToProfileDraft: true only for approved_internal with no active draft', () => {
  assert.equal(canPromoteCandidateToProfileDraft({ review_status: 'approved_internal', profile_draft: null }), true);
});

test('canPromoteCandidateToProfileDraft: false for every non-approved_internal status', () => {
  for (const status of ['new', 'needs_enrichment', 'rejected', 'deferred']) {
    assert.equal(canPromoteCandidateToProfileDraft({ review_status: status, profile_draft: null }), false, `expected false for ${status}`);
  }
});

test('canPromoteCandidateToProfileDraft: false once an active draft already exists', () => {
  assert.equal(
    canPromoteCandidateToProfileDraft({ review_status: 'approved_internal', profile_draft: { status: 'draft' } }),
    false
  );
});

test('canPromoteCandidateToProfileDraft: never throws on malformed input', () => {
  assert.equal(canPromoteCandidateToProfileDraft(null), false);
  assert.equal(canPromoteCandidateToProfileDraft(undefined), false);
  assert.equal(canPromoteCandidateToProfileDraft({}), false);
});

// ─── canDiscardCandidateDraft (discard/duplicate follow-up round,
// 2026-09-06, later still) ───────────────────────────────────────────────

test('canDiscardCandidateDraft: true only when an active (status="draft") draft exists', () => {
  assert.equal(canDiscardCandidateDraft({ profile_draft: { id: 'd1', status: 'draft' } }), true);
});

test('canDiscardCandidateDraft: false when there is no draft at all', () => {
  assert.equal(canDiscardCandidateDraft({ profile_draft: null }), false);
  assert.equal(canDiscardCandidateDraft({}), false);
});

test('canDiscardCandidateDraft: false for a discarded draft — never offers to discard twice', () => {
  assert.equal(canDiscardCandidateDraft({ profile_draft: { id: 'd1', status: 'discarded' } }), false);
});

test('canDiscardCandidateDraft: never throws on malformed input', () => {
  assert.equal(canDiscardCandidateDraft(null), false);
  assert.equal(canDiscardCandidateDraft(undefined), false);
});

// ─── validateDiscardRequestInput / discardValidationMessage (discard/
// duplicate follow-up round, 2026-09-06, later still) — a discard reason
// is mandatory, mirroring the migration's own tightened check
// constraint. ──────────────────────────────────────────────────────────

test('validateDiscardRequestInput: rejects a missing note', () => {
  assert.deepEqual(validateDiscardRequestInput({ note: undefined }), { valid: false, reason: 'missing-note' });
  assert.deepEqual(validateDiscardRequestInput({ note: null }), { valid: false, reason: 'missing-note' });
});

test('validateDiscardRequestInput: rejects a blank or whitespace-only note', () => {
  assert.deepEqual(validateDiscardRequestInput({ note: '' }), { valid: false, reason: 'missing-note' });
  assert.deepEqual(validateDiscardRequestInput({ note: '   ' }), { valid: false, reason: 'missing-note' });
});

test('validateDiscardRequestInput: rejects a non-string note', () => {
  assert.deepEqual(validateDiscardRequestInput({ note: 42 }), { valid: false, reason: 'missing-note' });
});

test('validateDiscardRequestInput: rejects a note longer than MAX_DISCARD_NOTE_LENGTH', () => {
  const result = validateDiscardRequestInput({ note: 'x'.repeat(MAX_DISCARD_NOTE_LENGTH + 1) });
  assert.deepEqual(result, { valid: false, reason: 'note-too-long' });
});

test('validateDiscardRequestInput: accepts and trims a real reason', () => {
  assert.deepEqual(validateDiscardRequestInput({ note: '  Wrong restaurant matched  ' }), {
    valid: true,
    note: 'Wrong restaurant matched',
  });
});

test('discardValidationMessage: one safe, human-readable message per reason, never the raw input', () => {
  assert.match(discardValidationMessage('missing-note'), /required/i);
  assert.match(discardValidationMessage('note-too-long'), new RegExp(String(MAX_DISCARD_NOTE_LENGTH)));
  assert.equal(discardValidationMessage('something-unexpected'), 'Invalid request.');
});

// ─── findPossibleDuplicateDraftId ───────────────────────────────────────

test('findPossibleDuplicateDraftId: flags an active draft with the same normalized name within 100m', () => {
  const candidateFields = { name: 'De Testkamer', location: { lat: 51.5719, lon: 4.7683 } };
  const activeDrafts = [
    { draftId: 'd1', extractedFields: { name: '  de testkamer  ', location: { lat: 51.572, lon: 4.7684 } } },
  ];
  assert.equal(findPossibleDuplicateDraftId(candidateFields, activeDrafts), 'd1');
});

test('findPossibleDuplicateDraftId: null when names differ, even at the exact same location', () => {
  const candidateFields = { name: 'De Testkamer', location: { lat: 51.5719, lon: 4.7683 } };
  const activeDrafts = [{ draftId: 'd1', extractedFields: { name: 'Different Name', location: { lat: 51.5719, lon: 4.7683 } } }];
  assert.equal(findPossibleDuplicateDraftId(candidateFields, activeDrafts), null);
});

test('findPossibleDuplicateDraftId: null when the same name is far away (beyond the distance threshold)', () => {
  const candidateFields = { name: 'De Testkamer', location: { lat: 51.5719, lon: 4.7683 } };
  const activeDrafts = [{ draftId: 'd1', extractedFields: { name: 'De Testkamer', location: { lat: 52.3676, lon: 4.9041 } } }]; // Amsterdam
  assert.equal(findPossibleDuplicateDraftId(candidateFields, activeDrafts), null);
});

test('findPossibleDuplicateDraftId: null when the candidate itself is missing a name or location — never guessed at', () => {
  const activeDrafts = [{ draftId: 'd1', extractedFields: { name: 'De Testkamer', location: { lat: 51.5719, lon: 4.7683 } } }];
  assert.equal(findPossibleDuplicateDraftId({ name: 'De Testkamer' }, activeDrafts), null, 'missing location');
  assert.equal(findPossibleDuplicateDraftId({ location: { lat: 51.5719, lon: 4.7683 } }, activeDrafts), null, 'missing name');
});

test('findPossibleDuplicateDraftId: null given an empty or missing active-draft list', () => {
  const candidateFields = { name: 'De Testkamer', location: { lat: 51.5719, lon: 4.7683 } };
  assert.equal(findPossibleDuplicateDraftId(candidateFields, []), null);
  assert.equal(findPossibleDuplicateDraftId(candidateFields, undefined), null);
});

test('findPossibleDuplicateDraftId: returns the first matching draftId when multiple active drafts are given', () => {
  const candidateFields = { name: 'De Testkamer', location: { lat: 51.5719, lon: 4.7683 } };
  const activeDrafts = [
    { draftId: 'd-no-match', extractedFields: { name: 'Elsewhere', location: { lat: 52.0, lon: 5.0 } } },
    { draftId: 'd-match', extractedFields: { name: 'De Testkamer', location: { lat: 51.572, lon: 4.7684 } } },
  ];
  assert.equal(findPossibleDuplicateDraftId(candidateFields, activeDrafts), 'd-match');
});

// ─── Structural safety net: migration + route + page source ────────────
// Same pattern used throughout src/lib/importInbox.test.js — reads the
// actual source files directly, since this project has no live database
// or React render harness in `node --test`. The migration's own runtime
// behavior (RPC guards, the partial unique index, discard/restart,
// append-only grants) was additionally verified by hand in a disposable,
// throwaway local Postgres container (0001 through 0010 applied in
// sequence) before this feature was considered ready — never against the
// live Supabase project — see this round's own report for the transcript.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase/migrations/0010_market05c_restaurant_profile_drafts.sql');
const PROFILE_DRAFTS_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/profile-drafts/route.js');
const DISCARD_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/profile-drafts/[id]/discard/route.js');
const CANDIDATES_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/import-inbox/candidates/route.js');
const IMPORT_INBOX_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/import-inbox/page.js');

const FORBIDDEN_CANONICAL_IDENTIFIERS = ['restaurants', 'menus', 'dishes', 'data/restaurants.json', 'data/menus.json'];

test('structural safety net: the migration makes source_candidate_id unique only among active (status=\'draft\') rows — never a plain column-level unique', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.doesNotMatch(
    sql,
    /source_candidate_id\s+uuid\s+not\s+null\s+unique/i,
    'must never be a plain unique column constraint — that would make a deliberate restart after discard structurally impossible'
  );
  assert.match(
    sql,
    /create unique index if not exists idx_restaurant_profile_drafts_one_active_per_candidate\s+on restaurant_profile_drafts \(source_candidate_id\)\s+where status = 'draft'/
  );
});

test('structural safety net: the migration grants only select+insert on the field-facts ledger — no update, no delete, for any role', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(sql, /grant select, insert on public\.restaurant_profile_draft_field_facts to service_role/);
  assert.doesNotMatch(
    sql,
    /grant\s+(?:[\w,\s]*\b)?(update|delete)\b[\w,\s]*\bon\s+public\.restaurant_profile_draft_field_facts/i
  );
});

test('structural safety net: the migration\'s update grant on the header table is column-scoped to exactly the discard-related columns', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(
    sql,
    /grant update \(status, discarded_by, discarded_at, discard_note, possible_duplicate_of_draft_id\)\s+on public\.restaurant_profile_drafts to service_role/
  );
  // No blanket, unqualified "grant ... update on public.restaurant_profile_drafts" without a column list.
  assert.doesNotMatch(sql, /grant\s+update\s+on\s+public\.restaurant_profile_drafts\s+to/i);
});

test('structural safety net: the migration never grants a delete privilege on either new table', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.doesNotMatch(sql, /grant\s+(?:[\w,\s]*\b)?delete\b[\w,\s]*\bon\s+public\.restaurant_profile_drafts/i);
  assert.doesNotMatch(sql, /grant\s+(?:[\w,\s]*\b)?delete\b[\w,\s]*\bon\s+public\.restaurant_profile_draft_field_facts/i);
});

// ─── Discard/duplicate follow-up round (2026-09-06, later still) —
// mandatory discard_note, the RPC's own friendly guard, and the exact
// three-independent-biconditionals fix for a real gap found and closed
// during this round's own local Postgres validation (see this round's
// own report for the full transcript: a direct `update ... set
// discard_note = 'x'` on a `status = 'draft'` row was wrongly accepted
// by an earlier, single combined `and`-based check). ────────────────────

test('structural safety net: discard_note is required via three independent per-column biconditionals — never one combined "and" check that a single false sub-condition could satisfy', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(sql, /check \(\(status = 'discarded'\) = \(discarded_by is not null\)\)/);
  assert.match(sql, /check \(\(status = 'discarded'\) = \(discarded_at is not null\)\)/);
  assert.match(
    sql,
    /check \(\(status = 'discarded'\) = \(discard_note is not null and btrim\(discard_note\) <> ''\)\)/
  );
  // The old, buggy shape must never reappear: a single check combining
  // all three with "and" inside one biconditional.
  assert.doesNotMatch(
    sql,
    /\(status = 'discarded'\) = \(\s*discarded_by is not null and discarded_at is not null\s*\n\s*and discard_note is not null/
  );
});

test('structural safety net: discard_profile_draft refuses a missing/blank note with a friendly, typed error before ever attempting the update', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const fn = sql.match(/create or replace function discard_profile_draft\([\s\S]*?\n\$\$;/);
  assert.ok(fn, 'expected to find the discard_profile_draft function body');
  const noteCheckIndex = fn[0].indexOf("p_note is null or btrim(p_note) = ''");
  const updateIndex = fn[0].indexOf('update restaurant_profile_drafts');
  assert.ok(noteCheckIndex >= 0 && updateIndex > noteCheckIndex, 'the note guard must run before the update');
  assert.match(fn[0], /errcode = 'P0014'/);
  assert.match(fn[0], /discard_note = btrim\(p_note\)/, 'the stored note must be trimmed, matching the JS-layer validation');
});

test('structural safety net: discard_profile_draft is valid only from status=\'draft\' and never deletes anything', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const fn = sql.match(/create or replace function discard_profile_draft\([\s\S]*?\n\$\$;/);
  assert.match(fn[0], /where id = p_draft_id\s*\n\s*and status = 'draft'/);
  assert.doesNotMatch(fn[0], /delete\s+from/i);
});

test('structural safety net: field_name is a fixed five-value set matching ALLOWED_DRAFT_FIELD_NAMES exactly — no menu/price/photo/marketing/owner-contact field', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const match = sql.match(/field_name\s+text not null check \(field_name in \(([\s\S]*?)\)\)/);
  assert.ok(match, 'expected to find the field_name fixed-value check');
  const values = match[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.deepEqual(values, ALLOWED_DRAFT_FIELD_NAMES);
});

test('structural safety net: origin is a fixed two-value set matching ALLOWED_DRAFT_FIELD_ORIGINS exactly — never a third, free-form value', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const match = sql.match(/origin\s+text not null check \(origin in \(([\s\S]*?)\)\)/);
  assert.ok(match, 'expected to find the origin fixed-value check');
  const values = match[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.deepEqual(values, ALLOWED_DRAFT_FIELD_ORIGINS);
});

test('structural safety net: the promotion RPC re-derives the effective review status itself and never accepts one as a parameter', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const fn = sql.match(/create or replace function promote_candidate_to_profile_draft\([\s\S]*?\n\$\$;/);
  assert.ok(fn, 'expected to find the promote_candidate_to_profile_draft function body');
  assert.doesNotMatch(fn[0], /p_status|p_review_status/i, 'must never accept a caller-supplied status');
  assert.match(fn[0], /order by decided_at desc, id desc\s*\n\s*limit 1/, 'must re-derive the latest review row itself, same tie-break as pickLatestReviewRow');
  assert.match(fn[0], /v_effective_status is distinct from 'approved_internal'/);
});

test('structural safety net: the promotion RPC validates restarted_from_draft_id against a discarded draft for the same candidate before trusting it', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const fn = sql.match(/create or replace function promote_candidate_to_profile_draft\([\s\S]*?\n\$\$;/);
  assert.match(
    fn[0],
    /where id = p_restarted_from_draft_id\s*\n\s*and source_candidate_id = p_candidate_id\s*\n\s*and status = 'discarded'/
  );
});

test('structural safety net: the promotion RPC refuses a second active draft for the same candidate, with a friendly error, before ever attempting the insert', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const fn = sql.match(/create or replace function promote_candidate_to_profile_draft\([\s\S]*?\n\$\$;/);
  assert.match(fn[0], /where source_candidate_id = p_candidate_id and status = 'draft'/);
  assert.match(fn[0], /An active draft already exists for this candidate/);
  // Also caught as a genuine race via unique_violation, mapped to the
  // same friendly message rather than a raw constraint-violation leak.
  assert.match(fn[0], /when unique_violation then/);
});

test('structural safety net: the profile-drafts route never calls .update()/.delete(), and never references a canonical/public identifier', () => {
  const source = fs.readFileSync(PROFILE_DRAFTS_ROUTE_PATH, 'utf8');
  assert.doesNotMatch(source, /\.update\(/, 'no code path may ever attempt to update a draft directly — only the RPCs may');
  assert.doesNotMatch(source, /\.delete\(/, 'no code path may ever attempt to delete a draft or a fact');
  for (const identifier of FORBIDDEN_CANONICAL_IDENTIFIERS) {
    assert.equal(source.includes(identifier), false, `must never reference "${identifier}"`);
  }
  assert.doesNotMatch(source, /from\(['"]staff_roles['"]\)/, 'must never read or write staff_roles');
  assert.doesNotMatch(source, /from\(['"]restaurant_claims['"]\)/, 'must never read or write restaurant_claims');
  assert.doesNotMatch(source, /writeFileSync|appendFileSync/, 'must never write to any file on disk');
});

test('structural safety net: the profile-drafts route is internal-only, gated the same way as the rest of Data-inbox', () => {
  const source = fs.readFileSync(PROFILE_DRAFTS_ROUTE_PATH, 'utf8');
  assert.match(source, /authenticateInternalRequest\(request\)/);
  assert.match(source, /isInternalOnly\(auth\.roles\)/);
});

test('structural safety net: the profile-drafts route computes the possible-duplicate check in application code, before calling the promotion RPC, and never auto-confirms it', () => {
  const source = fs.readFileSync(PROFILE_DRAFTS_ROUTE_PATH, 'utf8');
  const duplicateCheckIndex = source.indexOf('findPossibleDuplicateDraftId(');
  const rpcCallIndex = source.indexOf(".rpc('promote_candidate_to_profile_draft'");
  assert.ok(duplicateCheckIndex >= 0 && rpcCallIndex > duplicateCheckIndex, 'the duplicate heuristic must run before the RPC call');
  assert.match(source, /possibleDuplicateDraftId !== confirmPossibleDuplicateOfDraftId/, 'a detected duplicate must require an explicit, matching confirmation — never auto-confirmed');
  assert.match(source, /status: 409/, 'an unconfirmed possible duplicate must be surfaced as a distinct, structured response');
});

test('structural safety net: the profile-drafts route generates the draft id application-side (UUIDv7) — never lets Postgres default it', () => {
  const source = fs.readFileSync(PROFILE_DRAFTS_ROUTE_PATH, 'utf8');
  assert.match(source, /generateUuidV7\(\)/);
  assert.match(source, /p_draft_id: draftId/);
});

test('structural safety net: the candidates list route reads active profile drafts read-only, never writes one', () => {
  const source = fs.readFileSync(CANDIDATES_ROUTE_PATH, 'utf8');
  assert.match(source, /from\('restaurant_profile_drafts'\)/);
  assert.match(source, /\.eq\('status', 'draft'\)/);
  assert.doesNotMatch(source, /restaurant_profile_drafts[\s\S]{0,80}\.(insert|update|delete)\(/);
});

test('structural safety net: the import-inbox page gates the "Create Restaurant Profile Draft" action on approved_internal and hides it once an active draft exists', () => {
  const source = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  assert.match(source, /canPromoteCandidateToProfileDraft\(c\)/, 'the button must be gated by the pure, tested eligibility function');
  assert.match(source, /Create Restaurant Profile Draft/);
  assert.match(source, /Restaurant Profile Draft already created/);
});

test('structural safety net: the promote button is disabled while a submission for that candidate is already in flight — never double-clickable', () => {
  const source = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  const match = source.match(/onClick=\{\(\) => promoteToProfileDraft\(c\.id\)\}[\s\S]{0,120}?disabled=\{profileDraftSubmittingId === c\.id\}/);
  assert.ok(match, 'expected the "Create Restaurant Profile Draft" button to be disabled while submitting for this exact candidate');
});

test('structural safety net: the duplicate-confirmation prompt only ever offers "Promote anyway" with the flagged draft id echoed back — never a silent auto-merge', () => {
  const source = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  assert.match(source, /promoteToProfileDraft\(c\.id, profileDraftDuplicateByCandidateId\[c\.id\]\)/);
  assert.match(source, /Promote anyway/);
  assert.match(source, /possible duplicate of an already-promoted draft/i);
});

test('structural safety net: promoteToProfileDraft never sends a confirmation id unless the caller explicitly passed one', () => {
  const source = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  const fn = source.match(/async function promoteToProfileDraft\(candidateId, confirmPossibleDuplicateOfDraftId\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'expected to find the promoteToProfileDraft function body');
  assert.match(fn[0], /\.\.\.\(confirmPossibleDuplicateOfDraftId \? \{ confirm_possible_duplicate_of_draft_id: confirmPossibleDuplicateOfDraftId \} : \{\}\)/);
});

// ─── Discard/duplicate follow-up round (2026-09-06, later still) ───────

test('structural safety net: the promote route stores the server\'s own freshly recomputed possible-duplicate id on the RPC call — never blindly forwards the client\'s confirmation value', () => {
  const source = fs.readFileSync(PROFILE_DRAFTS_ROUTE_PATH, 'utf8');
  // The RPC call must be passed the variable the server itself computed
  // via findPossibleDuplicateDraftId, not a client-supplied field — the
  // 409-vs-proceed branch above it is what guarantees these two are ever
  // allowed to differ in the caller's favor, but the value actually
  // stored must always be the server's own.
  assert.match(source, /p_possible_duplicate_of_draft_id: possibleDuplicateDraftId,/);
  assert.doesNotMatch(source, /p_possible_duplicate_of_draft_id: confirmPossibleDuplicateOfDraftId/);
});

test('structural safety net: the discard route calls only discard_profile_draft, never .update()/.delete(), and is internal-only', () => {
  const source = fs.readFileSync(DISCARD_ROUTE_PATH, 'utf8');
  assert.match(source, /authenticateInternalRequest\(request\)/);
  assert.match(source, /isInternalOnly\(auth\.roles\)/);
  assert.match(source, /\.rpc\('discard_profile_draft', \{/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
  for (const identifier of FORBIDDEN_CANONICAL_IDENTIFIERS) {
    assert.equal(source.includes(identifier), false, `must never reference "${identifier}"`);
  }
});

test('structural safety net: the discard route validates the reason before ever calling the RPC, and maps P0013/P0014 to distinct, friendly responses', () => {
  const source = fs.readFileSync(DISCARD_ROUTE_PATH, 'utf8');
  const validateIndex = source.indexOf('validateDiscardRequestInput(');
  const rpcIndex = source.indexOf(".rpc('discard_profile_draft'");
  assert.ok(validateIndex >= 0 && rpcIndex > validateIndex, 'validation must run before the RPC call');
  assert.match(source, /error\.code === 'P0013'/);
  assert.match(source, /error\.code === 'P0014'/);
});

test('structural safety net: the import-inbox page gates the "Discard Restaurant Profile Draft" action on an active draft, requires an explicit confirm step and a non-empty reason', () => {
  const source = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  assert.match(source, /canDiscardCandidateDraft\(c\)/, 'the discard action must be gated by the pure, tested eligibility function');
  assert.match(source, /Discard Restaurant Profile Draft/);
  assert.match(source, /Confirm discard/, 'discarding must require a distinct, explicit confirm action, not the first click');
  const confirmButton = source.match(
    /onClick=\{\(\) => discardProfileDraft\(c\.id, c\.profile_draft\.id\)\}[\s\S]{0,160}?disabled=\{discardSubmittingId === c\.id \|\| !\(discardNoteByCandidateId\[c\.id\] \|\| ''\)\.trim\(\)\}/
  );
  assert.ok(confirmButton, 'the "Confirm discard" button must stay disabled until a non-empty reason is typed, and while submitting');
});

test('structural safety net: discardProfileDraft never submits an empty reason and always calls the discard route for that exact draft', () => {
  const source = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  const fn = source.match(/async function discardProfileDraft\(candidateId, draftId\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'expected to find the discardProfileDraft function body');
  assert.match(fn[0], /if \(!note\) return/, 'must never fire a request with an empty reason');
  assert.match(fn[0], /`\/api\/internal\/v1\/profile-drafts\/\$\{draftId\}\/discard`/);
});

test('structural safety net: a successful discard reloads the candidate list and shows a message that a restart is always a new, explicit promotion with a new draft id', () => {
  const source = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  const fn = source.match(/async function discardProfileDraft\(candidateId, draftId\) \{[\s\S]*?\n  \}/);
  assert.match(fn[0], /await loadCandidates\(/, 'must reload candidates so the promote button reappears once profile_draft is actually null');
  assert.match(source, /A restart is always a new, explicit promotion/);
});

test('structural safety net: discarding never automatically starts a restart — the promote button only ever fires from its own, separate, explicit click', () => {
  const source = fs.readFileSync(IMPORT_INBOX_PAGE_PATH, 'utf8');
  const fn = source.match(/async function discardProfileDraft\(candidateId, draftId\) \{[\s\S]*?\n  \}/);
  assert.doesNotMatch(fn[0], /promoteToProfileDraft\(/, 'discardProfileDraft must never itself call promoteToProfileDraft');
});
