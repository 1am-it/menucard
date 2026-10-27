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
const { MAX_COST_PER_PAGE_EUR_CENTS, MAX_SCAN_PAGES, imageReadNotice, planImageRead } = require('./menuImageRead');
const {
  MAX_CONCURRENT_PAGES,
  PAGE_ATTEMPTS,
  PAGE_CALL_TIMEOUT_MS,
  READING_DEADLINE_MS,
  RETRY_DELAY_MS,
  mergeReadingOutputs,
  mergedCoverage,
  pageFailure,
  publicUnit,
  readingCostPlan,
  readingUnits,
  repairPageOutput,
  retryUnits,
  retryableReason,
  unitLimits,
  unitSource,
} = require('./menuReadingPages');
const { validateStructuredOutput } = require('./menuExtractionSchema');
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

/**
 * BE-36 (#87, criterion 5): one reading is several calls, so its budget is a
 * ledger, not one reservation. Every page reserves its own maximum before the
 * call and books its own measured cost after it; an unknown cost keeps the
 * whole reservation charged. Nothing is ever booked as free, and the sum of the
 * pages can never pass the planned maximum of the reading (which follows the
 * number of pages).
 */
function createReadingBudget(maxEurCents) {
  const total = Number.isInteger(maxEurCents) && maxEurCents >= 0 ? maxEurCents : 0;
  const state = { spentEurCents: 0, reservedEurCents: 0, calls: 0, unknownCalls: 0, refused: 0 };
  /** What is still available for one page, so a retry can always fit. */
  function grant(perPageMax) {
    const left = total - state.spentEurCents - state.reservedEurCents;
    if (left <= 0) return 0;
    return Math.min(Number.isInteger(perPageMax) && perPageMax > 0 ? perPageMax : 0, left);
  }
  function attempt(limit) {
    const max = Number.isInteger(limit) && limit >= 0 ? limit : 0;
    let reserved = 0;
    let settled = false;
    return {
      costEurCents: undefined,
      reserve(maxCost) {
        if (settled) return false;
        if (!Number.isInteger(maxCost) || maxCost < 0 || maxCost > max) {
          state.refused += 1;
          return false;
        }
        if (state.spentEurCents + state.reservedEurCents + maxCost > total) {
          state.refused += 1;
          return false;
        }
        reserved = maxCost;
        state.reservedEurCents += maxCost;
        return true;
      },
      settle(amount) {
        if (settled) return true;
        settled = true;
        state.reservedEurCents = Math.max(0, state.reservedEurCents - reserved);
        if (Number.isInteger(amount) && amount >= 0) {
          state.spentEurCents += amount;
        } else {
          // A paid failure with no measured cost is not free.
          state.spentEurCents += reserved;
          state.unknownCalls += 1;
        }
        state.calls += 1;
        return true;
      },
    };
  }
  return { state, attempt, grant, totalEurCents: total };
}

/** The reading's cost for the screen: measured only when every call reported it. */
function publicReadingCost(ledger) {
  if (!ledger || !ledger.state) return { eurCents: null, known: false, maxEurCents: AI_MAX_COST_EUR_CENTS, calls: 0 };
  const state = ledger.state;
  const known = state.calls > 0 && state.unknownCalls === 0;
  return {
    eurCents: known ? state.spentEurCents : null,
    known,
    maxEurCents: ledger.totalEurCents,
    calls: state.calls,
  };
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
  // A retry waits a moment before the second attempt; injectable so a test
  // never waits for real time.
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
   * BE-35 ronde 3 (#84): the sources that really go to the model, in the order
   * of the plan. An image source carries exactly the number of images the plan
   * reads (a page whose images were all cut is not sent with none), a text
   * source goes by its own text and a scan as its document. The bytes exist only
   * inside this request; the sealed bundle keeps metadata.
   */
  function modelSources(plan, byId) {
    const entries = plan && Array.isArray(plan.sources) ? plan.sources : [];
    const out = [];
    for (const entry of entries) {
      const source = byId.get(entry.id);
      if (!source) continue;
      const images = entry.mode === 'image' && Array.isArray(source.images)
        ? source.images.slice(0, Number.isInteger(entry.imageCount) ? entry.imageCount : source.images.length)
        : [];
      out.push({
        id: source.id,
        url: source.url,
        kind: source.kind,
        text: entry.mode === 'text' && typeof source.text === 'string' ? source.text : null,
        images: images.map((image) => ({
          number: image.number,
          url: image.url,
          mediaType: image.mediaType,
          data: image.data,
        })),
        documentBase64: entry.mode === 'document' && typeof source.documentBase64 === 'string' ? source.documentBase64 : null,
        pageCount: Number.isInteger(source.pageCount) ? source.pageCount : null,
        imageRead: entry.mode !== 'text',
      });
    }
    return out;
  }

  /**
   * BE-36 (#87, criterion 2): the pages of an earlier reading that failed, read
   * again — only those pages. The earlier validated menus travel with the sealed
   * state, so the retry completes that same reading instead of replacing it with
   * one page. The bytes are fetched again from the sealed source URLs.
   */
  async function resolveRetry({ state, retryPages, bundle }) {
    const prior = state.report && state.report.validated ? state.report.validated : null;
    const descriptors = state.imageRead && Array.isArray(state.imageRead.units) ? state.imageRead.units : [];
    const wanted = descriptors.filter((unit) => unit && retryPages.includes(unit.number));
    if (!prior || !Array.isArray(prior.menus) || wanted.length === 0) {
      return { ok: false, status: 409, reason: 'state_invalid', message: 'Deze lezing heeft geen pagina om opnieuw te lezen.' };
    }
    if (typeof readSources !== 'function') return { ok: false, status: 503, reason: 'source_unknown' };
    const urls = [...new Set(wanted.map((unit) => unit.sourceUrl).filter((url) => typeof url === 'string' && url !== ''))].slice(0, MAX_SOURCES);
    let read;
    try {
      read = urls.length > 0 ? await readSources({ urls, now: stamp() }) : [];
    } catch {
      read = null;
    }
    const fetched = (Array.isArray(read) ? read : []).filter(
      (source) => source && (source.status === 'read' || source.status === undefined) && typeof source.sha256 === 'string',
    );
    const { units, missing } = retryUnits(wanted, retryPages, fetched);
    return {
      ok: true,
      restaurantId: state.restaurantId,
      bundle,
      plan: state.plan || null,
      sources: [],
      retry: {
        descriptors,
        prior,
        units,
        missing,
        read: Array.isArray(state.imageRead && state.imageRead.read) ? state.imageRead.read : [],
        failedUnits: Array.isArray(state.imageRead && state.imageRead.failedUnits) ? state.imageRead.failedUnits : [],
        requested: retryPages,
      },
    };
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
      // BE-36 (#87, criterion 2): "Opnieuw proberen" for the pages that failed.
      // The request names only page numbers; the source URLs come from the
      // sealed state of that same reading, never from the client.
      const retryPages = Array.isArray(body.retry_pages) ? body.retry_pages.filter((page) => Number.isInteger(page) && page > 0).slice(0, 20) : [];
      if (state.imageRead && retryPages.length > 0) return resolveRetry({ state, retryPages, bundle });
      const sealedText = (source) => Boolean(source) && source.hasText === true && typeof source.text === 'string' && source.text.trim() !== '';
      const textSources = bundle.sources.filter(sealedText);
      // BE-35 ronde 3 (#84): the sealed bundle keeps metadata only, so the menu
      // images of an image source are read again here, server-side, exactly as
      // the `job_id` branch does. The URLs come from the sealed state and never
      // from the request (W2); a source that already carries sealed text keeps
      // its text, which is free and exactly checkable.
      const imageSources = bundle.sources.filter((source) => (
        Boolean(source)
        && source.imageRead === true
        && !sealedText(source)
        && typeof source.url === 'string'
        && source.url.trim() !== ''
      ));
      if (textSources.length === 0 && imageSources.length === 0) return { ok: false, status: 422, reason: 'source_empty' };
      let fetched = [];
      if (imageSources.length > 0) {
        if (typeof readSources !== 'function') return { ok: false, status: 503, reason: 'source_unknown' };
        let read;
        try {
          read = await readSources({ urls: imageSources.map((source) => source.url), now: stamp() });
        } catch {
          read = null;
        }
        const sealedById = new Map(imageSources.map((source) => [source.url, source]));
        fetched = (Array.isArray(read) ? read : [])
          .filter((source) => (
            source
            && (source.status === 'read' || source.status === undefined)
            && typeof source.sha256 === 'string'
            && typeof source.url === 'string'
            && sealedById.has(source.url)
          ))
          // The sealed id stays the id of the source, so the existing bundle
          // binding and the validator keep naming the same source.
          .map((source) => ({ ...source, id: sealedById.get(source.url).id }));
        if (fetched.length === 0) {
          return {
            ok: false,
            status: 422,
            reason: 'source_empty',
            message: 'De beeldbronnen van deze import konden niet opnieuw worden gelezen. Kies de bron opnieuw of probeer het later.',
          };
        }
      }
      const byId = new Map();
      for (const source of textSources) {
        byId.set(source.id, { id: source.id, url: source.url, kind: source.kind, text: source.text, hasText: true });
      }
      for (const source of fetched) byId.set(source.id, source);
      const combined = bundle.sources.map((source) => byId.get(source.id)).filter(Boolean);
      const plan = planImageRead({ sources: combined });
      if (!plan.ok) return { ok: false, status: 422, reason: plan.reason, message: plan.message, plan };
      return {
        ok: true,
        restaurantId: state.restaurantId,
        bundle,
        plan,
        sources: modelSources(plan, byId),
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
      // 10-image / 10-page limits and the fixed file size; a refusal names the
      // reason instead of sending something unbounded to the model.
      const fetched = (Array.isArray(read) ? read : []).filter(
        (source) => source && (source.status === 'read' || source.status === undefined) && typeof source.sha256 === 'string',
      );
      if (fetched.length === 0) return { ok: false, status: 422, reason: 'source_empty' };
      const plan = planImageRead({ sources: fetched });
      if (!plan.ok) return { ok: false, status: 422, reason: plan.reason, message: plan.message, plan };
      // BE-35 ronde 3 (#84): the bundle holds exactly the sources the model gets,
      // so the validator's coverage rule and the reading name the same sources. A
      // page whose images were all cut or failed is no source of this reading.
      const byId = new Map(fetched.map((source) => [source.id, source]));
      const sent = plan.sources.map((entry) => byId.get(entry.id)).filter(Boolean);
      const built = buildImportBundle({
        bundleId: `AI-${generateId ? generateId() : 'job'}`,
        actorUserId: auth.userId,
        restaurantId,
        restaurantName: job.restaurantName || null,
        fetchedAt: stamp().toISOString(),
        protocol,
        sources: sent,
        now: stamp(),
      });
      return {
        ok: true,
        restaurantId,
        bundle: built,
        plan,
        // The model receives exactly what the plan reads: text, the images of
        // this website, or the PDF as a document. The bytes stay in this request
        // only; the sealed bundle keeps metadata only.
        sources: modelSources(plan, byId),
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

  /**
   * BE-36 (#87, criterion 1 and 2): one page per call, at most two at the same
   * time, one automatic retry per page, and never past the reading's time. The
   * same adapter, provider call, validator and budget guard as before — the loop
   * is the only new thing, so there is no second AI path.
   */
  async function readUnitPages({ units, protocol, ledger, startedAt, delay }) {
    const results = new Array(units.length);
    const calls = [];
    let cursor = 0;
    async function readOne(unit) {
      let failure = null;
      let attempts = 0;
      for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt += 1) {
        attempts = attempt;
        if (Date.now() - startedAt > READING_DEADLINE_MS) {
          return { ok: false, unit, reason: 'timeout', attempts: attempts - 1, deadline: true };
        }
        // What is still available decides this attempt, so a retry after a paid
        // failure always fits inside the reading's own maximum.
        const grant = ledger.grant(MAX_COST_PER_PAGE_EUR_CENTS);
        if (grant <= 0) {
          return { ok: false, unit, reason: failure ? failure.reason : 'budget_exceeded', attempts: attempts - 1, budgetStopped: true };
        }
        const guard = ledger.attempt(grant);
        const callModule = typeof createCall === 'function' ? createCall({ budget: guard }) : null;
        if (!callModule || callModule.enabled !== true || typeof callModule.call !== 'function') {
          return { ok: false, unit, reason: 'ai_not_configured', attempts: attempts - 1 };
        }
        const adapter = createStructuredExtractionAdapter({
          provider: callModule.provider || AI_PROVIDER,
          model: callModule.model || AI_MODEL,
          call: callModule.call,
          cancel: callModule.cancel,
        });
        const extraction = await runExtraction({
          adapter,
          protocol,
          sources: unitSource(unit),
          limits: { ...unitLimits(unit, { ...AI_LIMITS, maxPages: MAX_SCAN_PAGES }), maxCostEurCents: grant },
          budget: guard,
          repairOutput: (raw) => repairPageOutput(raw, unit),
        });
        if (callModule.lastCall) calls.push({ page: unit.number, ...callModule.lastCall });
        if (extraction && extraction.ok === true) {
          return {
            ok: true,
            unit,
            output: extraction.output,
            normalizations: [...(Array.isArray(extraction.repairs) ? extraction.repairs : []), ...(Array.isArray(extraction.normalizations) ? extraction.normalizations : [])],
            callModule,
          };
        }
        failure = {
          reason: (extraction && extraction.reason) || 'model_unavailable',
          problems: Array.isArray(extraction && extraction.problems) ? extraction.problems.slice(0, 20) : [],
        };
        if (!retryableReason(failure.reason) || attempt >= PAGE_ATTEMPTS) break;
        await delay(RETRY_DELAY_MS);
      }
      return { ok: false, unit, attempts, ...failure };
    }
    async function worker() {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= units.length) return;
        results[index] = await readOne(units[index]);
      }
    }
    const workers = Array.from({ length: Math.max(1, Math.min(MAX_CONCURRENT_PAGES, units.length)) }, () => worker());
    await Promise.all(workers);
    return { results: results.filter(Boolean), calls };
  }

  /** A validator source list from the sealed bundle: metadata only, never bytes. */
  function validatorSourcesFromBundle(bundle) {
    return (bundle && Array.isArray(bundle.sources) ? bundle.sources : []).map((source) => ({
      id: source.id,
      url: source.url,
      kind: source.kind,
      status: source.status,
      sha256: source.sha256,
      imageRead: source.imageRead === true,
      images: source.imageRead === true ? [{}] : [],
      pageCount: Number.isInteger(source.pageCount) ? source.pageCount : null,
      ...(typeof source.text === 'string' && source.text !== '' ? { text: source.text } : {}),
    }));
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
    // BE-36 (#87, criterion 1): a reading of images or a scan is a list of pages,
    // not one blob. The plan already says which images and pages may be read;
    // this only numbers them and keeps their origin.
    const units = source.retry ? source.retry.units : readingUnits(source.plan, source.sources);
    const costPlan = readingCostPlan(units);
    const decision = budgetDecision(spend.spend, { maxEurCents: costPlan.maxEurCents });
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
    if (units.length === 0) {
      if (source.retry) {
        // Criterion 2: the page is gone from the source. Say so per page; the
        // earlier reading stays saved and untouched.
        const missing = (source.retry.missing || []).map((unit) => pageFailure(unit, { reason: 'source_missing', attempts: 1 }));
        return reply(422, {
          error: messageFor('source_missing'),
          reason: 'source_missing',
          pages: {
            total: source.retry.descriptors.length,
            read: Array.isArray(source.retry.read) ? source.retry.read.length : 0,
            failed: missing,
            retryable: [],
            duplicates: 0,
            partial: true,
          },
          partial: true,
          monthly: publicMonthly(spend.spend),
        });
      }
      return reply(422, {
        error: messageFor('source_empty'),
        reason: 'source_empty',
        monthly: publicMonthly(spend.spend),
      });
    }

    // One cheap check that the provider is configured, before any page is read.
    const probe = typeof createCall === 'function' ? createCall({}) : null;
    if (!probe || probe.enabled !== true || typeof probe.call !== 'function') {
      return reply(503, { error: messageFor('ai_not_configured'), reason: 'ai_not_configured', enabled: false });
    }

    const protocol = (source.bundle && source.bundle.protocol) || null;
    const ledger = createReadingBudget(costPlan.maxEurCents);
    const startedAt = Date.now();
    const read = await readUnitPages({ units, protocol, ledger, startedAt, delay: sleep });
    const cost = publicReadingCost(ledger);
    const durationMs = Math.max(0, Date.now() - startedAt);
    const readOk = read.results.filter((entry) => entry.ok === true);
    const readFailed = read.results.filter((entry) => entry.ok !== true);
    const failures = readFailed.map((entry) => pageFailure(entry.unit, entry));
    // A page that could not be fetched again on a retry is a failed page too.
    const missingFailures = (source.retry && Array.isArray(source.retry.missing) ? source.retry.missing : [])
      .map((unit) => pageFailure(unit, { reason: 'source_missing', attempts: 1 }));
    // Criterion 2: a retry only reads the pages it was asked for; a page that was
    // already missing stays in the list with the message of that earlier round.
    const requested = new Set(source.retry ? source.retry.requested : []);
    const priorFailures = source.retry && Array.isArray(source.retry.failedUnits)
      ? source.retry.failedUnits
        .filter((unit) => !requested.has(unit.number))
        .map((unit) => ({
          page: unit.number,
          kind: unit.kind || null,
          sourceId: unit.sourceId || null,
          locator: unit.locator || null,
          label: unit.label || `Pagina ${unit.number}`,
          reason: unit.reason || 'model_unavailable',
          attempts: Number.isInteger(unit.attempts) ? unit.attempts : 0,
          retryable: retryableReason(unit.reason || 'model_unavailable'),
          message: unit.message || `${unit.label || `Pagina ${unit.number}`} kon niet gelezen worden.`,
          nextStep: 'Opnieuw proberen',
        }))
      : [];
    const allFailures = [...failures, ...missingFailures, ...priorFailures]
      .sort((a, b) => (a.page || 0) - (b.page || 0));
    const allUnits = source.retry ? source.retry.descriptors : units;
    const readNumbers = new Set([
      ...(source.retry ? source.retry.read : []),
      ...readOk.map((entry) => entry.unit.number),
    ]);
    const pages = {
      total: allUnits.length,
      read: readNumbers.size,
      failed: allFailures,
      retryable: allFailures.filter((failure) => failure.retryable).map((failure) => failure.page),
      duplicates: 0,
      partial: false,
    };
    const provider = (readOk[0] && readOk[0].callModule && readOk[0].callModule.provider) || probe.provider || AI_PROVIDER;
    const model = (readOk[0] && readOk[0].callModule && readOk[0].callModule.model) || probe.model || AI_MODEL;
    const requestIds = read.calls.map((call) => call && call.requestId).filter((id) => typeof id === 'string' && id !== '');

    if (readOk.length === 0) {
      const reason = readFailed.length > 0 ? (readFailed[0].reason || 'model_unavailable') : 'model_unavailable';
      return reply(422, {
        error: messageFor(reason),
        reason,
        problems: readFailed.length > 0 && Array.isArray(readFailed[0].problems) ? readFailed[0].problems : [],
        pages,
        partial: false,
        cost,
        durationMs,
        monthly: publicMonthly(spend.spend),
      });
    }

    // Criterion 1: the pages become one reading again. The earlier reading of a
    // retry travels as one extra source of the same merge, so its dishes stay.
    const entries = source.retry
      ? [{ unit: { number: 0, sourceId: null }, output: source.retry.prior }, ...readOk.map((entry) => ({ unit: entry.unit, output: entry.output }))]
      : readOk.map((entry) => ({ unit: entry.unit, output: entry.output }));
    const merged = mergeReadingOutputs(entries);
    const readRefs = allUnits.filter((unit) => readNumbers.has(unit.number));
    // The pages that still need a human: every page that was not read, whether
    // it failed now or in an earlier round.
    const failedRefs = [
      ...allUnits.filter((unit) => !readNumbers.has(unit.number)),
    ];
    const sourceCount = source.retry ? (source.bundle.sources || []).length : source.sources.length;
    const coverage = mergedCoverage({
      readUnits: readRefs,
      failedUnits: failedRefs,
      itemCount: merged.menus.reduce((sum, menu) => sum + menu.categories.reduce((inner, category) => inner + category.items.length, 0), 0),
      sourceCount,
    });
    const output = { menus: merged.menus, rejected: merged.rejected, coverage };
    // The existing strict validator decides; a repaired page only reaches it
    // after the repairs of criterion 3.
    const problems = validateStructuredOutput(output, source.retry ? validatorSourcesFromBundle(source.bundle) : source.sources);
    if (problems.length > 0) {
      return reply(422, {
        error: messageFor('schema_violation'),
        reason: 'schema_violation',
        problems: problems.slice(0, 20),
        pages: { ...pages, partial: allFailures.length > 0 },
        partial: allFailures.length > 0,
        cost,
        durationMs,
        monthly: publicMonthly(spend.spend),
      });
    }

    const importId = generateId ? generateId() : `ai-${Date.now()}`;
    const at = stamp();
    const carried = readOk.flatMap((entry) => (Array.isArray(entry.normalizations) ? entry.normalizations : []));
    const result = buildImportReport({
      importId,
      bundle: source.bundle,
      output,
      aiName: AI_READ_AI_NAME,
      now: at,
      carriedNormalizations: carried,
    });
    if (!result.ok) {
      return reply(422, {
        error: messageFor(result.code === 'no_items' ? 'no_items' : 'schema_violation'),
        reason: result.code,
        problems: result.problems,
        problemSummary: result.problemSummary,
        recoveryQuestion: result.recoveryQuestion,
        pages: { ...pages, duplicates: merged.duplicates.length, partial: allFailures.length > 0 },
        partial: allFailures.length > 0,
        cost,
        durationMs,
        monthly: publicMonthly(spend.spend),
      });
    }

    const ai = {
      provider,
      model,
      readAt: at.toISOString(),
      protocolVersion: result.technical.protocolVersion,
      protocolHash: result.technical.protocolHash,
      schemaVersion: result.technical.schemaVersion,
      bundleHash: result.technical.bundleHash,
      requestId: requestIds.length > 0 ? requestIds[requestIds.length - 1] : null,
      requestIds,
      cost,
      sources: result.technical.sources,
      restaurantId: source.restaurantId,
      // The origin that travels in the sealed step and into every version of
      // this reading: label, provider, model, cost and one read id.
      origin: {
        kind: AI_READ_PROVENANCE_KIND,
        label: AI_READ_LABEL,
        aiName: AI_READ_AI_NAME,
        provider,
        model,
        readId: importId,
        readAt: at.toISOString(),
        requestId: requestIds.length > 0 ? requestIds[requestIds.length - 1] : null,
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
          // BE-36 (#87, criterion 2): the page list and the pages that failed,
          // so "Opnieuw proberen" can read exactly those pages again. Metadata
          // only: the bytes are fetched again from the same sealed source URLs.
          plan: source.plan || null,
          imageRead: {
            units: allUnits.map(publicUnit),
            read: [...readNumbers].sort((a, b) => a - b),
            failed: failedRefs.map((unit) => unit.number).sort((a, b) => a - b),
            // The failed pages keep their own reason and sentence, so a later
            // retry still says the same thing about a page it did not read.
            failedUnits: [
              ...failures.map((failure, index) => ({
                ...publicUnit(readFailed[index].unit),
                reason: failure.reason,
                message: failure.message,
                attempts: failure.attempts,
              })),
              ...missingFailures.map((failure) => ({
                ...publicUnit({ number: failure.page, kind: failure.kind, sourceId: failure.sourceId, locator: failure.locator, label: failure.label }),
                reason: failure.reason,
                message: failure.message,
                attempts: failure.attempts,
              })),
              ...(source.retry && Array.isArray(source.retry.failedUnits) ? source.retry.failedUnits.filter((unit) => !requested.has(unit.number)) : []),
            ],
          },
        })
      : null;

    const spendAfter = { ...spend.spend, spentEurCents: spend.spend.spentEurCents + (cost.known ? cost.eurCents : 0) };
    const partial = allFailures.length > 0 || coverage.status === 'partial';
    return reply(200, {
      origin: { kind: AI_READ_PROVENANCE_KIND, label: AI_READ_LABEL, aiName: AI_READ_AI_NAME },
      // BE-33 (#79): what was read (text, N images or a document of N pages),
      // the estimate that was shown beforehand and the honest notice.
      plan: source.plan || null,
      estimate: source.plan ? source.plan.estimate : null,
      notice: imageReadNotice(source.plan),
      imageRead: Boolean(source.plan && source.plan.mode !== 'text'),
      // BE-36 (#87, criteria 1, 2 and 4): what was read page by page, which
      // pages failed (with one sentence and one next step each), which dishes
      // were deduplicated and whether this is a partial reading.
      pages: { ...pages, duplicates: merged.duplicates.length, partial },
      partial,
      costPlan: { pages: costPlan.pages, estimatedEurCents: costPlan.estimatedEurCents, maxEurCents: costPlan.maxEurCents },
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

