// BE-25 fase 2 — the one shared "analyse one URL" step, used by the
// single-URL route (app/api/internal/v1/restaurant-analysis-jobs/route.js,
// behaviour unchanged) and by the batch processor
// (src/lib/batchAnalysisHandlers.js). Moved here verbatim from that route:
// the robots.txt gate, the entry fetch through safeOutboundFetch with at
// most a few re-validated same-site redirects, BE-20's bounded same-host
// discovery and digital-PDF handling. No second egress path, no AI, no OCR.
//
// Returns either
//   { ok: false, errorReason, message, httpStatus }   (a closed job error_reason)
// or
//   { ok: true, analysis, finalUrl }
// It never writes to the database; callers record the job outcome.

'use strict';

const { fetchWebsiteSafely } = require('./safeOutboundFetch');
const {
  checkRobotsForUrl,
  fetchSameSiteWithRedirects,
  describeRedirects,
  describeRobotsBlock,
  RedirectPolicyError,
} = require('./restaurantSourceFetch');
const { runRestaurantSourceAnalysis, readPdfMenuSource, pdfLayoutLimitations, applyProviderNeutralExtraction } = require('./restaurantSourceAnalysis');
const { PdfExtractionError } = require('./pdfTextExtraction');
const { rollUpPdfAdapterErrorReason } = require('./restaurantSourceAnalysisJobs');
const { pdfContextToMenuContext } = require('./pdfMenuContext');
const { buildExtractionResult } = require('./menuExtractionResult');
const { loadMenuExtractionProtocol, protocolMetadata, withProtocolMetadata } = require('./menuExtractionProtocol');

// Generous for a real menu PDF but still a real, technical bound — same
// reasoning src/lib/pdfTextExtraction.js's own DEFAULT_MAX_BYTES already
// documents.
const CANDIDATE_PDF_MAX_BYTES = 15 * 1024 * 1024;

function failure(errorReason, message, httpStatus) {
  return { ok: false, errorReason, message, httpStatus };
}

/** robots.txt check for one URL, always through fetchWebsiteSafely. */
function robotsGateFor(url) {
  return checkRobotsForUrl(url, { fetchImpl: fetchWebsiteSafely });
}

function dispatchCandidateResponse(fetchResult) {
  if (fetchResult.contentType === 'application/pdf') {
    return { status: 'pdf', bytes: fetchResult.bytes, finalUrl: fetchResult.finalUrl };
  }
  if (fetchResult.contentType === 'text/html' || fetchResult.contentType === 'application/xhtml+xml') {
    return { status: 'html', body: fetchResult.bytes.toString('utf8'), finalUrl: fetchResult.finalUrl };
  }
  return { status: 'error' };
}

/**
 * Direct-PDF analysis: the entry URL itself is a digital PDF menu. Exactly one
 * source, no restaurant fields. The bounded, page/column-aware PDF text is
 * handed to the same provider-neutral chain as HTML (so the runtime hook is
 * never skipped for this path), and the result is the same canonical menu
 * context every other source produces.
 */
async function buildDirectPdfAnalysis({ pdfBytes, sourceUrl, sourceId = 'source-1', structuredExtraction } = {}) {
  const { context: pdfContext, extractionText, extractionTextTruncated } = await readPdfMenuSource(pdfBytes, sourceUrl, sourceId);
  const converted = pdfContextToMenuContext(pdfContext, new Set(), { sourceId });
  const menuContexts = converted ? [{ ...converted.menu, sourceUrl, sourceId }] : [];
  const sourceInventory = [{
    id: sourceId,
    url: sourceUrl,
    kind: 'pdf',
    status: 'read',
    pageCount: pdfContext.pageCount,
    wordCount: pdfContext.wordCount,
    contentHash: pdfContext.contentHash,
    ...(converted ? { itemCount: converted.itemCount } : {}),
  }];
  const limitations = [
    'Deze bron is een PDF zonder bijbehorende HTML-pagina — restaurantgegevens konden hier niet uit worden afgeleid.',
    ...(converted ? [] : ['De PDF bevat geen betrouwbaar herkenbare gerechten met prijs.']),
    ...(pdfContext.usedFallback ? ['De PDF is alleen via de tekstfallback gelezen; paginastructuur ontbreekt.'] : []),
    ...(extractionTextTruncated ? ['De PDF is voor modellezing afgekapt op de veilige tekstlimiet.'] : []),
    ...pdfLayoutLimitations(sourceUrl, pdfContext.layout || {}),
  ];
  const notes = [
    ...limitations,
    ...(converted ? [`Menukaart herkend uit de PDF: ${converted.itemCount} gerechten met prijs in ${converted.menu.categories.length} rubrieken.`] : []),
  ];
  const sourceTexts = new Map();
  if (extractionText) sourceTexts.set(sourceId, extractionText);
  const unknownMenuContexts = [pdfContext];
  const analysis = {
    restaurantCandidateFields: {},
    fieldEvidence: {},
    menuContexts,
    unknownMenuContexts,
    description: '',
    notes,
    sourceInventory,
    limitations,
  };
  const { aiExtraction } = await applyProviderNeutralExtraction({
    menuContexts,
    unknownMenuContexts,
    sourceInventory,
    sourceTexts,
    notes,
    limitations,
    restaurantCandidateFields: {},
    structuredExtraction,
  });
  analysis.aiExtraction = aiExtraction;
  analysis.extractionResult = buildExtractionResult({ sourceInventory, menus: menuContexts, unknownMenuContexts, limitations, notes });
  if (aiExtraction && aiExtraction.enabled) {
    analysis.extractionResult.ai = {
      ok: aiExtraction.ok === true,
      reason: aiExtraction.reason || null,
      meta: aiExtraction.meta || null,
    };
  }
  return analysis;
}


/** The `fetchCandidate` passed into runRestaurantSourceAnalysis: robots.txt,
 * then a buffer fetch with re-checked same-site redirects, dispatched by
 * content type. Each followed redirect is appended to `redirectNotes`. */
function createCandidateFetcher(redirectNotes) {
  return async function fetchCandidateSafely(url) {
    let target;
    try {
      target = new URL(url);
    } catch {
      return { status: 'blocked' };
    }

    const robotsGate = await robotsGateFor(target.href);
    if (!robotsGate.shouldFetchPage) {
      return { status: 'blocked' };
    }

    let fetchResult;
    try {
      const fetched = await fetchSameSiteWithRedirects(target.href, {
        fetchImpl: fetchWebsiteSafely,
        fetchOptions: { encoding: 'buffer', maxBytes: CANDIDATE_PDF_MAX_BYTES },
        robotsCheck: robotsGateFor,
      });
      fetchResult = fetched.response;
      redirectNotes.push(...describeRedirects(fetched.redirects));
    } catch (err) {
      return err instanceof RedirectPolicyError && err.reason === 'redirect-robots-blocked' ? { status: 'blocked' } : { status: 'error' };
    }

    return dispatchCandidateResponse(fetchResult);
  };
}

/**
 * Analyses one already-validated http(s) URL (a string). Every failure maps
 * to the job's closed error vocabulary; the messages are the ones the
 * single-URL route has always shown.
 */
async function analyzeSourceUrl(sourceUrlHref, options = {}) {
  // The exact instruction version is a required runtime input. A missing or
  // unversioned file is a concrete configuration failure, not an empty menu.
  let protocol;
  try {
    protocol = loadMenuExtractionProtocol();
  } catch {
    return failure('internal_error', 'De versiegebonden extractie-instructie kon niet worden geladen.', 500);
  }

  // ── robots.txt gate for the entry URL itself ────────────────────────
  const robotsGate = await robotsGateFor(sourceUrlHref);
  if (!robotsGate.shouldFetchPage) {
    return failure('robots_disallowed', describeRobotsBlock(robotsGate), 400);
  }

  // ── the entry fetch: raw bytes (HTML or a digital PDF), at most a few
  // same-site redirects, each hop re-validated. ─────────────────────────
  let fetchResult;
  const redirectNotes = [];
  try {
    const fetched = await fetchSameSiteWithRedirects(sourceUrlHref, {
      fetchImpl: fetchWebsiteSafely,
      fetchOptions: { encoding: 'buffer', maxBytes: CANDIDATE_PDF_MAX_BYTES },
      robotsCheck: robotsGateFor,
    });
    fetchResult = fetched.response;
    redirectNotes.push(...describeRedirects(fetched.redirects));
  } catch (err) {
    if (err instanceof RedirectPolicyError && err.reason === 'redirect-robots-blocked') {
      return failure('robots_disallowed', describeRobotsBlock(err.robotsGate), 400);
    }
    const message =
      err instanceof RedirectPolicyError
        ? 'Deze pagina stuurt door naar een adres dat niet veilig automatisch kan worden gevolgd.'
        : 'Het ophalen van deze pagina is mislukt.';
    return failure('fetch_failed', message, 502);
  }

  let analysis;
  if (fetchResult.contentType === 'text/html' || fetchResult.contentType === 'application/xhtml+xml') {
    analysis = await runRestaurantSourceAnalysis({
      homepageHtml: fetchResult.bytes.toString('utf8'),
      homepageUrl: fetchResult.finalUrl,
      fetchCandidate: createCandidateFetcher(redirectNotes),
      structuredExtraction: options.structuredExtraction,
    });
  } else if (fetchResult.contentType === 'application/pdf') {
    // The entry URL itself is a digital PDF menu: no same-host discovery is
    // possible, so exactly one source and no restaurant fields. Recognized
    // sections are promoted to the same canonical menu context as every other
    // source, so a direct PDF cannot be "found" while its dishes stay hidden.
    try {
      analysis = await buildDirectPdfAnalysis({
        pdfBytes: fetchResult.bytes,
        sourceUrl: fetchResult.finalUrl,
        structuredExtraction: options.structuredExtraction,
      });
    } catch (err) {
      const errorReason = err instanceof PdfExtractionError ? rollUpPdfAdapterErrorReason(err.reason) : 'pdf_extraction_failed';
      return failure(errorReason, 'Deze PDF kon niet worden gelezen.', 400);
    }
  } else {
    return failure('unsupported_content_type', 'Dit type bron wordt niet ondersteund.', 400);
  }

  // Followed redirects are reviewable metadata, shown with the other notes.
  analysis.notes = [...redirectNotes, ...analysis.notes];
  analysis.protocol = protocolMetadata(protocol);
  analysis.extractionResult = withProtocolMetadata(analysis.extractionResult, protocol);
  return { ok: true, analysis, finalUrl: fetchResult.finalUrl };
}

module.exports = { analyzeSourceUrl, buildDirectPdfAnalysis, CANDIDATE_PDF_MAX_BYTES };
