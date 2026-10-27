'use strict';

// BE-30 (#72) — het enige serverpad voor één AI-advies over alle onzekere
// rubrieken van één bronversie.
//
// Hergebruik (verplicht door de opdracht): dezelfde interne aanmelding en
// rollen, dezelfde sleutel en enable-vlag (menuAiImport.aiConfiguration),
// dezelfde maandteller (menuAiImport.monthlySpendFromRows + dezelfde
// budgetbeslissing) en dezelfde provider-call als "Lees met AI"
// (menuExtractionAnthropicCall, via dezelfde `createCall`-injectie). Er is geen
// tweede AI-client en er is geen migratie nodig: het advies gaat als
// `field_evidence.structureAdvice` (kind `ai_suggested`) naar de bestaande
// jobrij, apart van het menselijke besluit in menu_structure_reviews.
//
// Alle afhankelijkheden zijn geïnjecteerd, zodat elke regel offline met een
// nagebootst transport te bewijzen is. Er wordt nooit automatisch bevestigd,
// opgeslagen als besluit of gepubliceerd.

const { isInternalOnly } = require('./importInbox');
const {
  AI_MAX_COST_EUR_CENTS,
  AI_READ_AI_NAME,
  AI_READ_LABEL,
  aiConfiguration,
  budgetDecision,
  messageFor,
  monthlySpendFromRows,
  publicMonthly,
  reply,
} = require('./menuAiImport');
const { createCallBudget, publicCost, readJson } = require('./menuAiReadHandlers');
const { uncertainSections } = require('./menuStructureReview');
const {
  adviceRecord,
  messageForAdvice,
  sourceFragments,
  storedAdviceView,
  validateAdvice,
} = require('./menuStructureAdvice');

// One short, bounded call: the answer is a small JSON object, and the reviewer
// waits in front of the screen. The provider call itself aborts at this bound.
const ADVICE_LIMITS = Object.freeze({ maxOutputTokens: 1600, callTimeoutMs: 60_000 });

function createMenuStructureAdviceHandlers({
  authenticate,
  env = () => process.env,
  now = () => new Date(),
  readSource,
  readUsageRows,
  createCall,
  saveAdvice,
  generateId = () => null,
} = {}) {
  function stamp() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  async function authorize(request) {
    if (typeof authenticate !== 'function') return { denied: reply(500, { error: 'De interne aanmelding is niet aangesloten.' }) };
    let auth;
    try {
      auth = await authenticate(request);
    } catch {
      auth = null;
    }
    if (!auth || auth.ok !== true) return { denied: reply(401, { error: 'Meld je opnieuw aan.' }) };
    if (!isInternalOnly(auth.roles)) {
      return { denied: reply(403, { error: messageForAdvice('forbidden'), reason: 'forbidden' }) };
    }
    return { auth };
  }

  /** The month's spend: durable AI readings plus earlier advice calls. */
  async function readSpend() {
    if (typeof readUsageRows !== 'function') return { ok: false };
    let read;
    try {
      read = await readUsageRows();
    } catch {
      return { ok: false };
    }
    if (!read || read.ok !== true) return { ok: false };
    return { ok: true, spend: monthlySpendFromRows(read.rows, { now: stamp() }) };
  }

  /** The one advice call behind the button, for all uncertain sections at once. */
  async function advise(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;

    const config = aiConfiguration(env());
    if (!config.enabled) {
      return reply(503, { enabled: false, reason: config.reason, error: messageFor(config.reason) });
    }

    const parsed = await readJson(request);
    const jobId = parsed.ok && parsed.body && typeof parsed.body.job_id === 'string' ? parsed.body.job_id.trim() : '';
    if (jobId === '') return reply(400, { error: messageForAdvice('invalid_request'), reason: 'invalid_request' });

    let source = null;
    try {
      source = await readSource({ jobId, actorUserId: auth.userId });
    } catch {
      source = null;
    }
    if (!source || source.ok !== true) return reply(404, { error: messageForAdvice('not_found'), reason: 'not_found' });

    const sections = uncertainSections(source.menus);
    if (sections.length === 0) {
      return reply(422, { error: messageForAdvice('structure_sections_unknown'), reason: 'structure_sections_unknown', enabled: true });
    }

    // The same source version already has an advice: never pay for it twice.
    const stored = storedAdviceView(source.storedAdvice, source.receiptHash);
    if (stored) {
      const spend = await readSpend();
      return reply(200, {
        reused: true,
        enabled: true,
        advice: stored,
        cost: null,
        monthly: spend.ok ? publicMonthly(spend.spend) : publicMonthly(null),
      });
    }

    const fragments = sourceFragments(source.menus);
    if (fragments.length === 0) {
      return reply(422, { error: messageForAdvice('source_text_unavailable'), reason: 'source_text_unavailable', enabled: true });
    }

    const spend = await readSpend();
    if (!spend.ok) {
      return reply(503, { error: messageFor('budget_unavailable'), reason: 'budget_unavailable', monthly: publicMonthly(null), enabled: true });
    }
    const decision = budgetDecision(spend.spend);
    if (!decision.allowed) {
      return reply(429, {
        error: messageFor(decision.reason),
        reason: decision.reason,
        monthly: publicMonthly(spend.spend),
        enabled: true,
      });
    }

    const guard = createCallBudget(AI_MAX_COST_EUR_CENTS);
    let callModule = null;
    try {
      callModule = createCall({ budget: guard });
    } catch {
      callModule = null;
    }
    if (!callModule || typeof callModule.call !== 'function' || callModule.enabled === false) {
      return reply(503, { error: messageFor('ai_not_configured'), reason: 'ai_not_configured', enabled: false });
    }

    let output = null;
    let failure = null;
    try {
      output = await callModule.call({ sections, fragments, limits: ADVICE_LIMITS });
      guard.settle();
    } catch (err) {
      failure = err;
    }

    // The provider's own measured cost, also for a failure: a paid call is never
    // booked as free, and an unknown cost stays unknown (the counter charges the
    // full per-call maximum for it).
    const cost = publicCost(guard);
    const lastCall = (callModule.lastCall && typeof callModule.lastCall === 'object' ? callModule.lastCall : null) || (failure && failure.callRecord) || null;
    const validated = failure ? { advices: [], rejected: [] } : validateAdvice({ sections, fragments, output });

    const record = adviceRecord({
      jobId,
      receiptId: source.receiptId || null,
      receiptHash: source.receiptHash || null,
      advices: validated.advices,
      rejected: validated.rejected,
      ai: {
        label: AI_READ_LABEL,
        aiName: AI_READ_AI_NAME,
        provider: callModule.provider || null,
        model: callModule.model || null,
        requestId: lastCall && typeof lastCall.requestId === 'string' ? lastCall.requestId : null,
      },
      cost,
      now: stamp(),
      readId: generateId(),
      outcome: failure ? 'failed' : validated.advices.length > 0 ? 'advised' : 'rejected',
    });

    // The advice (or the failed attempt's cost) is stored apart from any human
    // decision. Without a stored record the monthly counter would under-report.
    let saved = null;
    try {
      saved = await saveAdvice({ jobId, actorUserId: auth.userId, record });
    } catch {
      saved = null;
    }
    if (!saved || saved.ok !== true) {
      return reply(502, {
        error: messageForAdvice('advice_not_stored'),
        reason: 'advice_not_stored',
        cost,
        monthly: publicMonthly(spend.spend),
        enabled: true,
      });
    }

    if (failure) {
      const code = (failure && (failure.code || (failure.callRecord && failure.callRecord.reason))) || '';
      const reason = code === 'timeout' || code === 'call_timeout' || code === 'provider_timeout' ? 'advice_timeout' : 'advice_failed';
      return reply(502, { error: messageForAdvice(reason), reason, cost, monthly: publicMonthly(spend.spend), enabled: true });
    }

    if (validated.advices.length === 0) {
      return reply(422, {
        error: messageForAdvice('advice_rejected'),
        reason: 'advice_rejected',
        cost,
        monthly: publicMonthly(spend.spend),
        enabled: true,
      });
    }

    const spendAfter = { ...spend.spend, spentEurCents: spend.spend.spentEurCents + (cost.known ? cost.eurCents : 0) };
    return reply(200, {
      reused: false,
      enabled: true,
      advice: storedAdviceView(record, source.receiptHash),
      cost,
      monthly: publicMonthly(spendAfter),
      ai: { label: AI_READ_LABEL, aiName: AI_READ_AI_NAME, model: callModule.model || null },
      rejectedCount: record.rejected.length,
    });
  }

  return { advise };
}

module.exports = { ADVICE_LIMITS, createMenuStructureAdviceHandlers };
