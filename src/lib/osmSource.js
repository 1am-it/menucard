'use strict';

// BE-32 (#75) — OpenStreetMap as the first layer of "Vind bronnen".
//
// Pure, deliberate CommonJS: directly testable with the project's existing
// `node --test`, no new dependency, and usable by the server route and the page.
// This module never fetches anything (see src/lib/osmOverpass.js for the one,
// cached, server-side request) and never writes.
//
// What it keeps from OpenStreetMap is exactly the business information the
// contract allows — name, address, website and the kind of business — plus the
// OSM object id, so a proposal can name its provenance. Phone numbers, e-mail
// addresses, opening hours and every other tag are dropped on purpose: no
// personal data is stored (criterion 5, decision 017 §4).
//
// Linking a restaurant to an OSM business is name plus postcode (or distance
// when coordinates are known), never a guess: on doubt there is no match and the
// business simply shows up under "Nieuw gevonden" (criterion 3).
//
// Contract: planning/specs/tickets/be-32-source-discovery-osm-ai.md,
// decision 017.

const OSM_ATTRIBUTION = '© OpenStreetMap-bijdragers';
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
/** One OSM request per day, never one per click. */
const OSM_CACHE_SECONDS = 24 * 60 * 60;
/** The public Overpass API asks for an identifying User-Agent. */
const OVERPASS_USER_AGENT =
  'OnzeMenukaarten-SourceDiscovery/1.0 (internal source suggestions; https://github.com/1am-it/menucard)';
/** Breda only (criterion 1: "voor Breda"); no other city is in scope. */
const BREDA_BOUNDS = Object.freeze({ south: 51.523, west: 4.699, north: 51.634, east: 4.851 });
/** The food businesses a restaurant could be. A bakery or a supermarket is not. */
const FOOD_AMENITIES = Object.freeze(['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'ice_cream', 'biergarten']);
const MAX_BUSINESSES = 800;
/** Distance at which a name match also has to be the same place. */
const MAX_MATCH_METERS = 150;
/** Leading words that name the kind of business, not the business itself. */
const GENERIC_LEADING_WORDS = Object.freeze([
  'restaurant',
  'eetcafe',
  'eet cafe',
  'cafe',
  'brasserie',
  'bistro',
  'eetbar',
  'bar',
  'grand cafe',
  // A joining word after a kind word ("Brasserie & Bar X") is not the name.
  'en',
]);

/** The Overpass query: bounded to Breda, food businesses only, with tags. */
function buildOverpassQuery() {
  const bbox = `${BREDA_BOUNDS.south},${BREDA_BOUNDS.west},${BREDA_BOUNDS.north},${BREDA_BOUNDS.east}`;
  const amenity = FOOD_AMENITIES.join('|');
  return [
    '[out:json][timeout:25];',
    '(',
    `  node["amenity"~"^(${amenity})$"](${bbox});`,
    `  way["amenity"~"^(${amenity})$"](${bbox});`,
    ');',
    `out center tags ${MAX_BUSINESSES};`,
  ].join('\n');
}

/** Lowercase, accent-free, punctuation-free words, one space between them. */
function normalizeBusinessName(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' en ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The comparable name: the normalized name without leading kind words, so
 * "Restaurant Wolfslaar" and "Wolfslaar" are one place and "Café De Beyerd" and
 * "De Beyerd" are one place. Only leading words are dropped; a name that is
 * nothing but a kind word keeps its own text instead of becoming empty.
 */
function comparableBusinessName(value) {
  const words = normalizeBusinessName(value).split(' ').filter(Boolean);
  let start = 0;
  while (start < words.length) {
    let matched = 0;
    for (const generic of GENERIC_LEADING_WORDS) {
      const parts = generic.split(' ');
      if (parts.every((part, index) => words[start + index] === part)) matched = Math.max(matched, parts.length);
    }
    if (matched === 0) break;
    start += matched;
  }
  const rest = words.slice(start);
  return rest.length > 0 ? rest.join(' ') : words.join(' ');
}

/** "4834 SP" and "4834sp" are the same postcode; nothing else is. */
function normalizePostcode(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/\b(\d{4})\s*([a-z]{2})\b/i);
  return match ? `${match[1]}${match[2].toUpperCase()}` : '';
}

function postcodeFromAddress(address) {
  return normalizePostcode(address);
}

/** Only http(s), without query or fragment — the shape a proposal may store. */
function canonicalWebsite(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
  const path = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/** Haversine, metres. Used only when both sides have coordinates. */
function distanceMeters(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  if (![a.lat, a.lon, b.lat, b.lon].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const earth = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * earth * Math.asin(Math.min(1, Math.sqrt(h))));
}

function addressFromTags(tags) {
  const street = typeof tags['addr:street'] === 'string' ? tags['addr:street'].trim() : '';
  const number = typeof tags['addr:housenumber'] === 'string' ? tags['addr:housenumber'].trim() : '';
  const postcode = typeof tags['addr:postcode'] === 'string' ? tags['addr:postcode'].trim() : '';
  const city = typeof tags['addr:city'] === 'string' ? tags['addr:city'].trim() : '';
  const line = [street, number].filter(Boolean).join(' ');
  const tail = [postcode, city].filter(Boolean).join(' ');
  return [line, tail].filter(Boolean).join(', ') || null;
}

function coordinatesOf(element) {
  const lat = typeof element.lat === 'number' ? element.lat : element.center && element.center.lat;
  const lon = typeof element.lon === 'number' ? element.lon : element.center && element.center.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return { lat: null, lon: null };
  return { lat, lon };
}

/**
 * The Overpass answer reduced to what we may keep. Returns one entry per OSM
 * object, sorted by name, with the attribution attached. Only name, address,
 * website and kind survive; nothing else from the tags is retained.
 */
function parseOverpassResponse(payload) {
  const elements = payload && Array.isArray(payload.elements) ? payload.elements : [];
  const byId = new Map();
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const tags = element.tags && typeof element.tags === 'object' ? element.tags : null;
    if (!tags) continue;
    const kind = typeof tags.amenity === 'string' ? tags.amenity.trim() : '';
    if (!FOOD_AMENITIES.includes(kind)) continue;
    const name = typeof tags.name === 'string' ? tags.name.trim() : '';
    if (!name) continue;
    const type = element.type === 'way' || element.type === 'node' || element.type === 'relation' ? element.type : null;
    const ref = Number.isInteger(element.id) ? element.id : null;
    if (!type || ref === null) continue;
    const osmId = `${type}/${ref}`;
    if (byId.has(osmId)) continue;
    const address = addressFromTags(tags);
    const { lat, lon } = coordinatesOf(element);
    byId.set(osmId, {
      osmId,
      osmType: type,
      osmRef: ref,
      name,
      address,
      postcode: postcodeFromAddress(address),
      website: canonicalWebsite(tags.website || tags['contact:website'] || tags.url),
      kind,
      cuisine: typeof tags.cuisine === 'string' ? tags.cuisine.trim().slice(0, 60) : null,
      lat,
      lon,
      attribution: OSM_ATTRIBUTION,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
}

/** "restaurant · italiaans" — the kind column of "Nieuw gevonden". */
function businessKindLabel(business) {
  if (!business) return '';
  const kind = business.kind || 'horeca';
  return business.cuisine ? `${kind} · ${business.cuisine.split(';')[0].trim()}` : kind;
}

/** A safe, databasable key for an OSM object: "node/123" → "osm-node-123". */
function osmStorageKey(osmId) {
  const match = typeof osmId === 'string' ? osmId.match(/^(node|way|relation)\/(\d{1,20})$/) : null;
  if (!match) return null;
  return `osm-${match[1]}-${match[2]}`;
}

function osmObjectUrl(osmId) {
  const match = typeof osmId === 'string' ? osmId.match(/^(node|way|relation)\/(\d{1,20})$/) : null;
  if (!match) return null;
  return `https://www.openstreetmap.org/${match[1]}/${match[2]}`;
}

/** "osm-node-123" back to "node/123" (the storage key is not the OSM id). */
function osmIdFromStorageKey(value) {
  const match = typeof value === 'string' ? value.match(/^osm-(node|way|relation)-(\d{1,20})$/) : null;
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Links one restaurant to at most one OSM business.
 *
 * Order of the evidence: the comparable name has to be equal; then the postcode
 * when both sides have one; then the distance when both sides have coordinates.
 * Exactly one candidate may remain. Two or more is doubt, and doubt is no match
 * (criterion 1/3: nothing is linked by guesswork).
 */
function matchOsmBusiness(restaurant, businesses, { maxMeters = MAX_MATCH_METERS } = {}) {
  const target = comparableBusinessName(restaurant && restaurant.name);
  const list = Array.isArray(businesses) ? businesses.filter(Boolean) : [];
  if (!target) return { match: null, reason: 'no_name', candidates: [] };
  let candidates = list.filter((business) => comparableBusinessName(business.name) === target);
  if (candidates.length === 0) return { match: null, reason: 'no_name_match', candidates: [] };

  const restaurantPostcode = postcodeFromAddress(restaurant && restaurant.address);
  if (restaurantPostcode) {
    const samePostcode = candidates.filter((business) => business.postcode === restaurantPostcode);
    if (samePostcode.length === 0) return { match: null, reason: 'postcode_mismatch', candidates };
    candidates = samePostcode;
  }

  const hasCoordinates = restaurant && typeof restaurant.lat === 'number' && typeof restaurant.lon === 'number';
  if (hasCoordinates) {
    const near = candidates
      .map((business) => ({ business, distance: distanceMeters(restaurant, business) }))
      .filter((entry) => entry.distance !== null && entry.distance <= maxMeters);
    if (near.length === 0) return { match: null, reason: 'distance_mismatch', candidates };
    candidates = near.map((entry) => entry.business);
  }

  if (candidates.length > 1) return { match: null, reason: 'ambiguous', candidates };
  return { match: candidates[0], reason: 'matched', candidates };
}

/**
 * The "Nieuw gevonden" list: OSM businesses in Breda that no restaurant links to
 * and that a staff member did not ignore. Sorted by name.
 */
function unknownBusinesses({ restaurants = {}, businesses = [], ignoredIds = [] } = {}) {
  const list = Array.isArray(businesses) ? businesses.filter(Boolean) : [];
  const known = new Set();
  for (const restaurant of Object.values(restaurants || {})) {
    const result = matchOsmBusiness(restaurant, list);
    if (result.match) known.add(result.match.osmId);
  }
  const ignored = new Set(
    (Array.isArray(ignoredIds) ? ignoredIds : [])
      .map((value) => (typeof value === 'string' ? value : value && value.osmId))
      .filter(Boolean)
      .map((value) => (value.includes('/') ? value : osmIdFromStorageKey(value)))
      .filter(Boolean),
  );
  return list
    .filter((business) => !known.has(business.osmId) && !ignored.has(business.osmId))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
}

/** The address line of "Nieuw gevonden": the address, or an honest dash. */
function businessAddressLabel(business) {
  return (business && business.address) || 'Geen adres in OpenStreetMap';
}

/**
 * "＋ Toevoegen" opens the existing add form with everything filled in
 * (criterion 3). The form only ever *offers* these values; the human submits.
 */
function addFormHref(business) {
  if (!business || !business.name) return '/internal/toevoegen';
  const params = new URLSearchParams();
  params.set('naam', business.name);
  if (business.address) params.set('adres', business.address);
  if (business.website) params.set('website', business.website);
  if (business.osmId) params.set('osm', business.osmId);
  return `/internal/toevoegen?${params.toString()}`;
}

module.exports = {
  OSM_ATTRIBUTION,
  OVERPASS_ENDPOINT,
  OSM_CACHE_SECONDS,
  OVERPASS_USER_AGENT,
  BREDA_BOUNDS,
  FOOD_AMENITIES,
  MAX_BUSINESSES,
  MAX_MATCH_METERS,
  GENERIC_LEADING_WORDS,
  buildOverpassQuery,
  normalizeBusinessName,
  comparableBusinessName,
  normalizePostcode,
  postcodeFromAddress,
  canonicalWebsite,
  distanceMeters,
  parseOverpassResponse,
  businessKindLabel,
  osmStorageKey,
  osmIdFromStorageKey,
  osmObjectUrl,
  matchOsmBusiness,
  unknownBusinesses,
  businessAddressLabel,
  addFormHref,
};
