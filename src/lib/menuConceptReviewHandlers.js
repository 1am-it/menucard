'use strict';

// BE-17 Menuconcepten beoordelen v1 — server handlers behind
// /api/internal/v1/menu-concepts. Dependency-injected and pure apart from
// the injected Supabase client, so every rule is tested with a fake.
//
// Rules (all enforced here, never by the browser):
//   - only the `internal` role reads, corrects, approves or rejects;
//   - a correction is a new immutable version (src/lib/menuConceptStore.js)
//     built from the stored version plus the reviewer's edits; blockers are
//     recomputed from that content and refuse the save;
//   - a decision names the version the client saw; a stale version is a
//     conflict (also enforced in record_menu_snapshot_decision, 0018);
//   - the same decision twice is one review row (RPC, 0018);
//   - a rejection needs a fixed BE-17 reason;
//   - approval is refused while the stored version has blockers, when its
//     public menu was rejected before, or when its source is no longer
//     confirmed or is blocked by its latest analysis.
// Approval stays internal: nothing is exported, published or fetched, and
// data/menus.json is only read.

const { isInternalOnly } = require('./importInbox');
const { validateSnapshotReviewInput, snapshotReviewValidationMessage, groupReviewsBySnapshotId, deriveEffectiveSnapshotStatus } = require('./menuSnapshotProposals');
const { liveMenuLines, recognisedLines, buildMenuConcept, storedConceptInput, sanitizeEdits, mergeEdits, REJECT_REASONS } = require('./menuConcept');
const { loadLineage, wasRejectedBefore, createConceptVersion } = require('./menuConceptStore');
const { exportForSnapshot, exportMenuEntry } = require('./menuConceptExport');
const { menuKeyFor, restaurantMenuEntries } = require('./menuExport');
const {
  readConceptProduct,
  readReceiptProjection,
  productActionRefusal,
  PRODUCT_READ_ONLY_MESSAGE,
} = require('./menuProductIntegrationV2');

const FORBIDDEN = 'Alleen interne medewerkers kunnen menuconcepten beoordelen.';
const LOAD_ERROR = 'De menuconcepten konden niet worden geladen.';
const LIST_LIMIT = 300;
const SOURCE_BLOCK_LABELS = {
  robots_disallowed: 'Robots geblokkeerd',
  fetch_failed: 'Niet bereikbaar',
  unsafe_url: 'Ongeldige URL',
};

function reply(status, body) {
  return { status, body };
}

function viewStatus(status) {
  if (status === 'approved_internal') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'waiting';
}

function restaurantName(restaurants, id) {
  const r = restaurants && (Array.isArray(restaurants) ? restaurants.find((x) => String(x.id) === String(id)) : restaurants[id]);
  return (r && r.name) || `Restaurant ${id}`;
}

function conceptSummary(captured, liveLines) {
  const product = readConceptProduct(captured);
  if (product.kind !== 'v1') return { concept: null, input: null, product };
  const input = storedConceptInput(captured);
  const concept = buildMenuConcept({ menus: input.menus, liveLines, edits: input.edits });
  return { concept, input, product };
}

/**
 * Is the concept's source still a confirmed source of the restaurant, and is
 * it free of a block? Derived from the BE-24 proposals (the latest accepted
 * decision about this URL) and the latest BE-20/BE-25 analysis of the URL.
 */
async function sourceStatus(supabase, { restaurantId, sourceUrl, receiptUrl }) {
  const { data: proposals, error } = await supabase
    .from('source_triage_proposals')
    .select('id, kind, proposed_url, current_url, status, decided_at')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'accepted');
  if (error) return { error };
  const about = (proposals || [])
    .filter((p) => p.proposed_url === sourceUrl || p.current_url === sourceUrl)
    .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)));
  const last = about[0] || null;
  const confirmed = Boolean(last && (last.kind === 'add_candidate' || last.kind === 'replace_source') && last.proposed_url === sourceUrl);

  const urls = [...new Set([sourceUrl, receiptUrl].filter(Boolean))];
  const { data: jobs, error: jobError } = await supabase
    .from('restaurant_source_analysis_jobs')
    .select('id, status, error_reason, created_at')
    .in('canonical_source_url', urls);
  if (jobError) return { error: jobError };
  const latestJob = [...(jobs || [])].filter((j) => j.status === 'succeeded' || j.status === 'failed').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const blocked = latestJob && latestJob.status === 'failed' ? { reason: latestJob.error_reason, label: SOURCE_BLOCK_LABELS[latestJob.error_reason] || 'Laatste analyse mislukt' } : null;
  return { confirmed, blocked };
}

function createMenuConceptReviewHandlers({ authenticate, getSupabase, restaurants, liveMenus, computeMenuHash, github = null, now = () => new Date() }) {
  async function authorize(request) {
    const auth = await authenticate(request);
    if (!auth || !auth.ok) return { denied: reply((auth && auth.status) || 401, { error: (auth && auth.error) || 'Niet ingelogd.' }) };
    if (!isInternalOnly(auth.roles)) return { denied: reply(403, { error: FORBIDDEN }) };
    return { auth };
  }

  async function readJson(request) {
    try {
      const body = await request.json();
      return body && typeof body === 'object' ? body : null;
    } catch {
      return null;
    }
  }

  function parseId(id) {
    return /^[1-9]\d{0,15}$/.test(String(id)) ? Number(id) : null;
  }

  async function loadSnapshot(supabase, id) {
    const { data, error } = await supabase
      .from('menu_snapshot_proposals')
      .select('id, restaurant_id, menu_context, version, content_hash, captured_content, source_url, source_type, quality_score, originally_fetched_at, created_at, created_by, origin_receipt_id, based_on_snapshot_id')
      .eq('id', id)
      .maybeSingle();
    return { snapshot: data || null, error };
  }

  async function loadReceipt(supabase, receiptId) {
    if (!receiptId) return { receipt: null };
    const { data, error } = await supabase
      .from('url_intake_analysis_receipts')
      // The versioned envelope is read explicitly next to the legacy
      // projection, so a v2 receipt is never validated from `menus` alone.
      .select('id, canonical_source_url, fetched_at, menus:candidate_summary->menus, product:candidate_summary->menuExtractionV2')
      .eq('id', receiptId)
      .maybeSingle();
    const receipt = data ? { ...data, productInfo: readReceiptProjection(data) } : null;
    return { receipt, error };
  }

  function receiptBlock(receipt) {
    if (!receipt || !receipt.productInfo || receipt.productInfo.kind === 'v1') return null;
    return { ...receipt.productInfo, reason: 'receipt_product_v2_authoritative' };
  }

  function previewFor(snapshot, blocked) {
    const current = Object.entries(restaurantMenuEntries(liveMenus, snapshot.restaurant_id)).map(([key, entry]) => ({ key, entry }));
    if (blocked) return { concept: null, current, blocked: blocked.reason, blockers: blocked.blockers || [] };
    const { entry } = exportMenuEntry({ snapshot, menus: liveMenus });
    return {
      concept: entry ? { key: menuKeyFor(snapshot.restaurant_id), entry } : null,
      current,
    };
  }

  /** GET — every concept lineage's latest version, waiting ones first. */
  async function list(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from('menu_snapshot_proposals')
      .select('id, restaurant_id, menu_context, version, source_url, created_at, created_by, captured_content, origin_receipt_id')
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (error) return reply(500, { error: LOAD_ERROR });

    const latestByLineage = new Map();
    for (const row of rows || []) {
      const key = `${row.restaurant_id}/${row.menu_context}`;
      const seen = latestByLineage.get(key);
      if (!seen || row.version > seen.version) latestByLineage.set(key, row);
    }
    const latest = [...latestByLineage.values()];
    let receipts = [];
    if (latest.length > 0) {
      const ids = [...new Set(latest.map((r) => r.origin_receipt_id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: receiptRows, error: receiptError } = await supabase
          .from('url_intake_analysis_receipts')
          .select('id, product:candidate_summary->menuExtractionV2')
          .in('id', ids);
        if (receiptError) return reply(500, { error: LOAD_ERROR });
        receipts = receiptRows || [];
      }
    }
    const productByReceipt = new Map(receipts.map((r) => [r.id, readReceiptProjection(r)]));
    let reviews = [];
    if (latest.length > 0) {
      const { data, error: reviewError } = await supabase.from('menu_snapshot_reviews').select('id, snapshot_id, decided_at, decision').in('snapshot_id', latest.map((r) => r.id));
      if (reviewError) return reply(500, { error: LOAD_ERROR });
      reviews = data || [];
    }
    const bySnapshot = groupReviewsBySnapshotId(reviews);
    const order = { waiting: 0, approved: 1, rejected: 2 };
    const items = latest
      .map((row) => {
        const summary = conceptSummary(row.captured_content, liveMenuLines(liveMenus, row.restaurant_id));
        const productBlocked = summary.product && summary.product.kind !== 'v1';
        const receiptProduct = row.origin_receipt_id ? productByReceipt.get(row.origin_receipt_id) : null;
        const receiptBlocked = Boolean(receiptProduct && receiptProduct.kind !== 'v1');
        const blocked = Boolean(productBlocked || receiptBlocked);
        const productView = (productBlocked && summary.product.view) || (receiptBlocked && receiptProduct.view) || null;
        const counts = blocked
          ? {
              dishCount: productView ? productView.counts.items : 0,
              attentionCount: productView ? productView.notes.length : 0,
              blockerCount: productView ? productView.blockers.length : 1,
            }
          : {
              dishCount: summary.concept.lines.filter((l) => l.status !== 'excluded').length,
              attentionCount: summary.concept.attentionLines.length + summary.concept.removed.length,
              blockerCount: summary.concept.blockers.length,
            };
        return {
          id: row.id,
          restaurantId: row.restaurant_id,
          restaurantName: restaurantName(restaurants, row.restaurant_id),
          menuContext: row.menu_context,
          version: row.version,
          sourceUrl: row.source_url,
          createdAt: row.created_at,
          createdBySelf: row.created_by === auth.userId,
          status: viewStatus(deriveEffectiveSnapshotStatus(bySnapshot[row.id] || [])),
          dishCount: counts.dishCount,
          attentionCount: counts.attentionCount,
          blockerCount: counts.blockerCount,
          readOnly: blocked,
          schemaVersion: productBlocked ? (summary.product.schemaVersion || null) : (receiptBlocked ? (receiptProduct.schemaVersion || null) : null),
          blockedReason: blocked
            ? (productBlocked ? summary.product.reason : 'receipt_product_v2_authoritative')
            : null,
        };
      })
      .sort((a, b) => order[a.status] - order[b.status] || String(b.createdAt).localeCompare(String(a.createdAt)));
    return reply(200, { items });
  }

  /** GET [id] — one version with its lineage, the original extraction, the current menu and the source status. */
  async function detail(request, rawId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const id = parseId(rawId);
    if (!id) return reply(404, { error: 'Menuconcept niet gevonden.' });
    const supabase = getSupabase();
    const { snapshot, error } = await loadSnapshot(supabase, id);
    if (error) return reply(500, { error: LOAD_ERROR });
    if (!snapshot) return reply(404, { error: 'Menuconcept niet gevonden.' });

    const lineage = await loadLineage(supabase, { restaurantId: snapshot.restaurant_id, menuContext: snapshot.menu_context });
    if (lineage.error) return reply(500, { error: LOAD_ERROR });
    const latest = lineage.versions[0];
    const current = lineage.versions.find((v) => v.id === snapshot.id) || { ...snapshot, reviews: [], status: 'unreviewed' };
    const { receipt, error: receiptError } = await loadReceipt(supabase, snapshot.origin_receipt_id);
    if (receiptError) return reply(500, { error: LOAD_ERROR });
    const source = await sourceStatus(supabase, { restaurantId: snapshot.restaurant_id, sourceUrl: snapshot.source_url, receiptUrl: receipt && receipt.canonical_source_url });
    if (source.error) return reply(500, { error: LOAD_ERROR });
    const exported = await exportForSnapshot(supabase, github, snapshot.id, now);
    if (exported.error) return reply(500, { error: LOAD_ERROR });

    const summary = conceptSummary(snapshot.captured_content, liveMenuLines(liveMenus, snapshot.restaurant_id));
    const productBlock = summary.product && summary.product.kind !== 'v1' ? summary.product : null;
    const receiptBlockInfo = receiptBlock(receipt);
    const block = productBlock
      ? { ...productBlock, blockers: productBlock.view ? productBlock.view.blockers : [] }
      : receiptBlockInfo
        ? { ...receiptBlockInfo, blockers: receiptBlockInfo.view ? receiptBlockInfo.view.blockers : [] }
        : null;
    const productView = (productBlock && productBlock.view) || (receiptBlockInfo && receiptBlockInfo.view) || null;
    const blocked = Boolean(block);

    const originLines = {};
    if (!blocked) {
      for (const line of recognisedLines((receipt && receipt.menus) || [])) originLines[line.id] = { name: line.name, desc: line.desc, price: line.price, category: line.category };
    }
    const byId = new Map(lineage.versions.map((v) => [v.id, v]));
    return reply(200, {
      concept: {
        id: snapshot.id,
        version: snapshot.version,
        latestVersion: latest ? latest.version : snapshot.version,
        latestId: latest ? latest.id : snapshot.id,
        isLatest: !latest || latest.id === snapshot.id,
        restaurantId: snapshot.restaurant_id,
        restaurantName: restaurantName(restaurants, snapshot.restaurant_id),
        menuContext: snapshot.menu_context,
        sourceUrl: snapshot.source_url,
        createdAt: snapshot.created_at,
        createdBySelf: snapshot.created_by === auth.userId,
        originRecorded: Boolean(receipt),
        status: viewStatus(current.status),
        rejectedBefore: blocked ? false : wasRejectedBefore(lineage.versions, snapshot.captured_content, computeMenuHash, snapshot.id),
        captured: blocked ? null : snapshot.captured_content,
        readOnly: blocked,
        schemaVersion: block ? block.schemaVersion || null : null,
        blocked: block
          ? {
              reason: block.reason,
              message: block.message || PRODUCT_READ_ONLY_MESSAGE,
              problems: Array.isArray(block.problems) ? block.problems : [],
              blockedActions: block.blockedActions || [],
              blockers: block.blockers,
            }
          : null,
      },
      product: productView,
      liveLines: liveMenuLines(liveMenus, snapshot.restaurant_id),
      originLines,
      source: { confirmed: source.confirmed, blocked: source.blocked },
      history: lineage.versions.map((v) => ({
        id: v.id,
        version: v.version,
        createdAt: v.created_at,
        createdBySelf: v.created_by === auth.userId,
        basedOnVersion: v.based_on_snapshot_id && byId.get(v.based_on_snapshot_id) ? byId.get(v.based_on_snapshot_id).version : null,
        status: viewStatus(v.status),
        reviews: v.reviews.map((r) => ({ decision: r.decision, reason: r.reason, reasonLabel: r.reason ? REJECT_REASONS[r.reason] || r.reason : null, note: r.note, decidedAt: r.decided_at, bySelf: r.reviewer_id === auth.userId })),
      })),
      rejectReasons: REJECT_REASONS,
      export: exported.export,
      // Publicatievoorbeeld: built on the server only. "concept" is exactly
      // the entry "Maak review-PR" would write; "current" is the restaurant's
      // unchanged published menus. Nothing is written or exported here.
      preview: previewFor(snapshot, block),
      githubConfigured: Boolean(github),
    });
  }

  /** POST [id]/versions — a reviewer's correction as a new immutable version. */
  async function saveVersion(request, rawId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const id = parseId(rawId);
    if (!id) return reply(404, { error: 'Menuconcept niet gevonden.' });
    const body = await readJson(request);
    if (!body || !Number.isInteger(body.expected_version) || body.expected_version < 1) return reply(400, { error: 'Ongeldig verzoek.' });
    const supabase = getSupabase();
    const { snapshot, error } = await loadSnapshot(supabase, id);
    if (error) return reply(500, { error: 'Het concept kon niet worden opgeslagen.' });
    if (!snapshot) return reply(404, { error: 'Menuconcept niet gevonden.' });
    const product = readConceptProduct(snapshot.captured_content);
    if (product.kind !== 'v1') return productActionRefusal('save', product);
    const receiptState = await loadReceipt(supabase, snapshot.origin_receipt_id);
    if (receiptState.error) return reply(500, { error: 'Het concept kon niet worden opgeslagen.' });
    const originBlock = receiptBlock(receiptState.receipt);
    if (originBlock) return productActionRefusal('save', originBlock);
    const lineage = await loadLineage(supabase, { restaurantId: snapshot.restaurant_id, menuContext: snapshot.menu_context });
    if (lineage.error) return reply(500, { error: 'Het concept kon niet worden opgeslagen.' });
    if (snapshot.version !== body.expected_version || (lineage.versions[0] && lineage.versions[0].id !== snapshot.id)) {
      return reply(409, { error: 'Er is intussen een nieuwere versie. Laad de pagina opnieuw.', reason: 'stale_version' });
    }

    const stored = storedConceptInput(snapshot.captured_content);
    const edits = mergeEdits(stored.edits, sanitizeEdits(body.edits));
    const concept = buildMenuConcept({ menus: stored.menus, liveLines: liveMenuLines(liveMenus, snapshot.restaurant_id), edits });
    if (!concept.canSave) return reply(409, { error: 'Los eerst de blokkades op.', reason: 'blockers', blockers: concept.blockers });

    return createConceptVersion(
      supabase,
      {
        restaurantId: snapshot.restaurant_id,
        menuContext: snapshot.menu_context,
        sourceUrl: snapshot.source_url,
        sourceType: snapshot.source_type,
        qualityScore: snapshot.quality_score,
        originallyFetchedAt: snapshot.originally_fetched_at,
        content: concept.content,
        createdBy: auth.userId,
        originReceiptId: snapshot.origin_receipt_id,
        basedOnSnapshotId: snapshot.id,
        expectedVersion: snapshot.version,
      },
      { computeMenuHash, now }
    );
  }

  /** POST [id]/decision — approve internally or reject with a fixed reason. */
  async function decide(request, rawId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const id = parseId(rawId);
    if (!id) return reply(404, { error: 'Menuconcept niet gevonden.' });
    const body = await readJson(request);
    if (!body || !Number.isInteger(body.expected_version) || body.expected_version < 1) return reply(400, { error: 'Ongeldig verzoek.' });
    if (body.decision !== 'approved_internal' && body.decision !== 'rejected') return reply(400, { error: 'Ongeldig besluit.' });
    const validation = validateSnapshotReviewInput({ decision: body.decision, reason: body.reason || null, note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null });
    if (!validation.valid) {
      return reply(400, { error: validation.reason === 'missing-reason' ? 'Kies een reden voor de afwijzing.' : snapshotReviewValidationMessage(validation.reason), reason: validation.reason });
    }

    const supabase = getSupabase();
    const { snapshot, error } = await loadSnapshot(supabase, id);
    if (error) return reply(500, { error: 'Het besluit kon niet worden vastgelegd.' });
    if (!snapshot) return reply(404, { error: 'Menuconcept niet gevonden.' });
    const product = readConceptProduct(snapshot.captured_content);
    if (product.kind !== 'v1') return productActionRefusal('decide', product);
    const receiptState = await loadReceipt(supabase, snapshot.origin_receipt_id);
    if (receiptState.error) return reply(500, { error: 'Het besluit kon niet worden vastgelegd.' });
    const originBlock = receiptBlock(receiptState.receipt);
    if (originBlock) return productActionRefusal('decide', originBlock);
    const lineage = await loadLineage(supabase, { restaurantId: snapshot.restaurant_id, menuContext: snapshot.menu_context });
    if (lineage.error) return reply(500, { error: 'Het besluit kon niet worden vastgelegd.' });
    const latest = lineage.versions[0];
    if (snapshot.version !== body.expected_version || (latest && latest.id !== snapshot.id)) {
      return reply(409, { error: 'Er is intussen een nieuwere versie. Laad de pagina opnieuw.', reason: 'stale_version' });
    }

    if (validation.decision === 'approved_internal') {
      const { concept } = conceptSummary(snapshot.captured_content, liveMenuLines(liveMenus, snapshot.restaurant_id));
      if (!concept.canSave) return reply(409, { error: 'Dit concept heeft nog blokkades.', reason: 'blockers', blockers: concept.blockers });
      if (wasRejectedBefore(lineage.versions, snapshot.captured_content, computeMenuHash, snapshot.id)) {
        return reply(409, { error: 'Deze menukaart is eerder afgewezen.', reason: 'previously_rejected' });
      }
      const { receipt } = receiptState;
      const source = await sourceStatus(supabase, { restaurantId: snapshot.restaurant_id, sourceUrl: snapshot.source_url, receiptUrl: receipt && receipt.canonical_source_url });
      if (source.error) return reply(500, { error: 'Het besluit kon niet worden vastgelegd.' });
      if (!source.confirmed) return reply(409, { error: 'De bron van dit concept is niet (meer) bevestigd.', reason: 'source_not_confirmed' });
      if (source.blocked) return reply(409, { error: `De bron is geblokkeerd: ${source.blocked.label}.`, reason: 'source_blocked' });
    }

    const { data, error: rpcError } = await supabase.rpc('record_menu_snapshot_decision', {
      p_snapshot_id: snapshot.id,
      p_expected_version: body.expected_version,
      p_decision: validation.decision,
      p_reason: validation.reason,
      p_note: validation.note,
      p_actor_user_id: auth.userId,
    });
    if (rpcError) {
      if (rpcError.code === 'P0061') return reply(409, { error: 'Er is intussen een nieuwere versie. Laad de pagina opnieuw.', reason: 'stale_version' });
      if (rpcError.code === 'P0060') return reply(404, { error: 'Menuconcept niet gevonden.' });
      return reply(500, { error: 'Het besluit kon niet worden vastgelegd.' });
    }
    const row = Array.isArray(data) ? data[0] : data;
    const created = Boolean(row && row.created);
    return reply(created ? 201 : 200, { review: { decision: validation.decision, created, version: snapshot.version } });
  }

  return { list, detail, saveVersion, decide };
}

module.exports = { createMenuConceptReviewHandlers, sourceStatus };
