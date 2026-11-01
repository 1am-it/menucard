'use strict';

// BE-71 (#176, Lead-review ronde 3) — which page of the restaurant's own site
// is the card? The url-intake's discovery stays as it is (its own bounds);
// this module only ranks the same-host links the homepage already prints, so
// the startvulling reads the card that is actually there:
//   - a sub page, including a link or button in the navigation, also one path
//     deeper than the homepage ("/nl/menukaart");
//   - a pdf with a text layer, linked from the page itself.
// Still the same bounds as besluit 021: the same host, one link step from the
// homepage, at most five candidates, and never a link that is not a menu (a
// gift card, a blog post, an event, opening hours). A card that is only an
// image, a pdf without a text layer, an external platform or JavaScript is
// still skipped — never worked around.

const { collectAnchors } = require('../../../src/lib/sameHostDiscovery');
const { normalizeHostname } = require('../../../src/lib/restaurantHostMatch');

const MAX_CANDIDATES = 5;

// One closed list of menu words, matching the words the repository already
// uses for the same purpose (src/lib/sameHostDiscovery.js) plus the words the
// Lead named for this round. Never a fuzzy match.
const MENU_WORDS = [
  'menukaart',
  'menukaarten',
  'menulijst',
  'lunchkaart',
  'dinerkaart',
  'borrelkaart',
  'afhaalkaart',
  'wijnkaart',
  'drankenkaart',
  'spijskaart',
  'spijslijst',
  'prijslijst',
  'bestellijst',
  'gerechten',
  'afhaalmenu',
  'menu',
  'kaart',
  'kaarten',
  'lunch',
  'diner',
  'borrel',
  'afhaal',
  'afhalen',
  'gerecht',
  'carte',
  'speisekarte',
  'drinks',
  'dranken',
  'takeaway',
  'take',
  'away',
];

const MENU_WORD_SET = new Set(MENU_WORDS);

// A link that is never the card, even when its own name holds a menu word.
const NON_MENU = /\b(?:cadeaukaart|cadeaubon|geschenk(?:bon)?|gift\s?card|giftcard|voucher|tegoedbon|blog|blogs|nieuws|news|artikel|articles?|events?|evenementen|agenda|openingstijden|vacatures?|jobs?|sollicit|contact|reserve(?:ren|er)?|reservation|login|inloggen|account|winkelwagen|cart|privacy|disclaimer|cookies?)\b/i;

function words(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when the text or the path holds one of the closed menu words. */
function hasMenuWord(value) {
  return words(value).some((word) => MENU_WORD_SET.has(word));
}

function isPdf(hrefPath) {
  return /\.pdf(?:$|[?#])/i.test(String(hrefPath || ''));
}

function pageKey(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}${parsed.search}`;
  } catch (error) {
    return String(url);
  }
}

function matchScore(anchor) {
  const text = String(anchor.visibleText || '').replace(/\s+/g, ' ').trim();
  const href = anchor.hrefPath || '';
  if (NON_MENU.test(text) || NON_MENU.test(href)) return 0;
  const textHit = hasMenuWord(text);
  const hrefHit = hasMenuWord(href);
  if (!textHit && !hrefHit) return 0;
  // A link whose own name says menu wins over a path that merely holds the
  // word; a pdf is a real card source, so it gets a small bonus. Ties keep
  // document order (Array.prototype.sort is stable).
  return (textHit ? 2 : 0) + (hrefHit ? 1 : 0) + (isPdf(href) ? 1 : 0);
}

/**
 * The same-host links worth fetching next, best first: at most `max`
 * candidates, never the page itself, one entry per page, never another host.
 * Returns `[{ url, matchedOn }]`.
 */
function chooseSameHostCandidates(html, baseUrl, { max = MAX_CANDIDATES } = {}) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch (error) {
    return [];
  }
  const baseHost = normalizeHostname(base.href);
  if (!baseHost) return [];
  const baseKey = pageKey(base.href);
  const seen = new Set([baseKey]);
  const scored = [];
  collectAnchors(html, base.href).forEach((anchor, index) => {
    if (normalizeHostname(anchor.url.href) !== baseHost) return;
    const key = pageKey(anchor.url.href);
    if (seen.has(key)) return;
    const score = matchScore(anchor);
    if (score === 0) return;
    seen.add(key);
    scored.push({
      index,
      score,
      candidate: {
        url: `${anchor.url.origin}${anchor.url.pathname}${anchor.url.search}`,
        matchedOn: String(anchor.visibleText || '').replace(/\s+/g, ' ').trim() || anchor.hrefPath,
      },
    });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map((entry) => entry.candidate);
}

/**
 * The same-host pdf links a page prints, in document order, without
 * duplicates: the one extra step a site may offer when its card is a pdf.
 */
function findSameHostPdfLinks(html, baseUrl) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch (error) {
    return [];
  }
  const baseHost = normalizeHostname(base.href);
  if (!baseHost) return [];
  const seen = new Set();
  const links = [];
  for (const anchor of collectAnchors(html, base.href)) {
    if (normalizeHostname(anchor.url.href) !== baseHost) continue;
    if (!isPdf(anchor.url.pathname)) continue;
    const text = String(anchor.visibleText || '').replace(/\s+/g, ' ').trim();
    if (NON_MENU.test(text) || NON_MENU.test(anchor.url.pathname)) continue;
    const url = `${anchor.url.origin}${anchor.url.pathname}`;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, matchedOn: text || anchor.url.pathname });
  }
  return links;
}

module.exports = {
  MAX_CANDIDATES,
  MENU_WORDS,
  chooseSameHostCandidates,
  findSameHostPdfLinks,
  hasMenuWord,
  matchScore,
  pageKey,
};
