'use strict';

// BE-32 (#75) — the pure decisions behind "Vind bronnen" and "Zoek de bron voor
// mij". Deliberately CommonJS, like sourceReview.js/sourceTriage.js: directly
// testable with `node --test`, usable by the 'use client' pages, no dependency.
//
// This module never fetches, never calls AI and never writes. It answers four
// questions, all provable in a test:
//  1. which layers may run, in which order (criterion 1);
//  2. which platform domains are never accepted as a restaurant's own source
//     (delivery and booking platforms, always rejected — a fixed, tested list);
//  3. whether an AI answer is allowed to become a proposal (a same-host page
//     plus a verbatim quote that really occurs in that page, checked with the
//     existing normalizeEvidenceText rule);
//  4. how the provenance is written into, and read back from, the existing
//     BE-24 proposal note field (280 characters, no migration).
//
// Contract: planning/specs/tickets/be-32-source-discovery-osm-ai.md,
// decision 017. Quote check: src/lib/menuExtractionSchema.js's
// quoteIsPresentInSource (which is normalizeEvidenceText).

const { quoteIsPresentInSource, normalizeEvidenceText } = require('./menuExtractionSchema');
const { osmStorageKey, osmObjectUrl } = require('./osmSource');

/** The four layers, in the fixed order of criterion 1. */
const LAYERS = Object.freeze({
  osm: Object.freeze({ key: 'osm', emoji: '🗺️', label: 'OpenStreetMap' }),
  same_host: Object.freeze({ key: 'same_host', emoji: '🌐', label: 'Eigen website' }),
  ai_choice: Object.freeze({ key: 'ai_choice', emoji: '🤖', label: 'AI koos de menupagina' }),
  ai_search: Object.freeze({ key: 'ai_search', emoji: '🤖', label: 'AI-zoeken' }),
});

const LAYER_ORDER = Object.freeze(['osm', 'same_host', 'ai_choice', 'ai_search']);

/**
 * Which layers a run may use: OSM and the same-host search always, the AI
 * choice only when there is a website to choose from, and AI web search only
 * when no website is known at all (criterion 1: "alleen als er geen website
 * bekend is").
 */
function planLayers({ hasWebsite = false } = {}) {
  return hasWebsite ? ['osm', 'same_host', 'ai_choice'] : ['osm', 'same_host', 'ai_choice', 'ai_search'];
}

/**
 * Delivery and booking platforms are never a restaurant's own source. A fixed
 * list, matched on the host itself or a subdomain of it — never a fuzzy match,
 * and never extended at runtime by an answer from the internet.
 */
const BLOCKED_PLATFORM_HOSTS = Object.freeze([
  'thuisbezorgd.nl',
  'takeaway.com',
  'just-eat.nl',
  'just-eat.com',
  'ubereats.com',
  'uber.com',
  'deliveroo.nl',
  'deliveroo.com',
  'bezorgd.nl',
  'etenbestellen.nl',
  'thefork.nl',
  'thefork.com',
  'resengo.nl',
  'resengo.com',
  'formitable.com',
  'quandoo.nl',
  'quandoo.com',
  'opentable.nl',
  'opentable.com',
  'google.com',
  'goo.gl',
  'tripadvisor.nl',
  'tripadvisor.com',
  'yelp.nl',
  'yelp.com',
  'restaurantguru.com',
  'facebook.com',
  'instagram.com',
]);

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedPlatformUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  return BLOCKED_PLATFORM_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The first URL that is not a platform, or null when every one is. */
function firstAllowedUrl(urls) {
  for (const url of Array.isArray(urls) ? urls : []) {
    if (typeof url !== 'string' || url.trim() === '') continue;
    if (isBlockedPlatformUrl(url)) continue;
    return url.trim();
  }
  return null;
}

/** "Alleen bezorgplatforms gevonden (genegeerd)" — the honest empty answer. */
const ONLY_PLATFORMS_MESSAGE = 'Alleen bezorgplatforms gevonden (genegeerd)';

/** Same host, ignoring a leading www. and a trailing slash. */
function sameSite(a, b) {
  const hostA = hostOf(a);
  const hostB = hostOf(b);
  return Boolean(hostA && hostB && hostA === hostB);
}

/** Menu-ish paths first, then the document order the existing search gave. */
const MENU_PATH_HINT = /(?:^|\/)(?:menukaart|menu|menus|kaart|kaarten|gerechten|spijskaart|lunch|diner|carte)(?:\/|$|[-_.])/i;

function pathOf(url) {
  try {
    return new URL(url, 'https://example.invalid').pathname;
  } catch {
    return '';
  }
}

function rankMenuCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && typeof c.url === 'string') : [];
  return list
    .map((candidate, index) => ({ candidate, index, rank: MENU_PATH_HINT.test(pathOf(candidate.url)) ? 0 : 1 }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((entry) => entry.candidate);
}

/** The one menu link the free layer proposes, or null when no link looks like a menu. */
function looksLikeMenu(candidate) {
  if (!candidate) return false;
  return MENU_PATH_HINT.test(pathOf(candidate.url)) || MENU_PATH_HINT.test(String(candidate.matchedOn || ''));
}

function chooseMenuCandidate(candidates) {
  return rankMenuCandidates(candidates).find(looksLikeMenu) || null;
}

const MIN_QUOTE = 8;
const MAX_QUOTE = 300;

/**
 * The AI choice: a page of the SAME host, with a quote that literally occurs in
 * that page's own text. Anything else is rejected — the answer never widens the
 * candidate set from the existing same-host search (criterion 1, layer 3).
 */
function validateChoiceAnswer(answer, { website, candidates = [], pageTexts = {} } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const url = answer && typeof answer.url === 'string' ? answer.url.trim() : '';
  if (!url) return { ok: false, reason: 'url_missing' };
  if (!sameSite(website, url)) return { ok: false, reason: 'not_same_host' };
  const known = list.some((candidate) => candidate.url === url || normalizeEvidenceText(candidate.url) === normalizeEvidenceText(url));
  if (!known) return { ok: false, reason: 'not_a_candidate' };
  if (isBlockedPlatformUrl(url)) return { ok: false, reason: 'platform' };
  const quote = answer && typeof answer.quote === 'string' ? answer.quote.replace(/\s+/g, ' ').trim() : '';
  if (quote.length < MIN_QUOTE || quote.length > MAX_QUOTE) return { ok: false, reason: 'quote_missing' };
  const sourceText = pageTexts[url];
  if (typeof sourceText !== 'string' || !quoteIsPresentInSource(quote, sourceText)) {
    return { ok: false, reason: 'quote_not_in_source' };
  }
  return { ok: true, value: { url, quote } };
}

/**
 * The AI web search: only when no website is known. Every result needs a
 * source-bound URL; a delivery or booking platform is dropped, never proposed.
 * The first usable result wins.
 */
function validateSearchAnswer(answer, { name } = {}) {
  const results = answer && Array.isArray(answer.results) ? answer.results : [];
  const rejected = [];
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const url = typeof result.url === 'string' ? result.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) {
      rejected.push({ url, reason: 'url_missing' });
      continue;
    }
    if (isBlockedPlatformUrl(url)) {
      rejected.push({ url, reason: 'platform' });
      continue;
    }
    const sourceUrl = typeof result.source === 'string' ? result.source.trim() : '';
    if (sourceUrl && isBlockedPlatformUrl(sourceUrl)) {
      rejected.push({ url, reason: 'platform_source' });
      continue;
    }
    const quote = typeof result.quote === 'string' ? result.quote.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE) : '';
    return {
      ok: true,
      value: {
        url,
        title: typeof result.title === 'string' ? result.title.trim().slice(0, 160) : null,
        source: sourceUrl || url,
        quote: quote.length >= MIN_QUOTE ? quote : null,
        name: typeof name === 'string' ? name : null,
      },
      rejected,
    };
  }
  return { ok: false, reason: rejected.length > 0 ? 'only_rejected' : 'no_results', rejected };
}

// ── Provenance ("herkomst") in the existing proposal note ───────────────────
// One open proposal per restaurant, 280 characters: the note field is the
// existing place for evidence/provenance (Lead review #6440199614). The URL
// itself is the proposal's proposed_url; everything else is written here and
// read back with parseProposalNote, so a row can show where it came from.

const NOTE_MAX = 280;

const ORIGIN_LABELS = Object.freeze({
  osm: 'OpenStreetMap (© OpenStreetMap-bijdragers)',
  same_host: 'eigen website',
  ai_choice: 'AI koos de menupagina',
  ai_search: 'AI-zoeken',
});

/** The visible origin, exactly as the mockup writes it. */
function originLabel(origin, { quote = null, source = null } = {}) {
  if (!LAYERS[origin]) return '';
  if (origin === 'ai_choice') return `🤖 AI koos de menupagina${quote ? ` (citaat: “${quote}”)` : ''}`;
  if (origin === 'ai_search') return `🤖 AI-zoeken${source ? ` · bron: ${source}` : ''}`;
  if (origin === 'same_host') return '🌐 eigen website';
  return '🗺️ OpenStreetMap';
}

/**
 * The whole provenance of one proposal, in the order the layers ran — exactly
 * the mockup's "🗺️ OpenStreetMap → 🌐 menulink op eigen website" or
 * "🗺️ OpenStreetMap → 🤖 AI koos de menupagina (citaat: “…”)". Never a layer
 * that was not actually used.
 */
function originChainLabel(chain, { quote = null, source = null } = {}) {
  const keys = (Array.isArray(chain) ? chain : []).filter((key) => LAYERS[key]);
  if (keys.length === 0) return '';
  const parts = keys.map((key) => {
    if (key === 'osm') return '🗺️ OpenStreetMap';
    if (key === 'ai_search') return originLabel('ai_search', { source });
    if (key === 'same_host') return '🌐 menulink op eigen website';
    return originLabel('ai_choice', { quote });
  });
  return parts.join(' → ');
}

/**
 * The proposal note: provenance first, then the website, the menu link, the
 * quote, the search source and the AI cost, each only when it exists. The note
 * never exceeds 280 characters; a part that does not fit is shortened, the
 * origin never is.
 */
function proposalNote({ origin, website = null, menu = null, quote = null, source = null, costEurCents = null } = {}) {
  const parts = [`Herkomst: ${ORIGIN_LABELS[origin] || 'onbekend'}`];
  if (website) parts.push(`website: ${website}`);
  if (menu && menu !== website) parts.push(`menulink: ${menu}`);
  if (quote) parts.push(`citaat: “${quote}”`);
  if (source) parts.push(`bron: ${source}`);
  if (Number.isInteger(costEurCents) && costEurCents >= 0) parts.push(`kosten: ${costEurCents} cent`);
  let note = parts[0];
  for (const part of parts.slice(1)) {
    const candidate = `${note} · ${part}`;
    if (candidate.length <= NOTE_MAX) {
      note = candidate;
      continue;
    }
    const room = NOTE_MAX - note.length - 3;
    if (room > 12) note = `${note} · ${part.slice(0, room - 1)}…`;
  }
  return note.slice(0, NOTE_MAX);
}

/** Reads a proposal note back: the origin key, the website, the menu link, … */
function parseProposalNote(note) {
  const text = typeof note === 'string' ? note : '';
  const result = { origin: null, website: null, menu: null, quote: null, source: null, costEurCents: null, text };
  const parts = text.split(' · ');
  for (const part of parts) {
    const at = part.indexOf(': ');
    const key = at > 0 ? part.slice(0, at).trim().toLowerCase() : '';
    const value = at > 0 ? part.slice(at + 2).trim() : part.trim();
    if (key === 'herkomst') {
      const label = value.toLowerCase().replace(/…$/, '');
      result.origin = Object.keys(ORIGIN_LABELS).find((origin) => ORIGIN_LABELS[origin].toLowerCase().startsWith(label)) || null;
    } else if (key === 'website') result.website = value;
    else if (key === 'menulink') result.menu = value;
    else if (key === 'citaat') result.quote = value.replace(/^“|”$/g, '');
    else if (key === 'bron') result.source = value;
    else if (key === 'kosten') {
      const match = value.match(/(\d+)/);
      result.costEurCents = match ? Number(match[1]) : null;
    }
  }
  return result;
}

// ── What the screens show ──────────────────────────────────────────────────

const DISCOVERY_MESSAGES = Object.freeze({
  osm_unreachable: 'OpenStreetMap is nu niet bereikbaar. De andere lagen werken gewoon door.',
  ai_disabled: 'De AI staat uit; de gratis lagen hebben wel gedraaid.',
  ai_key_missing: 'De AI-sleutel ontbreekt; de gratis lagen hebben wel gedraaid.',
  ai_flagged_off: 'De AI staat uit; de gratis lagen hebben wel gedraaid.',
  budget_exhausted: 'Het maandbudget is op; de gratis lagen hebben wel gedraaid.',
  budget_unavailable: 'De maandkosten konden niet worden gelezen; de AI is overgeslagen.',
  ai_failed: 'De AI gaf geen bruikbaar antwoord; er is niets voorgesteld.',
  only_platforms: ONLY_PLATFORMS_MESSAGE,
  not_found: 'Geen website gevonden.',
});

/** The one result row for "Zoek de bron voor mij" (SourceResultRow shape). */
function discoveryRow(result) {
  const value = result && typeof result === 'object' ? result : {};
  const found = Boolean(value.website || value.menu);
  return {
    key: `discovery-${value.restaurantId || ''}`,
    state: found ? 'certain' : 'no_menu',
    emoji: '🔎',
    restaurant: { name: value.name || '' },
    url: value.website ? value.website.url : null,
    foundUrl: value.menu ? value.menu.url : null,
    label: found ? '✅ Voorstel klaar' : '— Geen bron gevonden',
    detail: found
      ? value.originLabel || (value.origin ? originLabel(value.origin, { quote: value.quote, source: value.source }) : null)
      : value.message || DISCOVERY_MESSAGES.not_found,
    step: value.proposal ? { key: 'confirm', label: '✅ Bevestig voorstel' } : { key: 'wait', label: 'Geen voorstel' },
  };
}

/**
 * The line under "Vind bronnen": what was proposed, by which layer, and that
 * every one of them is a proposal. Every number comes from the actual run.
 */
function discoverySummary({ results = [], costEurCents = null } = {}) {
  const list = Array.isArray(results) ? results.filter(Boolean) : [];
  const found = list.filter((result) => result.website || result.menu);
  const counts = { osm: 0, same_host: 0, ai_choice: 0, ai_search: 0 };
  for (const result of found) if (Object.prototype.hasOwnProperty.call(counts, result.origin)) counts[result.origin] += 1;
  const notFound = list.length - found.length;
  const parts = [
    `🗺️ ${counts.osm} OpenStreetMap`,
    `🌐 ${counts.same_host} eigen website`,
    `🤖 ${counts.ai_choice} AI-keuze`,
    `🤖 ${counts.ai_search} AI-zoeken`,
  ];
  const what = found.length === 1 ? 'website' : 'websites';
  const head = `✨ Vind bronnen klaar: ${found.length} ${what} voorgesteld (${parts.join(' · ')}) · ${notFound} niet gevonden. Alles is een voorstel: je bevestigt per rij.`;
  const cost = Number.isInteger(costEurCents) ? ` Kosten AI: ${costEurCents} cent.` : '';
  return `${head}${cost}`;
}

/** "Kosten AI: 6 cent van je maandbudget (€ 9,62 over van € 10)." */
function costLine({ costEurCents = null, monthly = null } = {}) {
  if (!Number.isInteger(costEurCents) || costEurCents < 0) {
    return 'Kosten AI: niets gemeten voor deze zoekactie.';
  }
  const remaining =
    monthly && Number.isInteger(monthly.remainingEurCents) && Number.isInteger(monthly.limitEurCents)
      ? ` (€ ${(monthly.remainingEurCents / 100).toFixed(2).replace('.', ',')} over van € ${(monthly.limitEurCents / 100).toFixed(0)})`
      : '';
  return `Kosten AI: ${costEurCents} cent van je maandbudget${remaining}.`;
}

/**
 * "Negeren" of an OSM place that is not ours, without a migration: a BE-24
 * proposal of kind `mark_unusable` on the OSM object's own key. The triage view
 * ignores a proposal whose restaurant id is not in data/restaurants.json
 * (buildTriageView counts it as an orphan), so a remembered ignore never
 * becomes work on another screen — while the record itself is durable.
 */
function ignoreProposalInput(business) {
  const restaurantId = osmStorageKey(business && business.osmId);
  const currentUrl = osmObjectUrl(business && business.osmId);
  if (!restaurantId || !currentUrl) return null;
  const name = business && typeof business.name === 'string' ? `: ${business.name}` : '';
  return {
    restaurant_id: restaurantId,
    kind: 'mark_unusable',
    current_url: currentUrl,
    unusable_reason: 'other_business',
    note: `Negeren in Nieuw gevonden${name} — geen restaurant voor ons.`.slice(0, NOTE_MAX),
  };
}

module.exports = {
  LAYERS,
  LAYER_ORDER,
  planLayers,
  BLOCKED_PLATFORM_HOSTS,
  ONLY_PLATFORMS_MESSAGE,
  MIN_QUOTE,
  MAX_QUOTE,
  MENU_PATH_HINT,
  hostOf,
  isBlockedPlatformUrl,
  firstAllowedUrl,
  sameSite,
  rankMenuCandidates,
  looksLikeMenu,
  chooseMenuCandidate,
  validateChoiceAnswer,
  validateSearchAnswer,
  NOTE_MAX,
  ORIGIN_LABELS,
  DISCOVERY_MESSAGES,
  originLabel,
  originChainLabel,
  proposalNote,
  parseProposalNote,
  discoveryRow,
  discoverySummary,
  costLine,
  ignoreProposalInput,
};
