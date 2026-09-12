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
 * Groups an unordered list of draft header rows by `source_candidate_id`,
 * keeping only each candidate's single most-recently-discarded
 * (`status === 'discarded'`) draft — a candidate can accumulate more than
 * one discarded draft over time (e.g. promote, discard, restart, discard
 * again), so "latest wins" is required here, unlike
 * buildActiveProfileDraftByCandidateId's direct map (at most one active
 * draft per candidate is already guaranteed by the migration's partial
 * unique index). Tie-broken by `id` lexicographically (never `Number()`
 * — unlike the field-facts ledger's bigint identity ids,
 * `restaurant_profile_drafts.id` is an application-generated UUIDv7 —
 * see src/lib/uuidv7.js — whose lexicographic order already matches
 * creation order, so this is a safe, deterministic tie-break; a true
 * same-millisecond `discarded_at` tie is not expected in practice
 * either way). Added 2026-09-12 for the candidate detail card's
 * "Previous profile draft discarded" line — purely a presentation
 * addition; this never changes what counts as active/discardable
 * (canPromoteCandidateToProfileDraft/canDiscardCandidateDraft below
 * still only ever look at the *active* draft). Returns
 * `{ [candidateId]: { id, status, discarded_at, discard_note,
 * promoted_at } }`.
 */
function buildLatestDiscardedProfileDraftByCandidateId(allDraftRows) {
  const byCandidateId = {};
  for (const row of allDraftRows || []) {
    if (!row || !row.source_candidate_id || row.status !== 'discarded') continue;
    if (!byCandidateId[row.source_candidate_id]) byCandidateId[row.source_candidate_id] = [];
    byCandidateId[row.source_candidate_id].push(row);
  }
  const result = {};
  for (const candidateId of Object.keys(byCandidateId)) {
    let latest = null;
    for (const row of byCandidateId[candidateId]) {
      if (!latest) {
        latest = row;
        continue;
      }
      const latestTime = new Date(latest.discarded_at).getTime();
      const rowTime = new Date(row.discarded_at).getTime();
      if (rowTime > latestTime || (rowTime === latestTime && String(row.id) > String(latest.id))) {
        latest = row;
      }
    }
    if (latest) {
      result[candidateId] = {
        id: latest.id,
        status: latest.status,
        discarded_at: latest.discarded_at || null,
        discard_note: latest.discard_note || null,
        promoted_at: latest.promoted_at,
      };
    }
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
 * Reduces one candidate's draft lineage (its `profile_draft` from
 * buildActiveProfileDraftByCandidateId and `latest_discarded_draft` from
 * buildLatestDiscardedProfileDraftByCandidateId, both already attached by
 * enrichAndFilterCandidates) to the single fact the candidate detail
 * card's compact status row needs to show — added 2026-09-12 for the
 * mockup-driven presentation rebuild (docs/mockups/restaurant-profile-drafts-detail-v1.png).
 * An active draft always wins over a discarded one — a candidate that
 * was discarded and later restarted must show "active," never stale
 * "discarded" history, exactly matching what canDiscardCandidateDraft
 * above already treats as authoritative. Purely a display reducer: it
 * never decides whether an action is allowed (canPromoteCandidateToProfileDraft/
 * canDiscardCandidateDraft still own that), only what the status row's
 * third item says.
 */
function buildDraftLineageSummary(candidate) {
  const activeDraft = candidate && candidate.profile_draft;
  if (activeDraft && activeDraft.status === 'draft') {
    return { state: 'active', promoted_at: activeDraft.promoted_at, draft_id: activeDraft.id };
  }
  const discardedDraft = candidate && candidate.latest_discarded_draft;
  if (discardedDraft) {
    return {
      state: 'discarded',
      discarded_at: discardedDraft.discarded_at,
      discard_note: discardedDraft.discard_note,
      draft_id: discardedDraft.id,
    };
  }
  return { state: 'none' };
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

/**
 * Shapes ALL draft header rows — active AND discarded, unlike
 * buildActiveProfileDraftByCandidateId above, which deliberately keeps
 * only the active one per candidate — into the read-only list
 * /internal/profile-drafts renders (added as the next step after the
 * production smoke test, 2026-09-12). Resolves `source_candidate_id`,
 * `possible_duplicate_of_draft_id`, and `restarted_from_draft_id` to a
 * human-readable candidate name via `candidateNameById` (built by the
 * caller from one already-run `import_extraction_records` query — the
 * exact same "one query, resolve here" pattern this module and
 * importInbox.js already use throughout; never a second Supabase query
 * per row). Deliberately does NOT include per-field facts
 * (address/phone/website) — those already live on the source candidate's
 * own card in the import-review queue; repeating them here would be the
 * exact duplicate information this overview is scoped to avoid. Sorted
 * newest-first by `promoted_at`. Pure; never touches Supabase.
 */
function buildProfileDraftOverviewRows(allDraftRows, candidateNameById) {
  const namesById = candidateNameById || {};
  const rows = (allDraftRows || []).filter((row) => row && row.id);

  // Resolves possible_duplicate_of_draft_id/restarted_from_draft_id (both
  // OTHER draft ids) to a candidate name via the same already-fetched
  // list — never a second query for a "which candidate is that draft
  // for" lookup.
  const candidateNameByDraftId = {};
  for (const row of rows) {
    candidateNameByDraftId[row.id] = namesById[row.source_candidate_id] || null;
  }

  function resolveDraftRef(draftId) {
    if (!draftId) return null;
    return { draft_id: draftId, candidate_name: candidateNameByDraftId[draftId] || null };
  }

  return rows
    .map((row) => ({
      id: row.id,
      status: row.status,
      candidate_name: namesById[row.source_candidate_id] || null,
      source_candidate_id: row.source_candidate_id,
      promoted_at: row.promoted_at,
      possible_duplicate_of: resolveDraftRef(row.possible_duplicate_of_draft_id),
      restarted_from: resolveDraftRef(row.restarted_from_draft_id),
      // Discard fields are only ever non-null when status === 'discarded'
      // (the migration's own three-biconditional check guarantees this),
      // but the check here is kept explicit rather than trusted blindly.
      discarded_at: row.status === 'discarded' ? row.discarded_at || null : null,
      discard_note: row.status === 'discarded' ? row.discard_note || null : null,
    }))
    .sort((a, b) => new Date(b.promoted_at).getTime() - new Date(a.promoted_at).getTime());
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
  buildLatestDiscardedProfileDraftByCandidateId,
  buildDraftLineageSummary,
  canPromoteCandidateToProfileDraft,
  canDiscardCandidateDraft,
  findPossibleDuplicateDraftId,
  buildProfileDraftOverviewRows,
};
