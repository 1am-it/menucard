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
  'dranken',
  'drinks',
  'carte',
  'speisekarte',
  // #59 Delivery Lead review 6316295818: generic menu-page words a live
  // source used for its real menu (`/gerechten`, an `afhaalmenu` link, a
  // `takeaway` page). Still a closed list of menu words, never a domain list.
  'gerechten',
  'afhaalmenu',
  'takeaway',
  'spijskaart',
];

// A gift card or voucher is not a menu even though its name contains
// "kaart"/"card". Excluded before the keyword match so a real menu link
// behind it keeps its place in the bounded candidate budget. A blog/news/
// event/opening-hours path is an article about the restaurant, never the
// menu page itself (the live Klein Java source linked a "kerstmenu" blog post
// that consumed the only candidate slot).
const NON_MENU_LINK_PATTERN = /\b(?:cadeaukaart|cadeaubon|geschenk(?:bon)?|gift\s?card|giftcard|voucher|tegoedbon)\b|(?:^|\/)(?:blog|blogs|nieuws|news|artikel|articles?|events?|evenementen|agenda|openingstijden)(?:\/|$)/i


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
  if (haystacks.some((h) => NON_MENU_LINK_PATTERN.test(h))) return false;
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
/**
 * The same-host child pages directly below `baseUrl` (`/gerechten` ->
 * `/gerechten/basisgerechten`, ...). A menu hub often shows only category
 * labels, none of which contains a menu keyword; the hub itself is never a
 * menu, but its own children are the real menu pages. Label-like links only
 * (one extra path segment, short text, no ordinary navigation label), in
 * document order, at most MAX_CANDIDATES, never another host.
 */
const SUB_PAGE_LABEL_EXCLUDE = /^(?:home|start|over(?:\s+ons)?|about|contact|reserveren|reserveer|reserve|bestellen|bestel|order|cart|winkelwagen|login|inloggen|account|privacy|disclaimer|cookies?|vacatures?|jobs?|gallery|galerij|foto'?s?|impressie|blog|nieuws|news|events?|agenda|catering|verhuur|bekijk|lees\s+meer|more|terug|back)$/i

function findSameHostSubPageLinks(html, baseUrl) {
  let base
  try {
    base = new URL(baseUrl)
  } catch (err) {
    return []
  }
  const baseHost = normalizeHostname(base.href)
  if (!baseHost) return []
  const basePath = base.pathname.replace(/\/+$/, '') || '/'
  const seen = new Set()
  const links = []
  for (const anchor of collectAnchors(html, baseUrl)) {
    if (links.length >= MAX_CANDIDATES) break
    if (normalizeHostname(anchor.url.href) !== baseHost) continue
    const path = anchor.url.pathname.replace(/\/+$/, '') || '/'
    if (path === basePath) continue
    const prefix = basePath === '/' ? '/' : `${basePath}/`
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    if (!rest || rest.includes('/')) continue
    const text = (anchor.visibleText || '').trim()
    if (!text || text.length > 40) continue
    const words = text.split(/\s+/).filter(Boolean)
    if (words.length === 0 || words.length > 4) continue
    if (SUB_PAGE_LABEL_EXCLUDE.test(text)) continue
    if (seen.has(path)) continue
    seen.add(path)
    links.push({ url: `${anchor.url.origin}${path}`, matchedOn: text })
  }
  return links
}

/**
 * One page, regardless of a `www.` prefix or a trailing slash. `/menukaart`
 * and `https://www.example.nl/menukaart/` are the same page; a live source
 * linked both and the second pass duplicated every dish (#59 review
 * 6316295818, Andalous).
 */
function sameHostPageKey(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch (err) {
    return String(url);
  }
}

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

    // De-duplicate on the same host without `www.` and without a trailing
    // slash: `/menukaart` and `https://www.…/menukaart/` are one page, and
    // fetching both produced two identical menus for a live source (#59
    // review 6316295818, Andalous).
    const seenKey = `${candidateHost}${anchor.url.pathname.replace(/\/+$/, '') || '/'}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);

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
  findSameHostSubPageLinks,
  sameHostPageKey,
};
