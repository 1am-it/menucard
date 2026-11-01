'use strict';

/**
 * BE-72 (#178) — a working list of Breda restaurants from OpenStreetMap.
 *
 * Preparation, not publication (decision 021): this script only *reads* OSM and
 * writes two prepared artifacts (`ops/data/breda-restaurant-candidates.json`
 * and `docs/breda-candidates-report.md`). It never touches `data/`, `app/`,
 * `src/` or the database, it never fetches a restaurant website, and nothing on
 * the site reads its output.
 *
 * One request, through the existing helper: `fetchOverpassBusinesses()` in
 * `src/lib/osmOverpass.js` builds the Breda-bounded Overpass query and uses the
 * existing mirrors and identifying User-Agent. That helper deliberately reduces
 * an answer to the fields the app may keep, so it drops `phone`,
 * `opening_hours`, `brand` and `disused:*`/`was:*` — exactly the tags this
 * working list has to judge. Therefore the injected `fetchImpl` captures the
 * single JSON answer next to passing it on: one request, the same bounds, the
 * same mirrors, no second query, no new dependency.
 *
 * What it keeps per candidate: OSM type and id, name, address (`addr:*`),
 * coordinates, cuisine, website, phone, opening hours and the distance to the
 * Grote Markt. Nothing else — no e-mail, no personal data.
 *
 * Contract: issue #178 (BE-72), decision 021.
 */

const fs = require('node:fs');
const path = require('node:path');

const { fetchOverpassBusinesses } = require('../../src/lib/osmOverpass');
const {
  normalizeBusinessName,
  comparableBusinessName,
  canonicalWebsite,
  distanceMeters,
  BREDA_BOUNDS,
  OSM_ATTRIBUTION,
} = require('../../src/lib/osmSource');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_JSON = path.join(REPO_ROOT, 'ops', 'data', 'breda-restaurant-candidates.json');
const DEFAULT_REPORT = path.join(REPO_ROOT, 'docs', 'breda-candidates-report.md');
const RESTAURANTS_PATH = path.join(REPO_ROOT, 'data', 'restaurants.json');

/** The middle of the Grote Markt in Breda: the reference point of the ranking. */
const GROTE_MARKT = Object.freeze({ lat: 51.589, lon: 4.7755 });
/** Only these three amenities belong on the working list (contract outcome 1). */
const CANDIDATE_AMENITIES = Object.freeze(['restaurant', 'fast_food', 'cafe']);
/** A brand tag makes a place a chain; chains are not candidates (outcome 1). */
const CHAIN_TAGS = Object.freeze(['brand', 'brand:wikidata']);
/** Place tags that say the place is gone or was something else before. */
const GONE_TAG_PREFIXES = Object.freeze(['disused:', 'was:']);
const GONE_TAGS = Object.freeze(['disused', 'was']);
/** The two website tags the contract accepts; `url` is not one of them. */
const WEBSITE_TAGS = Object.freeze(['website', 'contact:website']);
const PHONE_TAGS = Object.freeze(['phone', 'contact:phone']);
/** The distance rings of the report (contract outcome 3). */
const DISTANCE_RINGS = Object.freeze([
  Object.freeze({ id: 'lt1km', label: '< 1 km', maxMeters: 1000 }),
  Object.freeze({ id: '1to2km', label: '1-2 km', maxMeters: 2000 }),
  Object.freeze({ id: 'gt2km', label: '> 2 km', maxMeters: null }),
]);
const UNKNOWN_RING = 'onbekend';
/**
 * The documented head start of a cuisine the existing 25 do not have, in
 * metres: such a candidate ranks up to 500 m farther away and still comes
 * first. Distance stays the main key (outcome 2).
 */
const MISSING_CUISINE_BONUS_METERS = 500;
const TOP_TABLE_SIZE = 100;
/** "© OpenStreetMap-bijdragers, ODbL" — the attribution the contract asks for. */
const OUTPUT_ATTRIBUTION = `${OSM_ATTRIBUTION}, ODbL`;


/** Dutch cuisine words as the 25 restaurants write them, mapped to the OSM word. */
const CUISINE_SYNONYMS = Object.freeze({
  frans: 'french',
  franse: 'french',
  italiaans: 'italian',
  italiaanse: 'italian',
  spaans: 'spanish',
  grieks: 'greek',
  griekse: 'greek',
  japans: 'japanese',
  chinees: 'chinese',
  indiaas: 'indian',
  indiase: 'indian',
  mexicaans: 'mexican',
  turks: 'turkish',
  thais: 'thai',
  thaise: 'thai',
  vietnamees: 'vietnamese',
  koreaans: 'korean',
  nederlands: 'dutch',
  hollands: 'dutch',
  belgisch: 'belgian',
  duits: 'german',
  europees: 'european',
  amerikaans: 'american',
  mediterraans: 'mediterranean',
  indonesisch: 'indonesian',
  moluks: 'indonesian',
  afrikaans: 'african',
  baskisch: 'basque',
  kantonees: 'cantonese',
  oosterse: 'asian',
  aziatisch: 'asian',
  vis: 'seafood',
  visgerechten: 'seafood',
  vlees: 'steak',
  vegetarisch: 'vegetarian',
  veganistisch: 'vegan',
});
/** Words that never name a cuisine (weekdays, kinds, joining words). */
const CUISINE_STOPWORDS = Object.freeze([
  'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag',
  'restaurant', 'restaurants', 'eetcafe', 'cafe', 'grand', 'brasserie', 'bistro',
  'bar', 'food', 'keuken', 'gerechten', 'and', 'the', 'of', 'de', 'het', 'een',
  'van', 'met', 'en', 'bij', 'op', 'shop', 'fast',
]);

function firstString(tags, keys) {
  for (const key of keys) {
    const value = tags && tags[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** A website only counts when it is a plain http(s) address with a real host. */
function usableWebsite(tags) {
  const raw = firstString(tags, WEBSITE_TAGS);
  return raw ? canonicalWebsite(raw) : null;
}

/** "https://www.example.nl/menu" → "example.nl": what the checks compare. */
function websiteHost(website) {
  if (typeof website !== 'string' || website.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(website.trim());
  } catch {
    return null;
  }
  const host = (parsed.hostname || '').toLowerCase().replace(/^www\./, '');
  return host.includes('.') ? host : null;
}

/** `brand` or `brand:wikidata` present → a chain, not a candidate. */
function isChain(tags) {
  return CHAIN_TAGS.some((key) => {
    const value = tags && tags[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/** A `disused:`/`was:` tag or an `opening_hours` with "closed" → not open. */
function isGone(tags) {
  const keys = Object.keys(tags || {});
  if (keys.some((key) => GONE_TAGS.includes(key) || GONE_TAG_PREFIXES.some((prefix) => key.startsWith(prefix)))) return true;
  const hours = tags && tags.opening_hours;
  return typeof hours === 'string' && /closed/i.test(hours);
}

/** Cuisine words of a free-text value, lowercased, deduplicated, synonyms applied. */
function cuisineTokensOf(value) {
  if (typeof value !== 'string' || value.trim() === '') return [];
  const tokens = [];
  for (const word of normalizeBusinessName(value).split(' ')) {
    if (word.length < 3 || CUISINE_STOPWORDS.includes(word)) continue;
    const token = CUISINE_SYNONYMS[word] || word;
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

/** The cuisine a candidate prints: "italian;pizza" → [italian, pizza]. */
function candidateCuisineTokens(cuisine) {
  return cuisineTokensOf(String(cuisine || '').replace(/[;,_/]+/g, ' '));
}

/** The cuisines the existing 25 restaurants already cover (outcome 2). */
function knownCuisineTokens(restaurants = {}) {
  const tokens = new Set();
  for (const restaurant of Object.values(restaurants || {})) {
    if (!restaurant) continue;
    const text = [restaurant.cuisine, restaurant.cuisineLabel, restaurant.cuisineKeywords]
      .filter((value) => typeof value === 'string')
      .join(' ');
    for (const token of cuisineTokensOf(text)) tokens.add(token);
  }
  return tokens;
}

/** Words that only say what kind of place it is, wherever they stand in a name. */
const KIND_WORDS = Object.freeze(['restaurant', 'eetcafe', 'cafe', 'brasserie', 'bistro', 'eethuis']);

/**
 * The name without kind words, its words sorted: "Wolfslaar Restaurant" and
 * "Restaurant Wolfslaar" both become "wolfslaar". `comparableBusinessName`
 * only drops a leading kind word, so the reversed order slipped through.
 */
function coreBusinessName(name) {
  const normalized = normalizeBusinessName(name);
  if (!normalized) return null;
  const words = normalized.split(/\s+/).filter((word) => word && !KIND_WORDS.includes(word));
  return words.length ? words.sort().join(' ') : null;
}

/** The 25 existing restaurants as data to compare against: name, host, cuisine. */
function knownBaseline(restaurants = {}) {
  const names = new Set();
  const comparableNames = new Set();
  const coreNames = new Set();
  const hosts = new Set();
  for (const restaurant of Object.values(restaurants || {})) {
    if (!restaurant) continue;
    const name = normalizeBusinessName(restaurant.name);
    if (name) names.add(name);
    const comparable = comparableBusinessName(restaurant.name);
    if (comparable) comparableNames.add(comparable);
    const core = coreBusinessName(restaurant.name);
    if (core) coreNames.add(core);
    const host = websiteHost(restaurant.website);
    if (host) hosts.add(host);
  }
  return { names, comparableNames, coreNames, hosts, cuisineTokens: knownCuisineTokens(restaurants) };
}

/** Already on the site: the same normalized name, or the same website host. */
function isKnownCandidate(candidate, baseline) {
  if (!candidate) return false;
  const name = normalizeBusinessName(candidate.name);
  const comparable = comparableBusinessName(candidate.name);
  if (name && baseline.names.has(name)) return true;
  if (comparable && baseline.comparableNames.has(comparable)) return true;
  const core = coreBusinessName(candidate.name);
  if (core && baseline.coreNames && baseline.coreNames.has(core)) return true;
  const host = websiteHost(candidate.website);
  return Boolean(host && baseline.hosts.has(host));
}

/** The report's distance ring for a candidate. */
function ringOf(distance) {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) return UNKNOWN_RING;
  for (const ring of DISTANCE_RINGS) {
    if (ring.maxMeters === null || distance < ring.maxMeters) return ring.id;
  }
  return UNKNOWN_RING;
}

/**
 * The tags of one OSM element, keyed by "node/123", "way/456". The parsed
 * helper output does not keep `phone`, `opening_hours` or a brand tag, so the
 * raw answer of the same single request is read next to it.
 */
function rawTagsByOsmId(payload) {
  const map = new Map();
  const elements = payload && Array.isArray(payload.elements) ? payload.elements : [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    if (!['node', 'way', 'relation'].includes(element.type)) continue;
    if (!Number.isInteger(element.id)) continue;
    const tags = element.tags && typeof element.tags === 'object' ? element.tags : {};
    map.set(`${element.type}/${element.id}`, tags);
  }
  return map;
}

/** One candidate record: only the fields the contract asks for. */
function candidateFromBusiness(business, tags = {}) {
  const website = usableWebsite(tags) || (business && business.website) || null;
  const cuisine = business && typeof business.cuisine === 'string' && business.cuisine.trim() !== '' ? business.cuisine.trim() : null;
  const distance = distanceMeters(GROTE_MARKT, { lat: business.lat, lon: business.lon });
  return {
    osmType: business.osmType,
    osmId: business.osmId,
    name: business.name,
    address: business.address || null,
    lat: typeof business.lat === 'number' ? business.lat : null,
    lon: typeof business.lon === 'number' ? business.lon : null,
    kind: business.kind,
    cuisine,
    cuisineTokens: candidateCuisineTokens(cuisine),
    website,
    websiteHost: websiteHost(website),
    phone: firstString(tags, PHONE_TAGS),
    openingHours: firstString(tags, ['opening_hours']),
    distanceMeters: distance,
    distanceRing: ringOf(distance),
  };
}

/**
 * The filters of outcome 1, each with its own counter so the report can say
 * honestly what was left out and why.
 */
function selectCandidates({ businesses = [], rawTags = new Map(), restaurants = {} } = {}) {
  const baseline = knownBaseline(restaurants);
  const rejected = {
    otherKind: 0,
    noWebsite: 0,
    chain: 0,
    gone: 0,
    alreadyOnSite: 0,
    duplicate: 0,
  };
  const kept = [];
  const tagsOf = rawTags instanceof Map ? (osmId) => (rawTags.has(osmId) ? rawTags.get(osmId) : null) : () => null;
  for (const business of Array.isArray(businesses) ? businesses : []) {
    if (!business || !business.osmId) continue;
    if (!CANDIDATE_AMENITIES.includes(business.kind)) {
      rejected.otherKind += 1;
      continue;
    }
    const tags = tagsOf(business.osmId) || {};
    if (isGone(tags)) {
      rejected.gone += 1;
      continue;
    }
    if (isChain(tags)) {
      rejected.chain += 1;
      continue;
    }
    const candidate = candidateFromBusiness(business, tags);
    if (!candidate.website || !candidate.websiteHost) {
      rejected.noWebsite += 1;
      continue;
    }
    if (isKnownCandidate(candidate, baseline)) {
      rejected.alreadyOnSite += 1;
      continue;
    }
    kept.push(candidate);
  }
  const deduped = dedupeCandidates(kept);
  rejected.duplicate = kept.length - deduped.length;
  return { candidates: rankCandidates(deduped, baseline), rejected, baseline };
}



/**
 * The same place is often mapped twice (a node and a way for one business):
 * one entry per comparable name + website host, or comparable name + address
 * when there is no usable host. The nearest entry wins; a tie goes to the
 * lowest OSM id, so the result never depends on the order of the answer.
 */
function dedupeCandidates(candidates = []) {
  const byKey = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate) continue;
    const name = comparableBusinessName(candidate.name) || normalizeBusinessName(candidate.name);
    const place = candidate.websiteHost || normalizeBusinessName(candidate.address);
    const key = `${name}|${place}`;
    const current = byKey.get(key);
    if (!current || isNearer(candidate, current)) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function isNearer(a, b) {
  const distanceA = typeof a.distanceMeters === 'number' ? a.distanceMeters : Number.POSITIVE_INFINITY;
  const distanceB = typeof b.distanceMeters === 'number' ? b.distanceMeters : Number.POSITIVE_INFINITY;
  if (distanceA !== distanceB) return distanceA < distanceB;
  return String(a.osmId) < String(b.osmId);
}

/**
 * The order of outcome 2: distance to the Grote Markt, with a documented head
 * start of MISSING_CUISINE_BONUS_METERS for a cuisine the 25 do not have yet.
 * A candidate without coordinates has no distance and comes last.
 */
function rankCandidates(candidates = [], baseline = { cuisineTokens: new Set() }) {
  const known = baseline && baseline.cuisineTokens instanceof Set ? baseline.cuisineTokens : new Set();
  const scored = (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const tokens = Array.isArray(candidate.cuisineTokens) ? candidate.cuisineTokens : candidateCuisineTokens(candidate.cuisine);
    const missingCuisines = tokens.filter((token) => !known.has(token));
    const cuisineIsNew = tokens.length > 0 && missingCuisines.length === tokens.length;
    const distance = typeof candidate.distanceMeters === 'number' ? candidate.distanceMeters : null;
    const rankScore = distance === null ? null : distance - (cuisineIsNew ? MISSING_CUISINE_BONUS_METERS : 0);
    return { ...candidate, cuisineTokens: tokens, missingCuisines, cuisineIsNew, rankScore };
  });
  scored.sort((a, b) => {
    const scoreA = a.rankScore === null ? Number.POSITIVE_INFINITY : a.rankScore;
    const scoreB = b.rankScore === null ? Number.POSITIVE_INFINITY : b.rankScore;
    if (scoreA !== scoreB) return scoreA < scoreB ? -1 : 1;
    const nameCompare = String(a.name).localeCompare(String(b.name), 'nl', { sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;
    return String(a.osmId).localeCompare(String(b.osmId));
  });
  return scored.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/** The aantallen the report has to show (outcome 3): per kind and per ring. */
function summarize(candidates = [], rejected = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const perKind = { restaurant: 0, fast_food: 0, cafe: 0 };
  const perRing = { lt1km: 0, '1to2km': 0, gt2km: 0, [UNKNOWN_RING]: 0 };
  const newCuisines = new Map();
  for (const candidate of list) {
    perKind[candidate.kind] = (perKind[candidate.kind] || 0) + 1;
    perRing[candidate.distanceRing] = (perRing[candidate.distanceRing] || 0) + 1;
    if (candidate.cuisineIsNew) {
      for (const token of candidate.missingCuisines || []) {
        newCuisines.set(token, (newCuisines.get(token) || 0) + 1);
      }
    }
  }
  return {
    total: list.length,
    perKind,
    perRing,
    withPhone: list.filter((candidate) => Boolean(candidate.phone)).length,
    withOpeningHours: list.filter((candidate) => Boolean(candidate.openingHours)).length,
    withCuisine: list.filter((candidate) => Boolean(candidate.cuisine)).length,
    withoutCoordinates: list.filter((candidate) => typeof candidate.distanceMeters !== 'number').length,
    missingCuisineCandidates: list.filter((candidate) => candidate.cuisineIsNew).length,
    newCuisines: [...newCuisines.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([cuisine, count]) => ({ cuisine, count })),
    rejected: { ...rejected },
  };
}

/** The committed JSON document: candidates plus provenance and counts. */
function buildOutput({ candidates = [], rejected = {}, fetchedAt = null } = {}) {
  return {
    ticket: 'BE-72 (#178)',
    fetchedAt,
    attribution: OUTPUT_ATTRIBUTION,
    source: {
      name: 'OpenStreetMap via de Overpass API',
      helper: 'src/lib/osmOverpass.js (fetchOverpassBusinesses)',
      scope: 'Breda, de bestaande grens en spiegels, één verzoek',
      bounds: { ...BREDA_BOUNDS },
      center: { ...GROTE_MARKT, name: 'Grote Markt, Breda' },
      note: 'Alleen voorbereiding; de site leest dit bestand niet en er is geen restaurantwebsite opgehaald.',
    },
    filters: {
      amenities: [...CANDIDATE_AMENITIES],
      chainTags: [...CHAIN_TAGS],
      goneTagPrefixes: [...GONE_TAG_PREFIXES],
      websiteTags: [...WEBSITE_TAGS],
      alsoDropped: 'wat al in data/restaurants.json staat (genormaliseerde naam of website-host), en dubbel gemapte plaatsen',
    },
    ranking: {
      primary: 'afstand tot de Grote Markt in meters (kort eerst)',
      missingCuisineBonusMeters: MISSING_CUISINE_BONUS_METERS,
      score: 'afstand − bonus; een keuken die de 25 nog niet hebben telt 500 m voorsprong',
      withoutCoordinates: 'onderaan, want zonder coördinaten is er geen afstand',
    },
    counts: summarize(candidates, rejected),
    candidates: candidates.map((candidate) => ({
      rank: candidate.rank,
      osmType: candidate.osmType,
      osmId: candidate.osmId,
      name: candidate.name,
      address: candidate.address,
      lat: candidate.lat,
      lon: candidate.lon,
      kind: candidate.kind,
      cuisine: candidate.cuisine,
      website: candidate.website,
      websiteHost: candidate.websiteHost,
      phone: candidate.phone,
      openingHours: candidate.openingHours,
      distanceMeters: candidate.distanceMeters,
      distanceRing: candidate.distanceRing,
      cuisineIsNew: candidate.cuisineIsNew,
      missingCuisines: candidate.missingCuisines,
      rankScore: candidate.rankScore,
    })),
  };
}


function cell(value) {
  return String(value === null || value === undefined || value === '' ? '—' : value).replace(/\|/g, '\\|');
}

function distanceLabel(distance) {
  return typeof distance === 'number' ? `${distance} m` : 'onbekend';
}

/** The committed report: counts, the ranking explained, the top 100 as a table. */
function renderReport(output) {
  const counts = output.counts || summarize(output.candidates, {});
  const candidates = Array.isArray(output.candidates) ? output.candidates : [];
  const ringLabels = new Map(DISTANCE_RINGS.map((ring) => [ring.id, ring.label]));
  const lines = [];
  lines.push('# Werklijst van Bredase restaurants uit OpenStreetMap (BE-72, #178)');
  lines.push('');
  lines.push('Voorbereiding, geen publicatie (besluit 021). Dit rapport hoort bij het script');
  lines.push('`ops/scripts/breda-candidates.js` en bij `ops/data/breda-restaurant-candidates.json`.');
  lines.push('De site leest geen van beide: `data/` en `app/` zijn niet aangeraakt en `next build`');
  lines.push('geeft dezelfde routes.');
  lines.push('');
  lines.push(`- Opgehaald: ${output.fetchedAt || 'onbekend'}`);
  lines.push('- Bron: OpenStreetMap via de Overpass API, met de bestaande Breda-grens, de bestaande');
  lines.push('  spiegels en de bestaande user-agent uit `src/lib/osmOverpass.js` — één verzoek.');
  lines.push(`- Bronvermelding: ${output.attribution}`);
  lines.push(`- Kandidaten in de lijst: ${counts.total}`);
  lines.push('');
  lines.push('## Wat er wel en niet in komt');
  lines.push('');
  lines.push(`Wel: ${CANDIDATE_AMENITIES.join(', ')}. Niet: een plaats met een`);
  lines.push(`${CHAIN_TAGS.join('- of ')}-tag (keten), zonder \`${WEBSITE_TAGS.join('` of `')}\`, met een`);
  lines.push(`${GONE_TAG_PREFIXES.join('/')}-tag of met "closed" in \`opening_hours\`, en alles wat al in`);
  lines.push('`data/restaurants.json` staat (genormaliseerde naam of website-host).');
  lines.push('');
  lines.push('| Reden om af te vallen | Aantal |');
  lines.push('| --- | ---: |');
  lines.push(`| Andere soort dan ${CANDIDATE_AMENITIES.join('/')} | ${counts.rejected.otherKind || 0} |`);
  lines.push(`| Geen bruikbare website | ${counts.rejected.noWebsite || 0} |`);
  lines.push(`| Keten (${CHAIN_TAGS.join(', ')}) | ${counts.rejected.chain || 0} |`);
  lines.push(`| Gesloten (${GONE_TAG_PREFIXES.join('/')} of "closed") | ${counts.rejected.gone || 0} |`);
  lines.push(`| Staat al op de site | ${counts.rejected.alreadyOnSite || 0} |`);
  lines.push(`| Dubbel gemapt (zelfde naam en host) | ${counts.rejected.duplicate || 0} |`);
  lines.push('');
  lines.push('## Aantallen per soort');
  lines.push('');
  lines.push('| Soort | Aantal |');
  lines.push('| --- | ---: |');
  for (const kind of CANDIDATE_AMENITIES) lines.push(`| ${kind} | ${counts.perKind[kind] || 0} |`);
  lines.push(`| **Totaal** | **${counts.total}** |`);
  lines.push('');
  lines.push('## Aantallen per afstandsring tot de Grote Markt');
  lines.push('');
  lines.push('| Ring | Aantal |');
  lines.push('| --- | ---: |');
  for (const ring of DISTANCE_RINGS) lines.push(`| ${ring.label} | ${counts.perRing[ring.id] || 0} |`);
  if (counts.perRing[UNKNOWN_RING]) lines.push(`| ${UNKNOWN_RING} (geen coördinaten) | ${counts.perRing[UNKNOWN_RING]} |`);
  lines.push('');
  lines.push('## De rangorde');
  lines.push('');
  lines.push(`De score is \`afstand − bonus\`, met een bonus van ${MISSING_CUISINE_BONUS_METERS} m voor een`);
  lines.push('keuken die in de 25 nog ontbreekt. De afstand tot de Grote Markt blijft dus de hoofdregel:');
  lines.push(`een ontbrekende keuken komt hooguit ${MISSING_CUISINE_BONUS_METERS} m verder weg toch eerder.`);
  lines.push('"Ontbreekt" betekent: geen woord van de `cuisine`-tag komt voor in `cuisine`, `cuisineLabel`');
  lines.push('of `cuisineKeywords` van de 25 (Nederlandse keukenwoorden eerst naar het OSM-woord vertaald).');
  lines.push('Een kandidaat zonder `cuisine`-tag krijgt geen bonus en geen oordeel.');
  lines.push('');
  lines.push(`## De top ${Math.min(TOP_TABLE_SIZE, candidates.length)}`);
  lines.push('');
  lines.push('| # | Naam | Keuken | Afstand | Website-host |');
  lines.push('| ---: | --- | --- | ---: | --- |');
  for (const candidate of candidates.slice(0, TOP_TABLE_SIZE)) {
    lines.push(`| ${candidate.rank} | ${cell(candidate.name)} | ${cell(candidate.cuisine)} | ${distanceLabel(candidate.distanceMeters)} | ${cell(candidate.websiteHost)} |`);
  }
  lines.push('');
  lines.push('## Ontbrekende keukens die de lijst toevoegt');
  lines.push('');
  if (counts.newCuisines.length === 0) {
    lines.push('Geen: elke keuken in de lijst komt al bij de 25 voor.');
  } else {
    lines.push('| Keuken | Kandidaten |');
    lines.push('| --- | ---: |');
    for (const entry of counts.newCuisines) lines.push(`| ${cell(entry.cuisine)} | ${entry.count} |`);
    lines.push('');
    lines.push(`In totaal ${counts.missingCuisineCandidates} kandidaten met een keuken die de 25 niet hebben.`);
  }
  lines.push('');
  lines.push('## Wat dit rapport niet doet');
  lines.push('');
  lines.push('- Geen restaurantwebsite opgehaald; dat is een latere stap.');
  lines.push('- Geen database, geen Supabase, geen migratie en geen nieuwe dependency.');
  lines.push('- `data/menus.json`, `data/restaurants.json` en `ops/scripts/menu-bootstrap/` zijn niet aangeraakt.');
  lines.push(`- Per kandidaat staan telefoon (${counts.withPhone}), openingstijden (${counts.withOpeningHours}) en`);
  lines.push(`  keuken (${counts.withCuisine}) alleen zoals OpenStreetMap ze heeft; ontbreekt een veld, dan is het leeg.`);
  lines.push('');
  return lines.join('\n');
}


/**
 * One request through the existing helper, with the raw answer kept aside: the
 * helper still decides the query, the bounds, the mirrors and the User-Agent,
 * and it still returns `{ ok: false, reason: 'osm_unreachable' }` on failure.
 */
async function fetchWithRawTags({ fetchImpl = fetch } = {}) {
  let payload = null;
  const capturingFetch = async (url, init) => {
    const response = await fetchImpl(url, init);
    if (!response || response.ok !== true || typeof response.json !== 'function') return response;
    const body = await response.json();
    payload = body;
    return { ok: true, json: async () => body };
  };
  const result = await fetchOverpassBusinesses({ fetchImpl: capturingFetch });
  return { ...result, payload };
}

/** Fetch, filter, rank and build the output document. No files are written here. */
async function collectCandidates({ restaurants = {}, fetchImpl, now } = {}) {
  const result = await fetchWithRawTags({ fetchImpl });
  if (!result.ok) return { ok: false, reason: result.reason };
  const selection = selectCandidates({
    businesses: result.businesses,
    rawTags: rawTagsByOsmId(result.payload),
    restaurants,
  });
  return {
    ok: true,
    businesses: result.businesses.length,
    output: buildOutput({ candidates: selection.candidates, rejected: selection.rejected, fetchedAt: result.fetchedAt }),
  };
}

function flagValue(argv, name) {
  const hit = (Array.isArray(argv) ? argv : []).find((argument) => argument.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents.endsWith('\n') ? contents : `${contents}\n`, 'utf8');
}

/**
 * The real run: one Overpass request, then the two committed artifacts. On an
 * unreachable Overpass nothing is written and the exit code says so.
 */
async function main(argv = process.argv.slice(2)) {
  const jsonPath = flagValue(argv, '--json') || DEFAULT_OUTPUT_JSON;
  const reportPath = flagValue(argv, '--report') || DEFAULT_REPORT;
  const restaurants = JSON.parse(fs.readFileSync(RESTAURANTS_PATH, 'utf8'));
  const result = await collectCandidates({ restaurants });
  if (!result.ok) {
    console.error(`Overpass niet bereikbaar (${result.reason}); niets geschreven.`);
    return 1;
  }
  writeFile(jsonPath, JSON.stringify(result.output, null, 2));
  writeFile(reportPath, renderReport(result.output));
  const counts = result.output.counts;
  console.log(`${result.businesses} bedrijven opgehaald, ${counts.total} kandidaten na filters en ontdubbeling.`);
  console.log(`Soorten: ${CANDIDATE_AMENITIES.map((kind) => `${kind} ${counts.perKind[kind] || 0}`).join(', ')}.`);
  console.log(`Ringen: ${DISTANCE_RINGS.map((ring) => `${ring.label} ${counts.perRing[ring.id] || 0}`).join(', ')}.`);
  console.log(`Ontbrekende keukens: ${counts.newCuisines.map((entry) => `${entry.cuisine} ${entry.count}`).join(', ') || 'geen'}.`);
  console.log(`Geschreven: ${path.relative(REPO_ROOT, jsonPath)} en ${path.relative(REPO_ROOT, reportPath)}.`);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    });
}

module.exports = {
  GROTE_MARKT,
  CANDIDATE_AMENITIES,
  CHAIN_TAGS,
  WEBSITE_TAGS,
  DISTANCE_RINGS,
  UNKNOWN_RING,
  MISSING_CUISINE_BONUS_METERS,
  TOP_TABLE_SIZE,
  OUTPUT_ATTRIBUTION,
  DEFAULT_OUTPUT_JSON,
  DEFAULT_REPORT,
  websiteHost,
  coreBusinessName,
  usableWebsite,
  isChain,
  isGone,
  cuisineTokensOf,
  candidateCuisineTokens,
  knownCuisineTokens,
  knownBaseline,
  isKnownCandidate,
  ringOf,
  rawTagsByOsmId,
  candidateFromBusiness,
  selectCandidates,
  dedupeCandidates,
  rankCandidates,
  summarize,
  buildOutput,
  renderReport,
  fetchWithRawTags,
  collectCandidates,
  main,
};

