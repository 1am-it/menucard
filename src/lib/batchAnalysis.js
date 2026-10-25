// BE-25 fase 2 — Batchanalyse: pure, shared logic for the batch page and
// its server handlers. No fetch, no database, no side effects.
// Contract: planning/specs/tickets/be-25-batch-source-analysis-from-triage.md
// ("Status vocabulary and copy", "Where results go", "Design v2 decisions").
//
// Every URL gets exactly one status, derived from its batch item, its job
// and (on success) its receipt — never a new status value in the database.
// A result is "high certainty" only under the conservative v1 rule: a known
// restaurant (exact host match), recognised menu items, and every
// recognised menu on exactly that restaurant's own host (existing
// normalisation only: lower case, leading `www.` stripped). Anything less
// is "Beoordeel handmatig".

'use strict';

const { canonicalizeSourceUrl } = require('./urlIntakes');
const { hostOf, observeJob } = require('./sourceWorkqueue');
const { summarizeRecognisedMenu } = require('./menuConcept');
const { uncertainSections } = require('./menuStructureReview');
const { storedAdviceView } = require('./menuStructureAdvice');
const { menusFromUnknownContexts } = require('./pdfMenuContext');
const { readReceiptProjection, summarizeProductMenu } = require('./menuProductIntegrationV2');

const MAX_BATCH_URLS = 10;
const DAILY_URL_LIMIT = 25;
const MAX_ATTEMPTS = 5;

const COPY = {
  start: 'Analyse starten',
  keepOpen: 'Houd dit scherm open. Sluit je het, dan pauzeert de analyse en gaat hij verder zodra je terugkomt.',
  nothingPublished: 'Niets wordt automatisch gepubliceerd.',
  alreadyActive: 'Deze URL staat al in een actieve analysebatch.',
  colleaguePaused: 'Analyse tijdelijk gepauzeerd.',
  colleagueReadOnly: 'Je kunt deze batch alleen bekijken.',
  confirmedText: (time) => `Bevestigd om ${time} na menselijke controle. Er is niets gepubliceerd.`,
};

// Status per URL: label (verbatim from the ticket), Kleurtaal v2 role, icon.
const STATUSES = {
  queued: { label: 'In wachtrij', role: 'neutral', icon: 'clock' },
  running: { label: 'Bezig', role: 'neutral', icon: 'progress' },
  menu_found: { label: 'Menukaart gevonden · controle nodig', role: 'file', icon: 'file' },
  needs_review: { label: 'Controle nodig', role: 'old', icon: 'warning' },
  no_menu: { label: 'Geen bruikbare menukaart gevonden', role: 'neutral', icon: 'minus' },
  image_only: { label: 'Menu alleen als afbeelding: niet ondersteund', role: 'blocked', icon: 'warning' },
  recent: { label: 'Recent geanalyseerd', role: 'neutral', icon: 'recent' },
  robots: { label: 'Robots geblokkeerd', role: 'blocked', icon: 'lock' },
  invalid: { label: 'Ongeldige URL', role: 'blocked', icon: 'cross' },
  error: { label: 'Fout', role: 'blocked', icon: 'warning' },
  confirmed: { label: 'Bron bevestigd', role: 'positive', icon: 'check' },
  duplicate: { label: 'Dubbel in deze lijst', role: 'neutral', icon: 'dot' },
  not_queued: { label: 'Niet in wachtrij gezet', role: 'neutral', icon: 'dot' },
};

const ACTION_LABELS = {
  confirm: 'Bevestig bron',
  review_structure: 'Rubriekindeling controleren',
  review_manually: 'Beoordeel handmatig',
  adjust_url: 'URL aanpassen',
  retry: 'Opnieuw proberen',
  reanalyze: 'Opnieuw analyseren',
  review_source: 'Bronnen beoordelen',
  onboarding: 'Naar Onboarding Restaurant',
};

const TERMINAL_KEYS = new Set(['menu_found', 'needs_review', 'no_menu', 'image_only', 'recent', 'robots', 'invalid', 'error', 'confirmed', 'duplicate', 'not_queued']);

// #59 / BE-21 "Lees met AI" (Lead review 6380804419, W1): the statuses in which
// the deterministic read produced no usable menu. Only there — and only for an
// existing analysis job — is the AI reading offered as a help, never as a
// replacement of the automatic path.
const AI_READ_OFFER_STATUSES = new Set(['no_menu', 'error', 'image_only']);

function offersAiRead(item) {
  return Boolean(item && AI_READ_OFFER_STATUSES.has(item.key) && typeof item.jobId === 'string' && item.jobId !== '');
}

// The exact status copy for a menu that exists only as an image or scan. It
// never claims a successful extraction and always names the working human
// follow-up route (Bronnen beoordelen) plus the option to try another URL.
const IMAGE_ONLY_TEXT =
  'De menukaart is alleen als afbeelding of scan beschikbaar. Deze import leest geen beeld en gebruikt geen OCR, dus er is niets als gerecht opgeslagen. Beoordeel de bron of kies een tekst- of pdf-bron.';
const IMAGE_ONLY_TEXT_PDF =
  'De PDF bevat geen leesbare tekstlaag; het menu lijkt alleen als afbeelding of scan beschikbaar. Deze import leest geen beeld en gebruikt geen OCR, dus er is niets als gerecht opgeslagen. Beoordeel de bron of kies een tekst- of pdf-bron.';

function imageOnlyText(reason) {
  return reason === 'pdf_no_text_layer' ? IMAGE_ONLY_TEXT_PDF : IMAGE_ONLY_TEXT;
}

/** True only on a concrete image/scan signal; never inferred from "no menu". */
function imageOnlyReason(job, recognisedMenu) {
  if (!job || typeof job !== 'object') return null;
  if (job.status === 'failed' && job.error_reason === 'pdf_no_text_layer') return 'pdf_no_text_layer';
  if (job.status !== 'succeeded') return null;
  if (recognisedMenu && Number.isInteger(recognisedMenu.itemCount) && recognisedMenu.itemCount > 0) return null;
  const limitations = Array.isArray(job.limitations) ? job.limitations.filter((line) => typeof line === 'string') : [];
  if (limitations.some((line) => /alleen als afbeelding|beeldanalyse\/OCR is niet geconfigureerd/i.test(line))) {
    return 'image_only_menu';
  }
  if (limitations.some((line) => /pdf_no_text_layer|geen (?:leesbare )?tekstlaag|no text layer/i.test(line))) {
    return 'pdf_no_text_layer';
  }
  return null;
}

/** The non-empty, trimmed lines of a pasted list, in order. */
function splitLines(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Canonical http(s) URL (scheme, host, path; no query or fragment) or null. */
function canonicalLine(line) {
  if (typeof line !== 'string') return null;
  const text = line.trim();
  if (!/^https?:\/\/[^/\s]+/i.test(text) || /\s/.test(text)) return null;
  const canonical = canonicalizeSourceUrl(text);
  if (!canonical || !canonical.hostname.includes('.')) return null;
  return canonical.canonicalUrl;
}

/**
 * The pre-check shown before a batch exists: one entry per line with
 * `status` 'ok' | 'invalid' | 'duplicate' (`duplicateOf` = 1-based line).
 * More than MAX_BATCH_URLS lines is reported, never silently cut.
 */
function precheckLines(text) {
  const lines = splitLines(text);
  const seen = new Map();
  const entries = lines.map((raw, index) => {
    const url = canonicalLine(raw);
    if (!url) return { line: index + 1, raw, url: null, status: 'invalid' };
    if (seen.has(url)) return { line: index + 1, raw, url, status: 'duplicate', duplicateOf: seen.get(url) };
    seen.set(url, index + 1);
    return { line: index + 1, raw, url, status: 'ok' };
  });
  return {
    entries,
    tooMany: lines.length > MAX_BATCH_URLS,
    queueableCount: entries.filter((e) => e.status === 'ok').length,
  };
}

/** Canonical URLs of every recognised menu (stored by the batch processor
 * in field_evidence.menu_source_urls). */
function menuSourceUrls(analysis) {
  const urls = [];
  const add = (value) => {
    const url = typeof value === 'string' ? canonicalLine(value) : null;
    if (url && !urls.includes(url)) urls.push(url);
  };
  for (const menu of (analysis && analysis.menuContexts) || []) {
    const items = ((menu && menu.categories) || []).reduce((n, c) => n + ((c && Array.isArray(c.items) && c.items.length) || 0), 0);
    if (items > 0) add(menu.sourceUrl);
  }
  for (const context of (analysis && analysis.unknownMenuContexts) || []) {
    const sections = (context && Array.isArray(context.recognizedSections) && context.recognizedSections) || [];
    if (sections.some((s) => s && Array.isArray(s.items) && s.items.length > 0)) add(context.sourceUrl);
  }
  return urls;
}

function restaurantFor(receipt, restaurants) {
  if (!receipt || receipt.restaurant_match_type !== 'exact' || !receipt.matched_restaurant_id) return null;
  const id = String(receipt.matched_restaurant_id);
  if (!restaurants || !Object.prototype.hasOwnProperty.call(restaurants, id)) return null;
  const restaurant = restaurants[id];
  return restaurant && typeof restaurant === 'object' ? { id, ...restaurant } : null;
}

/**
 * The conservative own-source checks, shared by the one-click rule and the
 * explicit human structure review: a known location on the restaurant's own
 * host that is not simply the already-known source. Returns
 * { ok: true, foundUrl } or { ok: false, reason }.
 */
function ownSourceOf({ job, restaurant }) {
  const urls = Array.isArray(job && job.menu_source_urls) ? job.menu_source_urls.filter((u) => typeof u === 'string') : [];
  if (urls.length === 0) return { ok: false, reason: 'menu_source_unknown' };
  const restaurantHost = hostOf(restaurant && restaurant.website);
  if (!restaurantHost || urls.some((u) => hostOf(u) !== restaurantHost)) return { ok: false, reason: 'other_host' };
  if (sameAddress(urls[0], restaurant.website)) return { ok: false, reason: 'already_known_source' };
  return { ok: true, foundUrl: urls[0] };
}

/**
 * The conservative v1 high-certainty rule for a succeeded job. Returns
 * { high: true, foundUrl } or { high: false, reason }.
 */
function certaintyOf({ job, receipt, restaurant }) {
  if (!restaurant) return { high: false, reason: 'unknown_restaurant' };
  const observation = observeJob(job, receipt);
  if (observation.kind !== 'classified' || observation.menu !== 'ready_for_review') return { high: false, reason: 'no_recognised_menu' };
  // An uncertain section structure is never confirmed with one click (menuHierarchy.js).
  if (receipt && Array.isArray(receipt.menus) && receipt.menus.some((m) => m && m.structure === 'uncertain')) return { high: false, reason: 'structure_uncertain' };
  const own = ownSourceOf({ job, restaurant });
  if (!own.ok) return { high: false, reason: own.reason };
  return { high: true, foundUrl: own.foundUrl };
}

/**
 * The separate, explicitly human route for an uncertain structure. It only
 * relaxes the structure rule: the restaurant, the recognised menu and the
 * own-source location must already pass, exactly as for one-click
 * confirmation. Returns { ok: true, foundUrl, receiptHash, sections } or
 * { ok: false, reason }. Never a certainty claim.
 */
function structureReviewFor({ job, receipt, restaurant }) {
  if (!restaurant) return { ok: false, reason: 'unknown_restaurant' };
  const observation = observeJob(job, receipt);
  if (observation.kind !== 'classified' || observation.menu !== 'ready_for_review') return { ok: false, reason: 'no_recognised_menu' };
  const menus = receipt && Array.isArray(receipt.menus) ? receipt.menus : [];
  if (!menus.some((m) => m && m.structure === 'uncertain')) return { ok: false, reason: 'structure_normalized' };
  const sections = uncertainSections(menus);
  // An inconsistent receipt (uncertain without any flagged section) cannot be
  // reviewed per section; it stays a manual result instead of a shortcut.
  if (sections.length === 0) return { ok: false, reason: 'structure_sections_unknown' };
  const own = ownSourceOf({ job, restaurant });
  if (!own.ok) return { ok: false, reason: own.reason };
  return {
    ok: true,
    foundUrl: own.foundUrl,
    receiptHash: receipt && typeof receipt.analysis_result_hash === 'string' ? receipt.analysis_result_hash : null,
    sections,
  };
}

/** Same host (existing normalisation) and same path. */
function sameAddress(a, b) {
  const pathOf = (value) => {
    const text = typeof value === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(value.trim()) ? `https://${value.trim()}` : value;
    const canonical = canonicalizeSourceUrl(text);
    return canonical ? new URL(canonical.canonicalUrl).pathname.replace(/\/+$/, '') : null;
  };
  return hostOf(a) !== null && hostOf(a) === hostOf(b) && pathOf(a) === pathOf(b);
}

const NOT_HIGH_TEXT = {
  structure_uncertain: 'Er is een menukaart gevonden, maar de rubriekindeling is onzeker. Een medewerker controleert de bronroute.',
  structure_sections_unknown: 'Er is een menukaart gevonden met een onzekere indeling, maar de onzekere rubrieken zijn niet per rubriek vastgelegd. Een medewerker beoordeelt hem handmatig.',
  structure_normalized: 'Er is een menukaart gevonden. Een medewerker beoordeelt hem handmatig.',
  menu_source_unknown: 'Er is een menukaart gevonden, maar de vindplaats is niet vastgelegd. Een medewerker beoordeelt hem handmatig.',
  other_host: 'De gevonden menukaart staat niet op de eigen website van dit restaurant. Een medewerker beoordeelt hem handmatig.',
  already_known_source: 'De menukaart staat op de al bekende bron. Een medewerker beoordeelt hem handmatig.',
};

// Shown for a result that only a human structure review can move forward.
const STRUCTURE_TEXT =
  'Er is een menukaart gevonden, maar de rubriekindeling is onzeker. Controleer elke onzekere rubriek hieronder en handhaaf of corrigeer hem; pas daarna kun je de bron bevestigen.';

/** The accepted BE-24 proposal that confirms this result, if any. */
function confirmationFor({ job, restaurant, foundUrl, proposals }) {
  if (!restaurant || !foundUrl || !Array.isArray(proposals)) return null;
  const since = job && (job.finished_at || job.updated_at);
  return (
    proposals.find(
      (p) =>
        p &&
        p.status === 'accepted' &&
        String(p.restaurant_id) === restaurant.id &&
        p.proposed_url === foundUrl &&
        (!since || !p.decided_at || new Date(p.decided_at).getTime() >= new Date(since).getTime())
    ) || null
  );
}

function view(key, extra) {
  const status = STATUSES[key];
  return { key, label: status.label, role: status.role, icon: status.icon, terminal: TERMINAL_KEYS.has(key), actions: [], text: null, ...extra };
}

/**
 * One URL's view.
 *   item:     { item_position, canonical_source_url, outcome, job_id, reused_job_id }
 *   job:      the item's job (queued) or the reused job (recent), or null
 *   receipt:  that job's receipt (succeeded), or null
 *   proposals: accepted BE-24 proposals (for "Bron bevestigd")
 *   duplicateOf: 1-based position of the first equal line (duplicate)
 *   formatTime(iso) → display time
 */
function deriveItemView({ item, job, receipt, restaurants, proposals, duplicateOf, now, formatTime, recordedReviews, structureStoreAvailable, storedAdvice }) {
  const fmt = typeof formatTime === 'function' ? formatTime : (v) => v;
  // Reviewer-facing analysis notes (redirects, pages read), never claims.
  const notes = job && Array.isArray(job.notes) ? job.notes.filter((n) => typeof n === 'string').slice(0, 10) : [];
  // The recognised dishes for the control view. The receipt is authoritative;
  // for an older/job-only PDF result, its recognized sections are converted to
  // the same menu shape instead of showing "Geen herkende gerechten" beside a
  // "Menukaart gevonden" badge (the Smelt mismatch).
  const fallbackMenus = job && job.status === 'succeeded' ? menusFromUnknownContexts(job.unknown_menu_contexts) : [];
  const receiptProduct = readReceiptProjection(receipt);
  const productBlocked = receiptProduct.kind !== 'v1';
  const reviewMenus = !productBlocked && receipt && Array.isArray(receipt.menus) && receipt.menus.length > 0 ? receipt.menus : (productBlocked ? [] : fallbackMenus);
  const recognisedMenu = productBlocked
    ? summarizeProductMenu(receiptProduct.view)
    : job && job.status === 'succeeded' && reviewMenus.length > 0 ? summarizeRecognisedMenu(reviewMenus) : null;
  const extraction = job && job.extraction_result && typeof job.extraction_result === 'object' ? job.extraction_result : null;
  const base = {
    position: item.item_position,
    url: item.canonical_source_url || null,
    jobId: item.job_id || item.reused_job_id || null,
    restaurant: null,
    foundUrl: null,
    high: false,
    notes,
    menu: recognisedMenu && recognisedMenu.itemCount > 0 ? recognisedMenu : null,
    // A versioned envelope is shown through the same bounded, sanitized view
    // as the review page; its legacy `menus` projection is never displayed.
    product: productBlocked ? receiptProduct.view : null,
    productBlocked,
    productReason: productBlocked ? receiptProduct.reason : null,
    productSchemaVersion: productBlocked ? receiptProduct.schemaVersion || null : null,
    coverage: extraction && extraction.coverage ? extraction.coverage : null,
    limitations: job && Array.isArray(job.limitations) ? job.limitations.filter((n) => typeof n === 'string').slice(0, 10) : [],
    attentionGroups: extraction && Array.isArray(extraction.attentionGroups) ? extraction.attentionGroups : [],
  };

  if (item.outcome === 'invalid') {
    return view('invalid', { ...base, text: 'Geen geldig webadres; pas de regel aan.', actions: ['adjust_url'] });
  }
  if (item.outcome === 'duplicate') {
    return view('duplicate', { ...base, text: duplicateOf ? `Zelfde adres als regel ${duplicateOf}; wordt één keer geanalyseerd.` : 'Zelfde adres staat al in deze lijst.' });
  }
  if (item.outcome === 'already_active') {
    return view('not_queued', { ...base, text: COPY.alreadyActive });
  }

  const restaurant = restaurantFor(receipt, restaurants);
  const withRestaurant = { ...base, restaurant: restaurant ? { id: restaurant.id, name: restaurant.name || null, known: true } : null };
  const known = Boolean(restaurant);

  if (item.outcome === 'recent') {
    const days = job && (job.finished_at || job.updated_at) ? Math.max(0, Math.floor((new Date(now || Date.now()).getTime() - new Date(job.finished_at || job.updated_at).getTime()) / 86400000)) : null;
    const earlier = job && job.status === 'succeeded' ? certaintyOf({ job, receipt, restaurant }) : { high: false };
    const confirmed = earlier.high ? confirmationFor({ job, restaurant, foundUrl: earlier.foundUrl, proposals }) : null;
    const when = days === null ? 'kort geleden' : days === 0 ? 'vandaag' : days === 1 ? '1 dag geleden' : `${days} dagen geleden`;
    return view('recent', {
      ...withRestaurant,
      foundUrl: earlier.high ? earlier.foundUrl : null,
      high: Boolean(earlier.high && !confirmed),
      confirmedAt: confirmed ? confirmed.decided_at : null,
      text: `Resultaat van ${when}; niet opnieuw opgehaald.`,
      actions: earlier.high && !confirmed ? ['confirm', 'reanalyze'] : ['reanalyze'],
    });
  }

  if (!job) return view('queued', { ...withRestaurant });

  if (job.expired_at) {
    return view('error', { ...withRestaurant, text: 'De analyse is verlopen voordat hij klaar was. Er is niets gewijzigd.', actions: ['retry'] });
  }
  if (job.status === 'pending') {
    const later = job.next_attempt_at && new Date(job.next_attempt_at).getTime() > new Date(now || Date.now()).getTime();
    return view('queued', {
      ...withRestaurant,
      text: later ? `Nieuwe poging om ${fmt(job.next_attempt_at)} · poging ${job.attempt_count} van ${MAX_ATTEMPTS}.` : null,
    });
  }
  if (job.status === 'running') return view('running', { ...withRestaurant });

  if (job.status === 'failed') {
    const imageOnly = imageOnlyReason(job, recognisedMenu);
    if (imageOnly) {
      return view('image_only', {
        ...withRestaurant,
        text: imageOnlyText(imageOnly),
        actions: ['review_source', 'adjust_url'],
        reason: imageOnly,
      });
    }
    if (job.error_reason === 'robots_disallowed') {
      return view('robots', {
        ...withRestaurant,
        text: 'De website staat automatische controle niet toe (robots.txt). Er is niets opgehaald; een medewerker kan de menukaart handmatig beoordelen.',
        actions: ['review_manually'],
      });
    }
    if (job.error_reason === 'unsafe_url') {
      return view('invalid', { ...withRestaurant, text: 'Dit adres kan niet veilig worden geanalyseerd; pas de regel aan.', actions: ['adjust_url'] });
    }
    if (job.error_reason === 'no_reliable_content_found') {
      return view('no_menu', {
        ...withRestaurant,
        text: 'Op deze website is geen bruikbare menukaart gevonden. Dat betekent niet dat het restaurant geen menukaart heeft.',
        actions: ['review_manually'],
      });
    }
    return view('error', {
      ...withRestaurant,
      text: `Technische fout: de analyse is na ${job.attempt_count || 1} ${job.attempt_count === 1 ? 'poging' : 'pogingen'} niet gelukt. Er is niets gewijzigd.`,
      actions: ['retry'],
    });
  }

  if (job.status !== 'succeeded') return view('queued', { ...withRestaurant });

  const observation = observeJob(job, receipt);
  const menu = observation.kind === 'classified' ? observation.menu : 'not_assessed';

  // A source whose only menu is an image/scan gets its own explicit status. It
  // must never fall through to "no usable menu" (which reads as a verdict about
  // the restaurant) or to "menu found" (which reads as success).
  const imageOnly = imageOnlyReason(job, recognisedMenu);
  if (imageOnly) {
    return view('image_only', {
      ...withRestaurant,
      text: imageOnlyText(imageOnly),
      actions: ['review_source', 'adjust_url'],
      reason: imageOnly,
    });
  }

  if (menu === 'not_assessed') {
    return view('no_menu', {
      ...withRestaurant,
      text: 'Op deze website is geen bruikbare menukaart gevonden. Dat betekent niet dat het restaurant geen menukaart heeft.',
      actions: ['review_manually'],
    });
  }

  if (!known) {
    if (receipt && receipt.restaurant_match_type === 'multiple') {
      return view('needs_review', { ...withRestaurant, text: 'Meer dan één bekend restaurant past bij deze website. Een medewerker beoordeelt hem handmatig.', actions: ['review_manually'] });
    }
    return view(menu === 'ready_for_review' ? 'menu_found' : 'needs_review', {
      ...withRestaurant,
      text: 'Dit restaurant staat nog niet in de catalogus. Een nieuwe aanmelding loopt via Onboarding Restaurant.',
      actions: ['onboarding'],
    });
  }

  if (menu === 'structure_not_recognized') {
    return view('needs_review', {
      ...withRestaurant,
      text: 'Er is een menukaart-kandidaat gevonden, maar er zijn geen gerechten met een betrouwbare prijs herkend. Open dit exacte resultaat voor handmatige controle; dit is geen geslaagde extractie.',
      actions: ['review_manually'],
    });
  }

  const certainty = certaintyOf({ job, receipt, restaurant });
  // An uncertain section structure is never "confirmed with one click"
  // (certaintyOf stays conservative). The separate, explicitly human route is
  // offered only when every other own-source rule already passes, and only
  // once a human handled each uncertain section.
  if (certainty.reason === 'structure_uncertain') {
    const structure = structureReviewFor({ job, receipt, restaurant });
    if (structure.ok) {
      const treated = Array.isArray(recordedReviews) ? recordedReviews : [];
      const handled = new Set(treated.map((review) => review.key));
      const complete = structure.sections.length > 0 && structure.sections.every((section) => handled.has(section.key));
      const structureReview = {
        eligible: true,
        foundUrl: structure.foundUrl,
        receiptHash: structure.receiptHash,
        storeAvailable: structureStoreAvailable !== false,
        required: structure.sections,
        treated,
        handledCount: structure.sections.filter((section) => handled.has(section.key)).length,
        // BE-30: het opgeslagen AI-advies hoort bij precies deze bronversie.
        advice: storedAdviceView(storedAdvice, structure.receiptHash),
      };
      const confirmed = confirmationFor({ job, restaurant, foundUrl: structure.foundUrl, proposals });
      if (confirmed) {
        return view('confirmed', {
          ...withRestaurant,
          foundUrl: structure.foundUrl,
          confirmedAt: confirmed.decided_at,
          text: COPY.confirmedText(fmt(confirmed.decided_at)),
          structureReview,
        });
      }
      return view('needs_review', {
        ...withRestaurant,
        foundUrl: structure.foundUrl,
        text: STRUCTURE_TEXT,
        actions: complete ? ['confirm'] : ['review_structure'],
        structureReview,
      });
    }
    // The human route is not available for this result (for example because
    // the menu sits on another host or the receipt has no flagged section):
    // never show a control the server would refuse.
    return view('needs_review', {
      ...withRestaurant,
      text: NOT_HIGH_TEXT[structure.reason] || NOT_HIGH_TEXT.structure_uncertain,
      actions: ['review_manually'],
      structureReview: { eligible: false },
    });
  }
  if (!certainty.high) {
    return view('needs_review', { ...withRestaurant, text: NOT_HIGH_TEXT[certainty.reason] || NOT_HIGH_TEXT.menu_source_unknown, actions: ['review_manually'] });
  }
  const confirmed = confirmationFor({ job, restaurant, foundUrl: certainty.foundUrl, proposals });
  if (confirmed) {
    return view('confirmed', { ...withRestaurant, foundUrl: certainty.foundUrl, confirmedAt: confirmed.decided_at, text: COPY.confirmedText(fmt(confirmed.decided_at)) });
  }
  return view('menu_found', { ...withRestaurant, foundUrl: certainty.foundUrl, high: true, actions: ['confirm'] });
}

/** Progress and the per-next-step summary above the list. */
function summarizeItems(views) {
  const list = Array.isArray(views) ? views : [];
  const counted = list.filter((v) => v.key !== 'duplicate');
  const done = counted.filter((v) => v.terminal).length;
  const byAction = {};
  for (const v of counted) for (const a of v.actions) byAction[a] = (byAction[a] || 0) + 1;
  return {
    total: counted.length,
    done,
    running: counted.filter((v) => v.key === 'running').length,
    queued: counted.filter((v) => v.key === 'queued').length,
    open: counted.length - done,
    highCertainty: counted.filter((v) => v.high).length,
    byAction,
  };
}

/** UTC instant (ISO) of midnight today in Europe/Amsterdam. */
function amsterdamDayStart(now) {
  const date = new Date(now === undefined ? Date.now() : now);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  const y = Number(parts.year);
  const m = Number(parts.month) - 1;
  const d = Number(parts.day);
  for (const offsetHours of [1, 2, 0]) {
    const candidate = new Date(Date.UTC(y, m, d) - offsetHours * 3600000);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit' }).format(candidate);
    if (local.startsWith(String(d).padStart(2, '0')) && local.endsWith('00:00')) return candidate.toISOString();
  }
  return new Date(Date.UTC(y, m, d)).toISOString();
}

module.exports = {
  MAX_BATCH_URLS,
  DAILY_URL_LIMIT,
  MAX_ATTEMPTS,
  AI_READ_OFFER_STATUSES,
  offersAiRead,
  COPY,
  STATUSES,
  ACTION_LABELS,
  splitLines,
  canonicalLine,
  precheckLines,
  menuSourceUrls,
  certaintyOf,
  ownSourceOf,
  structureReviewFor,
  deriveItemView,
  imageOnlyReason,
  IMAGE_ONLY_TEXT,
  summarizeItems,
  amsterdamDayStart,
};
