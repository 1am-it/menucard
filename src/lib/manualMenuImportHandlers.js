'use strict';

// #59 fase 2 — serverhandlers voor de handmatige AI-import.
//
// Sinds herstelronde 6350337273 (K1) is de stroom **toestandsloos**: er is geen
// `Map` op moduleniveau meer. Elke stap opent het ondertekende en versleutelde
// toestandstoken van de vorige stap (src/lib/manualMenuImportState.js) en geeft
// een nieuw token terug. Zo werkt de keten ook wanneer elke route in een eigen
// serverless-instantie draait.
//
// Regels blijven gelijk:
//   - alleen de interne rol; een collega zonder rol krijgt 403 en niets wordt
//     opgeslagen;
//   - de prompt wordt één keer teruggegeven en nooit gelogd;
//   - een gewijzigd, verlopen of vreemd token, of een token van een andere
//     gebruiker, is een gewone melding en nooit een stille doorgang;
//   - het restaurant komt uit de bestaande statische lijst, nooit uit vrije
//     invoer;
//   - geen automatische bevestiging, geen accepteer-alles, geen publicatie;
//   - de AI-naam is zelfgerapporteerd en gaat als herkomst mee.
//
// Dependency-injected en zonder eigen netwerk of database, zodat elke regel met
// een fake te bewijzen is. De enige echte schrijfactie is de bestaande
// conceptroute (`saveConcept`), en die draait pas na alle menselijke stappen.

const { isInternalOnly } = require('./importInbox');
const { buildImportBundle, bundleMetadata, ManualImportBundleError } = require('./manualMenuImportBundle');
const { buildImportPrompt, buildFollowUpPrompt, buildOpenPointsPrompt } = require('./manualMenuImportPrompt');
const { extractCodeBlock, buildImportReport, checkBundleBinding, publicImportReport } = require('./manualMenuImportImport');
const {
  decideRow,
  reviewView,
  buildConceptDraft,
  applyFollowUp,
  applyOpenPointsAnswer,
  MAX_FOLLOW_UPS_PER_IMPORT,
} = require('./manualMenuImportReview');
const { buildUsageExport, ROUTES } = require('./manualMenuImportUsage');
const { ManualImportStateError, stateMessage } = require('./manualMenuImportState');

const FORBIDDEN = 'Alleen interne medewerkers kunnen een menu importeren.';
const MAX_URLS = 5;
const MAX_RESTAURANT_RESULTS = 10;

function reply(status, body) {
  return { status, body };
}

/** Zoeken op naam: diakritisch ongevoelig en zonder betekenis voor de volgorde. */
function foldName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function publicRestaurant(id, restaurant) {
  return {
    id: String(id),
    name: typeof restaurant.name === 'string' ? restaurant.name : '',
    buurt: typeof restaurant.buurt === 'string' ? restaurant.buurt : null,
  };
}

/**
 * Alleen de bestaande statische restaurantlijst (data/restaurants.json).
 * Leeg zoeken geeft niets terug; het resultaat is begrensd.
 */
function searchRestaurantChoices(restaurants, query, limit = MAX_RESTAURANT_RESULTS) {
  const source = restaurants && typeof restaurants === 'object' ? restaurants : {};
  const needle = foldName(query);
  if (needle === '') return [];
  const scored = [];
  for (const [id, restaurant] of Object.entries(source)) {
    if (!restaurant || typeof restaurant !== 'object' || typeof restaurant.name !== 'string') continue;
    const name = foldName(restaurant.name);
    if (name === '') continue;
    const index = name.indexOf(needle);
    if (index === -1) continue;
    scored.push({ exactStart: index === 0 ? 0 : 1, name, id, restaurant });
  }
  scored.sort((a, b) => a.exactStart - b.exactStart || a.name.localeCompare(b.name, 'nl'));
  return scored.slice(0, Math.max(1, limit)).map((entry) => publicRestaurant(entry.id, entry.restaurant));
}

/** Levert het restaurant of null; een onbekend nummer is nooit geldig. */
function restaurantFor(restaurants, restaurantId) {
  const source = restaurants && typeof restaurants === 'object' ? restaurants : {};
  if (!Object.prototype.hasOwnProperty.call(source, restaurantId)) return null;
  const restaurant = source[restaurantId];
  if (!restaurant || typeof restaurant !== 'object') return null;
  return publicRestaurant(restaurantId, restaurant);
}

function decisionsFromState(state) {
  const list = Array.isArray(state.decisions) ? state.decisions : [];
  return new Map(list.filter((entry) => entry && typeof entry.rowId === 'string').map((entry) => [entry.rowId, entry]));
}

function nextState(state, patch) {
  return {
    userId: state.userId,
    restaurantId: state.restaurantId,
    bundle: state.bundle,
    report: state.report || null,
    decisions: Array.isArray(state.decisions) ? state.decisions : [],
    followUps: state.followUps && typeof state.followUps === 'object' ? state.followUps : {},
    followUpTotal: Number.isInteger(state.followUpTotal) ? state.followUpTotal : 0,
    ...patch,
  };
}

/**
 * deps:
 *   authenticate(request) → { ok, status, userId, roles }
 *   readSources({ urls }) → [{ id, url, kind, status, text, sha256, fetchedAt, limitation }]
 *   loadProtocol()        → src/lib/menuExtractionProtocol.js loadMenuExtractionProtocol
 *   generateId()          → a new id
 *   saveConcept(input)    → { status, body } via the existing concept route
 *   stateCipher           → src/lib/manualMenuImportState.js createManualImportStateCipher
 *   restaurants           → data/restaurants.json (server-side, read-only)
 *   usageLedger           → bounded usage counters
 *   now()                 → Date
 */
function createManualMenuImportHandlers(deps = {}) {
  const {
    authenticate,
    readSources,
    loadProtocol,
    generateId,
    saveConcept,
    stateCipher,
    restaurants,
    usageLedger,
  } = deps;
  const now = deps.now || (() => new Date());

  async function authorize(request) {
    const auth = await authenticate(request);
    if (!auth || !auth.ok) return { denied: reply((auth && auth.status) || 401, { error: (auth && auth.error) || 'Niet ingelogd.' }) };
    if (!isInternalOnly(auth.roles)) return { denied: reply(403, { error: FORBIDDEN }) };
    return { auth };
  }

  async function readJson(request) {
    try {
      const body = await request.json();
      return body && typeof body === 'object' && !Array.isArray(body) ? { ok: true, body } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  function protocolOrNull() {
    try {
      return loadProtocol();
    } catch {
      return null;
    }
  }

  function record(route, action, aiName) {
    if (usageLedger && typeof usageLedger.record === 'function') usageLedger.record({ route, action, aiName });
  }

  function stateFailure(err) {
    const code = err instanceof ManualImportStateError ? err.code : 'state_invalid';
    const status = code === 'state_too_large' ? 413 : code === 'state_config_missing' ? 500 : 409;
    return reply(status, { error: stateMessage(code), reason: code });
  }

  /** Versleutelt de volgende stap; een te groot token is een gewone melding. */
  function sealNext(state) {
    if (!stateCipher || typeof stateCipher.seal !== 'function') return { reply: stateFailure(new ManualImportStateError('state_config_missing')) };
    try {
      const sealed = stateCipher.seal(state);
      return { state: sealed.token, validUntil: sealed.expiresAt };
    } catch (err) {
      return { reply: stateFailure(err) };
    }
  }

  /**
   * Opent het token van de vorige stap. Geen token, een gewijzigd of verlopen
   * token en een token van een andere gebruiker zijn alle drie een gewone
   * melding met een concrete reden.
   */
  function openState(body, auth) {
    const token = typeof body.state === 'string' ? body.state.trim() : '';
    if (token === '') return { reply: reply(400, { error: 'Maak eerst een prompt.', reason: 'state_required' }) };
    if (!stateCipher || typeof stateCipher.open !== 'function') {
      return { reply: stateFailure(new ManualImportStateError('state_config_missing')) };
    }
    const opened = stateCipher.open(token);
    if (!opened.ok) return { reply: stateFailure(new ManualImportStateError(opened.code)) };
    if (opened.state.userId !== auth.userId) {
      return { reply: reply(409, { error: stateMessage('state_other_user'), reason: 'state_other_user' }) };
    }
    return { state: opened.state, expiresAt: opened.expiresAt };
  }

  /**Een stap 3-verzoek hoort bij de import in het token, niet bij de URL alleen. */
  function reportOrReply(state, importId) {
    if (!state.report || typeof state.report !== 'object') {
      return { reply: reply(409, { error: 'Controleer eerst een antwoord.', reason: 'state_step_missing' }) };
    }
    if (typeof importId === 'string' && importId !== '' && state.report.importId !== importId) {
      return { reply: reply(409, { error: stateMessage('state_mismatch'), reason: 'state_mismatch' }) };
    }
    return { report: state.report };
  }

  function followUpsFor(state, rowId) {
    const value = state.followUps && typeof state.followUps === 'object' ? state.followUps[rowId] : 0;
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  function remainingFollowUps(state) {
    const used = Number.isInteger(state.followUpTotal) ? state.followUpTotal : 0;
    return Math.max(0, MAX_FOLLOW_UPS_PER_IMPORT - used);
  }


  /**
   * GET — de bestaande statische restaurantlijst, zodat de medewerker op naam
   * kiest in plaats van een nummer te typen. Alleen interne rollen; het
   * antwoord bevat niet meer dan id, naam en buurt.
   */
  async function listRestaurants(request) {
    const { denied } = await authorize(request);
    if (denied) return denied;
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return reply(400, { error: 'Ongeldig verzoek.' });
    }
    const id = (url.searchParams.get('id') || '').trim();
    if (id !== '') {
      const found = restaurantFor(restaurants, id);
      if (!found) return reply(404, { error: 'Dit restaurant staat niet in de lijst.', reason: 'restaurant_unknown' });
      return reply(200, { restaurant: found });
    }
    const query = url.searchParams.get('q') || '';
    if (foldName(query).length < 2) {
      return reply(200, { restaurants: [], query, hint: 'Typ minstens twee letters van de naam.' });
    }
    return reply(200, { restaurants: searchRestaurantChoices(restaurants, query), query });
  }

  /** POST — stap 1: bronnen veilig lezen, bundel vastleggen, prompt teruggeven. */
  async function createBundle(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const restaurantId = typeof parsed.body.restaurant_id === 'string' ? parsed.body.restaurant_id.trim() : '';
    if (restaurantId === '') return reply(400, { error: 'Kies eerst een restaurant.', reason: 'restaurant_required' });
    const restaurant = restaurantFor(restaurants, restaurantId);
    if (!restaurant) return reply(400, { error: 'Kies een restaurant uit de lijst.', reason: 'restaurant_unknown' });
    const urls = [...new Set((Array.isArray(parsed.body.urls) ? parsed.body.urls : []).filter((url) => typeof url === 'string' && url.trim()))].slice(0, MAX_URLS);
    if (urls.length === 0) return reply(400, { error: 'Voeg minstens één bron-URL toe.', reason: 'sources_missing' });
    const protocol = protocolOrNull();
    if (!protocol) return reply(500, { error: 'De versiegebonden extractie-instructie kon niet worden geladen.', reason: 'protocol_unavailable' });

    let sources;
    try {
      sources = await readSources({ urls, now: now() });
    } catch {
      return reply(502, { error: 'De bronnen konden niet opgehaald worden.', reason: 'fetch_failed' });
    }
    try {
      const bundle = buildImportBundle({
        bundleId: generateId(),
        actorUserId: auth.userId,
        restaurantId,
        restaurantName: restaurant.name,
        sources,
        protocol,
        now: now(),
      });
      const prompt = buildImportPrompt(bundle);
      const next = sealNext({
        userId: auth.userId,
        restaurantId,
        bundle,
        report: null,
        decisions: [],
        followUps: {},
        followUpTotal: 0,
      });
      if (next.reply) return next.reply;
      record(ROUTES.bundles, 'prompt_created', null);
      return reply(201, { bundle: bundleMetadata(bundle), prompt, state: next.state, validUntil: next.validUntil });
    } catch (err) {
      if (err instanceof ManualImportBundleError) return reply(422, { error: err.message, reason: err.code });
      if (err instanceof ManualImportStateError) return stateFailure(err);
      return reply(500, { error: 'De prompt kon niet worden gemaakt.' });
    }
  }

  /** POST — stap 2: het plakveld. Groottegrens, codeblok, validatie, binding. */
  async function importAnswer(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const opened = openState(parsed.body, auth);
    if (opened.reply) return opened.reply;
    const state = opened.state;
    if (state.report) {
      return reply(409, {
        error: 'Dit antwoord is al gecontroleerd. Ga verder met nalopen of maak een nieuwe prompt.',
        reason: 'state_step_done',
      });
    }
    const binding = checkBundleBinding({
      bundle: state.bundle,
      bundleHash: typeof parsed.body.bundle_hash === 'string' ? parsed.body.bundle_hash : undefined,
      actorUserId: auth.userId,
      restaurantId: state.restaurantId,
    });
    if (!binding.ok) return reply(409, { error: binding.message, reason: binding.code });

    const code = extractCodeBlock(parsed.body.answer);
    if (!code.ok) {
      record(ROUTES.imports, 'rejected', null);
      return reply(422, { error: code.message, reason: code.code });
    }
    const report = buildImportReport({
      importId: generateId(),
      bundle: state.bundle,
      output: code.value,
      aiName: parsed.body.ai_name,
      now: now(),
    });
    if (!report.ok) {
      record(ROUTES.imports, 'rejected', report.aiName);
      return reply(422, { error: report.message, reason: report.code, problems: report.problems });
    }
    const next = sealNext(nextState(state, { report, decisions: [], followUps: {}, followUpTotal: 0 }));
    if (next.reply) return next.reply;
    record(ROUTES.imports, 'import_checked', report.aiName);
    return reply(201, {
      import: publicImportReport(report),
      review: reviewView({ report, decisions: new Map() }),
      state: next.state,
      validUntil: next.validUntil,
    });
  }


  /** POST — stap 3: één menselijke beslissing per regel. */
  async function decide(request, importId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const opened = openState(parsed.body, auth);
    if (opened.reply) return opened.reply;
    const step = reportOrReply(opened.state, importId || parsed.body.import_id);
    if (step.reply) return step.reply;
    const state = opened.state;
    const result = decideRow({ report: step.report, decisions: decisionsFromState(state), decision: parsed.body.decision });
    if (!result.ok) return reply(422, { error: result.message, reason: result.code });
    const next = sealNext(nextState(state, { decisions: [...result.decisions.values()] }));
    if (next.reply) return next.reply;
    return reply(200, {
      row: result.row,
      review: reviewView({ report: step.report, decisions: result.decisions }),
      state: next.state,
      validUntil: next.validUntil,
    });
  }

  /** POST — Vraag AI: prompt maken, of het antwoord door dezelfde validatie. */
  async function followUp(request, importId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const opened = openState(parsed.body, auth);
    if (opened.reply) return opened.reply;
    const step = reportOrReply(opened.state, importId || parsed.body.import_id);
    if (step.reply) return step.reply;
    const state = opened.state;
    const rowId = typeof parsed.body.row_id === 'string' ? parsed.body.row_id : null;
    const row = rowId ? step.report.rows.find((item) => item.id === rowId) : null;
    if (!row) return reply(404, { error: 'Deze regel hoort niet bij deze import.' });

    if (typeof parsed.body.answer !== 'string') {
      // Promptfase: nog geen modelcall, nog geen teller.
      if (followUpsFor(state, row.id) >= 1) {
        return reply(422, { error: 'Deze regel is al één keer gevraagd. Pas zelf aan of laat de regel weg.', reason: 'follow_up_used' });
      }
      if (!row.askAi) {
        return reply(422, {
          error:
            row.code === 'price_variant'
              ? 'Bij twee prijzen is er geen Vraag AI: kies zelf een prijs of laat de regel weg.'
              : 'Bij deze regel is Vraag AI niet mogelijk.',
          reason: 'follow_up_not_allowed',
        });
      }
      if (remainingFollowUps(state) <= 0) {
        return reply(422, { error: 'Het maximum van 20 vervolgvragen per import is bereikt.', reason: 'follow_up_limit' });
      }
      try {
        const prompt = buildFollowUpPrompt({ bundle: state.bundle, row, question: parsed.body.question });
        return reply(200, { prompt, rowId: row.id, validUntil: opened.expiresAt });
      } catch {
        return reply(422, { error: 'Deze regel kan niet worden nagevraagd.', reason: 'follow_up_unavailable' });
      }
    }

    const result = applyFollowUp({
      report: step.report,
      bundle: state.bundle,
      rowId: row.id,
      answer: parsed.body.answer,
      followUpCount: followUpsFor(state, row.id),
    });
    if (!result.ok) {
      record(ROUTES.followUp, 'rejected', step.report.aiName);
      return reply(422, { error: result.message, reason: result.code });
    }
    const followUps = { ...(state.followUps || {}), [row.id]: followUpsFor(state, row.id) + 1 };
    const next = sealNext(
      nextState(state, {
        report: result.report,
        followUps,
        followUpTotal: (Number.isInteger(state.followUpTotal) ? state.followUpTotal : 0) + 1,
      }),
    );
    if (next.reply) return next.reply;
    record(ROUTES.followUp, 'follow_up', step.report.aiName);
    return reply(200, {
      row: result.row,
      import: publicImportReport(result.report),
      review: reviewView({ report: result.report, decisions: decisionsFromState(state) }),
      state: next.state,
      validUntil: next.validUntil,
    });
  }


  /** POST — alle open punten in één prompt (max. 10 regels, geen bulkbesluit). */
  async function openPointsPrompt(request, importId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const opened = openState(parsed.body, auth);
    if (opened.reply) return opened.reply;
    const step = reportOrReply(opened.state, importId || parsed.body.import_id);
    if (step.reply) return step.reply;
    const state = opened.state;
    const decisions = decisionsFromState(state);
    const rows = step.report.rows.filter((row) => row.askAi && !decisions.has(row.id));
    if (rows.length === 0) return reply(422, { error: 'Er zijn geen open punten waar de AI iets kan toevoegen.', reason: 'no_open_points' });
    if (typeof parsed.body.answer === 'string') {
      // Het gecombineerde antwoord gaat door dezelfde validatie; elk item moet
      // bij precies één openstaande regel horen en verder verandert er niets.
      const result = applyOpenPointsAnswer({
        report: step.report,
        bundle: state.bundle,
        answer: parsed.body.answer,
        maxRows: Math.max(1, remainingFollowUps(state)),
      });
      if (!result.ok) {
        record(ROUTES.followUp, 'rejected', step.report.aiName);
        return reply(422, { error: result.message, reason: result.code });
      }
      const followUps = { ...(state.followUps || {}) };
      for (const rowId of result.rowIds) followUps[rowId] = (Number.isInteger(followUps[rowId]) ? followUps[rowId] : 0) + 1;
      const next = sealNext(
        nextState(state, {
          report: result.report,
          followUps,
          followUpTotal: (Number.isInteger(state.followUpTotal) ? state.followUpTotal : 0) + result.rowIds.length,
        }),
      );
      if (next.reply) return next.reply;
      record(ROUTES.followUp, 'follow_up', step.report.aiName);
      return reply(200, {
        import: publicImportReport(result.report),
        review: reviewView({ report: result.report, decisions }),
        state: next.state,
        validUntil: next.validUntil,
      });
    }
    try {
      const prompt = buildOpenPointsPrompt({ bundle: state.bundle, rows: rows.slice(0, 10), question: parsed.body.question });
      return reply(200, { prompt, validUntil: opened.expiresAt });
    } catch {
      return reply(422, { error: 'Deze open punten kunnen niet in één vraag.', reason: 'follow_up_unavailable' });
    }
  }

  /**
   * POST — opslaan. Alleen na alle menselijke stappen, en alleen via de
   * bestaande conceptroute. Niets publiceren, niets bevestigen.
   */
  async function save(request, importId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const opened = openState(parsed.body, auth);
    if (opened.reply) return opened.reply;
    const step = reportOrReply(opened.state, importId || parsed.body.import_id);
    if (step.reply) return step.reply;
    const state = opened.state;
    const decisions = decisionsFromState(state);
    const draft = buildConceptDraft({
      report: step.report,
      decisions,
      restaurantId: state.restaurantId,
    });
    if (!draft.ok) {
      record(ROUTES.save, 'rejected', step.report.aiName);
      return reply(409, { error: draft.message, reason: draft.code, blockers: draft.blockers || [], pending: draft.pending || [] });
    }
    const firstSource = (step.report.technical.sources || [])[0] || null;
    const result = await saveConcept({
      actorUserId: auth.userId,
      restaurantId: state.restaurantId,
      menuContext: typeof parsed.body.menu_context === 'string' && parsed.body.menu_context.trim() ? parsed.body.menu_context.trim() : draft.menuContext,
      sourceUrl: firstSource ? firstSource.url : null,
      sourceType: 'manual',
      qualityScore: 'medium',
      content: draft.content,
      originallyFetchedAt: state.bundle.fetchedAt,
      expectedVersion: Number.isInteger(parsed.body.expected_version) ? parsed.body.expected_version : undefined,
    });
    if (result.status >= 200 && result.status < 300) record(ROUTES.save, 'concept_saved', step.report.aiName);
    else record(ROUTES.save, 'rejected', step.report.aiName);
    return reply(result.status, {
      ...result.body,
      provenance: draft.provenance,
      concept: result.body && result.body.concept ? { ...result.body.concept, menuContext: draft.menuContext, provenance: draft.provenance } : result.body && result.body.concept,
    });
  }

  /** GET — K7: alleen metagegevens, geen menu-inhoud en geen prompts. */
  async function usage(request) {
    const { denied } = await authorize(request);
    if (denied) return denied;
    const stamp = now();
    return reply(200, {
      usage: buildUsageExport({ ledger: usageLedger, from: null, to: stamp.toISOString(), generatedAt: stamp }),
    });
  }

  return { createBundle, importAnswer, decide, followUp, openPointsPrompt, save, usage, listRestaurants };
}

module.exports = { createManualMenuImportHandlers, searchRestaurantChoices };

