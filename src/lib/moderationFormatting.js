// PLATFORM-06 — pure, presentation-only formatting helpers for the
// Moderation queue's proposal diff (app/internal/moderation/page.js).
// Deliberately CommonJS, same reasoning as importInbox.js/internalNav.js:
// directly testable via this project's existing `node --test` tooling, no
// new dependency, interoperates fine with the ESM 'use client' page that
// imports it.
//
// This module never touches Supabase, the DOM, or React — it only turns
// an already-fetched `pending_changes`/`field_provenance` value (any
// JSON-serializable payload, per docs/api/internal-provenance-api.md) into
// a short, readable string. It never decides what a value *means*, never
// validates it, and never affects the Approve/Reject actions themselves —
// those keep calling the exact same, unchanged
// /api/internal/v1/moderation/{id}/{approve,reject} endpoints regardless
// of how their proposal is displayed.

'use strict';

// The five `field_name` values this project's `check` constraint allows
// (supabase/migrations/0001_field_provenance.sql /
// 0002_pending_changes.sql) — used only for a readable label, never to
// reject an unrecognized value (a future sixth field_name must still
// render safely, via the generic camelCase fallback below).
const FIELD_NAME_LABELS = {
  price: 'Price',
  openingHours: 'Opening hours',
  reservationMethod: 'Reservation method',
  itemAvailability: 'Item availability',
  allergens: 'Allergens',
};

// The five `source`/`proposed_source` values the same migrations allow.
const SOURCE_LABELS = {
  owner: 'Owner',
  community: 'Community',
  editor: 'Editor',
  imported: 'Imported',
  unknown: 'Unknown',
};

// Text shown whenever there is no current value to compare against —
// either no field_provenance row exists yet for this field, or one exists
// but its own `value` is itself null/undefined. Exported so the page and
// its tests both use exactly this string, never a re-typed copy that
// could quietly drift.
const NO_CURRENT_VALUE_LABEL = 'Geen huidige waarde';

function splitCamelCase(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function capitalize(text) {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

// Readable label for a `field_name` — a known one gets its exact,
// hand-written label; an unrecognized one (a future field_name this
// module doesn't know about yet) still renders as readable text instead
// of the raw camelCase identifier or, worse, disappearing.
function formatFieldName(fieldName) {
  if (typeof fieldName !== 'string' || fieldName.length === 0) return 'Field';
  return FIELD_NAME_LABELS[fieldName] || capitalize(splitCamelCase(fieldName));
}

// Readable label for a `source`/`proposed_source` value, with the same
// safe fallback for anything unrecognized.
function formatSourceLabel(source) {
  if (typeof source !== 'string' || source.length === 0) return 'Unknown';
  return SOURCE_LABELS[source] || capitalize(splitCamelCase(source));
}

// `price` values look like `{ priceValue: 19.5, priceDisplay: "€19,50" }`
// or `{ priceOnRequest: true }` (docs/api/internal-provenance-api.md,
// src/services/coverageMetrics.js's own price-counting logic). Returns
// `null` — never a guess — when `value` isn't a recognizable price shape,
// so the caller falls back to the generic formatter instead of silently
// mis-rendering something that only happens to be object-shaped.
function formatPrice(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.priceDisplay === 'string' && value.priceDisplay.trim().length > 0) {
    return value.priceDisplay;
  }
  if (value.priceOnRequest) return 'Price on request';
  if (typeof value.priceValue === 'number' && Number.isFinite(value.priceValue)) {
    return `€${value.priceValue.toFixed(2).replace('.', ',')}`;
  }
  return null;
}

// `allergens` values are documented (docs/api/canonical-restaurant-menu-schema.md)
// as `{ scheme, code }[]`. Renders as a plain, comma-separated list of
// codes — `null` (falling back to the generic formatter) for anything
// that isn't an array of objects carrying at least a `code`.
function formatAllergens(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const codes = value.map((item) => (item && typeof item === 'object' ? item.code : undefined));
  if (codes.some((code) => typeof code !== 'string' || code.length === 0)) return null;
  return codes.join(', ');
}

// Generic, schema-agnostic humanizer for any other value shape —
// `openingHours`, `reservationMethod`, `itemAvailability`, an
// unrecognized field_name, or a `price`/`allergens` value that didn't
// match the specific shapes above. Never throws, never loses information
// silently: an object's own keys become readable "Key: value" segments
// instead of being dropped, and nesting is followed (one level of
// recursion is enough for every shape actually seen in this codebase;
// deeper structures still render, just as nested "Key: value" segments).
function humanizeValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    return value.map((item) => humanizeValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (entries.length === 0) return '(no details)';
    return entries.map(([key, v]) => `${capitalize(splitCamelCase(key))}: ${humanizeValue(v)}`).join(' · ');
  }
  return String(value);
}

// The single entry point the page uses to render a current/proposed
// value: tries the field-specific formatter for `fieldName` first, falls
// back to the generic humanizer for everything else, and returns `null`
// only when there is truly no value to show at all (the caller renders
// NO_CURRENT_VALUE_LABEL in that case, never `null`/`undefined`/raw JSON).
function formatFieldValue(fieldName, value) {
  if (value === null || value === undefined) return null;
  if (fieldName === 'price') {
    const formatted = formatPrice(value);
    if (formatted !== null) return formatted;
  }
  if (fieldName === 'allergens') {
    const formatted = formatAllergens(value);
    if (formatted !== null) return formatted;
  }
  const generic = humanizeValue(value);
  return generic.length > 0 ? generic : null;
}

module.exports = {
  NO_CURRENT_VALUE_LABEL,
  formatFieldName,
  formatSourceLabel,
  formatPrice,
  formatAllergens,
  humanizeValue,
  formatFieldValue,
};
