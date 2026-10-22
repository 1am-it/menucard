'use strict';

// Pin rules for the two remaining criterion-5 existing cards (#59 Delivery Lead
// order review 6349832755, K1 "Vastleggen Wolfslaar en T-Huis").
//
// The 2026-10-21 card capture recorded both sources as `failed`, so unlike
// Bardot there is no earlier hash to verify against: these bytes are pinned for
// the first time. The route is the same create-only route Bardot used (one
// read-only attempt per URL, bytes kept locally and gitignored, only hashes and
// metadata committed). The rules stay closed:
//
//   - a URL must be the pinned entry URL, a menu sub-page the historical export
//     names, a probe URL that same export names, or a same-host menu link the
//     captured entry page itself names (one link hop, never a crawl);
//   - a page that is readable but is not a menu (a maintenance page) is
//     recorded as `not-a-menu` with its reason, never as a menu;
//   - a page that cannot be read is `blocked` with its error and stores no
//     reference bytes.
//
// Pure: no fetch, parser, provider, database or publication here.

const { CAPTURE_KINDS, CARD_SOURCE_IDS, LOCAL_CAPTURE_PREFIX } = require('./cardReferenceCaptures');

// Only these two sources may be pinned by this route: Bardot has its own
// accepted pin and Zuyd was already captured as a controlled reference.
const REATTEMPT_SOURCE_IDS = ['wolfslaar', 'thuis'];
const PIN_FILE_PREFIX = 'card-reference-captures';
const CAPTURE_ROLES = ['entry', 'menu'];
const CAPTURE_STATES = ['captured', 'not-a-menu', 'blocked'];
const SEED_ORIGINS = ['entry', 'historical', 'pinned-probe'];
const DISCOVERY_KINDS = ['same-host-menu-link'];
const MAINTENANCE_PATTERN = /(?:website|site)\s+(?:is\s+)?(?:in\s+)?onderhoud|under\s+maintenance|maintenance\s+mode|binnenkort\s+(?:weer\s+)?(?:online|beschikbaar)|coming\s+soon|temporarily\s+unavailable/i;
// Amounts printed with a decimal part only. A menu that prints whole euros
// (Wolfslaar: "Witte Heilbot 32") yields 0 here, so the reference — not this
// counter — is what proves a price.
const DECIMAL_AMOUNT_PATTERN = /\d{1,3}[.,]\d{2}/g;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(String(value));
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The committed pin file of one source. Create-only, like the Bardot pin. */
function cardSourcePinPath(sourceId) {
  return `ops/benchmark/${PIN_FILE_PREFIX}.${sourceId}.json`;
}

/** True when the visible text of a readable page looks like a maintenance page. */
function looksLikeMaintenance(text) {
  return MAINTENANCE_PATTERN.test(String(text || ''));
}

/** How many printed amounts a page carries; 0 means no price evidence at all. */
function decimalAmountCount(text) {
  const matches = String(text || '').match(DECIMAL_AMOUNT_PATTERN);
  return matches ? matches.length : 0;
}

/** A stable page key: host without `www.`, path without a trailing slash. */
function pageKey(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return String(value);
  }
}

/** The menu URLs the historical export itself names for one source. */
function historicalUrlsOf(cardReferences, sourceId) {
  const source = cardReferences && cardReferences.sources ? cardReferences.sources[sourceId] : null;
  const urls = new Set();
  for (const row of Array.isArray(source && source.historical) ? source.historical : []) {
    if (nonEmptyString(row && row.sourceUrl)) urls.add(row.sourceUrl);
  }
  return [...urls];
}

/**
 * The closed seed set for one source: its pinned entry URL, the menu URLs the
 * historical export names, and the probe URLs the same export pinned. Order is
 * stable so two runs plan the same captures.
 */
function cardCaptureSeeds(cardSource, cardReferences) {
  const sourceId = cardSource && cardSource.id;
  const seeds = [];
  const seen = new Set();
  const add = (url, origin) => {
    if (!nonEmptyString(url)) return;
    const key = pageKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push({ url, origin });
  };
  add(cardSource && cardSource.entryUrl, 'entry');
  for (const url of historicalUrlsOf(cardReferences, sourceId)) add(url, 'historical');
  for (const url of Array.isArray(cardSource && cardSource.probeUrls) ? cardSource.probeUrls : []) add(url, 'pinned-probe');
  return seeds;
}

/** Every URL this pin is allowed to have requested, for a clear error message. */
function allowedSeedUrlSet(seeds) {
  return new Set((Array.isArray(seeds) ? seeds : []).map((seed) => seed.url));
}

/**
 * Validates one committed source pin against its pinned card capture.
 * `historicalUrls` comes from `existing-card-references.json`, so a pin cannot
 * claim a menu URL the historical export never named.
 */
function validateCardSourceCapturePin(pin, cardSource, { historicalUrls = [], cardCaptureSha256 } = {}) {
  const errors = [];
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) {
    return { ok: false, errors: ['pin: not an object'] };
  }
  if (!nonEmptyString(pin.version)) errors.push('pin: version is required');
  if (!REATTEMPT_SOURCE_IDS.includes(pin.sourceId)) errors.push('pin: sourceId must be wolfslaar or thuis');
  if (cardSource && cardSource.id && pin.sourceId !== cardSource.id) errors.push('pin: sourceId differs from the card source');
  if (!CARD_SOURCE_IDS.includes(pin.sourceId)) errors.push('pin: sourceId must be one of the four pinned card sources');
  if (!nonEmptyString(pin.capturedAt)) errors.push('pin: capturedAt is required');
  if (!nonEmptyString(pin.method)) errors.push('pin: method is required');
  if (pin.oneShot !== true) errors.push('pin: oneShot must be true; a second capture is refused');
  if (!pin.authorization || pin.authorization.appProviderActivation !== false) {
    errors.push('pin: app provider activation must remain false');
  }
  if (!pin.previousCardCapture || pin.previousCardCapture.previousCaptureStatus !== 'failed') {
    errors.push('pin: the previous card capture must be recorded as failed');
  } else if (!nonEmptyString(pin.previousCardCapture.path)) {
    errors.push('pin: the previous card capture path is required');
  } else if (!isSha256(cardCaptureSha256) || pin.previousCardCapture.bytesSha256 !== cardCaptureSha256) {
    errors.push('pin: the pin cannot drift from the card capture it replaces');
  }
  if (cardSource && nonEmptyString(cardSource.entryUrl) && pin.entryUrl !== cardSource.entryUrl) {
    errors.push('pin: entryUrl differs from the card source');
  }
  const allowedHosts = Array.isArray(cardSource && cardSource.allowedHosts) ? cardSource.allowedHosts : [];
  const probeUrls = Array.isArray(cardSource && cardSource.probeUrls) ? cardSource.probeUrls : [];

  const seeds = Array.isArray(pin.seeds) ? pin.seeds : [];
  if (seeds.length === 0) errors.push('pin: at least one seed URL is required');
  const seedUrls = new Set();
  let entrySeeds = 0;
  for (const [index, seed] of seeds.entries()) {
    const where = `seed #${index + 1}`;
    if (!seed || typeof seed !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!parseUrl(seed.url) || !String(seed.url).startsWith('https://')) {
      errors.push(`${where}: url must be https`);
      continue;
    }
    const host = parseUrl(seed.url).hostname;
    if (!allowedHosts.includes(host)) errors.push(`${where}: ${host} is not an allowed host`);
    if (!SEED_ORIGINS.includes(seed.origin)) errors.push(`${where}: origin is invalid`);
    if (seed.origin === 'entry') entrySeeds += 1;
    if (seed.origin === 'historical' && !historicalUrls.includes(seed.url)) {
      errors.push(`${where}: ${seed.url} is not a menu URL the historical export names`);
    }
    if (seed.origin === 'pinned-probe' && !probeUrls.includes(seed.url)) {
      errors.push(`${where}: ${seed.url} is not a pinned probe URL`);
    }
    seedUrls.add(seed.url);
  }
  if (entrySeeds !== 1) errors.push('pin: exactly one entry seed is required');
  return validateCardSourceCaptures(pin, { allowedHosts, seedUrls, errors });
}

/** The capture-list rules, split out so the seed rules above stay readable. */
function validateCardSourceCaptures(pin, state) {
  const { allowedHosts, seedUrls, errors } = state;
  const captures = Array.isArray(pin.captures) ? pin.captures : [];
  if (captures.length === 0) errors.push('pin: at least one capture is required');
  const capturedUrls = new Set();
  let entryCaptures = 0;
  let capturedMenus = 0;
  for (const [index, capture] of captures.entries()) {
    const where = `capture #${index + 1}`;
    if (!capture || typeof capture !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!nonEmptyString(capture.requestedUrl) || !parseUrl(capture.requestedUrl)) {
      errors.push(`${where}: requestedUrl is invalid`);
    } else {
      const parsed = parseUrl(capture.requestedUrl);
      if (!String(capture.requestedUrl).startsWith('https://')) errors.push(`${where}: requestedUrl must be https`);
      if (!allowedHosts.includes(parsed.hostname)) errors.push(`${where}: ${parsed.hostname} is not an allowed host`);
      const knownSeed = seedUrls.has(capture.requestedUrl);
      const discovered = capture.discovery === 'same-host-menu-link'
        && nonEmptyString(capture.discoveredFrom)
        && capturedUrls.has(capture.discoveredFrom);
      if (!knownSeed && !discovered) {
        errors.push(`${where}: ${capture.requestedUrl} is not a pinned seed URL or a menu link the entry page itself named`);
      }
      if (capture.discovery !== null && capture.discovery !== undefined && !DISCOVERY_KINDS.includes(capture.discovery)) {
        errors.push(`${where}: discovery is invalid`);
      }
    }
    if (!CAPTURE_ROLES.includes(capture.role)) errors.push(`${where}: role must be entry or menu`);
    if (!CAPTURE_STATES.includes(capture.status)) errors.push(`${where}: status must be captured, not-a-menu or blocked`);
    if (!nonEmptyString(capture.capturedAt)) errors.push(`${where}: capturedAt is required`);
    if (capture.role === 'entry' && capture.requestedUrl !== pin.entryUrl) {
      errors.push(`${where}: the entry capture must be the pinned entry URL`);
    }
    if (capture.status === 'captured' || capture.status === 'not-a-menu') {
      if (!CAPTURE_KINDS.includes(capture.kind)) errors.push(`${where}: kind is invalid`);
      if (!isSha256(capture.bytesSha256)) errors.push(`${where}: readable bytes need a SHA-256`);
      if (!Number.isInteger(capture.bytes) || capture.bytes <= 0) errors.push(`${where}: readable bytes need a positive size`);
      if (!nonEmptyString(capture.localPath) || !capture.localPath.startsWith(LOCAL_CAPTURE_PREFIX)) {
        errors.push(`${where}: bytes must point inside the gitignored card capture folder`);
      }
      if (!nonEmptyString(capture.contentType)) errors.push(`${where}: contentType is required`);
      if (capture.status === 'not-a-menu') {
        if (!nonEmptyString(capture.reason)) errors.push(`${where}: a not-a-menu page names its reason`);
        if (capture.role === 'entry') errors.push(`${where}: the entry page itself is never a menu capture`);
      } else if (capture.role === 'menu') {
        capturedMenus += 1;
      }
    } else {
      if (!nonEmptyString(capture.error)) errors.push(`${where}: a blocked capture names its reason`);
      if (nonEmptyString(capture.localPath)) errors.push(`${where}: a blocked capture stores no reference bytes`);
    }
    if (capture.role === 'entry' && capture.status === 'captured') entryCaptures += 1;
    if (nonEmptyString(capture.requestedUrl) && capture.status !== 'blocked') capturedUrls.add(capture.requestedUrl);
  }
  if (entryCaptures !== 1) errors.push('pin: exactly one readable entry capture is required');
  if (pin.captureStatus === 'captured' && capturedMenus === 0) {
    errors.push('pin: a captured source needs at least one readable menu capture');
  }
  if (pin.captureStatus === 'partially-captured' && capturedMenus > 0) {
    errors.push('pin: a partially captured source has no readable menu capture');
  }
  if (pin.captureStatus === 'blocked' && !nonEmptyString(pin.blockedReason)) {
    errors.push('pin: a blocked source names its reason');
  }
  if (!['captured', 'partially-captured', 'blocked'].includes(pin.captureStatus)) {
    errors.push('pin: captureStatus is invalid');
  }
  return { ok: errors.length === 0, errors };
}



module.exports = {
  CAPTURE_ROLES,
  CAPTURE_STATES,
  DISCOVERY_KINDS,
  MAINTENANCE_PATTERN,
  PIN_FILE_PREFIX,
  DECIMAL_AMOUNT_PATTERN,
  REATTEMPT_SOURCE_IDS,
  SEED_ORIGINS,
  allowedSeedUrlSet,
  cardCaptureSeeds,
  cardSourcePinPath,
  historicalUrlsOf,
  looksLikeMaintenance,
  pageKey,
  decimalAmountCount,
  validateCardSourceCapturePin,
};
