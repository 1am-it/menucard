'use strict';

// BE-31 (#74) — pure decision logic behind the new address /internal/bronnen
// ("Bronnen beoordelen"), the one shared result row of Dekking/Toevoegen, and
// the "Nog niet gecontroleerd" section of Dekking.
//
// Deliberately CommonJS, same reasoning as sourceTriage.js/sourceWorkqueue.js:
// directly testable with the project's existing `node --test` tooling, no new
// dependency, usable by the 'use client' pages that import it.
//
// This module never touches Supabase, the network, the DOM or a clock. It only
// turns already-fetched rows into what the screens show, and it refuses to
// invent work:
//  - a task exists only when a human action is needed (an open proposal, a
//    source that asks attention, or a batch result with a next step);
//  - "Nog niet gecontroleerd" is NOT a task (owner decision 2026-10-27): those
//    restaurants live in Dekking, with their existing reason texts;
//  - every batch result gets exactly one row state and exactly one next step
//    (criterion 4), derived from the result the existing BE-25 deriveItemView
//    already produced — no second status vocabulary.
//
// Contract: planning/specs/tickets/be-31-sources-coverage-inline.md.

const { MAX_BATCH_URLS, DAILY_URL_LIMIT } = require('./batchAnalysis');
const { NOT_IN_QUEUE_LABELS } = require('./sourceWorkqueue');

// Addresses (criteria 1, 4 and 5). Technical names — tables, APIs, ids — stay
// unchanged; only the visible route is new.
const BRONNEN_HREF = '/internal/bronnen';
const COVERAGE_HREF = '/internal/coverage';
const MENUKOPJES_HREF = '/internal/bronnen/batch';
const MANUAL_IMPORT_HREF = '/internal/menu-import';
const ADD_ENTRY_HREF = '/internal/toevoegen';

const TASK_KINDS = ['batch', 'proposal', 'attention'];
const TASK_FILTERS = ['all', ...TASK_KINDS];
const TASK_FILTER_LABELS = {
  all: 'Alles',
  batch: '🧪 Batches',
  proposal: '💡 Voorstellen',
  attention: '📡 Aandacht',
};
const TASK_EMOJI = { batch: '🧪', proposal: '💡', attention: '📡' };
const KIND_RANK = { batch: 0, proposal: 1, attention: 2 };

// The triage next-steps that describe a source asking attention (BE-24's own
// vocabulary). `review_proposal` is its own task kind; `check_via_onboarding`
// belongs to the onboarding/queue screens and is deliberately not work here.
const ATTENTION_STEPS = ['add_candidate', 'replace_or_mark', 'inspect_or_mark'];

const TASK_STATUS_LABELS = {
  proposal: '🕒 Wacht op besluit',
  attention: '📡 Vraagt aandacht',
  batch: '⚠️ Controle nodig',
};

// Five visible row states (criterion 4). `progress` is the ⏳ state, `done` is a
// result that already reached its end, `skip` is a line that is not work.
const ROW_STATES = {
  progress: { key: 'progress', emoji: '⏳', label: 'Bezig…' },
  certain: { key: 'certain', emoji: '✅', label: 'Zeker resultaat' },
  doubt: { key: 'doubt', emoji: '⚠️', label: 'Controle nodig' },
  no_menu: { key: 'no_menu', emoji: '📋', label: 'Geen menukaart gevonden' },
  blocked: { key: 'blocked', emoji: '⛔', label: 'Geen bruikbaar resultaat' },
  done: { key: 'done', emoji: '✅', label: 'Bron bevestigd' },
  skip: { key: 'skip', emoji: '—', label: 'Geen actie nodig' },
};

// Exactly one next step per row. A row never offers two.
const STEPS = {
  confirm: { key: 'confirm', label: '✅ Bevestig bron' },
  menukopjes: { key: 'menukopjes', label: '⚠️ Menukopjes controleren' },
  ai_read: { key: 'ai_read', label: '📖 Lees met AI' },
  manual: { key: 'manual', label: '✍️ Handmatig toevoegen' },
  wait: { key: 'wait', label: '⏳ Even wachten' },
  check: { key: 'check', label: '🔎 Controleer bron' },
};

const CHECK_COPY = {
  keepOpen:
    'De controle loopt alleen zolang deze pagina open is. Sluit je hem, dan pauzeert de controle en gaat hij verder zodra je terugkomt.',
  running: 'Controle loopt, laat deze pagina open',
  nothingPublished: 'Niets wordt automatisch gepubliceerd.',
  staysTask: 'Wat je hier niet afrondt, blijft als taak staan onder Werkvoorraad → Bronnen beoordelen.',
  noWork: '✅ Geen open bronwerk',
  pickTask: 'Kies een taak links',
};

// The batch result keys that mean "the automatic read found no usable menu".
// There — and only with a real job — "Lees met AI" (#59) is the next step.
const AI_READ_KEYS = new Set(['no_menu', 'image_only', 'error']);
// Lines that never become work: the same URL twice, or a URL that is already
// in an active batch (BE-25's own statuses).
const SKIP_KEYS = new Set(['duplicate', 'not_queued']);


/**
 * One batch result (BE-25 `deriveItemView` output) → one row:
 * { key, position, url, jobId, restaurant, foundUrl, detail, actions,
 *   state, emoji, label, step }.
 * Exactly one `step`; `null` only for a finished or work-free row.
 */
function rowForBatchItem(item, { batchId, returnTo } = {}) {
  const key = item && typeof item.key === 'string' ? item.key : null;
  const base = {
    key,
    position: item && item.position !== undefined ? item.position : null,
    url: (item && item.url) || null,
    jobId: (item && item.jobId) || null,
    restaurant: (item && item.restaurant) || null,
    foundUrl: (item && item.foundUrl) || null,
    detail: (item && item.text) || null,
    actions: Array.isArray(item && item.actions) ? item.actions : [],
    step: null,
    batchId: batchId || null,
  };
  const row = (state, step, extra) => ({
    ...base,
    state: ROW_STATES[state].key,
    emoji: ROW_STATES[state].emoji,
    label: ROW_STATES[state].label,
    step: step || null,
    ...extra,
  });

  if (!item) return row('skip', null);
  if (key === 'confirmed') return row('done', null);
  if (key === 'queued' || key === 'running') return row('progress', STEPS.wait);
  if (SKIP_KEYS.has(key)) return row('skip', null);
  if (key === 'menu_found') return row('certain', STEPS.confirm);

  const structureReview = item.structureReview;
  if (key === 'needs_review') {
    // Only the explicitly eligible human structure review is "twijfel" with the
    // BE-30 screen; anything else cannot be confirmed and is a manual result.
    if (structureReview && structureReview.eligible === true) return row('doubt', STEPS.menukopjes);
    return row('blocked', STEPS.manual);
  }
  if (key === 'recent') {
    const canConfirm = Boolean(item.high) || base.actions.includes('confirm');
    return canConfirm ? row('certain', STEPS.confirm) : row('blocked', STEPS.manual);
  }
  if (AI_READ_KEYS.has(key)) {
    // An AI reading needs the existing analysis job; without one, the honest
    // fallback is the manual import, never a button that cannot work.
    if (base.jobId) return row('no_menu', STEPS.ai_read);
    return row('blocked', STEPS.manual);
  }
  // Blocked sources (robots, invalid, technical failure, unknown restaurant).
  return row('blocked', STEPS.manual);
}

/** The href of a row's one next step, or null when the step is an in-page action
 * (confirm/wait) or the row has no step. */
function stepHref(row, { batchId, returnTo } = {}) {
  if (!row || !row.step) return null;
  const restaurant = row.restaurant;
  const batch = batchId || row.batchId;
  if (row.step.key === 'menukopjes') {
    if (!batch) return null;
    const params = new URLSearchParams({ batch: String(batch) });
    if (row.position !== null && row.position !== undefined) params.set('item', String(row.position));
    const safe = safeReturnHref(returnTo);
    if (safe) params.set('return', safe);
    return `${MENUKOPJES_HREF}?${params.toString()}`;
  }
  if (row.step.key === 'ai_read') {
    if (!row.jobId) return null;
    const params = new URLSearchParams({ job: String(row.jobId) });
    if (restaurant && restaurant.id) {
      params.set('restaurant', String(restaurant.id));
      if (restaurant.name) params.set('name', String(restaurant.name));
    }
    if (row.url) params.set('url', String(row.url));
    return `${MANUAL_IMPORT_HREF}?${params.toString()}`;
  }
  if (row.step.key === 'manual') {
    if (!restaurant || !restaurant.id) return MANUAL_IMPORT_HREF;
    const params = new URLSearchParams({ restaurant: String(restaurant.id) });
    if (restaurant.name) params.set('name', String(restaurant.name));
    return `${MANUAL_IMPORT_HREF}?${params.toString()}`;
  }
  return null;
}

/** Only the internal screens of this flow may be a return target; anything else
 * is ignored instead of becoming an open redirect. */
function safeReturnHref(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === BRONNEN_HREF || text.startsWith(`${BRONNEN_HREF}?`)) return text;
  if (text === ADD_ENTRY_HREF || text.startsWith(`${ADD_ENTRY_HREF}?`)) return text;
  if (text === COVERAGE_HREF) return text;
  return null;
}

/** The menukopjes screen's own back link: the row it came from, else the list. */
function menukopjesBackHref(returnTo) {
  return safeReturnHref(returnTo) || BRONNEN_HREF;
}

/** True when this batch result still needs a human action (criterion 2). */
function rowNeedsAction(row) {
  return Boolean(row && (row.step || row.state === 'progress'));
}


/** One triage entry → one task, or null when it is not work (criterion 2/3). */
function taskFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  // "Nog niet gecontroleerd" and the other queue-less reasons live in Dekking.
  if (entry.not_in_queue_reason) return null;
  if (!entry.restaurant_id) return null;
  const base = {
    id: `entry:${entry.restaurant_id}`,
    kind: null,
    restaurantId: String(entry.restaurant_id),
    name: entry.name || '',
    wijk: entry.wijk || null,
    domain: entry.domain || null,
    url: entry.known_url || null,
    entry,
  };
  if (entry.open_proposal_id) {
    return {
      ...base,
      kind: 'proposal',
      emoji: TASK_EMOJI.proposal,
      status: TASK_STATUS_LABELS.proposal,
      what: entry.domain ? `Nieuwe bron voorgesteld: ${entry.domain}` : 'Nieuwe bron voorgesteld',
    };
  }
  if (ATTENTION_STEPS.includes(entry.next_step)) {
    return {
      ...base,
      kind: 'attention',
      emoji: TASK_EMOJI.attention,
      status: TASK_STATUS_LABELS.attention,
      what: entry.attention || (entry.domain ? `Bron vraagt aandacht: ${entry.domain}` : 'Bron vraagt aandacht'),
    };
  }
  return null;
}

/**
 * One batch detail (BE-25 GET `detail`: { batch, items }) → one task, or null
 * when no line still needs a human action. The rows are the same objects the
 * shared result row renders; nothing is copied.
 */
function taskFromBatch(detail, { returnTo } = {}) {
  if (!detail || !detail.batch || !detail.batch.id) return null;
  const batch = detail.batch;
  const rows = (Array.isArray(detail.items) ? detail.items : []).map((item) =>
    rowForBatchItem(item, { batchId: batch.id, returnTo }),
  );
  const active = rows.filter(rowNeedsAction);
  if (active.length === 0) return null;
  const doubt = active.filter((row) => row.state === 'doubt').length;
  const progress = active.filter((row) => row.state === 'progress').length;
  return {
    id: `batch:${batch.id}`,
    kind: 'batch',
    emoji: TASK_EMOJI.batch,
    name: batchName(rows),
    status: TASK_STATUS_LABELS.batch,
    what: batchTaskWhat({ active, doubt, progress }),
    batchId: batch.id,
    rows,
    activeCount: active.length,
    detail,
    url: null,
    entry: null,
  };
}

/** The batch task's title: the restaurant when the rows agree on one, else a
 * plain count. Never an invented name. */
function batchName(rows) {
  const names = [...new Set(rows.map((row) => row.restaurant && row.restaurant.name).filter(Boolean))];
  if (names.length === 1) return names[0];
  if (names.length > 1) return `${names.length} restaurants`;
  return 'Onbekend restaurant';
}

function batchTaskWhat({ active, doubt, progress }) {
  if (progress > 0 && doubt === 0) return CHECK_COPY.running;
  if (doubt > 0) return `Menukopjes controleren · ${doubt}`;
  return `${active.length} resultaat${active.length === 1 ? '' : 'en'} met een volgende stap`;
}

/** All tasks of the screen, in the contract's own order (batch, proposal,
 * attention), then by name. */
function selectTasks({ entries, batchDetails, returnTo } = {}) {
  const tasks = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const task = taskFromEntry(entry);
    if (task) tasks.push(task);
  }
  for (const detail of Array.isArray(batchDetails) ? batchDetails : []) {
    const task = taskFromBatch(detail, { returnTo });
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => {
    const rank = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
    if (rank !== 0) return rank;
    return String(a.name).localeCompare(String(b.name), 'nl', { sensitivity: 'base' });
  });
}


/** Real numbers for the chips; every task counts exactly once. */
function countTasks(tasks) {
  const counts = { all: 0, batch: 0, proposal: 0, attention: 0 };
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || !TASK_KINDS.includes(task.kind)) continue;
    counts.all += 1;
    counts[task.kind] += 1;
  }
  return counts;
}

function filterTasks(tasks, filter) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!TASK_KINDS.includes(filter)) return list;
  return list.filter((task) => task && task.kind === filter);
}

/** The filter actually applied: an unknown kind shows everything. */
function effectiveTaskFilter(filter) {
  return TASK_FILTERS.includes(filter) ? filter : 'all';
}

/**
 * Dekking: the restaurants without a usable source check (criterion 3), with
 * the existing reason texts and the two existing check routes. A row without a
 * website cannot be checked and says so instead of offering a dead button.
 */
function coverageRows(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.not_in_queue_reason)
    .map((entry) => ({
      restaurantId: String(entry.restaurant_id),
      name: entry.name || '',
      wijk: entry.wijk || null,
      url: entry.known_url || null,
      reason: entry.not_in_queue_reason,
      reasonLabel: NOT_IN_QUEUE_LABELS[entry.not_in_queue_reason] || 'Nog niet gecontroleerd',
      canCheck: Boolean(entry.known_url),
      step: entry.known_url ? STEPS.check : null,
    }));
}

/**
 * The URLs of one explicit "Controleer N geselecteerde" click. Only known
 * websites are checked, duplicates are dropped, and the existing maximum of
 * MAX_BATCH_URLS per batch is respected instead of silently cut: the caller
 * shows `tooMany`.
 */
function checkSelection(rows, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const urls = [];
  const skipped = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !selected.has(row.restaurantId)) continue;
    if (!row.canCheck || !row.url) {
      skipped.push(row);
      continue;
    }
    if (!urls.includes(row.url)) urls.push(row.url);
  }
  const tooMany = urls.length > MAX_BATCH_URLS;
  return {
    urls: tooMany ? urls.slice(0, MAX_BATCH_URLS) : urls,
    count: tooMany ? MAX_BATCH_URLS : urls.length,
    selectedCount: selected.size,
    tooMany,
    skipped: skipped.map((row) => row.name).filter(Boolean),
  };
}

/** The existing batch limits (10 per batch, 25 per day), stated before a click. */
function canStartCheck({ count, remaining } = {}) {
  const n = Number.isInteger(count) ? count : 0;
  const left = Number.isInteger(remaining) ? remaining : DAILY_URL_LIMIT;
  if (n <= 0) return { ok: false, reason: 'Kies minstens één restaurant met een bekende website.' };
  if (n > MAX_BATCH_URLS) return { ok: false, reason: `Maximaal ${MAX_BATCH_URLS} URL's per batch.` };
  if (n > left) return { ok: false, reason: `Je hebt vandaag nog ${left} URL's over van ${DAILY_URL_LIMIT}.` };
  return { ok: true, reason: null };
}

/** What the Werkvoorraad number counts: exactly the tasks this screen shows. */
function countSourceReviewTasks(tasks) {
  return countTasks(tasks).all;
}
module.exports = {
  BRONNEN_HREF,
  COVERAGE_HREF,
  MENUKOPJES_HREF,
  MANUAL_IMPORT_HREF,
  ADD_ENTRY_HREF,
  TASK_KINDS,
  TASK_FILTERS,
  TASK_FILTER_LABELS,
  TASK_EMOJI,
  TASK_STATUS_LABELS,
  ATTENTION_STEPS,
  ROW_STATES,
  STEPS,
  CHECK_COPY,
  AI_READ_KEYS,
  SKIP_KEYS,
  MAX_BATCH_URLS,
  DAILY_URL_LIMIT,
  rowForBatchItem,
  stepHref,
  safeReturnHref,
  menukopjesBackHref,
  rowNeedsAction,
  taskFromEntry,
  taskFromBatch,
  selectTasks,
  countTasks,
  filterTasks,
  effectiveTaskFilter,
  coverageRows,
  checkSelection,
  canStartCheck,
  countSourceReviewTasks,
};

