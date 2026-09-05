// Pure parsing/comparison logic for MARKET-05A's "Suggest data from
// website" feature — never fetches anything itself (see
// src/lib/safeOutboundFetch.js for the actual, SSRF-guarded network
// call, and app/api/internal/v1/import-inbox/candidates/[id]/suggest-from-website/route.js
// for the route that wires the two together). Scoped **exclusively** to
// `address`/`phone`/`website` — never menus, prices, photos, marketing
// copy, or any other page content; nothing extracted by this module is
// ever stored anywhere by itself. A suggestion only ever reaches the
// database if a human reviewer explicitly confirms it, per field,
// through the pre-existing `POST .../candidates/{id}/enrichments` route
// — nothing here writes to Supabase, calls that route, or has any
// awareness that it exists.
//
// Deliberately CommonJS, same reasoning as importInbox.js.

'use strict';

const { normalizeAddressNL, normalizePhoneNL, normalizeWebsite, extractNlPostcode } = require('./candidateNormalization');

// ─── robots.txt — a product-policy gate, not a claim of legal permission.
// See planning/specs/tickets/market-05-normalization-deduplication.md's
// own "Website suggestions" section for the full reasoning: honoring
// robots.txt here is a deliberate, conservative product rule this
// feature applies to itself; its *absence* is never treated as
// permission, legal or otherwise, to fetch or use a site's content —
// only as "this specific technical gate did not apply this time." ──────

/**
 * Minimal, real `robots.txt` parser — only the `User-agent: *` group's
 * `Disallow` rules (the universal fallback every crawler is expected to
 * honor absent a more specific group naming it). Returns an array of
 * disallowed path prefixes; an empty `Disallow:` value means "allow
 * everything" and is represented as an empty array.
 */
function parseRobotsTxtDisallowRules(robotsTxt) {
  if (typeof robotsTxt !== 'string' || robotsTxt.trim().length === 0) return [];
  const lines = robotsTxt.split(/\r?\n/);
  const disallowed = [];
  let inWildcardGroup = false;
  let sawAnyUserAgentLine = false;
  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (line.length === 0) continue;
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      sawAnyUserAgentLine = true;
      inWildcardGroup = value === '*';
      continue;
    }
    if (!sawAnyUserAgentLine) {
      // Rules before any User-agent line are non-conformant; ignored
      // rather than guessed at.
      continue;
    }
    if (key === 'disallow' && inWildcardGroup && value.length > 0) {
      disallowed.push(value);
    }
  }
  return disallowed;
}

/** True when `pathname` is not covered by any collected `Disallow`
 * prefix — the standard (simplified) robots.txt prefix-match rule. An
 * empty `disallowRules` array means "nothing was disallowed" (allow). */
function isPathAllowedByRobots(disallowRules, pathname) {
  if (!Array.isArray(disallowRules) || disallowRules.length === 0) return true;
  const path = typeof pathname === 'string' && pathname.length > 0 ? pathname : '/';
  return !disallowRules.some((prefix) => path.startsWith(prefix));
}

// Correction (2026-09-05): earlier versions of this gate treated a
// failure to fetch robots.txt at all (network error, non-2xx status,
// timeout, disallowed SSRF target) the same as "robots.txt has nothing
// to say" — i.e. fail-open, proceeding to fetch the page anyway. That is
// wrong: this feature can only honor a rule it actually saw. The gate
// below fails closed instead — a failed fetch and an explicit
// `Disallow` both result in the target page never being fetched; the
// two cases are still reported with distinct statuses so a reviewer
// can tell "robots.txt forbids this" apart from "robots.txt could not
// be confirmed."
/**
 * The robots.txt gate's pure decision logic — never fetches anything
 * itself; the caller (the suggest-from-website route) is responsible
 * for actually fetching `robots.txt` and reporting whether that fetch
 * failed. Returns `{ status, shouldFetchPage }` where `status` is one
 * of `'allowed'` (confirmed, not disallowed — the only case where
 * `shouldFetchPage` is `true`), `'disallowed'` (confirmed, and the
 * path is covered by a `Disallow` rule), or `'unconfirmed'` (the
 * robots.txt fetch itself failed for any reason) .
 */
function classifyRobotsGate({ robotsFetchFailed, robotsTxtBody, pathname }) {
  if (robotsFetchFailed) {
    return { status: 'unconfirmed', shouldFetchPage: false };
  }
  const disallowRules = parseRobotsTxtDisallowRules(robotsTxtBody);
  const allowed = isPathAllowedByRobots(disallowRules, pathname);
  return { status: allowed ? 'allowed' : 'disallowed', shouldFetchPage: allowed };
}

// ─── JSON-LD / structured-data extraction ───────────────────────────────

const JSON_LD_SCRIPT_PATTERN = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** schema.org business types this feature ever reads contact info from —
 * never a generic "any JSON-LD block" — so an unrelated block (e.g. for
 * a blog post's `Article` schema elsewhere on the page) is never mined
 * for a phone number that has nothing to do with the business. */
const RELEVANT_SCHEMA_TYPES = ['restaurant', 'foodestablishment', 'localbusiness', 'organization', 'cafeorcoffeeshop', 'bar'];

function schemaTypeMatches(typeValue) {
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  return types.some((t) => typeof t === 'string' && RELEVANT_SCHEMA_TYPES.includes(t.toLowerCase()));
}

/** schema.org `PostalAddress` → one composed address string, in the
 * same "never invent a missing component" style as
 * ops/scripts/import-breda-osm.js's own composeAddress. */
function composeAddressFromSchemaOrg(addressValue) {
  if (!addressValue || typeof addressValue !== 'object') {
    return typeof addressValue === 'string' && addressValue.trim() ? addressValue.trim() : null;
  }
  const street = typeof addressValue.streetAddress === 'string' ? addressValue.streetAddress.trim() : '';
  const postcode = typeof addressValue.postalCode === 'string' ? addressValue.postalCode.trim() : '';
  const city = typeof addressValue.addressLocality === 'string' ? addressValue.addressLocality.trim() : '';
  const localityLine = [postcode, city].filter(Boolean).join(' ').trim();
  const parts = [street, localityLine].filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Walks one already-`JSON.parse`d JSON-LD document (which may itself be
 * an object, an array of objects, or an object with an `@graph` array —
 * all real, documented JSON-LD shapes) and returns the first node whose
 * `@type` matches `RELEVANT_SCHEMA_TYPES`, or `null`.
 */
function findRelevantSchemaNode(parsedJsonLd) {
  const candidates = [];
  if (Array.isArray(parsedJsonLd)) {
    candidates.push(...parsedJsonLd);
  } else if (parsedJsonLd && typeof parsedJsonLd === 'object') {
    candidates.push(parsedJsonLd);
    if (Array.isArray(parsedJsonLd['@graph'])) candidates.push(...parsedJsonLd['@graph']);
  }
  return candidates.find((node) => node && typeof node === 'object' && schemaTypeMatches(node['@type'])) || null;
}

/**
 * Extracts `{ name, address, phone, website }` (each `null` if absent)
 * from every JSON-LD block on the page — the first relevant node found
 * wins. Never reads or returns anything beyond these four fields, even
 * if the source JSON-LD node has many more properties (e.g. `menu`,
 * `image`, `priceRange` are all present on real schema.org
 * `Restaurant`/`FoodEstablishment` nodes and are never read here).
 */
function extractFromJsonLd(html) {
  if (typeof html !== 'string') return null;
  const matches = [...html.matchAll(JSON_LD_SCRIPT_PATTERN)];
  for (const match of matches) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch (err) {
      continue; // malformed block — skip it, never guess at its content
    }
    const node = findRelevantSchemaNode(parsed);
    if (!node) continue;
    return {
      name: typeof node.name === 'string' && node.name.trim() ? node.name.trim() : null,
      address: composeAddressFromSchemaOrg(node.address),
      phone: typeof node.telephone === 'string' && node.telephone.trim() ? node.telephone.trim() : null,
      website: typeof node.url === 'string' && node.url.trim() ? node.url.trim() : null,
    };
  }
  return null;
}

// ─── Fallback: explicit contact links/tags only — never a general text
// scrape of the page. ─────────────────────────────────────────────────

const TEL_LINK_PATTERN = /<a[^>]+href\s*=\s*["']tel:([^"']+)["']/i;
const ADDRESS_TAG_PATTERN = /<address[^>]*>([\s\S]*?)<\/address>/i;

function stripHtmlTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFromFallbackMarkup(html) {
  if (typeof html !== 'string') return { name: null, address: null, phone: null, website: null };
  const telMatch = html.match(TEL_LINK_PATTERN);
  const addressMatch = html.match(ADDRESS_TAG_PATTERN);
  return {
    name: null,
    address: addressMatch ? stripHtmlTags(addressMatch[1]) || null : null,
    phone: telMatch ? telMatch[1].trim() : null,
    website: null,
  };
}

/**
 * The one entry point for parsing a fetched page — prefers JSON-LD
 * structured data (more reliable, explicitly machine-readable contact
 * info); falls back to explicit `tel:` links / `<address>` tags only
 * when no relevant JSON-LD node was found. Never falls further back to
 * scanning arbitrary page text.
 */
function parseContactSuggestionsFromHtml(html) {
  const fromJsonLd = extractFromJsonLd(html);
  if (fromJsonLd && (fromJsonLd.address || fromJsonLd.phone || fromJsonLd.website)) {
    return { ...fromJsonLd, source: 'json-ld' };
  }
  const fallback = extractFromFallbackMarkup(html);
  return { ...fallback, source: 'fallback-markup' };
}

// ─── Comparison against the candidate's own current data ────────────────

function normalizeForNameCompare(name) {
  return typeof name === 'string' ? name.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/** `true` when the suggested name plausibly refers to the same
 * business — an exact match, or either name containing the other after
 * normalization (handles "De Kroeg" vs. "Café De Kroeg"-style
 * legal/trade-name variants without attempting fuzzy/similarity
 * matching, which risks false confidence). `null` (not `false`) when
 * there is nothing to compare — never treated as a mismatch. */
function namesLikelyMatch(candidateName, suggestedName) {
  const a = normalizeForNameCompare(candidateName);
  const b = normalizeForNameCompare(suggestedName);
  if (!a || !b) return null;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

/** Compares two postcodes (already-free-text addresses) — `true` when
 * both contain a recognizable NL postcode and they match, `false` when
 * both are present and differ, `null` when at least one side has no
 * recognizable postcode to compare (never guessed at). */
function postcodesLikelyMatch(candidateAddress, suggestedAddress) {
  const a = extractNlPostcode(candidateAddress);
  const b = extractNlPostcode(suggestedAddress);
  if (!a || !b) return null;
  return a === b;
}

/** One of `'new'` (candidate has no value for this field yet — a plain
 * addition), `'match'` (agrees with the candidate's current value,
 * after normalization), or `'needs_review'` (conflicts with the
 * candidate's current value, or the page-level name/address mismatch
 * check below means this suggestion cannot be trusted regardless of
 * whether the individual field itself looks fine) — never a status that
 * implies anything was or will be written automatically. */
function compareFieldValue(existingValue, suggestedValue, normalizeFn) {
  if (suggestedValue === null || suggestedValue === undefined || String(suggestedValue).trim().length === 0) {
    return 'no_data';
  }
  if (existingValue === null || existingValue === undefined || String(existingValue).trim().length === 0) {
    return 'new';
  }
  const existingNormalized = normalizeFn(existingValue).normalized;
  const suggestedNormalized = normalizeFn(suggestedValue).normalized;
  return existingNormalized === suggestedNormalized ? 'match' : 'needs_review';
}

/**
 * Builds the final suggestion payload the route returns — the only
 * place in this module that combines parsing + comparison. Never
 * mutates `candidateFields`; never returns anything beyond
 * `address`/`phone`/`website` plus the warnings describing *why* a
 * result might not be trustworthy. `sourceUrl` is recorded on every
 * present field so a reviewer confirming it through the enrichment form
 * has the exact page it came from, per field, exactly like a manually
 * typed-in enrichment would.
 */
function buildSuggestionResult({ parsed, candidateFields, sourceUrl }) {
  const fields = candidateFields || {};
  const nameMatch = namesLikelyMatch(fields.name, parsed.name);
  const addressPostcodeMatch = postcodesLikelyMatch(fields.address, parsed.address);

  const warnings = [];
  if (nameMatch === false) {
    warnings.push(`The website's name ("${parsed.name}") does not match the candidate's name ("${fields.name}").`);
  }
  if (addressPostcodeMatch === false) {
    warnings.push(`The website's address postcode does not match the candidate's current address.`);
  }
  const forceNeedsReview = nameMatch === false || addressPostcodeMatch === false;

  function buildOne(fieldName, suggestedValue, normalizeFn) {
    if (suggestedValue === null || suggestedValue === undefined || String(suggestedValue).trim().length === 0) {
      return { status: 'no_data', value: null, source_url: null };
    }
    let status = compareFieldValue(fields[fieldName], suggestedValue, normalizeFn);
    if (status !== 'no_data' && forceNeedsReview) status = 'needs_review';
    return { status, value: suggestedValue, source_url: sourceUrl };
  }

  return {
    source_url: sourceUrl,
    parsed_from: parsed.source,
    suggestions: {
      address: buildOne('address', parsed.address, normalizeAddressNL),
      phone: buildOne('phone', parsed.phone, normalizePhoneNL),
      website: buildOne('website', parsed.website, normalizeWebsite),
    },
    warnings,
  };
}

module.exports = {
  parseRobotsTxtDisallowRules,
  isPathAllowedByRobots,
  classifyRobotsGate,
  extractFromJsonLd,
  extractFromFallbackMarkup,
  parseContactSuggestionsFromHtml,
  composeAddressFromSchemaOrg,
  namesLikelyMatch,
  postcodesLikelyMatch,
  compareFieldValue,
  buildSuggestionResult,
};
