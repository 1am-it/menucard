'use strict';

// #59 fase 2 — de exportbundel van de handmatige AI-import.
// (planning/specs/tickets/menu-extraction-manual-ai-import.md, K2.)
//
// Een bundel is de enige bron van waarheid voor de latere import: de
// protocolversie en -hash, de schemaversie met hash, de vaste bron-ID's met
// URL, ophaaltijd en SHA-256, en de brontekst die de AI heeft gezien. De
// geplakte JSON levert die waarden nooit; een modelbewering telt niet.
//
// Bewust server-only (node:crypto) en bewust in-memory:
//   - de bundel wordt nooit gelogd, nooit in de browseropslag bewaard en
//     nooit naar de database geschreven;
//   - de opslag is begrensd (aantal bundels en levensduur), zodat een herstart
//     of verlopen bundel een concrete `bundle_expired` geeft en nooit een
//     stilzwijgend andere bron;
//   - dezelfde tekst die in de prompt gaat, is de tekst waartegen de quote-
//     controle later plaatsvindt. Zo controleert de validator wat de AI zag.
//
// Geen provider, geen netwerkoproep en geen fetch in dit bestand: de
// bronlezing gebeurt in de bestaande veilige route en wordt hier ingevoerd.

const { createHash } = require('node:crypto');
const schema = require('./menuExtractionSchema');
const { DEFAULT_EXTRACTION_LIMITS } = require('./menuExtractionProtocol');

const BUNDLE_VERSION = 'manual-ai-import-bundle/v1';
const PROVENANCE_KIND = 'handmatige_ai_import';
const DEFAULT_BUNDLE_TTL_MS = 30 * 60 * 1000;
const MAX_BUNDLES = 50;
const MAX_SOURCE_TEXT_CHARS = 120_000;
const MAX_TOTAL_TEXT_CHARS = 400_000;
const MAX_SOURCES = DEFAULT_EXTRACTION_LIMITS.maxDocuments;
const MAX_SOURCE_URL = 500;
const MAX_RESTAURANT_NAME = 160;
const MAX_RESTAURANT_ID = 80;
const SOURCE_KINDS = ['html', 'pdf', 'other'];
const SOURCE_STATUSES = ['read', 'blocked', 'failed', 'not_read'];
const HEX_64 = /^[0-9a-f]{64}$/;

class ManualImportBundleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ManualImportBundleError';
    this.code = code;
  }
}

function canonicalText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** De SHA-256 van de genormaliseerde brontekst; dezelfde tekst gaat de prompt in. */
function sourceHashForText(text) {
  const canonical = canonicalText(text);
  return canonical === '' ? null : sha256(canonical);
}

/** Stabiele JSON-vorm voor de bundelhash: gesorteerde sleutels, vaste velden. */
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalJson(value[key]);
    return out;
  }
  return value;
}

/** De binding die de import later hercontroleert: nooit de brontekst zelf. */
function bundleBinding({ bundleId, actorUserId, restaurantId, fetchedAt, protocol, sources }) {
  return {
    version: BUNDLE_VERSION,
    bundleId,
    actorUserId,
    restaurantId,
    fetchedAt,
    protocolVersion: protocol.version,
    protocolHash: protocol.hash,
    instructionSchemaVersion: protocol.schemaVersion,
    outputSchemaVersion: schema.EXTRACTION_OUTPUT_SCHEMA_VERSION,
    outputSchemaHash: sha256(JSON.stringify(canonicalJson(schema.EXTRACTION_OUTPUT_SCHEMA))),
    sources: sources.map((source) => ({
      id: source.id,
      url: source.url,
      kind: source.kind,
      status: source.status,
      fetchedAt: source.fetchedAt,
      sha256: source.sha256,
      hasText: source.hasText,
    })),
  };
}

function computeBundleHash(binding) {
  return sha256(JSON.stringify(canonicalJson(binding)));
}

function isValidUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_URL) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeSource(raw, index, fallbackFetchedAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManualImportBundleError('source_invalid', `Bron ${index + 1} is ongeldig.`);
  }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
  if (!id || id.length > schema.LIMITS.sourceId) {
    throw new ManualImportBundleError('source_invalid', `Bron ${index + 1} heeft geen geldige sourceId.`);
  }
  if (!isValidUrl(raw.url)) {
    throw new ManualImportBundleError('source_invalid', `Bron ${index + 1} heeft geen geldige URL.`);
  }
  const kind = SOURCE_KINDS.includes(raw.kind) ? raw.kind : 'other';
  const status = SOURCE_STATUSES.includes(raw.status) ? raw.status : 'read';
  const text = canonicalText(raw.text);
  // Een bron zonder tekst (scan, afbeelding, PDF zonder tekstlaag) is een
  // expliciete stand: de prompt vraagt de mens het bestand zelf toe te voegen
  // en bewijs is later niet automatisch controleerbaar. Nooit tekst verzinnen.
  const hasText = text.length > 0;
  if (hasText && text.length > MAX_SOURCE_TEXT_CHARS) {
    throw new ManualImportBundleError('source_too_large', `Bron ${index + 1} is groter dan ${MAX_SOURCE_TEXT_CHARS} tekens.`);
  }
  const hash = typeof raw.sha256 === 'string' && HEX_64.test(raw.sha256.toLowerCase())
    ? raw.sha256.toLowerCase()
    : sourceHashForText(text);
  if (!hash) {
    throw new ManualImportBundleError('source_hash_missing', `Bron ${index + 1} heeft geen SHA-256.`);
  }
  return {
    id,
    url: raw.url.trim(),
    kind,
    status,
    fetchedAt: typeof raw.fetchedAt === 'string' && raw.fetchedAt.trim() ? raw.fetchedAt.trim() : fallbackFetchedAt,
    sha256: hash,
    hasText,
    text: hasText ? text : null,
    limitation: typeof raw.limitation === 'string' && raw.limitation.trim() ? raw.limitation.trim().slice(0, schema.LIMITS.limitation) : null,
  };
}


function normalizeProtocol(protocol) {
  if (!protocol || typeof protocol !== 'object') {
    throw new ManualImportBundleError('protocol_unavailable', 'De versiegebonden extractie-instructie is niet geladen.');
  }
  if (typeof protocol.text !== 'string' || protocol.text.trim() === '') {
    throw new ManualImportBundleError('protocol_unavailable', 'MENU-EXTRACTION.md is leeg.');
  }
  if (typeof protocol.hash !== 'string' || !HEX_64.test(protocol.hash)) {
    throw new ManualImportBundleError('protocol_unversioned', 'De protocolhash ontbreekt.');
  }
  if (typeof protocol.version !== 'string' || protocol.version.trim() === '') {
    throw new ManualImportBundleError('protocol_unversioned', 'De protocolversie ontbreekt.');
  }
  return {
    version: protocol.version,
    status: protocol.status || 'CONCEPT',
    schemaVersion: protocol.schemaVersion || 'menu-extraction-result/v1',
    hash: protocol.hash,
    file: protocol.file || 'MENU-EXTRACTION.md',
    text: canonicalText(protocol.text),
  };
}

/**
 * Bouwt één exportbundel. `bundleId` en `now` worden ingevoerd zodat de
 * handler en de tests dezelfde, controleerbare waarden gebruiken.
 */
function buildImportBundle({ bundleId, actorUserId, restaurantId, restaurantName, fetchedAt, sources, protocol, now = new Date() } = {}) {
  if (typeof bundleId !== 'string' || bundleId.trim() === '') {
    throw new ManualImportBundleError('bundle_invalid', 'De bundel heeft geen id.');
  }
  if (typeof actorUserId !== 'string' || actorUserId.trim() === '') {
    throw new ManualImportBundleError('bundle_invalid', 'De bundel heeft geen gebruiker.');
  }
  if (typeof restaurantId !== 'string' || restaurantId.trim() === '' || restaurantId.length > MAX_RESTAURANT_ID) {
    throw new ManualImportBundleError('restaurant_invalid', 'Kies eerst een restaurant.');
  }
  const normalizedProtocol = normalizeProtocol(protocol);
  const list = Array.isArray(sources) ? sources : [];
  if (list.length === 0) {
    throw new ManualImportBundleError('sources_missing', 'Er is geen leesbare bron om te exporteren.');
  }
  if (list.length > MAX_SOURCES) {
    throw new ManualImportBundleError('sources_too_many', `Maximaal ${MAX_SOURCES} bronnen per prompt.`);
  }
  const set = typeof fetchedAt === 'string' && fetchedAt.trim() ? fetchedAt.trim() : now.toISOString();
  const normalizedSources = list.map((source, index) => normalizeSource(source, index, set));
  const ids = new Set();
  for (const source of normalizedSources) {
    if (ids.has(source.id)) throw new ManualImportBundleError('source_duplicate', `sourceId ${source.id} komt dubbel voor.`);
    ids.add(source.id);
  }
  const totalText = normalizedSources.reduce((sum, source) => sum + (source.text ? source.text.length : 0), 0);
  if (totalText > MAX_TOTAL_TEXT_CHARS) {
    throw new ManualImportBundleError('sources_too_large', `De brontekst samen is groter dan ${MAX_TOTAL_TEXT_CHARS} tekens.`);
  }
  if (!normalizedSources.some((source) => source.hasText)) {
    throw new ManualImportBundleError('sources_unreadable', 'Geen enkele bron heeft leesbare tekst; exporteren heeft dan geen zin.');
  }

  const binding = bundleBinding({
    bundleId: bundleId.trim(),
    actorUserId: actorUserId.trim(),
    restaurantId: restaurantId.trim(),
    fetchedAt: set,
    protocol: normalizedProtocol,
    sources: normalizedSources,
  });
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    version: BUNDLE_VERSION,
    bundleId: binding.bundleId,
    actorUserId: binding.actorUserId,
    restaurantId: binding.restaurantId,
    restaurantName: typeof restaurantName === 'string' && restaurantName.trim() ? restaurantName.trim().slice(0, MAX_RESTAURANT_NAME) : null,
    createdAt,
    fetchedAt: set,
    expiresAt: new Date(new Date(createdAt).getTime() + DEFAULT_BUNDLE_TTL_MS).toISOString(),
    protocol: normalizedProtocol,
    schemaVersion: schema.EXTRACTION_OUTPUT_SCHEMA_VERSION,
    schemaHash: binding.outputSchemaHash,
    limits: {
      maxDocuments: DEFAULT_EXTRACTION_LIMITS.maxDocuments,
      maxPages: DEFAULT_EXTRACTION_LIMITS.maxPages,
      itemsTotal: schema.LIMITS.itemsTotal,
      quote: schema.LIMITS.quote,
      answerBytes: 1024 * 1024,
      sourceTextChars: MAX_SOURCE_TEXT_CHARS,
      followUpsPerRow: 1,
      followUpsPerImport: 20,
      rowsPerFollowUp: 10,
      followUpContextChars: 8 * 1024,
    },
    sources: normalizedSources,
    binding,
    bundleHash: computeBundleHash(binding),
    // De brontekst gaat mee in de prompt en blijft alleen in dit object; de
    // handler logt het niet en de browser bewaart het niet.
    promptText: null,
  };
}


/** Alleen wat een scherm mag tonen: geen brontekst, geen protocoltekst. */
function bundleMetadata(bundle) {
  if (!bundle) return null;
  return {
    bundleId: bundle.bundleId,
    bundleHash: bundle.bundleHash,
    restaurantId: bundle.restaurantId,
    restaurantName: bundle.restaurantName,
    createdAt: bundle.createdAt,
    fetchedAt: bundle.fetchedAt,
    expiresAt: bundle.expiresAt,
    protocol: {
      version: bundle.protocol.version,
      hash: bundle.protocol.hash,
      schemaVersion: bundle.protocol.schemaVersion,
      file: bundle.protocol.file,
    },
    schemaVersion: bundle.schemaVersion,
    schemaHash: bundle.schemaHash,
    sources: bundle.sources.map((source) => ({
      id: source.id,
      url: source.url,
      kind: source.kind,
      status: source.status,
      fetchedAt: source.fetchedAt,
      sha256: source.sha256,
      hasText: source.hasText,
      limitation: source.limitation,
    })),
  };
}

class ManualImportBundleStore {
  constructor({ ttlMs = DEFAULT_BUNDLE_TTL_MS, maxBundles = MAX_BUNDLES, now = () => new Date() } = {}) {
    this.ttlMs = ttlMs;
    this.maxBundles = maxBundles;
    this.now = now;
    this.bundles = new Map();
  }

  put(bundle) {
    this.prune();
    // De opslag bezit de levensduur: een bundel kan nooit langer leven dan de
    // begrensde TTL van deze opslag.
    const withTtl = {
      ...bundle,
      expiresAt: new Date(new Date(bundle.createdAt).getTime() + this.ttlMs).toISOString(),
    };
    this.bundles.set(withTtl.bundleId, withTtl);
    while (this.bundles.size > this.maxBundles) {
      const oldest = this.bundles.keys().next().value;
      this.bundles.delete(oldest);
    }
    return withTtl;
  }

  /** Null voor onbekend én verlopen; de handler meldt dat als `bundle_expired`. */
  get(bundleId) {
    if (typeof bundleId !== 'string') return null;
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return null;
    if (this.isExpired(bundle)) {
      this.bundles.delete(bundleId);
      return null;
    }
    return bundle;
  }

  /**
   * Geldige bundels van deze gebruiker voor dit resultaat, nieuwste eerst.
   * Twee kandidaten betekent: de mens kiest ("14:12 of 14:40") — de app gokt
   * niet. Nul kandidaten betekent: geen import zonder nieuwe export.
   */
  validFor({ actorUserId, restaurantId, limit = 2 }) {
    return [...this.bundles.values()]
      .filter((bundle) => bundle.actorUserId === actorUserId && bundle.restaurantId === restaurantId && !this.isExpired(bundle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  isExpired(bundle) {
    return new Date(bundle.expiresAt).getTime() <= this.now().getTime();
  }

  prune() {
    for (const [id, bundle] of this.bundles) {
      if (this.isExpired(bundle)) this.bundles.delete(id);
    }
  }

  size() {
    return this.bundles.size;
  }
}

/** Eén procesbrede opslag; geen database, geen bestand, geen browser. */
const sharedBundleStore = new ManualImportBundleStore();

module.exports = {
  BUNDLE_VERSION,
  PROVENANCE_KIND,
  DEFAULT_BUNDLE_TTL_MS,
  MAX_BUNDLES,
  MAX_SOURCES,
  MAX_SOURCE_TEXT_CHARS,
  MAX_TOTAL_TEXT_CHARS,
  ManualImportBundleError,
  ManualImportBundleStore,
  sharedBundleStore,
  canonicalText,
  canonicalJson,
  sha256,
  sourceHashForText,
  computeBundleHash,
  buildImportBundle,
  bundleMetadata,
};

