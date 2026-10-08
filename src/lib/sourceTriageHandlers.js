// Brontriage (BE-24) — request handling behind the three internal routes
// under app/api/internal/v1/source-triage/. CommonJS with injected
// dependencies, so the role checks and "no database call before
// authorization" are tested behaviourally (src/lib/sourceTriageHandlers.test.js)
// instead of only structurally. The route files only wire in the real
// authenticateInternalRequest, getSupabaseAdmin and data/restaurants.json.
//
// What these handlers never do: fetch a URL, start an analysis, call AI/OCR
// or a provider, publish, or write anything except through the two 0015
// RPCs. Contract: planning/specs/tickets/be-24-internal-source-triage.md.

'use strict';

const { buildSourceWorkqueue } = require('./sourceWorkqueue');
const { isInternalOnly } = require('./importInbox');
const { validateProposalInput, validateDecisionInput, buildTriageView, isUuid } = require('./sourceTriage');

// Same bound and columns as the BE-23 route (read only).
const JOB_LIMIT = 2000;
const JOB_COLUMNS =
  'id, canonical_source_url, status, error_reason, result_receipt_id, created_at, updated_at, unknown_menu_contexts:field_evidence->unknown_menu_contexts';
const RECEIPT_COLUMNS = 'id, restaurant_match_type, matched_restaurant_id, menus:candidate_summary->menus';

const PROPOSAL_LIMIT = 1000;
const PROPOSAL_COLUMNS =
  'id, restaurant_id, kind, proposed_url, current_url, unusable_reason, note, status, proposed_by, proposed_at, decided_by, decided_at, decision_note, source_triage_proposal_events(event, actor_user_id, note, created_at)';

const LOAD_ERROR = 'De brontriage kon niet worden geladen.';
const FORBIDDEN = 'Alleen interne medewerkers kunnen de brontriage gebruiken.';

function reply(status, body) {
  return { status, body };
}

/**
 * deps:
 *   authenticate(request) → { ok, status, error, userId, roles }
 *   getSupabase()         → a Supabase client (service role)
 *   restaurants           → data/restaurants.json
 *   generateId()          → a new UUIDv7 string
 */
function createSourceTriageHandlers(deps) {
  const { authenticate, getSupabase, restaurants, generateId } = deps;

  // Every handler starts here: no body parsing, validation or database
  // client before the caller is an authenticated `internal` staff member.
  async function authorize(request) {
    const auth = await authenticate(request);
    if (!auth || !auth.ok) return { denied: reply((auth && auth.status) || 401, { error: (auth && auth.error) || 'Niet ingelogd.' }) };
    if (!isInternalOnly(auth.roles)) return { denied: reply(403, { error: FORBIDDEN }) };
    return { auth };
  }

  async function marketId(supabase) {
    const { data, error } = await supabase.from('markets').select('id').eq('slug', 'breda').maybeSingle();
    if (error || !data) return null;
    return data.id;
  }

  async function readJson(request) {
    try {
      return { ok: true, body: await request.json() };
    } catch {
      return { ok: false };
    }
  }

  /** GET /api/internal/v1/source-triage — read only. */
  async function getTriage(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const supabase = getSupabase();
    const market = await marketId(supabase);
    if (!market) return reply(500, { error: LOAD_ERROR });

    const { data: jobs, error: jobsError } = await supabase
      .from('restaurant_source_analysis_jobs')
      .select(JOB_COLUMNS)
      .eq('market_id', market)
      .order('created_at', { ascending: false })
      .limit(JOB_LIMIT);
    if (jobsError) return reply(500, { error: LOAD_ERROR });

    const receiptIds = [...new Set((jobs || []).map((j) => j.result_receipt_id).filter(Boolean))];
    let receipts = [];
    if (receiptIds.length > 0) {
      const { data, error } = await supabase.from('url_intake_analysis_receipts').select(RECEIPT_COLUMNS).in('id', receiptIds);
      if (error) return reply(500, { error: LOAD_ERROR });
      receipts = data || [];
    }
    const queue = buildSourceWorkqueue({ restaurants, jobs: jobs || [], receipts });

    // Proposals are optional for the read: when they cannot be loaded the
    // page still shows the BE-23 data, says proposals are unavailable and
    // derives no proposal state (buildTriageView, proposalsAvailable).
    const { data: proposals, error: proposalsError } = await supabase
      .from('source_triage_proposals')
      .select(PROPOSAL_COLUMNS)
      .eq('market_id', market)
      .order('proposed_at', { ascending: false })
      .limit(PROPOSAL_LIMIT);

    const view = buildTriageView({
      queue,
      restaurants,
      proposals: proposalsError ? [] : proposals || [],
      viewerId: auth.userId,
      proposalsAvailable: !proposalsError,
    });
    return reply(200, {
      city: 'Breda',
      restaurants: view.restaurants,
      proposals_available: !proposalsError,
      proposal_limit_reached: !proposalsError && (proposals || []).length >= PROPOSAL_LIMIT,
      orphan_proposals: view.orphanProposals,
      unattributed_checks: queue.unattributedChecks,
      job_limit_reached: (jobs || []).length >= JOB_LIMIT,
    });
  }

  /** POST /api/internal/v1/source-triage/proposals */
  async function createProposal(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const body = parsed.body;
    const restaurantId = body && typeof body.restaurant_id === 'string' ? body.restaurant_id.trim() : '';
    const restaurant = restaurantId && Object.prototype.hasOwnProperty.call(restaurants, restaurantId) ? restaurants[restaurantId] : null;
    const validation = validateProposalInput(body, restaurant);
    if (!validation.ok) return reply(validation.status, { error: validation.message, reason: validation.reason });

    const supabase = getSupabase();
    const market = await marketId(supabase);
    if (!market) return reply(500, { error: 'Het voorstel kon niet worden opgeslagen.' });

    const v = validation.value;
    // The only write: one RPC that inserts the proposal and its `proposed`
    // event in one transaction. The actor is the authenticated user, never
    // a value from the body.
    const { data, error } = await supabase.rpc('create_source_triage_proposal', {
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
    if (error) {
      if (error.code === 'P0030') return reply(409, { error: 'Er staat al een open voorstel voor dit restaurant. Beoordeel dat eerst.', reason: 'open_exists' });
      if (error.code === '23514') return reply(400, { error: 'Het voorstel is ongeldig.', reason: 'constraint' });
      return reply(500, { error: 'Het voorstel kon niet worden opgeslagen.' });
    }
    return reply(201, { proposal: { id: data && data.id, status: data && data.status } });
  }

  /** POST /api/internal/v1/source-triage/proposals/[id]/decision */
  async function decideProposal(request, proposalId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    if (!isUuid(proposalId)) return reply(404, { error: 'Voorstel niet gevonden.' });
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const validation = validateDecisionInput(parsed.body);
    if (!validation.ok) return reply(validation.status, { error: validation.message, reason: validation.reason });

    const supabase = getSupabase();
    // The only write: one RPC, valid only from `open`, that records the
    // decision and its event. Accepting changes no other table.
    const { data, error } = await supabase.rpc('decide_source_triage_proposal', {
      p_proposal_id: proposalId,
      p_decision: validation.decision,
      p_actor_user_id: auth.userId,
      p_note: validation.note,
    });
    if (error) {
      if (error.code === 'P0031') return reply(409, { error: 'Dit voorstel bestaat niet of is al beoordeeld.', reason: 'not_open' });
      if (error.code === 'P0032') return reply(400, { error: 'Geef een reden voor het afwijzen.', reason: 'note_required' });
      if (error.code === 'P0033') return reply(400, { error: 'Kies accepteren of afwijzen.', reason: 'decision' });
      return reply(500, { error: 'De beslissing kon niet worden opgeslagen.' });
    }
    return reply(200, { proposal: { id: data && data.id, status: data && data.status } });
  }

  return { getTriage, createProposal, decideProposal };
}

module.exports = { createSourceTriageHandlers, JOB_LIMIT, PROPOSAL_LIMIT };
