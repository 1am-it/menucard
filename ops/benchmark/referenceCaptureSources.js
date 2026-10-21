'use strict';

// Shared, pure rules for the five controlled #59 reference sources (Delivery
// Lead review 6318225879). A source version is captured once through the
// existing safe fetch, the bytes stay local and gitignored, and only the
// hashes/metadata are committed. The measurement then replays the real
// extraction on exactly those bytes: no second network read can change what
// was measured.
//
// This module never fetches, parses a menu, writes a database or publishes.
// It only validates the pinned manifest and maps captured URLs to their local
// bytes. The count is deliberately closed: a sixth URL needs a new decision.

const { MAX_CANDIDATES } = require('../../src/lib/sameHostDiscovery');

const REFERENCE_SOURCE_IDS = ['zuyd', 'andalous', 'pellens', 'chocolat', 'senang-makan'];
const CAPTURE_MAX_BYTES = 15 * 1024 * 1024;
const CAPTURE_MAX_CANDIDATES = MAX_CANDIDATES;
const CAPTURE_STATES = ['captured', 'blocked', 'failed'];
const CAPTURE_KINDS = ['html', 'pdf', 'unsupported'];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Content type to the only three kinds the replay can honestly handle. */
function classifyCaptureKind(contentType) {
  const value = typeof contentType === 'string' ? contentType.toLowerCase().split(';')[0].trim() : '';
  if (value === 'application/pdf') return 'pdf';
  if (value === 'text/html' || value === 'application/xhtml+xml') return 'html';
  return 'unsupported';
}

/**
 * A stable lookup key for one page: host without `www.`, path without a
 * trailing slash. Two URL spellings of the same page must never be measured
 * twice, and a redirect target must resolve to the captured bytes.
 */
function captureLookupKey(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return String(value);
  }
}

/** Validates the manifest before any network call. */
function validateReferenceCaptureManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest: not an object'] };
  }
  if (!nonEmptyString(manifest.version)) errors.push('manifest: version is required');
  if (!isDate(manifest.pinnedAt)) errors.push('manifest: pinnedAt must be an ISO date');
  const authorization = manifest.authorization;
  if (!authorization || typeof authorization !== 'object') {
    errors.push('manifest: authorization is required');
  } else {
    if (authorization.appProviderActivation !== false) {
      errors.push('manifest: app provider activation must remain false');
    }
    if (!nonEmptyString(authorization.reference)) errors.push('manifest: authorization reference is required');
    if (!nonEmptyString(authorization.scope)) errors.push('manifest: authorization scope is required');
  }

  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  if (sources.length !== REFERENCE_SOURCE_IDS.length) {
    errors.push(`manifest: exactly ${REFERENCE_SOURCE_IDS.length} pinned sources are required`);
  }
  const seen = new Set();
  for (const [index, source] of sources.entries()) {
    const where = source && nonEmptyString(source.id) ? `source ${source.id}` : `source #${index + 1}`;
    if (!source || typeof source !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!nonEmptyString(source.id)) errors.push(`${where}: id is required`);
    else if (!REFERENCE_SOURCE_IDS.includes(source.id)) errors.push(`${where}: id is not one of the five approved sources`);
    else if (seen.has(source.id)) errors.push(`${where}: duplicate id`);
    else seen.add(source.id);
    if (!nonEmptyString(source.label)) errors.push(`${where}: label is required`);
    if (!nonEmptyString(source.class)) errors.push(`${where}: class is required`);

    const parsed = parseUrl(source.entryUrl);
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      errors.push(`${where}: entryUrl must be a plain https URL`);
    }
    const hosts = Array.isArray(source.allowedHosts) ? source.allowedHosts.filter(nonEmptyString) : [];
    if (hosts.length === 0) errors.push(`${where}: at least one allowedHost is required`);
    if (parsed && !hosts.includes(parsed.hostname)) {
      errors.push(`${where}: entryUrl host must be one of the pinned allowedHosts`);
    }
    for (const extra of Array.isArray(source.extraUrls) ? source.extraUrls : []) {
      const extraUrl = parseUrl(extra);
      if (!extraUrl || extraUrl.protocol !== 'https:' || extraUrl.username || extraUrl.password) {
        errors.push(`${where}: extraUrl must be a plain https URL`);
      } else if (!hosts.includes(extraUrl.hostname)) {
        errors.push(`${where}: extraUrl host must be one of the pinned allowedHosts`);
      }
    }
    if (source.captureStatus !== undefined && !CAPTURE_STATES.includes(source.captureStatus)) {
      errors.push(`${where}: captureStatus must be captured, blocked or failed`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validates committed capture metadata against the pinned manifest. It never
 * reads the local bytes; the capture and measurement commands verify hashes.
 */
function validateCaptureMetadata(metadata, manifest) {
  const errors = [];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { ok: false, errors: ['metadata: not an object'] };
  }
  if (!nonEmptyString(metadata.version)) errors.push('metadata: version is required');
  if (!isDate(metadata.pinnedAt)) errors.push('metadata: pinnedAt must be an ISO date');
  if (!nonEmptyString(metadata.capturedAt)) errors.push('metadata: capturedAt is required');
  if (!CAPTURE_STATES.includes(metadata.captureStatus)) errors.push('metadata: captureStatus is invalid');
  if (typeof metadata.deterministicReplay !== 'boolean') errors.push('metadata: deterministicReplay must be a boolean');
  const sources = metadata.sources && typeof metadata.sources === 'object' && !Array.isArray(metadata.sources)
    ? metadata.sources
    : null;
  if (!sources) {
    errors.push('metadata: sources must be an object');
    return { ok: false, errors };
  }
  const manifestSources = new Map((manifest && Array.isArray(manifest.sources) ? manifest.sources : []).map((s) => [s.id, s]));
  for (const id of REFERENCE_SOURCE_IDS) {
    const source = sources[id];
    if (!source) {
      errors.push(`metadata: source ${id} is missing`);
      continue;
    }
    if (!CAPTURE_STATES.includes(source.captureStatus)) errors.push(`metadata ${id}: captureStatus is invalid`);
    const entry = manifestSources.get(id);
    if (entry && source.entryUrl !== entry.entryUrl) {
      errors.push(`metadata ${id}: entryUrl differs from the pinned manifest`);
    }
    const captures = Array.isArray(source.captures) ? source.captures : [];
    if (source.captureStatus === 'captured' && captures.length === 0) {
      errors.push(`metadata ${id}: a captured source needs at least one capture`);
    }
    for (const capture of captures) {
      if (!nonEmptyString(capture.requestedUrl) || !parseUrl(capture.requestedUrl)) {
        errors.push(`metadata ${id}: capture requestedUrl is invalid`);
      }
      if (!CAPTURE_STATES.includes(capture.captureStatus)) errors.push(`metadata ${id}: capture status is invalid`);
      if (!CAPTURE_KINDS.includes(capture.kind)) errors.push(`metadata ${id}: capture kind is invalid`);
      if (capture.captureStatus === 'captured') {
        if (!/^[0-9a-f]{64}$/.test(String(capture.bytesSha256))) {
          errors.push(`metadata ${id}: captured bytes need a SHA-256`);
        }
        if (!Number.isInteger(capture.bytes) || capture.bytes <= 0) {
          errors.push(`metadata ${id}: captured bytes need a positive size`);
        }
        if (!nonEmptyString(capture.localPath) || !capture.localPath.startsWith('ops/benchmark/output/reference-captures/')) {
          errors.push(`metadata ${id}: captured bytes must point inside the gitignored capture folder`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The offline fetcher for the measurement. It serves only pinned bytes and
 * reports a missing page as an error instead of silently fetching it. Both the
 * requested URL and the redirect target resolve to the same capture.
 */
function createOfflineCandidateFetcher(captures) {
  const byKey = new Map();
  const missing = [];
  for (const capture of Array.isArray(captures) ? captures : []) {
    if (!capture || capture.captureStatus !== 'captured') continue;
    for (const url of [capture.requestedUrl, capture.finalUrl, capture.url].filter(nonEmptyString)) {
      byKey.set(captureLookupKey(url), capture);
    }
  }
  function fetchCandidate(url) {
    const capture = byKey.get(captureLookupKey(url));
    if (!capture) {
      missing.push(url);
      return { status: 'error', reason: 'not_captured' };
    }
    if (capture.kind === 'pdf') {
      return { status: 'pdf', bytes: capture.bytesBuffer, finalUrl: capture.finalUrl || capture.requestedUrl };
    }
    if (capture.kind === 'html') {
      return { status: 'html', body: capture.bytesBuffer.toString('utf8'), finalUrl: capture.finalUrl || capture.requestedUrl };
    }
    return { status: 'error', reason: 'unsupported_content_type' };
  }
  return { fetchCandidate, missing };
}

module.exports = {
  CAPTURE_KINDS,
  CAPTURE_MAX_BYTES,
  CAPTURE_MAX_CANDIDATES,
  CAPTURE_STATES,
  REFERENCE_SOURCE_IDS,
  captureLookupKey,
  classifyCaptureKind,
  createOfflineCandidateFetcher,
  validateCaptureMetadata,
  validateReferenceCaptureManifest,
};

