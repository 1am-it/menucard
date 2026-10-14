'use strict';

// BE-17 Menuconcepten beoordelen v1 — the one way a new internal menu
// concept version is written (BE-25 "Concept opslaan" and a reviewer's
// correction alike). A version is an immutable menu_snapshot_proposals row;
// nothing here publishes, fetches or touches data/menus.json.
//
//   - identical content (same content_hash as the latest version) creates
//     no new version;
//   - content whose public menu equals a version a human rejected is never
//     raised again as a new version (decision 016 §7);
//   - with an expected version, a stale view is refused, never overwritten;
//   - every new version records its maker, its analysis result and the
//     version it builds on (0018).

const { validateSnapshotProposalInput, groupReviewsBySnapshotId, deriveEffectiveSnapshotStatus } = require('./menuSnapshotProposals');
const { publicMenu } = require('./menuConcept');

/** All versions of one concept lineage, newest first, with their effective review status. */
async function loadLineage(supabase, { restaurantId, menuContext }) {
  const { data: rows, error } = await supabase
    .from('menu_snapshot_proposals')
    .select('id, restaurant_id, menu_context, version, content_hash, captured_content, source_url, source_type, quality_score, originally_fetched_at, created_at, created_by, origin_receipt_id, based_on_snapshot_id')
    .eq('restaurant_id', restaurantId)
    .eq('menu_context', menuContext);
  if (error) return { error };
  const versions = [...(rows || [])].sort((a, b) => b.version - a.version);
  let reviews = [];
  if (versions.length > 0) {
    const { data, error: reviewError } = await supabase
      .from('menu_snapshot_reviews')
      .select('id, snapshot_id, reviewer_id, decided_at, decision, reason, note')
      .in('snapshot_id', versions.map((v) => v.id));
    if (reviewError) return { error: reviewError };
    reviews = data || [];
  }
  const bySnapshot = groupReviewsBySnapshotId(reviews);
  for (const v of versions) {
    v.reviews = [...(bySnapshot[v.id] || [])].sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)) || b.id - a.id);
    v.status = deriveEffectiveSnapshotStatus(v.reviews);
  }
  return { versions };
}

/** True when this public menu equals one a human already rejected in the lineage. */
function wasRejectedBefore(versions, content, computeMenuHash, exceptId) {
  const target = computeMenuHash(publicMenu(content));
  return versions.some((v) => v.id !== exceptId && v.status === 'rejected' && computeMenuHash(publicMenu(v.captured_content)) === target);
}

/**
 * Writes one new concept version, or explains why not.
 * Returns { status, body } like the route handlers:
 *   201 { concept: { id, version, unchanged: false } }
 *   200 { concept: { id, version, unchanged: true } }       identical to the latest
 *   409 reason stale_version | previously_rejected | version_conflict
 */
async function createConceptVersion(supabase, input, { computeMenuHash, now }) {
  const validation = validateSnapshotProposalInput({
    restaurantId: input.restaurantId,
    menuContext: input.menuContext,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    qualityScore: input.qualityScore,
    capturedContent: input.content,
  });
  if (!validation.valid) return { status: 400, body: { error: 'Het concept is ongeldig.', reason: validation.reason } };
  const contentHash = computeMenuHash(validation.capturedContent);

  const lineage = await loadLineage(supabase, { restaurantId: validation.restaurantId, menuContext: validation.menuContext });
  if (lineage.error) return { status: 500, body: { error: 'Het concept kon niet worden opgeslagen.' } };
  const latest = lineage.versions[0] || null;

  if (input.expectedVersion !== undefined && (latest ? latest.version : 0) !== input.expectedVersion) {
    return { status: 409, body: { error: 'Er is intussen een nieuwere versie. Laad de pagina opnieuw.', reason: 'stale_version', latestVersion: latest ? latest.version : 0 } };
  }
  if (latest && latest.content_hash === contentHash) {
    return { status: 200, body: { concept: { id: latest.id, version: latest.version, unchanged: true } } };
  }
  if (wasRejectedBefore(lineage.versions, validation.capturedContent, computeMenuHash)) {
    return { status: 409, body: { error: 'Deze menukaart is eerder afgewezen en komt niet terug als nieuwe versie.', reason: 'previously_rejected' } };
  }

  const version = latest ? latest.version + 1 : 1;
  const { data, error } = await supabase
    .from('menu_snapshot_proposals')
    .insert({
      restaurant_id: validation.restaurantId,
      menu_context: validation.menuContext,
      source_url: validation.sourceUrl,
      source_type: validation.sourceType,
      originally_fetched_at: input.originallyFetchedAt || now().toISOString(),
      content_hash: contentHash,
      version,
      quality_score: validation.qualityScore,
      captured_content: validation.capturedContent,
      created_by: input.createdBy,
      origin_receipt_id: input.originReceiptId || null,
      based_on_snapshot_id: input.basedOnSnapshotId || null,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return { status: 409, body: { error: 'Er is net een nieuwere versie opgeslagen. Laad de pagina opnieuw.', reason: 'version_conflict' } };
    return { status: 500, body: { error: 'Het concept kon niet worden opgeslagen.' } };
  }
  return { status: 201, body: { concept: { id: data ? data.id : null, version, unchanged: false } } };
}

module.exports = { loadLineage, wasRejectedBefore, createConceptVersion };
