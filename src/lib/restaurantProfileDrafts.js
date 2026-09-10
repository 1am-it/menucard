// Pure decision logic for MARKET-05C — Restaurant Profile Drafts
// (app/api/internal/v1/profile-drafts + the "Create Restaurant Profile
// Draft" action on /internal/import-inbox's approved_internal detail
// view). Implements docs/api/restaurant-profile-drafts-schema.md's
// contract exactly — see that document for the full design/reasoning.
//
// Deliberately its own module, not folded into src/lib/importInbox.js:
// MARKET-05C is documented as its own, distinct ticket (not a
// redefinition of MARKET-05A or MARKET-05B — see the schema contract's
// own "Resolved decisions"). It reuses importInbox.js's already-tested
// name/geo-distance primitives rather than duplicating them.
//
// This module never touches Supabase, the DOM, or React — it only takes
// already-fetched rows/values and returns a decision or a reshaped value.
// The API route and the page are the only places that actually call the
// Supabase client or render anything. The actual promotion/discard writes
// happen only via supabase/migrations/0010_market05c_restaurant_profile_drafts.sql's
// RPCs (`promote_candidate_to_profile_draft`, `discard_profile_draft`) —
// this module never proposes a write of its own.

'use strict';

const { normalizeName, haversineDistanceMeters, DUPLICATE_DISTANCE_METERS } = require('./importInbox');

/** The only statuses a draft header row may ever hold — matches
 * supabase/migrations/0010_market05c_restaurant_profile_drafts.sql's own
 * `status` check constraint exactly. */
const ALLOWED_DRAFT_STATUSES = ['draft', 'discarded'];

/** The only fields a draft's field-fact ledger may ever cover — matches
 * the migration's own `field_name` check constraint exactly. Deliberately
 * identical scope to what MARKET-05A already collects: no menu, price,
 * photo, marketing, or owner-contact field exists in this list. */
const ALLOWED_DRAFT_FIELD_NAMES = ['name', 'category', 'address', 'phone', 'website'];

/** The only two provenance origins a field fact may ever carry — never a
 * third, free-form "manual correction" value. See the schema contract's
 * own "Field-level provenance" section for why. */
const ALLOWED_DRAFT_FIELD_ORIGINS = ['import', 'enrichment'];

/** Matches the migration's own `char_length(discard_note) <= 2000`
 * check — enforced here too so a caller gets a clear, immediate `400`
 * instead of relying solely on the database constraint. Same bound as
 * importInbox.js's MAX_REVIEW_NOTE_LENGTH. */
const MAX_DISCARD_NOTE_LENGTH = 2000;

/**
 * Validates a discard request body before it ever reaches
 * `discard_profile_draft` — a UX/clarity guard only, never the
 * authoritative check (the migration's own check constraint and the
 * RPC's own explicit guard are, enforced regardless of what any caller
 * sends). A discard reason is mandatory (added 2026-09-06, later still —
 * discard/duplicate follow-up round): a discarded draft's own
 * `discard_note` must be non-null and non-blank, per the migration's
 * updated constraint — never optional the way a review's free-text
 * `note` is.
 */
function validateDiscardRequestInput({ note }) {
  if (typeof note !== 'string' || note.trim().length === 0) {
    return { valid: false, reason: 'missing-note' };
  }
  if (note.trim().length > MAX_DISCARD_NOTE_LENGTH) {
    return { valid: false, reason: 'note-too-long' };
  }
  return { valid: true, note: note.trim() };
}

/** One safe, human-readable message per validation failure reason. */
function discardValidationMessage(reason) {
  if (reason === 'missing-note') return 'A short internal discard reason is required.';
  if (reason === 'note-too-long') return `Discard reason must be at most ${MAX_DISCARD_NOTE_LENGTH} characters.`;
  return 'Invalid request.';
}

/**
 * Picks the single latest row from one draft field's full fact history —
 * the row with the latest `recorded_at`, tie-broken by the higher `id`.
 * Identical tie-break rule to importInbox.js's own
 * pickLatestReviewRow/pickLatestEnrichmentRow. Returns `null` given no
 * rows — never throws, never guesses from partial/malformed input.
 */
function pickLatestDraftFactRow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let latest = null;
  for (const row of rows) {
    if (!row || !row.recorded_at) continue;
    if (!latest) {
      latest = row;
      continue;
    }
    const latestTime = new Date(latest.recorded_at).getTime();
    const rowTime = new Date(row.recorded_at).getTime();
    if (rowTime > latestTime || (rowTime === latestTime && Number(row.id) > Number(latest.id))) {
      latest = row;
    }
  }
  return latest;
}

/**
 * Groups an unordered list of field-fact rows (as returned by a single,
 * un-filtered `restaurant_profile_draft_field_facts` query covering many
 * drafts) by `draft_id`, then by `field_name`, and reduces each
 * (draft, field) group to its effective (latest) row —
 * `{ [draftId]: { [fieldName]: { value, origin, source_enrichment_id,
 * recorded_by, recorded_at } } }`. Pure; never touches Supabase. Mirrors
 * importInbox.js's own buildEnrichmentSourceByCandidateId one layer up.
 */
function buildDraftFieldsByDraftId(allFactRows) {
  const byDraft = {};
  for (const row of allFactRows || []) {
    if (!row || !row.draft_id || !row.field_name) continue;
    if (!byDraft[row.draft_id]) byDraft[row.draft_id] = {};
    if (!byDraft[row.draft_id][row.field_name]) byDraft[row.draft_id][row.field_name] = [];
    byDraft[row.draft_id][row.field_name].push(row);
  }
  const result = {};
  for (const draftId of Object.keys(byDraft)) {
    result[draftId] = {};
    for (const fieldName of Object.keys(byDraft[draftId])) {
      const latest = pickLatestDraftFactRow(byDraft[draftId][fieldName]);
      if (latest) {
        result[draftId][fieldName] = {
          value: latest.value,
          origin: latest.origin,
          source_enrichment_id: latest.source_enrichment_id,
          recorded_by: latest.recorded_by,
          recorded_at: latest.recorded_at,
        };
      }
    }
  }
  return result;
}

/**
 * Groups an unordered list of draft header rows by `source_candidate_id`,
 * keeping only the *active* (`status === 'draft'`) one — never a
 * discarded one, per this feature's own scope this round (surfacing
 * discard history in the candidate list UI is not part of MARKET-05C's
 * first implementation). The partial unique index in
 * 0010_market05c_restaurant_profile_drafts.sql already guarantees at most
 * one active draft per candidate, so no "latest wins" reduction is
 * needed here — a direct map is always safe. Returns
 * `{ [candidateId]: { id, status, promoted_by, promoted_at,
 * restarted_from_draft_id, possible_duplicate_of_draft_id } }`.
 */
function buildActiveProfileDraftByCandidateId(allDraftRows) {
  const result = {};
  for (const row of allDraftRows || []) {
    if (!row || !row.source_candidate_id || row.status !== 'draft') continue;
    result[row.source_candidate_id] = {
      id: row.id,
      status: row.status,
      promoted_by: row.promoted_by,
      promoted_at: row.promoted_at,
      restarted_from_draft_id: row.restarted_from_draft_id || null,
      possible_duplicate_of_draft_id: row.possible_duplicate_of_draft_id || null,
    };
  }
  return result;
}

/**
 * Whether the "Create Restaurant Profile Draft" action should be offered
 * for one candidate (as already shaped by
 * importInbox.js's enrichAndFilterCandidates, which attaches
 * `review_status` and — as of this feature — `profile_draft`). `true`
 * only when the candidate's *effective* review status is
 * `approved_internal` and it does not already have an active draft. This
 * is a UX convenience only: `promote_candidate_to_profile_draft` (the
 * RPC) re-derives and re-checks both conditions itself, authoritatively,
 * regardless of what this function decides — a disabled/hidden button
 * here can never be the only thing standing between a candidate and an
 * invalid promotion.
 */
function canPromoteCandidateToProfileDraft(candidate) {
  if (!candidate || candidate.review_status !== 'approved_internal') return false;
  if (candidate.profile_draft && candidate.profile_draft.status === 'draft') return false;
  return true;
}

/**
 * Whether the "Discard Restaurant Profile Draft" action should be
 * offered for one candidate — `true` only when it already has an active
 * draft (added 2026-09-06, later still, discard/duplicate follow-up
 * round). A UX convenience only, same disclaimer as
 * canPromoteCandidateToProfileDraft above: `discard_profile_draft` (the
 * RPC) re-checks `status = 'draft'` itself, authoritatively.
 */
function canDiscardCandidateDraft(candidate) {
  return Boolean(candidate && candidate.profile_draft && candidate.profile_draft.status === 'draft');
}

/**
 * A read-only, non-authoritative HINT — never MARKET-05B's eventual real
 * deduplication/matching logic. Flags the one already-active draft whose
 * own source candidate "looks like the same place" as `candidateFields`
 * (case/whitespace-insensitive exact name match AND within
 * `DUPLICATE_DISTANCE_METERS`), reusing the exact same heuristic
 * importInbox.js's computePossibleDuplicateIds already applies one layer
 * down, applied here across "the candidate about to be promoted" and
 * "every candidate that already backs an active draft" instead of across
 * a whole run's candidates. Returns the first matching `draftId`, or
 * `null` if none. A candidate missing a name or a location is never
 * compared (can't be compared meaningfully) — never guessed at.
 */
function findPossibleDuplicateDraftId(candidateFields, activeDraftCandidates) {
  const name = normalizeName(candidateFields && candidateFields.name);
  const loc = candidateFields && candidateFields.location;
  if (!name || !loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return null;

  for (const draft of activeDraftCandidates || []) {
    const otherFields = draft && draft.extractedFields;
    const otherName = normalizeName(otherFields && otherFields.name);
    const otherLoc = otherFields && otherFields.location;
    if (!otherName || !otherLoc || typeof otherLoc.lat !== 'number' || typeof otherLoc.lon !== 'number') continue;
    if (otherName !== name) continue;
    if (haversineDistanceMeters(loc.lat, loc.lon, otherLoc.lat, otherLoc.lon) <= DUPLICATE_DISTANCE_METERS) {
      return draft.draftId;
    }
  }
  return null;
}

module.exports = {
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
};
