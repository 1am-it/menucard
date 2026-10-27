'use strict';

// BE-31 herstel (#74) — "Oude resultaten opruimen": a staff member closes
// existing batch results by hand.
//
// No migration (the review forbids one) and no deletion: the marker goes into
// the existing, additive `restaurant_source_analysis_jobs.field_evidence` under
// `resultHandled` — the same column BE-30 uses for `structureAdvice`. The
// analysis result, its receipt, the batch row and any proposal stay exactly as
// they are; only a small, read-only addition says who closed it and when.
//
// All dependencies are injected so every rule is testable offline with a
// fictional client: no Supabase, no network, no clock in the module itself.

const { isInternalOnly } = require('./importInbox');
const { isUuid } = require('./sourceTriage');

const HANDLED_KEY = 'resultHandled';
// One request is one explicit human action; the bound keeps a single click from
// turning into an unbounded write.
const MAX_RESULTS_PER_REQUEST = 100;
const FORBIDDEN = 'Alleen interne medewerkers kunnen bronresultaten afhandelen.';
const UNAVAILABLE = 'De resultaten konden niet worden afgehandeld.';

function reply(status, body) {
  return { status, body };
}

/**
 * deps:
 *   authenticate(request) → { ok, status, error, userId, roles }
 *   getSupabase()         → a Supabase client (service role)
 *   now()                 → Date (injectable for tests)
 */
function createBatchResultHandlingHandlers({ authenticate, getSupabase, now = () => new Date() } = {}) {
  async function authorize(request) {
    if (typeof authenticate !== 'function') return { denied: reply(500, { error: 'De interne aanmelding is niet aangesloten.' }) };
    let auth;
    try {
      auth = await authenticate(request);
    } catch {
      auth = null;
    }
    if (!auth || auth.ok !== true) return { denied: reply(401, { error: 'Meld je opnieuw aan.' }) };
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

  function stamp() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  async function marketId(supabase) {
    const { data, error } = await supabase.from('markets').select('id').eq('slug', 'breda').maybeSingle();
    if (error || !data) return null;
    return data.id;
  }

  /**
   * POST — close exactly these results, each with the same date and the acting
   * staff member. Idempotent: an earlier marker is never overwritten, so the
   * original "afgehandeld door … op …" stays the record.
   */
  async function markHandled(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;

    const parsed = await readJson(request);
    const body = parsed.ok && parsed.body && typeof parsed.body === 'object' ? parsed.body : null;
    if (!body || !Array.isArray(body.job_ids)) return reply(400, { error: 'Ongeldig verzoek.' });

    const ids = [...new Set(body.job_ids.filter((id) => typeof id === 'string' && isUuid(id)))];
    if (ids.length === 0) return reply(400, { error: 'Kies minstens één resultaat.' });
    if (ids.length > MAX_RESULTS_PER_REQUEST) {
      return reply(400, { error: `Maximaal ${MAX_RESULTS_PER_REQUEST} resultaten per keer.` });
    }

    let supabase;
    try {
      supabase = getSupabase();
    } catch {
      return reply(500, { error: UNAVAILABLE });
    }
    const market = await marketId(supabase);
    if (!market) return reply(500, { error: UNAVAILABLE });

    const at = stamp().toISOString();
    const handled = [];
    const already = [];
    const skipped = [];
    for (const id of ids) {
      const { data: job, error } = await supabase
        .from('restaurant_source_analysis_jobs')
        .select('id, batch_id, field_evidence')
        .eq('id', id)
        .maybeSingle();
      if (error || !job) {
        skipped.push(id);
        continue;
      }
      // Only results of this market's own batches: never another market's data.
      const { data: batch, error: batchError } = await supabase
        .from('url_intake_batches')
        .select('id')
        .eq('id', job.batch_id)
        .eq('market_id', market)
        .maybeSingle();
      if (batchError || !batch) {
        skipped.push(id);
        continue;
      }
      const evidence = job.field_evidence && typeof job.field_evidence === 'object' && !Array.isArray(job.field_evidence) ? job.field_evidence : {};
      // Never drop an earlier record: closing twice keeps the first one.
      if (evidence[HANDLED_KEY] && typeof evidence[HANDLED_KEY] === 'object') {
        already.push(id);
        continue;
      }
      const { error: updateError } = await supabase
        .from('restaurant_source_analysis_jobs')
        .update({
          field_evidence: {
            ...evidence,
            [HANDLED_KEY]: { kind: 'batch_result_handled', by: auth.userId, at },
          },
        })
        .eq('id', id)
        .eq('batch_id', job.batch_id);
      if (updateError) {
        skipped.push(id);
        continue;
      }
      handled.push(id);
    }

    if (handled.length === 0 && already.length === 0) return reply(500, { error: UNAVAILABLE });
    return reply(200, {
      handled: handled.length,
      already: already.length,
      skipped: skipped.length,
      at,
    });
  }

  return { markHandled };
}

module.exports = { createBatchResultHandlingHandlers, HANDLED_KEY, MAX_RESULTS_PER_REQUEST };
