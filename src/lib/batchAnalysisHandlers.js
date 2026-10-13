// BE-25 fase 2 — Batchanalyse: request handling behind the internal routes
// under app/api/internal/v1/batch-analysis/. CommonJS with injected
// dependencies (like src/lib/sourceTriageHandlers.js), so authorization and
// "no database call before authorization" are tested behaviourally.
//
// Writes only through the 0015/0016 RPCs and the BE-19 receipt insert:
//   enqueue_source_analysis_batch, claim_next_source_analysis_job,
//   complete_source_analysis_job, fail_source_analysis_job,
//   create_source_triage_proposal + decide_source_triage_proposal.
// Fetching happens only in the injected `analyze` (the shared
// src/lib/sourceAnalysisPipeline.js). Nothing here publishes, activates a
// source or creates a concept. Processing runs only when the starter's open
// page calls `process` — there is no worker, cron or schedule.

'use strict';

const { isInternalOnly } = require('./importInbox');
const { isUuid, validateProposalInput } = require('./sourceTriage');
const { matchRestaurantByHostname } = require('./restaurantHostMatch');
const { canonicalizeSourceUrl, buildCandidateSummary, computeReceiptExpiry } = require('./urlIntakes');
const {
  MAX_BATCH_URLS,
  DAILY_URL_LIMIT,
  canonicalLine,
  menuSourceUrls,
  deriveItemView,
  summarizeItems,
  amsterdamDayStart,
} = require('./batchAnalysis');

const FORBIDDEN = 'Alleen interne medewerkers kunnen de batchanalyse gebruiken.';
const LOAD_ERROR = 'De batchanalyse kon niet worden geladen.';
const RECENT_BATCH_LIMIT = 10;
const BATCH_COLUMNS = 'id, actor_user_id, created_at, last_activity_at, closed_at, close_reason, item_count';
const JOB_COLUMNS =
  'id, status, error_reason, attempt_count, next_attempt_at, lease_expires_at, expired_at, finished_at, created_at, updated_at, result_receipt_id, unknown_menu_contexts:field_evidence->unknown_menu_contexts, menu_source_urls:field_evidence->menu_source_urls, notes:field_evidence->notes';
const RECEIPT_COLUMNS = 'id, restaurant_match_type, matched_restaurant_id, created_at, menus:candidate_summary->menus';
const CONFIRM_NOTE = 'Bevestigd vanuit Batchanalyse na menselijke controle.';

function reply(status, body) {
  return { status, body };
}

/**
 * deps:
 *   authenticate(request)  → { ok, status, error, userId, roles }
 *   getSupabase()          → a Supabase client (service role)
 *   restaurants            → data/restaurants.json
 *   generateId()           → a new UUIDv7 string
 *   analyze(url)           → src/lib/sourceAnalysisPipeline.js analyzeSourceUrl
 *   computeHash(input)     → src/lib/urlIntakeReceiptHash.js computeAnalysisResultHash
 *   now()                  → Date (injectable for tests)
 */
function createBatchAnalysisHandlers(deps) {
  const { authenticate, getSupabase, restaurants, generateId, analyze, computeHash } = deps;
  const now = deps.now || (() => new Date());

  async function authorize(request) {
    const auth = await authenticate(request);
    if (!auth || !auth.ok) return { denied: reply((auth && auth.status) || 401, { error: (auth && auth.error) || 'Niet ingelogd.' }) };
    if (!isInternalOnly(auth.roles)) return { denied: reply(403, { error: FORBIDDEN }) };
    return { auth };
  }

  async function readJson(request) {
    try {
      return { ok: true, body: await request.json() };
    } catch {
      return { ok: false };
    }
  }

  async function marketId(supabase) {
    const { data, error } = await supabase.from('markets').select('id').eq('slug', 'breda').maybeSingle();
    if (error || !data) return null;
    return data.id;
  }

  /** Items, jobs, receipts and confirmations of one batch → views. */
  async function loadBatchDetail(supabase, batch, viewerId) {
    const { data: items, error: itemsError } = await supabase
      .from('url_intake_batch_items')
      .select('item_position, canonical_source_url, outcome, job_id, reused_job_id')
      .eq('batch_id', batch.id)
      .order('item_position', { ascending: true });
    if (itemsError) return null;

    const jobIds = [...new Set((items || []).flatMap((i) => [i.job_id, i.reused_job_id]).filter(Boolean))];
    let jobs = [];
    if (jobIds.length > 0) {
      const { data, error } = await supabase.from('restaurant_source_analysis_jobs').select(JOB_COLUMNS).in('id', jobIds);
      if (error) return null;
      jobs = data || [];
    }
    const receiptIds = [...new Set(jobs.map((j) => j.result_receipt_id).filter(Boolean))];
    let receipts = [];
    if (receiptIds.length > 0) {
      const { data, error } = await supabase.from('url_intake_analysis_receipts').select(RECEIPT_COLUMNS).in('id', receiptIds);
      if (error) return null;
      receipts = data || [];
    }
    const restaurantIds = [...new Set(receipts.filter((r) => r.restaurant_match_type === 'exact' && r.matched_restaurant_id).map((r) => String(r.matched_restaurant_id)))];
    let proposals = [];
    if (restaurantIds.length > 0) {
      const { data, error } = await supabase
        .from('source_triage_proposals')
        .select('id, restaurant_id, proposed_url, status, decided_at')
        .eq('status', 'accepted')
        .in('restaurant_id', restaurantIds);
      if (error) return null;
      proposals = data || [];
    }

    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const receiptById = new Map(receipts.map((r) => [r.id, r]));
    const firstPosition = new Map();
    const views = (items || []).map((item) => {
      if (item.canonical_source_url && item.outcome !== 'duplicate' && !firstPosition.has(item.canonical_source_url)) {
        firstPosition.set(item.canonical_source_url, item.item_position);
      }
      const job = jobById.get(item.job_id || item.reused_job_id) || null;
      const receipt = job && job.result_receipt_id ? receiptById.get(job.result_receipt_id) || null : null;
      return deriveItemView({
        item,
        job,
        receipt,
        restaurants,
        proposals,
        duplicateOf: item.outcome === 'duplicate' ? firstPosition.get(item.canonical_source_url) : undefined,
        now: now(),
      });
    });

    const isStarter = batch.actor_user_id === viewerId;
    return {
      batch: {
        id: batch.id,
        created_at: batch.created_at,
        closed_at: batch.closed_at,
        close_reason: batch.close_reason,
        item_count: batch.item_count,
        // Colleagues never learn who started a batch: only "is it yours".
        is_starter: isStarter,
      },
      items: views,
      summary: summarizeItems(views),
    };
  }

  /** GET — overview: own daily usage, recent batches, and one batch in detail. */
  async function getOverview(request, requestedBatchId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    if (requestedBatchId !== undefined && requestedBatchId !== null && requestedBatchId !== '' && !isUuid(requestedBatchId)) {
      return reply(404, { error: 'Batch niet gevonden.' });
    }
    const supabase = getSupabase();
    const market = await marketId(supabase);
    if (!market) return reply(500, { error: LOAD_ERROR });

    const { data: recent, error: recentError } = await supabase
      .from('url_intake_batches')
      .select(BATCH_COLUMNS)
      .eq('market_id', market)
      .not('item_count', 'is', null)
      .order('created_at', { ascending: false })
      .limit(RECENT_BATCH_LIMIT);
    if (recentError) return reply(500, { error: LOAD_ERROR });

    const { count, error: countError } = await supabase
      .from('restaurant_source_analysis_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('actor_user_id', auth.userId)
      .not('batch_id', 'is', null)
      .gte('created_at', amsterdamDayStart(now()));
    if (countError) return reply(500, { error: LOAD_ERROR });

    const recentList = recent || [];
    let selected = null;
    if (requestedBatchId) {
      selected = recentList.find((b) => b.id === requestedBatchId) || null;
      if (!selected) {
        const { data, error } = await supabase.from('url_intake_batches').select(BATCH_COLUMNS).eq('id', requestedBatchId).eq('market_id', market).maybeSingle();
        if (error) return reply(500, { error: LOAD_ERROR });
        if (!data) return reply(404, { error: 'Batch niet gevonden.' });
        selected = data;
      }
    } else {
      selected = recentList.find((b) => b.actor_user_id === auth.userId && !b.closed_at) || null;
    }

    let detail = null;
    if (selected) {
      detail = await loadBatchDetail(supabase, selected, auth.userId);
      if (!detail) return reply(500, { error: LOAD_ERROR });
    }

    return reply(200, {
      daily: { used: count || 0, limit: DAILY_URL_LIMIT },
      own_open_batch_id: (recentList.find((b) => b.actor_user_id === auth.userId && !b.closed_at) || {}).id || null,
      recent_batches: recentList.map((b) => ({
        id: b.id,
        created_at: b.created_at,
        closed_at: b.closed_at,
        close_reason: b.close_reason,
        item_count: b.item_count,
        is_own: b.actor_user_id === auth.userId,
      })),
      detail,
    });
  }

  /** POST — "Analyse starten": one batch from at most 10 lines. */
  async function createBatch(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok || !parsed.body || typeof parsed.body !== 'object') return reply(400, { error: 'Ongeldig verzoek.' });
    const { batch_id: batchId, urls } = parsed.body;
    if (!isUuid(batchId)) return reply(400, { error: 'Ongeldig verzoek.' });
    if (!Array.isArray(urls) || urls.length < 1 || urls.length > MAX_BATCH_URLS) {
      return reply(400, { error: `Voer 1 tot ${MAX_BATCH_URLS} URL's in.`, reason: 'size' });
    }
    // Server-side validation: every line becomes a canonical URL or null
    // (stored as an invalid line, without its text).
    const canonical = urls.map((u) => (typeof u === 'string' ? canonicalLine(u) : null));

    const supabase = getSupabase();
    const market = await marketId(supabase);
    if (!market) return reply(500, { error: 'De batch kon niet worden gestart.' });

    const { data, error } = await supabase.rpc('enqueue_source_analysis_batch', {
      p_batch_id: batchId,
      p_market_id: market,
      p_actor_user_id: auth.userId,
      p_urls: canonical,
    });
    if (error) {
      if (error.code === 'P0040') return reply(409, { error: 'Deze batch hoort bij een ander account.', reason: 'other_actor' });
      if (error.code === 'P0041') return reply(400, { error: `Voer 1 tot ${MAX_BATCH_URLS} URL's in.`, reason: 'size' });
      if (error.code === 'P0042') return reply(429, { error: `Je daglimiet van ${DAILY_URL_LIMIT} URL's is bereikt. Recent geanalyseerde URL's tellen niet mee.`, reason: 'daily_limit' });
      if (error.code === 'P0043') return reply(409, { error: 'Je hebt al een open batch. Rond die eerst af.', reason: 'open_batch' });
      return reply(500, { error: 'De batch kon niet worden gestart.' });
    }
    return reply(201, { batch: { id: (data && data.id) || batchId } });
  }

  /** Records a successful analysis: the BE-19 receipt, then the job. */
  async function recordSuccess(supabase, job, outcome) {
    const canonical = canonicalizeSourceUrl(job.canonical_source_url);
    if (!canonical) return { ok: false };
    const match = matchRestaurantByHostname(restaurants, outcome.finalUrl);
    const matchedRestaurantId = match.matchType === 'exact' ? match.restaurantId : null;
    const candidateSummary = buildCandidateSummary({ restaurantCandidateFields: outcome.analysis.restaurantCandidateFields, menus: outcome.analysis.menuContexts });
    const receiptId = generateId();
    const { error: insertError } = await supabase.from('url_intake_analysis_receipts').insert({
      id: receiptId,
      market_id: job.market_id,
      actor_user_id: job.actor_user_id,
      canonical_source_url: canonical.canonicalUrl,
      source_hostname: canonical.hostname,
      fetched_at: now().toISOString(),
      restaurant_match_type: match.matchType,
      matched_restaurant_id: matchedRestaurantId,
      candidate_summary: candidateSummary,
      analysis_result_hash: computeHash({
        actorUserId: job.actor_user_id,
        canonicalSourceUrl: canonical.canonicalUrl,
        restaurantMatchType: match.matchType,
        matchedRestaurantId,
        candidateSummary,
      }),
      expires_at: computeReceiptExpiry(now()),
    });
    if (insertError) return { ok: false };
    const { error } = await supabase.rpc('complete_source_analysis_job', {
      p_job_id: job.id,
      p_actor_user_id: job.actor_user_id,
      p_receipt_id: receiptId,
      p_field_evidence: {
        fields: outcome.analysis.fieldEvidence,
        unknown_menu_contexts: outcome.analysis.unknownMenuContexts,
        description: outcome.analysis.description,
        notes: outcome.analysis.notes,
        menu_source_urls: menuSourceUrls(outcome.analysis),
      },
    });
    return { ok: !error, code: error && error.code };
  }

  /** POST /[id]/process — claim and analyse exactly one job of this batch. */
  async function processNext(request, batchId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    if (!isUuid(batchId)) return reply(404, { error: 'Batch niet gevonden.' });
    const supabase = getSupabase();

    const { data: claimRows, error: claimError } = await supabase.rpc('claim_next_source_analysis_job', {
      p_batch_id: batchId,
      p_actor_user_id: auth.userId,
    });
    if (claimError) {
      if (claimError.code === 'P0044') return reply(403, { error: 'Alleen wie de batch startte, kan hem verwerken.', reason: 'not_starter' });
      return reply(500, { error: 'De analyse kon niet worden voortgezet.' });
    }
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim || claim.claim_outcome !== 'claimed' || !claim.claimed_job_id) {
      return reply(200, { outcome: (claim && claim.claim_outcome) || 'done', retry_at: (claim && claim.retry_at) || null });
    }

    const { data: job, error: jobError } = await supabase
      .from('restaurant_source_analysis_jobs')
      .select('id, market_id, actor_user_id, canonical_source_url')
      .eq('id', claim.claimed_job_id)
      .maybeSingle();
    if (jobError || !job) return reply(500, { error: 'De analyse kon niet worden voortgezet.' });

    let outcome;
    try {
      outcome = await analyze(job.canonical_source_url);
    } catch {
      outcome = { ok: false, errorReason: 'internal_error' };
    }

    if (outcome && outcome.ok) {
      let recorded;
      try {
        recorded = await recordSuccess(supabase, job, outcome);
      } catch {
        recorded = { ok: false };
      }
      if (recorded.ok) return reply(200, { outcome: 'claimed', job: { id: job.id, status: 'succeeded' } });
      if (recorded.code === 'P0045') return reply(200, { outcome: 'lease_lost', job: { id: job.id } });
      outcome = { ok: false, errorReason: 'internal_error' };
    }

    const { error: failError } = await supabase.rpc('fail_source_analysis_job', {
      p_job_id: job.id,
      p_actor_user_id: auth.userId,
      p_error_reason: (outcome && outcome.errorReason) || 'internal_error',
    });
    if (failError) {
      if (failError.code === 'P0045') return reply(200, { outcome: 'lease_lost', job: { id: job.id } });
      return reply(500, { error: 'De analyse kon niet worden voortgezet.' });
    }
    return reply(200, { outcome: 'claimed', job: { id: job.id, status: 'attempted' } });
  }

  /** POST /[id]/confirm — "Bevestig bron" for one or more high-certainty
   * results: per result an accepted BE-24 proposal, nothing else. */
  async function confirmSources(request, batchId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    if (!isUuid(batchId)) return reply(404, { error: 'Batch niet gevonden.' });
    const parsed = await readJson(request);
    const jobIds = parsed.ok && parsed.body && Array.isArray(parsed.body.job_ids) ? parsed.body.job_ids : null;
    if (!jobIds || jobIds.length < 1 || jobIds.length > MAX_BATCH_URLS || !jobIds.every(isUuid) || new Set(jobIds).size !== jobIds.length) {
      return reply(400, { error: 'Ongeldig verzoek.' });
    }

    const supabase = getSupabase();
    const market = await marketId(supabase);
    if (!market) return reply(500, { error: 'De bevestiging kon niet worden opgeslagen.' });
    const { data: batch, error: batchError } = await supabase.from('url_intake_batches').select(BATCH_COLUMNS).eq('id', batchId).eq('market_id', market).maybeSingle();
    if (batchError) return reply(500, { error: 'De bevestiging kon niet worden opgeslagen.' });
    if (!batch) return reply(404, { error: 'Batch niet gevonden.' });
    // Starter-only in v1: colleagues view a batch, they never act on it.
    if (batch.actor_user_id !== auth.userId) return reply(403, { error: 'Alleen wie de batch startte, kan bronnen bevestigen.', reason: 'not_starter' });

    const detail = await loadBatchDetail(supabase, batch, auth.userId);
    if (!detail) return reply(500, { error: 'De bevestiging kon niet worden opgeslagen.' });

    const results = [];
    for (const jobId of jobIds) {
      const item = detail.items.find((v) => v.jobId === jobId);
      // The same checks for one and for many: only a high-certainty,
      // unconfirmed result of this batch can be confirmed.
      if (!item || !item.high || !item.foundUrl || !item.restaurant || !item.actions.includes('confirm')) {
        results.push({ job_id: jobId, ok: false, reason: 'not_eligible' });
        continue;
      }
      const restaurant = restaurants[item.restaurant.id];
      const validation = validateProposalInput(
        { restaurant_id: item.restaurant.id, kind: 'add_candidate', proposed_url: item.foundUrl, note: CONFIRM_NOTE },
        restaurant
      );
      if (!validation.ok) {
        results.push({ job_id: jobId, ok: false, reason: validation.reason });
        continue;
      }
      const v = validation.value;
      const { data: proposal, error: createError } = await supabase.rpc('create_source_triage_proposal', {
        p_proposal_id: generateId(),
        p_market_id: market,
        p_restaurant_id: v.restaurant_id,
        p_kind: v.kind,
        p_proposed_url: v.proposed_url,
        p_current_url: v.current_url,
        p_unusable_reason: v.unusable_reason,
        p_note: v.note,
        p_actor_user_id: auth.userId,
      });
      if (createError) {
        results.push({ job_id: jobId, ok: false, reason: createError.code === 'P0030' ? 'open_proposal_exists' : 'save_failed' });
        continue;
      }
      const { error: decideError } = await supabase.rpc('decide_source_triage_proposal', {
        p_proposal_id: proposal && proposal.id,
        p_decision: 'accepted',
        p_actor_user_id: auth.userId,
        p_note: CONFIRM_NOTE,
      });
      // A proposal that could not be accepted stays open in Bronnen
      // beoordelen for a human; it is never reported as confirmed.
      results.push(decideError ? { job_id: jobId, ok: false, reason: 'left_open' } : { job_id: jobId, ok: true });
    }
    return reply(200, { results, confirmed: results.filter((r) => r.ok).length });
  }

  return { getOverview, createBatch, processNext, confirmSources };
}

module.exports = { createBatchAnalysisHandlers, RECENT_BATCH_LIMIT };
