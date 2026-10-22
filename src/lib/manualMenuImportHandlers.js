'use strict';

// #59 fase 2 — serverhandlers voor de handmatige AI-import.
// Dependency-injected en zonder eigen netwerk of database, zodat elke regel
// met een fake te bewijzen is. De enige echte schrijfactie is de bestaande
// conceptroute (`saveConcept`), en die draait pas na alle menselijke stappen.
//
// Regels:
//   - alleen de interne rol; een collega zonder rol krijgt 403 en niets wordt
//     opgeslagen;
//   - de prompt wordt één keer teruggegeven en nooit gelogd;
//   - importeren kan alleen binnen de bundel die deze gebruiker zelf
//     exporteerde (verlopen bundel, andere gebruiker of gewijzigde binding is
//     een blokkade);
//   - geen automatische bevestiging, geen accepteer-alles, geen publicatie;
//   - de AI-naam is zelfgerapporteerd en gaat als herkomst mee.

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
  ManualImportReviewError,
} = require('./manualMenuImportReview');
const { buildUsageExport, ROUTES } = require('./manualMenuImportUsage');

const FORBIDDEN = 'Alleen interne medewerkers kunnen een menu importeren.';
const MAX_URLS = 5;

function reply(status, body) {
  return { status, body };
}

/**
 * deps:
 *   authenticate(request) → { ok, status, userId, roles }
 *   readSources({ urls }) → [{ id, url, kind, status, text, sha256, fetchedAt, limitation }]
 *   bundleStore, importStore, usageLedger
 *   loadProtocol()        → src/lib/menuExtractionProtocol.js loadMenuExtractionProtocol
 *   generateId()          → a new id
 *   saveConcept(input)    → { status, body } via the existing concept route
 *   now()                 → Date
 */
function createManualMenuImportHandlers(deps = {}) {
  const {
    authenticate,
    readSources,
    loadProtocol,
    generateId,
    saveConcept,
    bundleStore,
    importStore,
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

  /** POST — stap 1: bronnen veilig lezen, bundel vastleggen, prompt teruggeven. */
  async function createBundle(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const restaurantId = typeof parsed.body.restaurant_id === 'string' ? parsed.body.restaurant_id.trim() : '';
    if (restaurantId === '') return reply(400, { error: 'Kies eerst een restaurant.', reason: 'restaurant_required' });
    const urls = [...new Set((Array.isArray(parsed.body.urls) ? parsed.body.urls : []).filter((url) => typeof url === 'string' && url.trim()))].slice(0, MAX_URLS);
    if (urls.length === 0) return reply(400, { error: 'Voeg minstens één bron-URL toe.', reason: 'sources_missing' });
    const protocol = protocolOrNull();
    if (!protocol) return reply(500, { error: 'De versiegebonden extractie-instructie kon niet worden geladen.', reason: 'protocol_unavailable' });

    let sources;
    try {
      sources = await readSources({ urls, now: now() });
    } catch {
      return reply(502, { error: 'De bronnen konden niet worden opgehaald.', reason: 'fetch_failed' });
    }
    try {
      const bundle = buildImportBundle({
        bundleId: generateId(),
        actorUserId: auth.userId,
        restaurantId,
        restaurantName: typeof parsed.body.restaurant_name === 'string' ? parsed.body.restaurant_name : null,
        sources,
        protocol,
        now: now(),
      });
      const stored = bundleStore.put(bundle);
      const prompt = buildImportPrompt(stored);
      record(ROUTES.bundles, 'prompt_created', null);
      return reply(201, { bundle: bundleMetadata(stored), prompt });
    } catch (err) {
      if (err instanceof ManualImportBundleError) return reply(422, { error: err.message, reason: err.code });
      return reply(500, { error: 'De prompt kon niet worden gemaakt.' });
    }
  }

  /** POST — stap 2: het plakveld. Groottegrens, codeblok, validatie, binding. */
  async function importAnswer(request) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const bundleId = typeof parsed.body.bundle_id === 'string' ? parsed.body.bundle_id : null;
    if (!bundleId) return reply(400, { error: 'Maak eerst een prompt.', reason: 'bundle_required' });
    const bundle = bundleStore.get(bundleId);
    const binding = checkBundleBinding({
      bundle,
      bundleHash: typeof parsed.body.bundle_hash === 'string' ? parsed.body.bundle_hash : undefined,
      actorUserId: auth.userId,
    });
    if (!binding.ok) return reply(409, { error: binding.message, reason: binding.code });

    const code = extractCodeBlock(parsed.body.answer);
    if (!code.ok) {
      record(ROUTES.imports, 'rejected', null);
      return reply(422, { error: code.message, reason: code.code });
    }
    const report = buildImportReport({
      importId: generateId(),
      bundle,
      output: code.value,
      aiName: parsed.body.ai_name,
      now: now(),
    });
    if (!report.ok) {
      record(ROUTES.imports, 'rejected', report.aiName);
      return reply(422, { error: report.message, reason: report.code, problems: report.problems });
    }
    importStore.put({ report, bundle, actorUserId: auth.userId, restaurantId: bundle.restaurantId });
    record(ROUTES.imports, 'import_checked', report.aiName);
    return reply(201, {
      import: publicImportReport(report),
      review: reviewView({ report, decisions: new Map() }),
    });
  }

  function entryFor(importId, auth) {
    return importStore.get(importId, auth.userId);
  }

  /** POST — stap 3: één menselijke beslissing per regel. */
  async function decide(request, importId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const entry = entryFor(importId || parsed.body.import_id, auth);
    if (!entry) return reply(404, { error: 'Deze import is verlopen. Plak het antwoord opnieuw.' });
    const result = decideRow({ report: entry.report, decisions: entry.decisions, decision: parsed.body.decision });
    if (!result.ok) return reply(422, { error: result.message, reason: result.code });
    entry.decisions = result.decisions;
    const view = reviewView({ report: entry.report, decisions: entry.decisions });
    return reply(200, { row: result.row, review: view });
  }


  /** POST — Vraag AI: prompt maken, of het antwoord door dezelfde validatie. */
  async function followUp(request, importId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const entry = entryFor(importId || parsed.body.import_id, auth);
    if (!entry) return reply(404, { error: 'Deze import is verlopen. Plak het antwoord opnieuw.' });
    const rowId = typeof parsed.body.row_id === 'string' ? parsed.body.row_id : null;
    const row = rowId ? entry.report.rows.find((item) => item.id === rowId) : null;
    if (!row) return reply(404, { error: 'Deze regel hoort niet bij deze import.' });

    if (typeof parsed.body.answer !== 'string') {
      // Promptfase: nog geen modelcall, nog geen teller.
      if (importStore.followUpsFor(entry, row.id) >= 1) {
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
      if (importStore.remainingFollowUps(entry) <= 0) {
        return reply(422, { error: 'Het maximum van 20 vervolgvragen per import is bereikt.', reason: 'follow_up_limit' });
      }
      try {
        const prompt = buildFollowUpPrompt({ bundle: entry.bundle, row, question: parsed.body.question });
        return reply(200, { prompt, rowId: row.id });
      } catch {
        return reply(422, { error: 'Deze regel kan niet worden nagevraagd.', reason: 'follow_up_unavailable' });
      }
    }

    const result = applyFollowUp({
      report: entry.report,
      bundle: entry.bundle,
      rowId: row.id,
      answer: parsed.body.answer,
      followUpCount: importStore.followUpsFor(entry, row.id),
    });
    if (!result.ok) {
      record(ROUTES.followUp, 'rejected', entry.report.aiName);
      return reply(422, { error: result.message, reason: result.code });
    }
    importStore.replaceReport(entry, result.report);
    importStore.countFollowUp(entry, row.id);
    record(ROUTES.followUp, 'follow_up', entry.report.aiName);
    return reply(200, {
      row: result.row,
      import: publicImportReport(result.report),
      review: reviewView({ report: entry.report, decisions: entry.decisions }),
    });
  }

  /** POST — alle open punten in één prompt (max. 10 regels, geen bulkbesluit). */
  async function openPointsPrompt(request, importId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const parsed = await readJson(request);
    if (!parsed.ok) return reply(400, { error: 'Ongeldig verzoek.' });
    const entry = entryFor(importId || parsed.body.import_id, auth);
    if (!entry) return reply(404, { error: 'Deze import is verlopen. Plak het antwoord opnieuw.' });
    const rows = entry.report.rows.filter((row) => row.askAi && !entry.decisions.has(row.id));
    if (rows.length === 0) return reply(422, { error: 'Er zijn geen open punten waar de AI iets kan toevoegen.', reason: 'no_open_points' });
    if (typeof parsed.body.answer === 'string') {
      // Het gecombineerde antwoord gaat door dezelfde validatie; elk item moet
      // bij precies één openstaande regel horen en verder verandert er niets.
      const result = applyOpenPointsAnswer({
        report: entry.report,
        bundle: entry.bundle,
        answer: parsed.body.answer,
        maxRows: Math.max(1, importStore.remainingFollowUps(entry)),
      });
      if (!result.ok) {
        record(ROUTES.followUp, 'rejected', entry.report.aiName);
        return reply(422, { error: result.message, reason: result.code });
      }
      importStore.replaceReport(entry, result.report);
      for (const rowId of result.rowIds) importStore.countFollowUp(entry, rowId);
      record(ROUTES.followUp, 'follow_up', entry.report.aiName);
      return reply(200, {
        import: publicImportReport(result.report),
        review: reviewView({ report: entry.report, decisions: entry.decisions }),
      });
    }
    try {
      const prompt = buildOpenPointsPrompt({ bundle: entry.bundle, rows: rows.slice(0, 10), question: parsed.body.question });
      return reply(200, { prompt });
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
    const entry = entryFor(importId || parsed.body.import_id, auth);
    if (!entry) return reply(404, { error: 'Deze import is verlopen. Plak het antwoord opnieuw.' });
    const draft = buildConceptDraft({
      report: entry.report,
      decisions: entry.decisions,
      restaurantId: entry.restaurantId,
    });
    if (!draft.ok) {
      record(ROUTES.save, 'rejected', entry.report.aiName);
      return reply(409, { error: draft.message, reason: draft.code, blockers: draft.blockers || [], pending: draft.pending || [] });
    }
    const firstSource = (entry.report.technical.sources || [])[0] || null;
    const result = await saveConcept({
      actorUserId: auth.userId,
      restaurantId: entry.restaurantId,
      menuContext: typeof parsed.body.menu_context === 'string' && parsed.body.menu_context.trim() ? parsed.body.menu_context.trim() : draft.menuContext,
      sourceUrl: firstSource ? firstSource.url : null,
      sourceType: 'manual',
      qualityScore: 'medium',
      content: draft.content,
      originallyFetchedAt: entry.bundle.fetchedAt,
      expectedVersion: Number.isInteger(parsed.body.expected_version) ? parsed.body.expected_version : undefined,
    });
    if (result.status >= 200 && result.status < 300) record(ROUTES.save, 'concept_saved', entry.report.aiName);
    else record(ROUTES.save, 'rejected', entry.report.aiName);
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

  return { createBundle, importAnswer, decide, followUp, openPointsPrompt, save, usage };
}

module.exports = { createManualMenuImportHandlers };

