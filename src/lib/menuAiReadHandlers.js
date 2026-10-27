'use strict';

// W2/W5 of the Delivery Lead order for #59 / BE-21 (review 6380804419): the
// one internal route behind the "Lees met AI" button. It reads an allowed
// source, runs route B's existing provider call, validates and normalizes it,
// writes one durable concept (the existing concept route) and hands the result
// to the existing review screen through the existing sealed state token.
//
// Every dependency is injected: the auth check, the source reader, the job
// lookup, the concept write, the state cipher, the budget reader and the
// provider call. The module itself has no network, no database and no clock of
// its own, so each rule below is provable offline with fake transport.

const { isInternalOnly } = require('./importInbox');
const { buildImportBundle, bundleMetadata } = require('./manualMenuImportBundle');
const { buildImportReport, publicImportReport } = require('./manualMenuImportImport');
const { reviewView, menuContextFor } = require('./manualMenuImportReview');
const { mapStructuredOutputToMenuContexts } = require('./menuExtractionMapping');
const { buildMenuConcept } = require('./menuConcept');
const { MAX_SCAN_PAGES, imageReadNotice, planImageRead } = require('./menuImageRead');
const {
  createStructuredExtractionAdapter,
  runStructuredExtraction,
} = require('./menuExtractionAdapter');
const {
  AI_LIMITS,
  AI_MAX_COST_EUR_CENTS,
  AI_MODEL,
  AI_PROVIDER,
  AI_READ_AI_NAME,
  AI_READ_LABEL,
  AI_READ_PROVENANCE_KIND,
  MAX_SOURCES,
  aiConfiguration,
  aiOriginOverrides,
  budgetDecision,
  messageFor,
  monthlySpendFromRows,
  publicMonthly,
  reply,
} = require('./menuAiImport');

const MAX_BODY_CHARS = 8 * 1024 * 1024;
const MAX_RESTAURANT_ID = 80;

/**
 * The synchronous reservation the existing adapter expects. It never lets a
 * second call of the same request spend the same cents, and an unknown cost
 * stays charged at the maximum.
 */
function createCallBudget(maxCostEurCents) {
  let reserved = 0;
  let settled = false;
  return {
    costEurCents: undefined,
    reserve(maxCost) {
      if (settled || reserved > 0) return false;
      if (!Number.isInteger(maxCost) || maxCost < 0 || maxCost > maxCostEurCents) return false;
      reserved = maxCost;
      return true;
    },
    settle() {
      settled = true;
      return true;
    },
    snapshot() {
      return { reservedEurCents: reserved, settled };
    },
  };
}

function publicCost(guard) {
  const measured = guard && Number.isInteger(guard.costEurCents) && guard.costEurCents >= 0 ? guard.costEurCents : null;
  return { eurCents: measured, known: measured !== null, maxEurCents: AI_MAX_COST_EUR_CENTS };
}

async function readJson(request) {
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_BODY_CHARS) return { ok: false };
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? { ok: true, body } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function createMenuAiReadHandlers({
  authenticate,
  env = () => process.env,
  now = () => new Date(),
  readUsageRows,
  readSources,
  resolveJob,
  restaurantExists = () => true,
  loadProtocol,
  openState,
  sealState,
  saveConcept,
  createCall,
  generateId,
  runExtraction = runStructuredExtraction,
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
    if (!auth || auth.ok !== true) {
      return { denied: reply(401, { error: 'Meld je opnieuw aan.' }) };
    }
    if (!isInternalOnly(auth.roles)) {
      return { denied: reply(403, { error: messageFor('forbidden'), reason: 'forbidden' }) };
    }
    return { auth };
  }

  /** W4: the month's spend, only from durable AI concepts. */
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

  /**
   * W2: the only two accepted handles. `state` is a capture this server sealed
   * itself; `job_id` is resolved from the database. A URL in the body is never
   * used: no code path reads one.
   */
  async function resolveSource(body, auth) {
    if (body && typeof body.state === 'string' && body.state.trim() !== '') {
      if (typeof openState !== 'function') return { ok: false, status: 503, reason: 'source_unknown' };
      const opened = openState(body.state);
      if (!opened || opened.ok !== true) {
        return { ok: false, status: 409, reason: (opened && opened.code) || 'state_invalid', message: opened && opened.message };
      }
      const state = opened.state;
      if (!state || state.userId !== auth.userId) return { ok: false, status: 403, reason: 'forbidden' };
      const bundle = state.bundle;
      if (!bundle || !Array.isArray(bundle.sources)) return { ok: false, status: 409, reason: 'source_unknown' };
      const readable = bundle.sources.filter((source) => source && source.hasText === true && typeof source.text === 'string' && source.text.trim() !== '');
      if (readable.length === 0) return { ok: false, status: 422, reason: 'source_empty' };
      return {
        ok: true,
        restaurantId: state.restaurantId,
        bundle,
        sources: readable.map((source) => ({ id: source.id, url: source.url, kind: source.kind, text: source.text })),
      };
    }

    if (body && typeof body.job_id === 'string' && body.job_id.trim() !== '') {
      if (typeof resolveJob !== 'function') return { ok: false, status: 503, reason: 'source_unknown' };
      let job;
      try {
        job = await resolveJob({ jobId: body.job_id.trim(), actorUserId: auth.userId });
      } catch {
        job = null;
      }
      if (!job || job.ok !== true) return { ok: false, status: 404, reason: 'source_unknown' };
      const urls = (Array.isArray(job.urls) ? job.urls : []).filter((url) => typeof url === 'string' && url.trim() !== '').slice(0, MAX_SOURCES);
      if (urls.length === 0) return { ok: false, status: 422, reason: 'source_required' };
      const restaurantId = job.restaurantId || (typeof body.restaurant_id === 'string' ? body.restaurant_id.trim() : '');
      if (
        typeof restaurantId !== 'string' ||
        restaurantId === '' ||
        restaurantId.length > MAX_RESTAURANT_ID ||
        !restaurantExists(restaurantId)
      ) {
        return { ok: false, status: 422, reason: 'restaurant_required' };
      }
      if (typeof readSources !== 'function' || typeof loadProtocol !== 'function') {
        return { ok: false, status: 503, reason: 'source_unknown' };
      }
      let protocol;
      try {
        protocol = loadProtocol();
      } catch {
        return { ok: false, status: 503, reason: 'source_unknown' };
      }
      const read = await readSources({ urls, now: stamp() });
      // BE-33 (#79, criterion 2): a menu that only exists as an image or as a
      // scan is planned here, before any budget is spent. The plan enforces the
      // 6-image / 10-page limits and the fixed file size; a refusal names the
      // reason instead of sending something unbounded to the model.
      const fetched = (Array.isArray(read) ? read : []).filter(
        (source) => source && (source.status === 'read' || source.status === undefined) && typeof source.sha256 === 'string',
      );
      if (fetched.length === 0) return { ok: false, status: 422, reason: 'source_empty' };
      const plan = planImageRead({ sources: fetched });
      if (!plan.ok) return { ok: false, status: 422, reason: plan.reason, message: plan.message, plan };
      const built = buildImportBundle({
        bundleId: `AI-${generateId ? generateId() : 'job'}`,
        actorUserId: auth.userId,
        restaurantId,
        restaurantName: job.restaurantName || null,
        fetchedAt: stamp().toISOString(),
        protocol,
        sources: fetched,
        now: stamp(),
      });
      return {
        ok: true,
        restaurantId,
        bundle: built,
        plan,
        // The model receives the same validated inventory: text, or the images
        // of this website, or the PDF as a document. The bytes stay in this
        // request only; the sealed bundle keeps metadata only.
        sources: fetched.map((source) => ({
          id: source.id,
          url: source.url,
          kind: source.kind,
          text: source.hasText === true && typeof source.text === 'string' ? source.text : null,
          images: Array.isArray(source.images)
            ? source.images.map((image) => ({
                number: image.number,
                url: image.url,
                mediaType: image.mediaType,
                data: image.data,
              }))
            : [],
          documentBase64: typeof source.documentBase64 === 'string' ? source.documentBase64 : null,
          pageCount: Number.isInteger(source.pageCount) ? source.pageCount : null,
          imageRead: source.imageRead === true,
        })),
      };
    }

    return { ok: false, status: 422, reason: 'source_required' };
  }


  /**
   * The durable concept of this read: the validated, normalized result through
   * the existing mapping and concept rules, with an explicit AI provenance
   * (label "Gelezen door AI", provider, model, cost, versions). It is a draft:
   * open points are counted, nothing is approved or published.
   */
  function buildAiReadConcept(result, ai) {
    const contexts = mapStructuredOutputToMenuContexts({ menus: result.validated.menus }, ai.sources);
    const concept = buildMenuConcept({ menus: contexts, liveLines: [], edits: {} });
    const provenance = {
      // Fixed AI-read fields, taken only from this app's own call.
      ...aiOriginOverrides(ai.origin),
      // Report-derived facts; never a model claim.
      protocolVersion: ai.protocolVersion,
      protocolHash: ai.protocolHash,
      schemaVersion: ai.schemaVersion,
      bundleHash: ai.bundleHash,
      // Explicitly not reviewed: this version is the reading, not a decision.
      reviewed: false,
      items: result.summary.items,
      openPoints: result.summary.needsReview,
      sources: result.technical.sources.map((source) => ({ id: source.id, url: source.url, sha256: source.sha256 })),
      normalizations: (Array.isArray(result.normalizations) ? result.normalizations : []).slice(0, 5),
    };
    const content = { ...concept.content, importProvenance: provenance };
    return {
      content,
      provenance,
      menuContext: menuContextFor(ai.restaurantId || 'import', contexts),
      concepts: contexts.length,
    };
  }

  /** GET — W1/W3/W4: may the block offer the button, and what has been spent? */
  async function status(request) {
    const { denied } = await authorize(request);
    if (denied) return denied;
    const config = aiConfiguration(env());
    // An unavailable reading is reported as an unknown amount, never as zero.
    const spend = await readSpend();
    const monthly = spend.ok ? publicMonthly(spend.spend) : publicMonthly(null);
    return reply(200, {
      enabled: config.enabled,
      reason: config.enabled ? null : config.reason,
      message: config.enabled ? null : messageFor(config.reason),
      label: AI_READ_LABEL,
      aiName: AI_READ_AI_NAME,
      perCallMaxEurCents: AI_MAX_COST_EUR_CENTS,
      monthly,
      budget: spend.ok ? budgetDecision(spend.spend) : { allowed: false, reason: 'budget_unavailable' },
    });
  }



  /** POST — the one server call behind "Lees met AI". */
  async function read(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;

    const config = aiConfiguration(env());
    if (!config.enabled) return reply(503, { error: messageFor(config.reason), reason: config.reason, enabled: false });

    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: messageFor('invalid_request'), reason: 'invalid_request' });

    const source = await resolveSource(parsed.body, auth);
    if (!source.ok) {
      return reply(source.status || 422, { error: source.message || messageFor(source.reason), reason: source.reason });
    }

    const spend = await readSpend();
    if (!spend.ok) {
      return reply(503, { error: messageFor('budget_unavailable'), reason: 'budget_unavailable', monthly: publicMonthly(null) });
    }
    const decision = budgetDecision(spend.spend);
    // BE-33 (#79, criterion 2): the estimate of an image or scan reading is
    // available before the click. A dry run resolves the source and the plan,
    // but never creates a provider call and never spends anything.
    if (parsed.body && parsed.body.dry_run === true) {
      return reply(200, {
        dry_run: true,
        enabled: config.enabled,
        plan: source.plan || null,
        estimate: source.plan ? source.plan.estimate : null,
        notice: imageReadNotice(source.plan),
        monthly: publicMonthly(spend.spend),
        budget: decision,
      });
    }
    if (!decision.allowed) {
      return reply(429, { error: messageFor(decision.reason), reason: decision.reason, monthly: publicMonthly(spend.spend) });
    }

    const guard = createCallBudget(AI_MAX_COST_EUR_CENTS);
    const callModule = typeof createCall === 'function' ? createCall({ budget: guard }) : null;
    if (!callModule || callModule.enabled !== true || typeof callModule.call !== 'function') {
      return reply(503, { error: messageFor('ai_not_configured'), reason: 'ai_not_configured', enabled: false });
    }

    const protocol = (source.bundle && source.bundle.protocol) || null;
    const adapter = createStructuredExtractionAdapter({
      provider: callModule.provider || AI_PROVIDER,
      model: callModule.model || AI_MODEL,
      call: callModule.call,
      cancel: callModule.cancel,
    });
    const startedAt = Date.now();
    const extraction = await runExtraction({
      adapter,
      protocol,
      sources: source.sources,
      // Criterion 2: at most 10 pages per reading, also for the model's own
      // coverage claim. The adapter keeps the existing validator authoritative.
      limits: { ...AI_LIMITS, maxPages: MAX_SCAN_PAGES },
      budget: guard,
    });
    const cost = publicCost(guard);
    const durationMs = Math.max(0, Date.now() - startedAt);

    if (!extraction || extraction.ok !== true) {
      const reason = (extraction && extraction.reason) || 'model_unavailable';
      return reply(422, {
        error: messageFor(reason),
        reason,
        problems: Array.isArray(extraction && extraction.problems) ? extraction.problems.slice(0, 20) : [],
        cost,
        durationMs,
        monthly: publicMonthly(spend.spend),
      });
    }

    const importId = generateId ? generateId() : `ai-${Date.now()}`;
    const at = stamp();
    const result = buildImportReport({
      importId,
      bundle: source.bundle,
      output: extraction.output,
      aiName: AI_READ_AI_NAME,
      now: at,
      carriedNormalizations: extraction.normalizations,
    });
    if (!result.ok) {
      return reply(422, {
        error: messageFor(result.code === 'no_items' ? 'no_items' : 'schema_violation'),
        reason: result.code,
        problems: result.problems,
        problemSummary: result.problemSummary,
        recoveryQuestion: result.recoveryQuestion,
        cost,
        durationMs,
        monthly: publicMonthly(spend.spend),
      });
    }

    const ai = {
      provider: callModule.provider || AI_PROVIDER,
      model: callModule.model || AI_MODEL,
      readAt: at.toISOString(),
      protocolVersion: result.technical.protocolVersion,
      protocolHash: result.technical.protocolHash,
      schemaVersion: result.technical.schemaVersion,
      bundleHash: result.technical.bundleHash,
      requestId: callModule.lastCall && callModule.lastCall.requestId,
      cost,
      sources: result.technical.sources,
      restaurantId: source.restaurantId,
      // The origin that travels in the sealed step and into every version of
      // this reading: label, provider, model, cost and one read id.
      origin: {
        kind: AI_READ_PROVENANCE_KIND,
        label: AI_READ_LABEL,
        aiName: AI_READ_AI_NAME,
        provider: callModule.provider || AI_PROVIDER,
        model: callModule.model || AI_MODEL,
        readId: importId,
        readAt: at.toISOString(),
        requestId: (callModule.lastCall && callModule.lastCall.requestId) || null,
        cost: { eurCents: cost.known ? cost.eurCents : null, known: cost.known },
      },
    };
    const draft = buildAiReadConcept(result, ai);

    let saved = null;
    if (typeof saveConcept === 'function') {
      try {
        saved = await saveConcept({
          actorUserId: auth.userId,
          restaurantId: source.restaurantId,
          menuContext: draft.menuContext,
          sourceUrl: (result.technical.sources[0] && result.technical.sources[0].url) || null,
          sourceType: 'own_website',
          qualityScore: 'medium',
          content: draft.content,
          originallyFetchedAt: source.bundle.fetchedAt,
        });
      } catch {
        saved = null;
      }
    }
    if (!saved || typeof saved.status !== 'number' || saved.status >= 400) {
      return reply(502, {
        error: messageFor('concept_failed'),
        reason: 'concept_failed',
        cost,
        durationMs,
        monthly: publicMonthly(spend.spend),
      });
    }

    const sealed = typeof sealState === 'function'
      ? sealState({
          userId: auth.userId,
          restaurantId: source.restaurantId,
          bundle: source.bundle,
          report: result,
          decisions: [],
          followUps: {},
          followUpTotal: 0,
          // The existing review and save routes take the label, provider,
          // model, read id and measured cost from here — never from input.
          origin: ai.origin,
        })
      : null;

    const spendAfter = { ...spend.spend, spentEurCents: spend.spend.spentEurCents + (cost.known ? cost.eurCents : 0) };
    return reply(200, {
      origin: { kind: AI_READ_PROVENANCE_KIND, label: AI_READ_LABEL, aiName: AI_READ_AI_NAME },
      // BE-33 (#79): what was read (text, N images or a document of N pages),
      // the estimate that was shown beforehand and the honest notice.
      plan: source.plan || null,
      estimate: source.plan ? source.plan.estimate : null,
      notice: imageReadNotice(source.plan),
      imageRead: Boolean(source.plan && source.plan.mode !== 'text'),
      ai: {
        provider: ai.provider,
        model: ai.model,
        readAt: ai.readAt,
        label: AI_READ_LABEL,
        protocolVersion: ai.protocolVersion,
        protocolHash: ai.protocolHash,
        schemaVersion: ai.schemaVersion,
        bundleHash: ai.bundleHash,
        requestId: ai.requestId || null,
        durationMs,
      },
      cost,
      monthly: publicMonthly(spendAfter),
      import: publicImportReport(result),
      review: reviewView({ report: result, decisions: new Map(), capture: source.bundle.sources }),
      summary: {
        items: result.summary.items,
        valid: result.summary.valid,
        needsReview: result.summary.needsReview,
      },
      concept: saved.body && saved.body.concept ? saved.body.concept : null,
      state: sealed ? sealed.token : null,
      validUntil: sealed ? sealed.expiresAt : null,
    });
  }

  return { status, read };
}

module.exports = { createCallBudget, createMenuAiReadHandlers, publicCost, readJson };

