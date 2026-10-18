// BE-19 — URL Intake pure decision logic (canonicalization, receipt
// expiry, candidate-summary shaping). Implements docs/api/url-intake-schema.md's
// contract. Never touches Supabase, the DOM, or React, and never uses
// `node:crypto` — see src/lib/urlIntakeReceiptHash.js for the server-only
// hash computation this module's output feeds into, split out the same
// way src/lib/menuSnapshotHash.js was split from
// src/lib/menuSnapshotProposals.js (so this module stays safely
// importable from a 'use client' component).
//
// Deliberately CommonJS, same reasoning as src/lib/importInbox.js.

'use strict';

/** Mirrors src/lib/restaurantHostMatch.js's own matchType vocabulary
 * exactly — never invented independently. */
const ALLOWED_RESTAURANT_MATCH_TYPES = ['exact', 'none', 'multiple'];

/** The same fixed allowlist restaurant_profile_draft_field_facts.field_name
 * already enforces (src/lib/restaurantProfileDrafts.js's own
 * ALLOWED_DRAFT_FIELD_NAMES) — never a wider set for a URL-intake-derived
 * restaurant candidate. */
const ALLOWED_RESTAURANT_CANDIDATE_FIELDS = ['name', 'category', 'address', 'phone', 'website'];

/** Short-lived by design (docs/api/url-intake-schema.md's own "Analysis-
 * result integrity" section) — a receipt must not realistically survive
 * long enough to be reused well after the analysis it represents. Ten
 * minutes is a reasoned default, not an empirically derived one — see
 * that document's own "Open questions" for the exact TTL policy. */
const RECEIPT_TTL_MS = 10 * 60 * 1000;

/**
 * Strips query string and fragment from a URL, keeping only scheme, host,
 * and path — matches the `canonical_source_url` shape
 * `supabase/migrations/0013_be19_url_intakes.sql`'s own check constraint
 * requires (`~* '^https?://' and !~ '[?#]'`). Returns `null` for anything
 * unparseable or non-http(s) — never guessed at. The original,
 * fully-qualified URL (including any query parameters) is never returned
 * here and must never be persisted durably — see docs/api/url-intake-schema.md's
 * own "URL data minimisation" section.
 */
function canonicalizeSourceUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return null;
  const canonicalUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  return { canonicalUrl, hostname };
}

/** `true` when `expiresAt` (an ISO string or Date) is at or before `now`
 * (defaults to the real current time; injectable for tests). Never
 * throws on a malformed value — treated as already expired, fail closed. */
function isReceiptExpired(expiresAt, now = new Date()) {
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return true;
  const current = now instanceof Date ? now : new Date(now);
  return expiry.getTime() <= current.getTime();
}

/** Computes a fixed, short expiry timestamp (ISO string) `RECEIPT_TTL_MS`
 * from `now` (defaults to the real current time; injectable for tests). */
function computeReceiptExpiry(now = new Date()) {
  const base = now instanceof Date ? now : new Date(now);
  return new Date(base.getTime() + RECEIPT_TTL_MS).toISOString();
}

/**
 * Reduces a raw restaurant-candidate fields object (e.g. from
 * src/lib/candidateSuggestions.js's parseContactSuggestionsFromHtml) to
 * exactly the fixed, allowed field set — never a wider one. Absent or
 * blank fields are simply omitted, never recorded as an empty-string
 * placeholder (mirrors src/lib/restaurantProfileDrafts.js's own
 * "missing means absent" convention).
 */
function buildRestaurantCandidateSummary(rawFields) {
  const summary = {};
  for (const field of ALLOWED_RESTAURANT_CANDIDATE_FIELDS) {
    const value = rawFields && rawFields[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      summary[field] = value.trim();
    }
  }
  return summary;
}

/**
 * Reduces BE-18's existing `extractMenusFromHtml` output
 * (`[{ name, contextSlug, categories: [{ name, items: [{ name, desc,
 * price }] }] }]`) to the same, already-bounded shape — this function
 * exists as the single, named place that shape is asserted to stay
 * bounded (context label, category names, item names only — never
 * prices/allergens beyond what a preview already renders, though BE-18's
 * own item shape already includes `price`, kept here since it is already
 * part of the existing, reviewed preview a staff member sees — never
 * anything beyond what BE-18 itself already extracts and shows).
 */
function boundedLabels(path) {
  return Array.isArray(path) ? path.filter((label) => typeof label === 'string').slice(0, 8).map((label) => label.slice(0, 160)) : null;
}

/** The lossless hierarchy fields of src/lib/menuHierarchy.js, only when present
 * (flat menus keep exactly their earlier summary shape). */
function hierarchyFields(category) {
  const out = {};
  const pathLabels = boundedLabels(category && category.path);
  if (pathLabels) out.path = pathLabels;
  const sourceLabels = boundedLabels(category && category.sourcePath);
  if (sourceLabels) out.sourcePath = sourceLabels;
  if (category && Number.isInteger(category.position)) out.position = category.position;
  if (category && typeof category.locator === 'string') out.locator = category.locator.slice(0, 160);
  if (category && category.uncertain === true) out.uncertain = true;
  return out;
}

/** Short source evidence only — never raw source text. */
function boundedEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const out = {};
  if (typeof evidence.locator === 'string' && evidence.locator.trim()) out.locator = evidence.locator.trim().slice(0, 160);
  if (typeof evidence.sourceId === 'string' && evidence.sourceId.trim()) out.sourceId = evidence.sourceId.trim().slice(0, 80);
  if (typeof evidence.sourceUrl === 'string' && evidence.sourceUrl.trim()) out.sourceUrl = evidence.sourceUrl.trim().slice(0, 2048);
  if (typeof evidence.quote === 'string' && evidence.quote.trim()) out.quote = evidence.quote.trim().slice(0, 500);
  if (typeof evidence.contentHash === 'string' && evidence.contentHash.trim()) out.contentHash = evidence.contentHash.trim().slice(0, 128);
  return Object.keys(out).length > 0 ? out : null;
}

function buildMenuCandidateSummary(menus) {
  if (!Array.isArray(menus)) return [];
  return menus.map((menu) => ({
    name: (menu && menu.name) || null,
    contextSlug: menu && menu.contextSlug,
    ...(menu && typeof menu.title === 'string' ? { title: menu.title.slice(0, 160) } : {}),
    ...(menu && (menu.structure === 'normalized' || menu.structure === 'uncertain') ? { structure: menu.structure } : {}),
    // Additive provenance, bounded and optional: existing receipts keep their
    // exact shape, while PDF/HTML review can point back to the source.
    ...(menu && typeof menu.sourceId === 'string' ? { sourceId: menu.sourceId.slice(0, 80) } : {}),
    ...(menu && typeof menu.sourceUrl === 'string' ? { sourceUrl: menu.sourceUrl.slice(0, 2048) } : {}),
    ...(menu && typeof menu.extractionMethod === 'string' ? { extractionMethod: menu.extractionMethod.slice(0, 40) } : {}),
    // Explicit menu variant/order from a validated extraction survive into the
    // receipt instead of disappearing at this mapping step.
    ...(menu && typeof menu.variant === 'string' && menu.variant.trim() ? { variant: menu.variant.trim().slice(0, 160) } : {}),
    ...(menu && Number.isInteger(menu.order) && menu.order >= 0 ? { order: menu.order } : {}),
    categories: Array.isArray(menu && menu.categories)
      ? menu.categories.map((category) => ({
          name: (category && category.name) || null,
          ...hierarchyFields(category),
          items: Array.isArray(category && category.items)
            ? category.items.map((item) => {
                const summary = {
                  name: (item && item.name) || null,
                  desc: (item && item.desc) || null,
                  price: (item && item.price) || null,
                };
                const evidence = boundedEvidence(item && item.evidence);
                if (evidence) summary.evidence = evidence;
                if (item && ['multiple_undecomposed', 'on_request', 'unknown'].includes(item.priceStatus)) summary.priceStatus = item.priceStatus;
                if (item && typeof item.priceText === 'string' && item.priceText.trim()) summary.priceText = item.priceText.trim().slice(0, 160);
                if (item && Array.isArray(item.priceVariants)) {
                  summary.priceVariants = item.priceVariants
                    .filter((variant) => variant && typeof variant.price === 'string')
                    .slice(0, 10)
                    .map((variant) => ({
                      label: typeof variant.label === 'string' ? variant.label.slice(0, 80) : null,
                      price: variant.price.slice(0, 40),
                    }));
                }
                return summary;
              })
            : [],
        }))
      : [],
  }));
}

/**
 * The full, server-derived analysis payload a receipt carries —
 * `{ restaurant: {...allowed fields}, menus: [...bounded summary] }`.
 * This is the exact shape `analysis_result_hash` is computed over (see
 * src/lib/urlIntakeReceiptHash.js) and the exact shape
 * `create_url_intake_from_receipt`/`promote_url_intake_to_profile_draft`
 * (supabase/migrations/0013_be19_url_intakes.sql) read back out of a
 * receipt/url_intakes row — never a wider payload.
 */
function buildCandidateSummary({ restaurantCandidateFields, menus }) {
  return {
    restaurant: buildRestaurantCandidateSummary(restaurantCandidateFields),
    menus: buildMenuCandidateSummary(menus),
  };
}

module.exports = {
  ALLOWED_RESTAURANT_MATCH_TYPES,
  ALLOWED_RESTAURANT_CANDIDATE_FIELDS,
  RECEIPT_TTL_MS,
  canonicalizeSourceUrl,
  isReceiptExpired,
  computeReceiptExpiry,
  buildRestaurantCandidateSummary,
  buildMenuCandidateSummary,
  buildCandidateSummary,
};
