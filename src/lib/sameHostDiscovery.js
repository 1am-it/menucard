// BE-20 — bounded same-host source discovery. Pure logic only: given a
// homepage's already-fetched HTML and its own canonical URL, proposes a
// small, fixed-size set of same-host candidate URLs worth fetching next
// (e.g. a linked menu page) — never fetches anything itself.
//
// Implements exactly the bound `be-20-general-restaurant-source-extraction.md`'s
// own "Vaststaande productkeuzes" §6 and the matching, explicitly dated
// amendment to `docs/api/url-intake-schema.md`'s "Governance exception"
// require: at most one extra link hop beyond the already-fetched
// homepage, a small, fixed-size candidate set, same-host only — never a
// cross-host candidate, never a second hop from a discovered page (this
// module has no way to recurse into a candidate's own links at all, by
// construction: it only ever reads the ONE HTML string it is given).
//
// The caller (a future route) is responsible for actually fetching each
// candidate via the existing, unchanged `src/lib/safeOutboundFetch.js`
// and for the existing `classifyRobotsGate` check per candidate — this
// module never fetches, never checks robots.txt itself, and never
// decides safety; it only proposes.
//
// Deliberately CommonJS, same reasoning as `restaurantHostMatch.js`/
// `candidateSuggestions.js`/`menuJsonLdExtraction.js`.

'use strict';

const { normalizeHostname } = require('./restaurantHostMatch');

/** Fixed, small upper bound on how many same-host candidates a single
 * analysis may ever propose — a technical limit, never a business count
 * dressed up as one (matches this project's own existing convention,
 * e.g. `safeOutboundFetch.js`'s `maxBytes`/`timeoutMs`). */
const MAX_CANDIDATES = 5;

/** Keywords (already lowercase) this pilot recognizes in an anchor's
 * visible text or href path as plausibly pointing at a menu/kaart page —
 * a fixed, closed list, never a fuzzy/similarity match. Deliberately
 * narrow and Dutch/English-focused, matching this project's own Breda-
 * first scope; a source in a language outside this list simply yields no
 * keyword-matched candidate, which is honestly reported as "nothing
 * discovered," never guessed at. */
const MENU_KEYWORDS = [
  'menu',
  'kaart',
  'menukaart',
  'kaarten',
  'lunch',
  'diner',
  'dinerkaart',
  'lunchkaart',
  'borrelkaart',
  'carte',
  'speisekarte',
];

const ANCHOR_PATTERN = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `true` when either the anchor's own visible text or its href path
 * contains one of `MENU_KEYWORDS` — case-insensitive, substring match
 * only (never fuzzy). A `null`/empty href or text is never matched. */
function anchorLooksLikeMenuLink(hrefPath, visibleText) {
  const haystacks = [
    typeof hrefPath === 'string' ? hrefPath.toLowerCase() : '',
    typeof visibleText === 'string' ? visibleText.toLowerCase() : '',
  ];
  return MENU_KEYWORDS.some((keyword) => haystacks.some((h) => h.includes(keyword)));
}

/**
 * Every `<a href>` found directly in `html`, resolved against `baseUrl`
 * (the homepage's own final URL, after redirects) into an absolute URL —
 * an unresolvable/malformed href is simply skipped, never guessed at.
 * Returns `[{ url: URL, hrefPath, visibleText }]`, one entry per anchor,
 * duplicates included (deduplication happens later, in
 * `findSameHostMenuCandidates`).
 */
function collectAnchors(html, baseUrl) {
  if (typeof html !== 'string' || html.length === 0) return [];
  let base;
  try {
    base = new URL(baseUrl);
  } catch (err) {
    return [];
  }
  const anchors = [];
  for (const match of html.matchAll(ANCHOR_PATTERN)) {
    const rawHref = match[1];
    let resolved;
    try {
      resolved = new URL(rawHref, base);
    } catch (err) {
      continue;
    }
    anchors.push({
      url: resolved,
      hrefPath: resolved.pathname,
      visibleText: stripTags(match[2] || ''),
    });
  }
  return anchors;
}

/**
 * The one entry point. Given the already-fetched homepage `html` and its
 * own final URL `baseUrl` (after redirects — the same value
 * `safeOutboundFetch.js`'s own `finalUrl` already returns), proposes at
 * most `MAX_CANDIDATES` same-host, menu-keyword-matched candidate URLs to
 * fetch next. Returns `[]` when nothing reliable was found — never a
 * guessed or partial candidate.
 *
 * Ordering: document order (first-seen anchor wins over a later duplicate
 * of the same URL) — deterministic, never re-ranked by "confidence" or
 * any other guess.
 *
 * Never returns a cross-host URL, never a URL identical to `baseUrl`
 * itself (that page is already being read), and never more than one
 * entry for the same resolved URL.
 */
function findSameHostMenuCandidates(html, baseUrl) {
  const anchors = collectAnchors(html, baseUrl);
  if (anchors.length === 0) return [];

  let base;
  try {
    base = new URL(baseUrl);
  } catch (err) {
    return [];
  }
  const baseHost = normalizeHostname(base.href);
  if (!baseHost) return [];

  const seen = new Set();
  const candidates = [];

  for (const anchor of anchors) {
    if (candidates.length >= MAX_CANDIDATES) break;

    const candidateHost = normalizeHostname(anchor.url.href);
    if (!candidateHost || candidateHost !== baseHost) continue; // cross-host — never a candidate

    // Never propose the homepage itself as its own "discovered" candidate.
    const normalizedCandidateUrl = `${anchor.url.origin}${anchor.url.pathname}`;
    const normalizedBaseUrl = `${base.origin}${base.pathname}`;
    if (normalizedCandidateUrl === normalizedBaseUrl) continue;

    if (!anchorLooksLikeMenuLink(anchor.hrefPath, anchor.visibleText)) continue;

    if (seen.has(normalizedCandidateUrl)) continue; // de-duplicate same-URL anchors
    seen.add(normalizedCandidateUrl);

    candidates.push({
      url: normalizedCandidateUrl,
      matchedOn: anchor.visibleText || anchor.hrefPath,
    });
  }

  return candidates;
}

module.exports = {
  MAX_CANDIDATES,
  MENU_KEYWORDS,
  anchorLooksLikeMenuLink,
  collectAnchors,
  findSameHostMenuCandidates,
};
