// Bronwerkvoorraad — pure classification logic behind the internal source
// workqueue (/internal/source-workqueue). Deliberately CommonJS, same
// reasoning as internalNav.js/importInbox.js: directly testable via this
// project's existing `node --test` tooling, no new dependency.
//
// This module never touches Supabase, the network, the DOM or React. It
// only turns rows that already exist — the BE-20
// `restaurant_source_analysis_jobs` rows, their
// `url_intake_analysis_receipts`, and the static restaurant list — into a
// read-only workqueue. It never starts an analysis, never writes, and never
// publishes anything.
//
// Every row always carries two separate dimensions:
//   Bron      — reachable | unreachable | access_limited | identity_changed
//   Menukaart — ready_for_review | structure_not_recognized | no_menu_found |
//               not_assessed
// Hard rule (classifyRow): if the source is not `reachable`, the menu is
// always `not_assessed` — whatever the input says.
//
// Two statuses cannot be derived from the current data model and are
// therefore NEVER produced by observeJob below (see "Datamodelkloof" in
// planning/specs/tickets/be-23-internal-source-workqueue.md):
//   - `identity_changed`: no table records an explicit identity change for a
//     source; it is never inferred from a name, URL, redirect or HTTP status.
//   - `no_menu_found`: the analysis records what it recognized, not an
//     explicit verdict that a source has no menu. "Nothing recognized" is not
//     evidence of absence (BE-22 decision), so it maps to `not_assessed`.
// classifyRow still supports both, so a later, explicit evidence field can
// feed them without changing the queue logic.

'use strict';

const SOURCE_STATUSES = ['reachable', 'unreachable', 'access_limited', 'identity_changed'];
const MENU_STATUSES = ['ready_for_review', 'structure_not_recognized', 'no_menu_found', 'not_assessed'];

const SOURCE_LABELS = {
  reachable: 'Bereikbaar',
  unreachable: 'Niet bereikbaar',
  access_limited: 'Toegang beperkt',
  identity_changed: 'Identiteit gewijzigd',
};

const MENU_LABELS = {
  ready_for_review: 'Klaar voor review',
  structure_not_recognized: 'Structuur niet herkend',
  no_menu_found: 'Geen menukaart aangetroffen',
  not_assessed: 'Niet beoordeeld',
};

const ACTIONS = ['review', 'review_manually', 'check_source', 'check_access', 'check_identity'];

const ACTION_LABELS = {
  review: 'Beoordeel',
  review_manually: 'Beoordeel handmatig',
  check_source: 'Controleer bron',
  check_access: 'Controleer toegang',
  check_identity: 'Controleer identiteit',
};

// Mutually exclusive queues: every row is in exactly one, so the queue
// counts always add up to the total.
const QUEUES = ['review', 'source', 'identity'];

const QUEUE_LABELS = {
  review: 'Beoordelen',
  source: 'Bron controleren',
  identity: 'Identiteit',
};

const QUEUE_BY_ACTION = {
  review: 'review',
  review_manually: 'review',
  check_source: 'source',
  check_access: 'source',
  check_identity: 'identity',
};

// "Eerst actie nodig": the lower the rank, the earlier the row. An identity
// question blocks everything else; a broken source comes before reviewing
// what we did read; a manual review before a ready one.
const ACTION_PRIORITY = {
  check_identity: 0,
  check_source: 1,
  check_access: 1,
  review_manually: 2,
  review: 3,
};

// Why a known restaurant is not (yet) in the workqueue — never a guessed
// source status.
const NOT_IN_QUEUE_REASONS = ['no_website', 'never_checked', 'check_in_progress', 'check_not_usable'];

const NOT_IN_QUEUE_LABELS = {
  no_website: 'Geen website bekend',
  never_checked: 'Nog nooit gecontroleerd',
  check_in_progress: 'Controle loopt nog',
  check_not_usable: 'Laatste controle gaf geen bruikbaar resultaat',
};

const SORT_MODES = ['action_first', 'oldest_check', 'name'];

const SORT_LABELS = {
  action_first: 'Eerst actie nodig',
  oldest_check: 'Oudste controle eerst',
  name: 'Restaurant (A–Z)',
};

// Job failure reasons that say something reliable about the source itself.
// Every other reason (internal_error, unsafe_url, and the reserved
// ai_structuring_failed/budget_exceeded/no_reliable_content_found) says
// nothing reliable about the source and is never mapped to a status.
const FAILED_REASON_OBSERVATIONS = {
  fetch_failed: { source: 'unreachable' },
  robots_disallowed: { source: 'access_limited' },
  // The source was fetched, but nothing could be read as a menu: reachable,
  // no menu verdict.
  unsupported_content_type: { source: 'reachable', menu: 'not_assessed' },
  pdf_extraction_failed: { source: 'reachable', menu: 'not_assessed' },
};

/**
 * Applies the hard dependency rule and derives the one action and queue.
 * `sourceStatus`/`menuStatus` must be one of the known values; anything else
 * throws (fail closed — an unknown status is a bug, never a silent default).
 */
function classifyRow({ sourceStatus, menuStatus }) {
  if (!SOURCE_STATUSES.includes(sourceStatus)) throw new Error(`Unknown source status: ${sourceStatus}`);
  if (!MENU_STATUSES.includes(menuStatus)) throw new Error(`Unknown menu status: ${menuStatus}`);
  const menu = sourceStatus === 'reachable' ? menuStatus : 'not_assessed';
  let action;
  if (sourceStatus === 'identity_changed') action = 'check_identity';
  else if (sourceStatus === 'unreachable') action = 'check_source';
  else if (sourceStatus === 'access_limited') action = 'check_access';
  else if (menu === 'ready_for_review') action = 'review';
  else if (menu === 'no_menu_found') action = 'check_source';
  else action = 'review_manually'; // structure_not_recognized | not_assessed
  return { source: sourceStatus, menu, action, queue: QUEUE_BY_ACTION[action], priority: ACTION_PRIORITY[action] };
}

/** Number of menu items in a receipt's `candidate_summary.menus`
 * (`[{ categories: [{ items: [...] }] }]`) — 0 for anything malformed. */
function countSummaryMenuItems(menus) {
  if (!Array.isArray(menus)) return 0;
  let count = 0;
  for (const menu of menus) {
    const categories = menu && Array.isArray(menu.categories) ? menu.categories : [];
    for (const category of categories) count += category && Array.isArray(category.items) ? category.items.length : 0;
  }
  return count;
}

/** Number of menu items recognized in a job's
 * `field_evidence.unknown_menu_contexts[].recognizedSections` (a discovered
 * PDF that was structured) — 0 for anything malformed. */
function countRecognizedPdfItems(unknownMenuContexts) {
  if (!Array.isArray(unknownMenuContexts)) return 0;
  let count = 0;
  for (const context of unknownMenuContexts) {
    const sections = context && Array.isArray(context.recognizedSections) ? context.recognizedSections : [];
    for (const section of sections) count += section && Array.isArray(section.items) ? section.items.length : 0;
  }
  return count;
}

/**
 * Maps one terminal analysis job (plus its receipt, when it succeeded) to an
 * observation. Returns `{ kind: 'classified', source, menu }` or
 * `{ kind: 'unusable' }` — never a guess.
 *
 *   job: { status, error_reason, unknown_menu_contexts }
 *   receipt: { menus } | null   (candidate_summary.menus)
 */
function observeJob(job, receipt) {
  if (!job || typeof job !== 'object') return { kind: 'unusable' };
  if (job.status === 'succeeded') {
    if (!receipt) return { kind: 'unusable' }; // a succeeded job always has a receipt; without it, no claim
    const recognized = countSummaryMenuItems(receipt.menus) + countRecognizedPdfItems(job.unknown_menu_contexts);
    if (recognized > 0) return { kind: 'classified', source: 'reachable', menu: 'ready_for_review' };
    const candidateFound =
      (Array.isArray(job.unknown_menu_contexts) && job.unknown_menu_contexts.length > 0) ||
      (Array.isArray(receipt.menus) && receipt.menus.length > 0);
    if (candidateFound) return { kind: 'classified', source: 'reachable', menu: 'structure_not_recognized' };
    // Nothing recognized and no menu candidate: not evidence of absence.
    return { kind: 'classified', source: 'reachable', menu: 'not_assessed' };
  }
  if (job.status === 'failed') {
    const observation = FAILED_REASON_OBSERVATIONS[job.error_reason];
    if (!observation) return { kind: 'unusable' };
    return { kind: 'classified', source: observation.source, menu: observation.menu || 'not_assessed' };
  }
  return { kind: 'unusable' }; // pending/running/unknown: not a terminal observation
}

/** Hostname without a leading "www." — what the workqueue shows instead of a
 * full URL. `null` for anything that is not an http(s) URL. */
function domainOf(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function timeOf(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Which restaurant a job belongs to — or `null` when that is not certain.
 * A succeeded job uses only its receipt's server-side exact match (made
 * against the final URL); a failed job uses an exact hostname match of the
 * URL that was checked. `none`/`multiple` matches are never attributed.
 *
 *   matchHostname(url) => { matchType, restaurantId }
 */
function attributeJob(job, receipt, matchHostname) {
  if (!job) return null;
  if (job.status === 'succeeded') {
    return receipt && receipt.restaurant_match_type === 'exact' && receipt.matched_restaurant_id
      ? String(receipt.matched_restaurant_id)
      : null;
  }
  if (typeof matchHostname !== 'function') return null;
  const match = matchHostname(job.canonical_source_url);
  return match && match.matchType === 'exact' && match.restaurantId ? String(match.restaurantId) : null;
}

/**
 * Builds the whole workqueue.
 *
 *   restaurants: { [id]: { name, buurt, website } }   (data/restaurants.json)
 *   jobs: [{ id, canonical_source_url, status, error_reason, result_receipt_id,
 *            unknown_menu_contexts, created_at, updated_at }]
 *   receipts: [{ id, restaurant_match_type, matched_restaurant_id, menus }]
 *   matchHostname: (url) => { matchType, restaurantId }
 *
 * Per restaurant, the most recent terminal job that gives a usable
 * observation decides the row; `checkedAt` is that job's own `updated_at`.
 * A restaurant without one is listed in `notInQueue` with a plain reason —
 * never given a guessed status.
 */
function buildSourceWorkqueue({ restaurants, jobs, receipts, matchHostname }) {
  const receiptById = new Map();
  for (const r of Array.isArray(receipts) ? receipts : []) if (r && r.id) receiptById.set(r.id, r);

  const byRestaurant = new Map(); // id -> { usable: [], inProgress: bool, unusableTerminal: bool }
  let unattributedChecks = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== 'object') continue;
    const receipt = job.result_receipt_id ? receiptById.get(job.result_receipt_id) || null : null;
    const restaurantId = attributeJob(job, receipt, matchHostname);
    if (!restaurantId || !restaurants || !restaurants[restaurantId]) {
      unattributedChecks += 1;
      continue;
    }
    if (!byRestaurant.has(restaurantId)) byRestaurant.set(restaurantId, { usable: [], inProgress: false, unusableTerminal: false });
    const entry = byRestaurant.get(restaurantId);
    if (job.status === 'pending' || job.status === 'running') {
      entry.inProgress = true;
      continue;
    }
    const observation = observeJob(job, receipt);
    if (observation.kind === 'classified') entry.usable.push({ job, observation });
    else entry.unusableTerminal = true;
  }

  const rows = [];
  const notInQueue = [];
  for (const [id, restaurant] of Object.entries(restaurants || {})) {
    if (!restaurant || typeof restaurant !== 'object') continue;
    const name = typeof restaurant.name === 'string' && restaurant.name.trim() ? restaurant.name.trim() : null;
    if (!name) continue;
    const wijk = typeof restaurant.buurt === 'string' && restaurant.buurt.trim() ? restaurant.buurt.trim() : null;
    const domain = domainOf(restaurant.website);
    const entry = byRestaurant.get(String(id));
    if (entry && entry.usable.length > 0) {
      const latest = entry.usable.reduce((a, b) => ((timeOf(b.job.created_at) || 0) > (timeOf(a.job.created_at) || 0) ? b : a));
      const classified = classifyRow({ sourceStatus: latest.observation.source, menuStatus: latest.observation.menu });
      rows.push({
        restaurantId: String(id),
        name,
        wijk,
        domain,
        ...classified,
        checkedAt: latest.job.updated_at || latest.job.created_at || null,
        identityEvidence: null, // never derived from the current data model
      });
      continue;
    }
    let reason;
    if (!domain && !entry) reason = 'no_website';
    else if (entry && entry.inProgress) reason = 'check_in_progress';
    else if (entry && entry.unusableTerminal) reason = 'check_not_usable';
    else reason = 'never_checked';
    notInQueue.push({ restaurantId: String(id), name, wijk, domain, reason });
  }

  return { rows, notInQueue, counts: countQueues(rows), unattributedChecks };
}

/** `{ review, source, identity, total }` — mutually exclusive, so
 * review + source + identity === total, always. */
function countQueues(rows) {
  const counts = { review: 0, source: 0, identity: 0, total: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !QUEUES.includes(row.queue)) continue;
    counts[row.queue] += 1;
    counts.total += 1;
  }
  return counts;
}

function compareName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'nl', { sensitivity: 'base' });
}

function compareOldestCheck(a, b) {
  const ta = timeOf(a.checkedAt);
  const tb = timeOf(b.checkedAt);
  if (ta === tb) return 0;
  if (ta === null) return -1; // an unknown check time is treated as oldest
  if (tb === null) return 1;
  return ta - tb;
}

/** A new, sorted array — the input is never mutated. Unknown modes fall
 * back to the default `action_first`. */
function sortRows(rows, mode = 'action_first') {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const sortMode = SORT_MODES.includes(mode) ? mode : 'action_first';
  list.sort((a, b) => {
    if (sortMode === 'name') return compareName(a, b);
    if (sortMode === 'oldest_check') return compareOldestCheck(a, b) || compareName(a, b);
    return (a.priority - b.priority) || compareOldestCheck(a, b) || compareName(a, b);
  });
  return list;
}

/** Filters by queue ('all' or a queue id), source, menu, wijk and a free-text
 * query on restaurant name or domain. Empty/`'all'` filters match
 * everything. */
function filterRows(rows, { queue = 'all', source = 'all', menu = 'all', wijk = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (queue !== 'all' && row.queue !== queue) return false;
    if (source !== 'all' && row.source !== source) return false;
    if (menu !== 'all' && row.menu !== menu) return false;
    if (wijk !== 'all' && row.wijk !== wijk) return false;
    if (q && !String(row.name || '').toLowerCase().includes(q) && !String(row.domain || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Sorted, unique, non-empty wijk names present in the rows. */
function wijkOptions(rows) {
  const set = new Set();
  for (const row of Array.isArray(rows) ? rows : []) if (row && row.wijk) set.add(row.wijk);
  return [...set].sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' }));
}

module.exports = {
  SOURCE_STATUSES,
  MENU_STATUSES,
  SOURCE_LABELS,
  MENU_LABELS,
  ACTIONS,
  ACTION_LABELS,
  QUEUES,
  QUEUE_LABELS,
  NOT_IN_QUEUE_REASONS,
  NOT_IN_QUEUE_LABELS,
  SORT_MODES,
  SORT_LABELS,
  classifyRow,
  observeJob,
  attributeJob,
  buildSourceWorkqueue,
  countQueues,
  sortRows,
  filterRows,
  wijkOptions,
  domainOf,
  countSummaryMenuItems,
  countRecognizedPdfItems,
};
