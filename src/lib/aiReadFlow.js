'use strict';

// BE-34 (#81, criterion 1) — "Lees met AI" met één klik vanuit de resultaatrij.
//
// The row no longer sends the human to the manual copy/paste import first: it
// starts the existing server-side reading (#59, route B) for the source of that
// row, shows the progress and the outcome in the row itself, and only then
// offers "Bekijk en controleer" for the existing review screen (Lijst | Kaart).
//
// Deliberately CommonJS, like sourceReview.js: no network, no DOM model, no
// clock, directly testable with `node --test`, usable by the 'use client' pages.
//
// Deliberate boundaries:
//  - one route only: `AI_READ_API` is the existing
//    /api/internal/v1/menu-ai-import; no second AI path, no new key, no new
//    budget. The request carries the row's own analysis job (`job_id`) and the
//    row's restaurant id, exactly the two handles that route already accepts;
//  - the manual import stays available as one small link ("Liever zelf plakken"
//    while everything works) and as the honest next step ("Handmatig toevoegen")
//    after a failure, an empty budget or AI being switched off. It is never the
//    first destination of "Lees met AI";
//  - the handoff to the review screen carries the reading this server itself
//    produced (the same sealed state token, report and review the review screen
//    already works with). It is kept in this tab's session storage only, under a
//    one-time key, and is removed as soon as the review screen read it. The
//    prompt and a pasted answer are still never stored in the browser.

/** The one existing server-side AI reading (route B, #59). */
const AI_READ_API = '/api/internal/v1/menu-ai-import';
/** The existing review screen (Lijst | Kaart). */
const AI_REVIEW_HREF = '/internal/menu-import';
/** The existing manual import; only a small link, never the first step. */
const MANUAL_IMPORT_HREF = '/internal/menu-import';

const HANDOFF_PREFIX = 'menucard.ai-read.';
const HANDOFF_PARAM = 'ai';
/** A reading of one menu is far below this; anything above is refused honestly. */
const MAX_HANDOFF_CHARS = 2 * 1024 * 1024;

// The estimate is the same wording the existing AI card uses (one cent, about a
// minute); it is shown before the click, never after.
const ESTIMATE = Object.freeze({ durationLabel: '± 1 minuut', costLabel: '± 1 cent' });
const PROGRESS_LINE = '⏳ AI leest de kaart… ± 1 minuut';
const PASTE_LABEL = 'Liever zelf plakken';
const NEXT_MANUAL_LABEL = '✍️ Handmatig toevoegen';
const REVIEW_LABEL = 'Bekijk en controleer';
const HANDOFF_FAILED =
  'Het resultaat kon niet aan het controlescherm worden doorgegeven. Het concept is wel opgeslagen; open het via Menuconcepten.';

/** "± 1 minuut · ± 1 cent" — the estimate that is visible before the click. */
function aiReadEstimateLine() {
  return `${ESTIMATE.durationLabel} · ${ESTIMATE.costLabel}`;
}

function aiReadEstimate() {
  return { ...ESTIMATE, label: aiReadEstimateLine() };
}

function aiReadProgressLine() {
  return PROGRESS_LINE;
}

/**
 * The outcome of a finished reading in the row, in the words of the contract:
 * "✅ 42 gerechten gelezen · 3 controle nodig". Only counts the server actually
 * reported are used; nothing is estimated here.
 */
function aiReadOutcomeLine({ items, needsReview } = {}) {
  const read = Number.isInteger(items) && items >= 0 ? items : 0;
  const open = Number.isInteger(needsReview) && needsReview >= 0 ? needsReview : 0;
  return `✅ ${read} ${read === 1 ? 'gerecht' : 'gerechten'} gelezen · ${open} controle nodig`;
}

/** The measured cost of the reading, or the honest "not measured". */
function aiReadCostLine(cost) {
  if (cost && cost.known === true && Number.isInteger(cost.eurCents) && cost.eurCents >= 0) {
    return `Kosten AI: ${cost.eurCents} cent van je maandbudget.`;
  }
  return 'Kosten AI: niet gemeten (het maximum per aanroep blijft gereserveerd).';
}

/**
 * An honest failure: what happened in plain language and the one next step that
 * always works. A timeout and a busy server are named as such instead of being
 * hidden behind a technical code.
 */
function aiReadFailure({ reason = null, error = null, status = null } = {}) {
  const code = typeof reason === 'string' ? reason : '';
  let message;
  if (code === 'budget_exhausted') {
    message = 'Het AI-budget van deze maand is op.';
  } else if (code === 'budget_unavailable') {
    message = 'Het AI-gebruik kon niet worden gecontroleerd, dus er is niets aangeroepen.';
  } else if (code === 'ai_not_configured' || code === 'ai_flagged_off' || code === 'ai_key_missing') {
    message = 'AI staat uit.';
  } else if (code === 'timeout' || status === 504 || status === 408) {
    message = 'De AI-lezing duurde te lang.';
  } else if (status === 502 || status === 503 || code === 'provider_unavailable' || code === 'model_unavailable') {
    message = 'De AI is nu niet bereikbaar (server bezet).';
  } else if (typeof error === 'string' && error.trim() !== '') {
    // The server's own words are already in plain Dutch and name the next step.
    message = error.trim();
  } else {
    message = 'De AI-lezing lukte niet.';
  }
  return { reason: code || null, message, nextLabel: NEXT_MANUAL_LABEL, nextHref: MANUAL_IMPORT_HREF };
}

/**
 * The row's own handle for the existing AI route. Without an analysis job there
 * is nothing this route may read, so the answer is null and the row keeps its
 * existing honest step (the manual import).
 */
function aiReadRequestFor(row) {
  if (!row || typeof row.jobId !== 'string' || row.jobId.trim() === '') return null;
  const body = { job_id: row.jobId.trim() };
  const restaurantId =
    row.restaurant && typeof row.restaurant.id === 'string'
      ? row.restaurant.id
      : typeof row.restaurantId === 'string'
        ? row.restaurantId
        : null;
  if (restaurantId) body.restaurant_id = restaurantId;
  return body;
}

/** One identity per row: the analysis job it belongs to. */
function aiReadRowKey(row) {
  if (!row) return null;
  if (typeof row.jobId === 'string' && row.jobId.trim() !== '') return row.jobId.trim();
  if (row.restaurant && typeof row.restaurant.id === 'string') return `restaurant:${row.restaurant.id}`;
  return null;
}

/** The small link "Liever zelf plakken" (the existing manual import). */
function manualPasteHref(row) {
  const restaurant = row && row.restaurant;
  if (!restaurant || typeof restaurant.id !== 'string' || restaurant.id === '') return MANUAL_IMPORT_HREF;
  const params = new URLSearchParams({ restaurant: restaurant.id });
  if (typeof restaurant.name === 'string' && restaurant.name !== '') params.set('name', restaurant.name);
  return `${MANUAL_IMPORT_HREF}?${params.toString()}`;
}

/** What the review screen needs from one reading; nothing else is kept. */
const HANDOFF_FIELDS = Object.freeze([
  'state',
  'validUntil',
  'import',
  'review',
  'summary',
  'cost',
  'estimate',
  'notice',
  'imageRead',
  'plan',
  'ai',
  'origin',
  'monthly',
]);

function handoffPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const kept = {};
  for (const field of HANDOFF_FIELDS) {
    if (payload[field] !== undefined) kept[field] = payload[field];
  }
  return typeof kept.state === 'string' && kept.state.trim() !== '' && kept.review ? kept : null;
}

function nonce() {
  const source = typeof globalThis !== 'undefined' ? globalThis : null;
  if (source && source.crypto && typeof source.crypto.randomUUID === 'function') return source.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Keeps one reading for the review screen in this tab. The key is one-time and
 * unguessable; the caller passes the storage (window.sessionStorage) so a
 * regression can prove the failure paths without a browser.
 */
function stashAiRead(storage, payload, key = null) {
  const kept = handoffPayload(payload);
  if (!kept) return { ok: false, reason: 'payload_invalid' };
  if (!storage || typeof storage.setItem !== 'function') return { ok: false, reason: 'storage_unavailable' };
  let text;
  try {
    text = JSON.stringify(kept);
  } catch {
    return { ok: false, reason: 'payload_invalid' };
  }
  if (typeof text !== 'string' || text.length > MAX_HANDOFF_CHARS) return { ok: false, reason: 'payload_too_large' };
  const storageKey = `${HANDOFF_PREFIX}${typeof key === 'string' && key !== '' ? key : nonce()}`;
  try {
    storage.setItem(storageKey, text);
  } catch {
    // A full or blocked storage is never a silent loss: the caller says so.
    return { ok: false, reason: 'storage_failed' };
  }
  return { ok: true, key: storageKey.replace(HANDOFF_PREFIX, ''), storageKey };
}

/** Reads and removes the one-time handoff. A second read finds nothing. */
function takeAiRead(storage, key) {
  if (!storage || typeof storage.getItem !== 'function' || typeof key !== 'string' || key === '') return null;
  const storageKey = `${HANDOFF_PREFIX}${key}`;
  let text = null;
  try {
    text = storage.getItem(storageKey);
  } catch {
    return null;
  }
  if (typeof text !== 'string' || text === '') return null;
  try {
    if (typeof storage.removeItem === 'function') storage.removeItem(storageKey);
  } catch {
    // A storage that refuses the removal still handed us the reading once.
  }
  try {
    const parsed = JSON.parse(text);
    return handoffPayload(parsed);
  } catch {
    return null;
  }
}

/** The one address "Bekijk en controleer" opens: the existing review screen. */
function aiReviewHref(key) {
  if (typeof key !== 'string' || key === '') return AI_REVIEW_HREF;
  return `${AI_REVIEW_HREF}?${HANDOFF_PARAM}=${encodeURIComponent(key)}`;
}

/** The handoff key in an address bar, or null. Only our own safe shape. */
function aiHandoffKeyFromSearch(search) {
  if (typeof search !== 'string' || search === '') return null;
  let value = null;
  try {
    value = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(HANDOFF_PARAM);
  } catch {
    return null;
  }
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key === '' || key.length > 120) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  return key;
}

module.exports = {
  AI_READ_API,
  AI_REVIEW_HREF,
  MANUAL_IMPORT_HREF,
  HANDOFF_PREFIX,
  HANDOFF_PARAM,
  MAX_HANDOFF_CHARS,
  HANDOFF_FIELDS,
  PASTE_LABEL,
  NEXT_MANUAL_LABEL,
  REVIEW_LABEL,
  HANDOFF_FAILED,
  aiReadEstimate,
  aiReadEstimateLine,
  aiReadProgressLine,
  aiReadOutcomeLine,
  aiReadCostLine,
  aiReadFailure,
  aiReadRequestFor,
  aiReadRowKey,
  manualPasteHref,
  handoffPayload,
  stashAiRead,
  takeAiRead,
  aiReviewHref,
  aiHandoffKeyFromSearch,
};
