'use strict';

// #62 — request handling behind GET /api/internal/v1/workqueue-counts: the real
// numbers for "Werkvoorraad (N)" and the "Open werk" rows. Read only; no writes,
// no external fetch, no AI, no migration. CommonJS with injected dependencies
// (the same pattern as src/lib/sourceTriageHandlers.js), so authentication, role
// scoping, the "no query before authorization" rule and the "a failed count is
// null, never 0" rule are tested behaviourally.
//
// Only the sections the caller may already see are counted: an `internal`
// account never triggers the editor-only moderation queries, and an
// `editor`-only account only counts its own queue. The bounds below are the same
// bounds the pages themselves use, so the number always matches the list a click
// opens.

const { isInternalOnly } = require('./importInbox');
const { isEditorRole, resolveVisibleModules } = require('./internalNav');
const { countSnapshotConceptsAwaitingReview, countNewInboxCandidates, sumAvailableCounts } = require('./workqueueCounts');

const CONCEPT_LIMIT = 300;
const INBOX_RECORD_LIMIT = 2000;
const INBOX_REVIEW_LIMIT = 4000;

const FORBIDDEN = 'Alleen interne medewerkers kunnen de werkvoorraad zien.';

function createWorkqueueCountsHandlers(deps) {
  const { authenticate, getSupabase } = deps;

  async function countExact(supabase, table, column, value) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(column, value);
    if (error) return null;
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  async function loadMenuConceptCount(supabase) {
    const { data, error } = await supabase
      .from('menu_snapshot_proposals')
      .select('id, restaurant_id, menu_context, version')
      .order('created_at', { ascending: false })
      .limit(CONCEPT_LIMIT);
    if (error) return null;
    const rows = Array.isArray(data) ? data : [];
    const ids = rows.map((row) => row && row.id).filter((id) => id !== undefined && id !== null);
    if (ids.length === 0) return 0;
    const reviews = await supabase
      .from('menu_snapshot_reviews')
      .select('id, snapshot_id, decided_at, decision')
      .in('snapshot_id', ids);
    if (reviews.error) return null;
    return countSnapshotConceptsAwaitingReview(rows, reviews.data || []);
  }

  async function loadSourceTriageCount(supabase) {
    return countExact(supabase, 'source_triage_proposals', 'status', 'proposed');
  }

  async function loadImportInboxCount(supabase) {
    const records = await supabase
      .from('import_extraction_records')
      .select('id')
      .order('retrieved_at', { ascending: false })
      .limit(INBOX_RECORD_LIMIT);
    if (records.error) return null;
    const reviews = await supabase
      .from('import_candidate_reviews')
      .select('id, candidate_id, decided_at, status')
      .order('decided_at', { ascending: false })
      .limit(INBOX_REVIEW_LIMIT);
    if (reviews.error) return null;
    return countNewInboxCandidates(records.data || [], reviews.data || []);
  }

  async function loadModerationCount(supabase) {
    const pendingChanges = await countExact(supabase, 'pending_changes', 'status', 'pending');
    const pendingClaims = await countExact(supabase, 'restaurant_claims', 'status', 'pending');
    return sumAvailableCounts([pendingChanges, pendingClaims]);
  }

  const LOADERS = {
    'menu-concepts': loadMenuConceptCount,
    'source-triage': loadSourceTriageCount,
    'import-inbox': loadImportInboxCount,
    moderation: loadModerationCount,
  };

  /** GET — the real counts for exactly the sections this account may open. */
  async function getCounts(request) {
    const auth = await authenticate(request);
    if (!auth || !auth.ok) {
      return { status: (auth && auth.status) || 401, body: { error: (auth && auth.error) || 'Niet ingelogd.' } };
    }
    const roles = Array.isArray(auth.roles) ? auth.roles : [];
    if (!isInternalOnly(roles) && !isEditorRole(roles)) {
      return { status: 403, body: { error: FORBIDDEN } };
    }

    const wanted = resolveVisibleModules(roles)
      .map((module) => module.countKey)
      .filter((key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(LOADERS, key));

    const supabase = getSupabase();
    const counts = {};
    for (const key of wanted) {
      counts[key] = await LOADERS[key](supabase);
    }
    return { status: 200, body: { counts } };
  }

  return { getCounts };
}

module.exports = { createWorkqueueCountsHandlers, CONCEPT_LIMIT, INBOX_RECORD_LIMIT, INBOX_REVIEW_LIMIT };
