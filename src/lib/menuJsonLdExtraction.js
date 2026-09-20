// BE-18 (fase 1) — pure schema.org JSON-LD menu-structure extraction for
// the "Onboarding Menu via URL" flow. Never fetches anything itself —
// see src/lib/safeOutboundFetch.js for the actual, SSRF-guarded network
// call, and app/api/internal/v1/onboarding-menu/read-url/route.js for
// the route that wires the two together.
//
// Deliberately a **separate module** from src/lib/candidateSuggestions.js:
// that file's own `extractFromJsonLd` has an existing, tested guarantee
// ("never reads menu/price/image fields, even though they are present
// on the same schema.org node" — candidateSuggestions.test.js) that this
// module must not weaken. The `<script type="application/ld+json">`
// scanning pattern below is therefore a deliberately independent copy,
// not a shared import — same reasoning as every other small,
// deliberately-duplicated helper already in this project (e.g. the
// per-route `isEditor` one-liners).
//
// Reads exactly two schema.org shapes, never more:
//   1. A top-level node whose own `@type` is `Menu`.
//   2. A `Restaurant`/`FoodEstablishment`-like node's `menu`/`hasMenu`
//      property, when that property is an embedded `Menu` object (or an
//      array of them) — never when it is only a URL string, since
//      following that would require a second, separate fetch outside
//      this fase's scope; a URL-only `menu` reference is treated as
//      "no reliable structure found here," never guessed at.
// Each `Menu` node's `hasMenuSection` becomes this feature's
// `categories` (nested sub-sections are flattened, combining names, so
// the output always matches the flat `categories: [{ name, items }]`
// shape `data/menus.json` already uses); `hasMenuItem` becomes `items`.
// A `Menu` node with no usable `hasMenuSection`/`hasMenuItem` content is
// dropped, never returned as an empty/guessed proposal.
//
// Deliberately CommonJS, same reasoning as src/lib/candidateSuggestions.js.

'use strict';

const JSON_LD_SCRIPT_PATTERN = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const RESTAURANT_LIKE_SCHEMA_TYPES = ['restaurant', 'foodestablishment', 'localbusiness', 'cafeorcoffeeshop', 'bar'];

function nodeHasSchemaType(node, typeName) {
  if (!node || typeof node !== 'object') return false;
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  return types.some((t) => typeof t === 'string' && t.toLowerCase() === typeName.toLowerCase());
}

function nodeIsRestaurantLike(node) {
  if (!node || typeof node !== 'object') return false;
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  return types.some((t) => typeof t === 'string' && RESTAURANT_LIKE_SCHEMA_TYPES.includes(t.toLowerCase()));
}

/**
 * Every JSON-LD block on the page, flattened (including `@graph`
 * members) into one array of candidate nodes — malformed blocks are
 * skipped, never guessed at, exactly like
 * candidateSuggestions.js's own `extractFromJsonLd`.
 */
function collectJsonLdNodes(html) {
  const nodes = [];
  for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch (err) {
      continue;
    }
    if (Array.isArray(parsed)) {
      nodes.push(...parsed);
    } else if (parsed && typeof parsed === 'object') {
      nodes.push(parsed);
      if (Array.isArray(parsed['@graph'])) nodes.push(...parsed['@graph']);
    }
  }
  return nodes;
}

/**
 * Every distinct `Menu` node reachable from the page's JSON-LD — either
 * directly, or embedded on a restaurant-like node's `menu`/`hasMenu`
 * property (an array there means separate, independent menus, e.g. one
 * per daypart — never merged into one).
 */
function findMenuNodes(nodes) {
  const menuNodes = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (nodeHasSchemaType(node, 'Menu')) {
      menuNodes.push(node);
      continue;
    }
    if (!nodeIsRestaurantLike(node)) continue;
    const menuProp = node.hasMenu || node.menu;
    if (!menuProp) continue;
    const candidates = Array.isArray(menuProp) ? menuProp : [menuProp];
    for (const candidate of candidates) {
      // A plain URL string reference is never followed here — that
      // would need a second fetch, out of this fase's scope.
      if (candidate && typeof candidate === 'object') menuNodes.push(candidate);
    }
  }
  return menuNodes;
}

function extractPrice(itemNode) {
  const offers = itemNode.offers;
  const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of offerList) {
    if (!offer || typeof offer !== 'object') continue;
    if (typeof offer.price === 'string' || typeof offer.price === 'number') return String(offer.price);
    const spec = offer.priceSpecification;
    if (spec && typeof spec === 'object' && (typeof spec.price === 'string' || typeof spec.price === 'number')) {
      return String(spec.price);
    }
  }
  return null;
}

function extractMenuItem(itemNode) {
  if (!itemNode || typeof itemNode !== 'object') return null;
  const name = typeof itemNode.name === 'string' && itemNode.name.trim() ? itemNode.name.trim() : null;
  if (!name) return null;
  const desc = typeof itemNode.description === 'string' && itemNode.description.trim() ? itemNode.description.trim() : null;
  return { name, desc, price: extractPrice(itemNode) };
}

/**
 * Flattens `hasMenuSection` (which schema.org allows to nest — a
 * section may itself contain further `hasMenuSection` instead of
 * `hasMenuItem`) into the flat `categories: [{ name, items }]` shape
 * `data/menus.json` already uses. A nested section's name is combined
 * with its parent's so no information is silently dropped. A section
 * with no items at all (after flattening) contributes no category.
 */
function flattenMenuSections(sectionsInput, parentName) {
  const categories = [];
  const sections = Array.isArray(sectionsInput) ? sectionsInput : sectionsInput ? [sectionsInput] : [];
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const sectionName = typeof section.name === 'string' && section.name.trim() ? section.name.trim() : null;
    const combinedName = parentName && sectionName ? `${parentName} — ${sectionName}` : sectionName || parentName || 'Categorie';
    if (section.hasMenuSection) {
      categories.push(...flattenMenuSections(section.hasMenuSection, combinedName));
      continue;
    }
    const itemsInput = Array.isArray(section.hasMenuItem) ? section.hasMenuItem : section.hasMenuItem ? [section.hasMenuItem] : [];
    const items = itemsInput.map(extractMenuItem).filter(Boolean);
    if (items.length > 0) {
      categories.push({ name: combinedName, items });
    }
  }
  return categories;
}

// Known Dutch/English daypart keywords this pilot recognizes, mapped to
// a fixed, lowercase-letters-only slug matching the migration's own
// `menu_context ~ '^[^-]+-[a-z]+$'` shape. This slug is a purely
// internal identifier — the human-readable `name` (shown in the review
// UI) is what a reviewer actually sees; nobody ever types or reviews
// this slug directly.
const KNOWN_MEALTYPE_SLUGS = [
  { slug: 'lunch', keywords: ['lunch'] },
  { slug: 'diner', keywords: ['diner', 'dinner', 'avond'] },
  { slug: 'borrel', keywords: ['borrel'] },
  { slug: 'dranken', keywords: ['drank', 'drink', 'beverage', 'wijn', 'bier'] },
  { slug: 'specialiteiten', keywords: ['specialiteit', 'special'] },
  { slug: 'ontbijt', keywords: ['ontbijt', 'breakfast', 'brunch'] },
];

/**
 * Derives a deterministic, lowercase-letters-only slug for one menu's
 * `menu_context` — tries a known daypart keyword first, then a
 * sanitized form of the menu's own name, then a positional fallback
 * (`menu` + a letter). `usedSlugs` (a `Set`, mutated) guarantees
 * uniqueness across one page's own extracted menus, since the migration
 * requires `unique (restaurant_id, menu_context, version)` and this
 * pilot always writes `version = 1`.
 */
function deriveUniqueMenuContextSlug(menuName, index, usedSlugs) {
  const lower = typeof menuName === 'string' ? menuName.toLowerCase() : '';
  let candidate = null;
  for (const entry of KNOWN_MEALTYPE_SLUGS) {
    if (entry.keywords.some((k) => lower.includes(k))) {
      candidate = entry.slug;
      break;
    }
  }
  if (!candidate) {
    const sanitized = lower.replace(/[^a-z]/g, '');
    candidate = sanitized.length > 0 ? sanitized : null;
  }
  if (!candidate) {
    candidate = `menu${String.fromCharCode(97 + (index % 26))}`;
  }
  let unique = candidate;
  let suffix = 1;
  while (usedSlugs.has(unique)) {
    unique = `${candidate}${String.fromCharCode(97 + (suffix % 26))}`;
    suffix += 1;
  }
  usedSlugs.add(unique);
  return unique;
}

/**
 * The one entry point. Returns `[]` when nothing reliable was found —
 * never a guessed or partially-empty menu. Each returned entry:
 * `{ name, contextSlug, categories: [{ name, items: [{ name, desc,
 * price }] }] }`. `contextSlug` is unique across the returned array.
 */
function extractMenusFromHtml(html) {
  if (typeof html !== 'string') return [];
  const nodes = collectJsonLdNodes(html);
  const menuNodes = findMenuNodes(nodes);
  const usedSlugs = new Set();
  const menus = [];
  menuNodes.forEach((menuNode, index) => {
    const name = typeof menuNode.name === 'string' && menuNode.name.trim() ? menuNode.name.trim() : null;
    const categories = flattenMenuSections(menuNode.hasMenuSection, null);
    if (categories.length === 0) return;
    menus.push({
      name,
      contextSlug: deriveUniqueMenuContextSlug(name, index, usedSlugs),
      categories,
    });
  });
  return menus;
}

module.exports = {
  collectJsonLdNodes,
  findMenuNodes,
  flattenMenuSections,
  extractMenuItem,
  extractPrice,
  deriveUniqueMenuContextSlug,
  extractMenusFromHtml,
};
