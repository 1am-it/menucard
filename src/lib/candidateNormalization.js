// Central, conservative normalization for MARKET-05A candidate fields —
// used by the Data-inbox to compute one consistent *display* view over
// the whole import/enrichment pipeline. Never mutates or replaces the
// raw import value or an enrichment audit row; both stay exactly as
// recorded (src/lib/importInbox.js's computeEnrichedFields runs first,
// this module runs only on the *result* of that, for display purposes).
//
// Every normalizer here follows the same conservative contract:
//  - Never guesses. An input that doesn't clearly match a known-safe
//    shape is returned completely unchanged, flagged `valid: false` —
//    never "corrected" toward a best guess.
//  - Idempotent. Feeding a normalizer's own `normalized` output back in
//    produces the identical `normalized` output again — see this file's
//    own test suite for exhaustive proof per normalizer.
//  - Pure. No I/O, no geocoding, no external lookups, no network access
//    of any kind — see planning/specs/tickets/market-05-normalization-deduplication.md's
//    own "Centralized normalization" section for why (e.g. address
//    normalization is explicitly whitespace/postcode-shape only, never
//    an automatic correction or a real address lookup).
//
// Deliberately CommonJS, same reasoning as importInbox.js/setPasswordFlow.js
// — directly testable via this project's existing `node --test` tooling.

'use strict';

// ─── Website ────────────────────────────────────────────────────────────

/**
 * Splits a URL string (already confirmed parseable by `new URL()`) into
 * `{ scheme, authority, remainder }` without using any of the URL
 * object's own reconstructed fields — `remainder` (path + query +
 * fragment) is a byte-for-byte substring of the original input, never
 * re-encoded or reconstructed, so it can never lose or alter meaningful
 * path segments or query parameters.
 */
function splitUrlForNormalization(trimmed) {
  const schemeEnd = trimmed.indexOf(':');
  if (schemeEnd === -1) return null;
  const scheme = trimmed.slice(0, schemeEnd);
  let rest = trimmed.slice(schemeEnd + 1);
  if (!rest.startsWith('//')) return null;
  rest = rest.slice(2);
  const authorityEndMatch = rest.match(/[/?#]/);
  const authorityEnd = authorityEndMatch ? authorityEndMatch.index : rest.length;
  const authority = rest.slice(0, authorityEnd);
  const remainder = rest.slice(authorityEnd);
  return { scheme, authority, remainder };
}

/**
 * Normalizes only the two case-insensitive parts of a URL per RFC
 * 3986 — the scheme and the host (never userinfo, which IS
 * case-sensitive, and never the path/query/fragment, which this
 * function never even parses/re-encodes — see splitUrlForNormalization).
 * `http://Example.COM/Menu?Table=1` becomes
 * `http://example.com/Menu?Table=1` — `/Menu?Table=1` is untouched.
 *
 * Rejects (returns `valid: false`, value unchanged) anything that is
 * not a syntactically valid, `http:`/`https:` URL — never guesses at a
 * missing scheme or a typo'd domain.
 */
function normalizeWebsite(rawValue) {
  if (typeof rawValue !== 'string') {
    return { value: rawValue, normalized: rawValue, display: rawValue, changed: false, valid: false };
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return { value: trimmed, normalized: trimmed, display: trimmed, changed: trimmed !== rawValue, valid: false };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return { value: trimmed, normalized: trimmed, display: trimmed, changed: false, valid: false };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { value: trimmed, normalized: trimmed, display: trimmed, changed: false, valid: false };
  }

  const split = splitUrlForNormalization(trimmed);
  if (!split) {
    return { value: trimmed, normalized: trimmed, display: trimmed, changed: false, valid: false };
  }

  const atIndex = split.authority.lastIndexOf('@');
  const userinfo = atIndex >= 0 ? split.authority.slice(0, atIndex + 1) : '';
  const hostAndPort = atIndex >= 0 ? split.authority.slice(atIndex + 1) : split.authority;
  const normalizedAuthority = userinfo + hostAndPort.toLowerCase();
  const normalized = `${split.scheme.toLowerCase()}://${normalizedAuthority}${split.remainder}`;

  return { value: trimmed, normalized, display: normalized, changed: normalized !== trimmed, valid: true };
}

// ─── Phone (Netherlands-focused) ────────────────────────────────────────

/**
 * Recognizes only the common, unambiguous shapes of a Dutch phone
 * number: a national 10-digit form (`0` + 9 digits, covering both `06`
 * mobile and geographic/service numbers) written with or without a `+31`
 * / `0031` international prefix, and with common cosmetic punctuation
 * (spaces, hyphens, parentheses, dots) — never anything else. Notably
 * does **not** attempt to recognize shorter special-rate numbers (e.g.
 * some `0800` numbers have fewer than 9 digits after the trunk `0`) —
 * those fall through to `valid: false`, unchanged, exactly like any
 * other input this function cannot confidently classify. Never guesses:
 * a wrong digit count is left alone, never padded or truncated.
 */
const NL_PHONE_COSMETIC_CHARS = /[\s\-().]/g;

function normalizePhoneNL(rawValue) {
  if (typeof rawValue !== 'string') {
    return { value: rawValue, normalized: rawValue, display: rawValue, changed: false, valid: false };
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return { value: trimmed, normalized: trimmed, display: trimmed, changed: trimmed !== rawValue, valid: false };
  }

  const stripped = trimmed.replace(NL_PHONE_COSMETIC_CHARS, '');
  if (!/^\+?[0-9]+$/.test(stripped)) {
    return { value: trimmed, normalized: trimmed, display: trimmed, changed: false, valid: false };
  }

  let nationalDigits = null;
  if (stripped.startsWith('+31')) {
    const rest = stripped.slice(3);
    if (/^[0-9]{9}$/.test(rest)) nationalDigits = rest;
  } else if (stripped.startsWith('0031')) {
    const rest = stripped.slice(4);
    if (/^[0-9]{9}$/.test(rest)) nationalDigits = rest;
  } else if (stripped.startsWith('0')) {
    const rest = stripped.slice(1);
    if (/^[0-9]{9}$/.test(rest)) nationalDigits = rest;
  }

  if (!nationalDigits) {
    return { value: trimmed, normalized: trimmed, display: trimmed, changed: false, valid: false };
  }

  const normalized = `+31${nationalDigits}`;
  const isMobile = nationalDigits.startsWith('6');
  // Mobile numbers are unambiguously "06" + 8 digits — grouped cleanly.
  // Every other valid national number (geographic or service) is shown
  // as "0" + the 9 digits with no further internal grouping: this
  // project does not have a verified, complete table of which Dutch
  // area codes are 2 digits vs. 3 digits, and guessing a split point
  // would silently mis-group roughly half of them — a known, named
  // limitation (see this module's own test suite and the ticket's
  // "Centralized normalization" section), preferred over a confidently
  // wrong-looking display.
  const display = isMobile ? `06 ${nationalDigits.slice(1)}` : `0${nationalDigits}`;

  return { value: trimmed, normalized, display, changed: normalized !== trimmed, valid: true };
}

// ─── Address (Netherlands-focused, formatting only) ─────────────────────

/** Exactly the fixed Dutch postcode shape: 4 digits, then 2 letters,
 * with or without whitespace between them — never a looser match that
 * could catch an unrelated 4-digit number elsewhere in the address. */
const NL_POSTCODE_PATTERN = /\b(\d{4})\s*([A-Za-z]{2})\b/;

/**
 * Whitespace- and Dutch-postcode-formatting only: collapses any run of
 * whitespace to a single space, and — only for a substring that already
 * matches the fixed 4-digit+2-letter Dutch postcode shape — uppercases
 * the two letters and ensures exactly one space before them. Never
 * reorders components, never expands abbreviations, never geocodes or
 * looks up a real address, never touches anything that isn't whitespace
 * or a recognized postcode substring.
 */
function normalizeAddressNL(rawValue) {
  if (typeof rawValue !== 'string') {
    return { value: rawValue, normalized: rawValue, display: rawValue, changed: false, valid: false };
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return { value: trimmed, normalized: trimmed, display: trimmed, changed: trimmed !== rawValue, valid: false };
  }

  let normalized = trimmed.replace(/\s+/g, ' ');
  normalized = normalized.replace(NL_POSTCODE_PATTERN, (match, digits, letters) => `${digits} ${letters.toUpperCase()}`);

  return { value: trimmed, normalized, display: normalized, changed: normalized !== trimmed, valid: true };
}

/** Extracts the Dutch postcode (as `"1234 AB"`, already normalized) from
 * a free-text address, or `null` if none is present — used only to
 * compare two addresses' postcodes as a cheap, objective proxy for "is
 * this plausibly the same location," never to validate or complete an
 * address. */
function extractNlPostcode(addressValue) {
  if (typeof addressValue !== 'string') return null;
  const match = addressValue.match(NL_POSTCODE_PATTERN);
  if (!match) return null;
  return `${match[1]} ${match[2].toUpperCase()}`;
}

module.exports = {
  normalizeWebsite,
  normalizePhoneNL,
  normalizeAddressNL,
  extractNlPostcode,
  NL_POSTCODE_PATTERN,
};
