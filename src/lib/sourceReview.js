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
//  - a task exists only when a decision is ready for a human: a certain result
//    ("Bevestig bron"), a doubt result ("Menukopjes controleren"), an open
//    proposal, or a source that asks attention (Lead review #6439131777);
//  - there is at most ONE task per restaurant: the newest batch result wins and
//    older results for the same restaurant are not a task. The title is always
//    the restaurant name, never "N restaurants";
//  - dead ends are not tasks (owner decision 2026-10-27): "geen bruikbaar
//    resultaat", a robots/access block and "geen menukaart gevonden" move to
//    Dekking → "Nog niet gecontroleerd" with the existing reason text and the
//    fitting next step in that row;
//  - a restaurant with an active, confirmed source and a published menu is not
//    a task when the newest result says nothing new about that same URL;
//  - nothing expires automatically. A result only stops being a task when a
//    staff member closes it ("Oude resultaten opruimen"), and its age stays
//    visible ("resultaat van 12 dagen geleden");
//  - every batch result gets exactly one row state and exactly one next step
//    (criterion 4), derived from the result the existing BE-25 deriveItemView
//    already produced — no second status vocabulary.
//
// Contract: planning/specs/tickets/be-31-sources-coverage-inline.md.

const { MAX_BATCH_URLS, DAILY_URL_LIMIT } = require('./batchAnalysis');
const { NOT_IN_QUEUE_LABELS } = require('./sourceWorkqueue');
const { parseProposalNote } = require('./sourceDiscovery');

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
  certain: '✅ Klaar om te bevestigen',
  doubt: '⚠️ Controle nodig',
};

// Five visible row states (criterion 4). `progress` is the ⏳ state, `done` is a
// result that already reached its end, `skip` is a line that is not work and
// `handled` is a result a staff member closed by hand (never automatic).
const ROW_STATES = {
  progress: { key: 'progress', emoji: '⏳', label: 'Bezig…' },
  certain: { key: 'certain', emoji: '✅', label: 'Zeker resultaat' },
  doubt: { key: 'doubt', emoji: '⚠️', label: 'Controle nodig' },
  no_menu: { key: 'no_menu', emoji: '📋', label: 'Geen menukaart gevonden' },
  blocked: { key: 'blocked', emoji: '⛔', label: 'Geen bruikbaar resultaat' },
  done: { key: 'done', emoji: '✅', label: 'Bron bevestigd' },
  handled: { key: 'handled', emoji: '🗄️', label: 'Afgehandeld' },
  skip: { key: 'skip', emoji: '—', label: 'Geen actie nodig' },
};

// The row states that still hold a ready decision: only these make a task.
const TASK_ROW_STATES = ['certain', 'doubt'];
// Dead ends (Lead review #6439131777): a finished automatic read without a
// usable menu is not work in Bronnen beoordelen. The restaurant moves to
// Dekking with the existing reason "Laatste controle gaf geen bruikbaar
// resultaat" (NOT_IN_QUEUE_LABELS.check_not_usable) and its own next step.
const DEAD_END_STATES = ['blocked', 'no_menu'];
const DEAD_END_REASON = 'check_not_usable';


// Exactly one next step per row. A row never offers two.
const STEPS = {
  confirm: { key: 'confirm', label: '✅ Bevestig bron' },
  menukopjes: { key: 'menukopjes', label: '⚠️ Menukopjes controleren' },
  ai_read: { key: 'ai_read', label: '📖 Lees met AI' },
  // BE-33 (#79, criterion 1): a menu that only exists as an image or scan gets
  // its own honest next step. It is the same route (and the same step key), so
  // only the words change: "Lees met AI" text can never be offered for an image.
  ai_read_image: { key: 'ai_read', label: '📷 Lees met AI (afbeelding)' },
  manual: { key: 'manual', label: '✍️ Handmatig toevoegen' },
  wait: { key: 'wait', label: '⏳ Even wachten' },
  check: { key: 'check', label: '🔎 Controleer bron' },
  // BE-32 (#75): a found source is a BE-24 proposal. The human confirms it
  // here, and only then does the existing check become the next step.
  confirm_proposal: { key: 'confirm_proposal', label: '✅ Bevestig voorstel' },
  check_proposal: { key: 'check', label: '🔎 Controleer' },
};

const CHECK_COPY = {
  keepOpen:
    'De controle loopt alleen zolang deze pagina open is. Sluit je hem, dan pauzeert de controle en gaat hij verder zodra je terugkomt.',
  running: 'Controle loopt, laat deze pagina open',
  nothingPublished: 'Niets wordt automatisch gepubliceerd.',
  staysTask: 'Wat je hier niet afrondt, blijft als taak staan onder Werkvoorraad → Bronnen beoordelen.',
  noWork: '✅ Geen open bronwerk',
  pickTask: 'Kies een taak links',
  // Lead review #6439131777: the age of a result, re-checking it, and closing
  // old results by hand. Nothing expires automatically (criterion 5).
  recheck: 'Opnieuw controleren',
  cleanup: 'Oude resultaten opruimen',
  cleanupHint:
    'Afgehandeld door een medewerker op een datum. Er wordt niets gewist: het resultaat en de vastlegging blijven bestaan.',
  handled: 'Afgehandeld',
};

// The batch result keys that mean "the automatic read found no usable menu".
// There — and only with a real job — "Lees met AI" (#59) is the next step.
const AI_READ_KEYS = new Set(['no_menu', 'image_only', 'error']);
// Lines that never become work: the same URL twice, or a URL that is already
// in an active batch (BE-25's own statuses).
const SKIP_KEYS = new Set(['duplicate', 'not_queued']);

/** A timestamp in milliseconds, or null — never NaN. */
function timeOf(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * The visible age of a result: "resultaat van vandaag", "resultaat van 1 dag
 * geleden", "resultaat van 12 dagen geleden". Nothing expires by itself, so the
 * age is information, never a reason to hide a result. `now` is passed by the
 * caller (this module has no clock); without it there is no age claim.
 */
function ageLabel(resultAt, now) {
  const then = timeOf(resultAt);
  const base = timeOf(now);
  if (then === null || base === null) return null;
  const days = Math.max(0, Math.floor((base - then) / 86400000));
  if (days === 0) return 'resultaat van vandaag';
  if (days === 1) return 'resultaat van 1 dag geleden';
  return `resultaat van ${days} dagen geleden`;
}

/**
 * BE-33 (#79, criterion 1): may a row claim that "Lees met AI" can read an
 * image? Only when the same existing status endpoint says AI is on *and* the
 * month budget allows a call. Anything unknown — no status yet, a failed
 * request, AI off, budget exhausted — is `false`, so the row falls back to the
 * manual route instead of a button that cannot work.
 */
function aiReadReady(status) {
  if (!status || status.enabled !== true) return false;
  if (status.budget && status.budget.allowed === false) return false;
  return true;
}

/**
 * One batch result (BE-25 `deriveItemView` output) → one row:
 * { key, position, url, jobId, restaurant, foundUrl, detail, actions,
 *   resultAt, age, handled, state, emoji, label, step }.
 * Exactly one `step`; `null` only for a finished, closed or work-free row.
 *
 * `aiReady` is the answer of the existing AI status endpoint (`aiReadReady`);
 * it decides only the image/scan row, never a text reading.
 */
function rowForBatchItem(item, { batchId, returnTo, now, aiReady } = {}) {
  const key = item && typeof item.key === 'string' ? item.key : null;
  const resultAt = (item && item.resultAt) || null;
  const base = {
    key,
    position: item && item.position !== undefined ? item.position : null,
    url: (item && item.url) || null,
    jobId: (item && item.jobId) || null,
    restaurant: (item && item.restaurant) || null,
    foundUrl: (item && item.foundUrl) || null,
    detail: (item && item.text) || null,
    actions: Array.isArray(item && item.actions) ? item.actions : [],
    resultAt,
    age: ageLabel(resultAt, now),
    handled: null,
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
  // A result a staff member closed by hand is not work any more; the record
  // itself stays (review point 6).
  const handled = item.handled && typeof item.handled === 'object' ? item.handled : null;
  if (handled) return row('handled', null, { handled: { at: handled.at || null, by: handled.by || null } });
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
    // BE-33 (#79, criterion 1): an image/scan menu gets its own step, and only
    // when the AI can actually read an image (AI on + budget) *and* the job is
    // a real source. Otherwise the row says "Handmatig toevoegen" — never a
    // "Lees met AI" that can only read text.
    if (key === 'image_only') {
      // Without a job there is no source at all: a blocked row with the manual
      // route. With a job the row keeps the same outcome (a menu exists only as
      // an image) and differs only in its one next step: the AI reading when it
      // can read an image, the manual import when it cannot.
      if (!base.jobId) return row('blocked', STEPS.manual);
      if (aiReady === true) return row('no_menu', STEPS.ai_read_image);
      return row('no_menu', STEPS.manual);
    }
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
    // BE-33 (#79): the image/scan step is the one that may read images, so the
    // screen may ask for the estimate of that reading before the click.
    if (row.step.label === STEPS.ai_read_image.label) params.set('image', '1');
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

/** True when this batch result is a ready decision that still waits for a
 * human (criterion 2 + Lead review #6439131777). A running result, a dead end
 * and a result a staff member already handled are not work in Bronnen. */
function rowNeedsAction(row) {
  return Boolean(row && row.step && TASK_ROW_STATES.includes(row.state) && !row.handled);
}


/** A queue entry asks attention when its source or its menu is not in order —
 * the same facts BE-23's own attention text names. A source that is reachable
 * with a menu ready for review needs no new source work here. */
function asksAttention(entry) {
  if (ATTENTION_STEPS.includes(entry.next_step)) return true;
  if (entry.source && entry.source !== 'reachable') return true;
  if (entry.menu && entry.menu !== 'ready_for_review') return true;
  return false;
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
  if (entry.next_step !== 'proposals_unknown' && asksAttention(entry)) {
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

// ── One task per restaurant (Lead review #6439131777) ────────────────────────
// A batch is not a task: a restaurant is. All loaded results of one restaurant
// are grouped, the newest result decides, and older results are kept only as
// context and as ids for "Oude resultaten opruimen".

/** Newest result first: by result time, then by position, then batch id. */
function newestFirst(a, b) {
  const ta = timeOf(a.at);
  const tb = timeOf(b.at);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  if (a.position !== b.position) return a.position - b.position;
  return String(a.batchId).localeCompare(String(b.batchId));
}

/**
 * All loaded batch details → one group per known restaurant, newest result
 * first. A result without a known restaurant cannot become a task: there is no
 * name to show and no Dekking row to fall back to (the batch screen still shows
 * the line itself).
 *
 * group: {
 *   restaurantId, name,
 *   newest: { row, batchId, at },          the result that decides
 *   rows: row[]                            the newest result(s) of that batch
 *   olderCount, resultAt, age,
 *   handledJobIds: string[]                every job of this restaurant, still open
 *   detailById: Map<batchId, detail>
 * }
 */
function groupBatchResults(batchDetails, { returnTo, now, aiReady } = {}) {
  const groups = new Map();
  for (const detail of Array.isArray(batchDetails) ? batchDetails : []) {
    if (!detail || !detail.batch || !detail.batch.id) continue;
    const batch = detail.batch;
    const items = Array.isArray(detail.items) ? detail.items : [];
    for (const item of items) {
      const row = rowForBatchItem(item, { batchId: batch.id, returnTo, now, aiReady });
      const restaurant = row.restaurant;
      if (!restaurant || !restaurant.id) continue;
      const id = String(restaurant.id);
      if (!groups.has(id)) {
        groups.set(id, {
          restaurantId: id,
          name: restaurant.name || '',
          results: [],
          detailById: new Map(),
        });
      }
      const group = groups.get(id);
      group.detailById.set(batch.id, detail);
      group.results.push({
        row,
        batchId: batch.id,
        batchAt: batch.created_at || null,
        at: row.resultAt || batch.created_at || null,
        position: row.position === null || row.position === undefined ? Number.MAX_SAFE_INTEGER : Number(row.position),
      });
    }
  }

  const list = [];
  for (const group of groups.values()) {
    const results = group.results.slice().sort(newestFirst);
    const newest = results[0];
    // Everything of the winner's own batch for this restaurant: a restaurant
    // with two URLs in one batch shows both lines, not a made-up summary.
    const rows = results
      .filter((entry) => entry.batchId === newest.batchId)
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.row);
    const handledJobIds = [];
    for (const entry of results) {
      const jobId = entry.row.jobId;
      if (!jobId || entry.row.handled || handledJobIds.includes(jobId)) continue;
      handledJobIds.push(jobId);
    }
    const resultAt = newest.at || null;
    list.push({
      restaurantId: group.restaurantId,
      name: group.name,
      newest,
      rows,
      olderCount: results.length - rows.length,
      resultAt,
      age: ageLabel(resultAt, now),
      handledJobIds,
      batchIds: [...new Set(results.map((entry) => entry.batchId))],
      detailById: group.detailById,
      results,
    });
  }
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'nl', { sensitivity: 'base' }));
}

/** The URL of this restaurant's accepted proposal = its active, confirmed
 * source (BE-24's own vocabulary). */
function confirmedSourceUrl(entry) {
  const proposals = entry && Array.isArray(entry.proposals) ? entry.proposals : [];
  const accepted = proposals.find((p) => p && p.status === 'accepted' && p.proposed_url);
  return accepted ? accepted.proposed_url : null;
}

function sameUrl(a, b) {
  if (!a || !b) return false;
  return String(a).trim().replace(/\/+$/, '') === String(b).trim().replace(/\/+$/, '');
}

/**
 * Review point 4: an active, confirmed source (or a published menu on that
 * source) means a result about exactly that same URL says nothing new. A
 * different menu URL is new and stays a task.
 */
function resultMatchesConfirmedSource(row, entry) {
  const confirmed = confirmedSourceUrl(entry);
  return Boolean(confirmed && row.foundUrl && sameUrl(row.foundUrl, confirmed));
}

/**
 * One restaurant's newest result → one task, or null when no decision is
 * waiting. Only a certain result and a doubt result are tasks; dead ends,
 * running results, confirmed results and handled results are not.
 */
function taskFromGroup(group, { entry } = {}) {
  if (!group || !group.newest) return null;
  const row = group.newest.row;
  if (!TASK_ROW_STATES.includes(row.state)) return null;
  if (resultMatchesConfirmedSource(row, entry)) return null;
  const active = group.rows.filter(rowNeedsAction);
  const what = [row.step ? row.step.label : null, group.age].filter(Boolean).join(' · ');
  return {
    id: `batch:${group.newest.batchId}:${group.restaurantId}`,
    kind: 'batch',
    emoji: TASK_EMOJI.batch,
    // The title is always the restaurant name, never "N restaurants".
    name: group.name || 'Onbekend restaurant',
    status: TASK_STATUS_LABELS[row.state] || TASK_STATUS_LABELS.doubt,
    what,
    batchId: group.newest.batchId,
    batchIds: group.batchIds,
    restaurantId: group.restaurantId,
    rows: group.rows,
    activeCount: active.length,
    olderCount: group.olderCount,
    resultAt: group.resultAt,
    ageLabel: group.age,
    // "Oude resultaten opruimen" closes this restaurant's whole result set;
    // otherwise the next-oldest result would simply become the task.
    handledJobIds: group.handledJobIds,
    detail: group.detailById.get(group.newest.batchId) || null,
    url: row.url || null,
    entry: null,
  };
}

function entryById(entries, restaurantId) {
  const id = String(restaurantId);
  return (Array.isArray(entries) ? entries : []).find((entry) => entry && String(entry.restaurant_id) === id) || null;
}
/**
 * All tasks of the screen: one per restaurant, in the contract's own order
 * (batch, proposal, attention), then by name.
 *  - an open proposal is the one task of its restaurant: it decides the source
 *    itself, so a batch result of that same restaurant is not a second task;
 *  - when a restaurant has a loaded batch result and no open proposal, that
 *    newest result decides (task or not); its triage attention signal never
 *    adds a second task for the same restaurant.
 */
function selectTasks({ entries, batchDetails, returnTo, now, aiReady } = {}) {
  const entryList = Array.isArray(entries) ? entries : [];
  const groups = groupBatchResults(batchDetails, { returnTo, now, aiReady });
  const groupById = new Map(groups.map((group) => [group.restaurantId, group]));
  const tasks = [];
  for (const group of groups) {
    const entry = entryById(entryList, group.restaurantId);
    if (entry && entry.open_proposal_id) continue;
    const task = taskFromGroup(group, { entry });
    if (task) tasks.push(task);
  }
  for (const entry of entryList) {
    if (!entry || !entry.restaurant_id) continue;
    // The batch result already decided for this restaurant, unless the
    // restaurant needs a decision on its source first (an open proposal).
    if (groupById.has(String(entry.restaurant_id)) && !entry.open_proposal_id) continue;
    const task = taskFromEntry(entry);
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
 * Dekking: "Nog niet gecontroleerd" (criterion 3 + Lead review #6439131777).
 *  - the existing queue-less reasons keep their own row and reason text;
 *  - a restaurant whose newest batch result is a dead end ("geen bruikbaar
 *    resultaat", a robots/access block, "geen menukaart gevonden") is listed
 *    here with the existing reason "Laatste controle gaf geen bruikbaar
 *    resultaat" and its own fitting next step ("Handmatig toevoegen" or
 *    "Lees met AI") in the row;
 *  - a restaurant with a ready decision is a task on /internal/bronnen instead,
 *    so the same work never appears on both screens;
 *  - a row without a website cannot be checked and says so instead of offering
 *    a dead button.
 */
function coverageRows(entries, { batchDetails, now, aiReady } = {}) {
  const groups = groupBatchResults(batchDetails, { now, aiReady });
  const groupById = new Map(groups.map((group) => [group.restaurantId, group]));
  const rows = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !entry.not_in_queue_reason) continue;
    const id = String(entry.restaurant_id);
    if (seen.has(id)) continue;
    const group = groupById.get(id) || null;
    // A ready decision belongs to Bronnen beoordelen, not to Dekking.
    if (group && TASK_ROW_STATES.includes(group.newest.row.state)) continue;
    seen.add(id);
    rows.push(coverageRow(entry, group, now));
  }
  for (const group of groups) {
    if (seen.has(group.restaurantId)) continue;
    if (!DEAD_END_STATES.includes(group.newest.row.state)) continue;
    seen.add(group.restaurantId);
    rows.push(coverageRow(null, group, now));
  }
  return rows;
}

/**
 * BE-32 (#75): the newest usable source proposal of one restaurant, with the
 * provenance read back from its note. Only the two URL kinds can become a
 * source; `mark_unusable` is not a source.
 */
function discoveryProposalFromEntry(entry) {
  const proposals = entry && Array.isArray(entry.proposals) ? entry.proposals : [];
  const usable = proposals
    .filter(
      (proposal) =>
        proposal &&
        (proposal.kind === 'add_candidate' || proposal.kind === 'replace_source') &&
        typeof proposal.proposed_url === 'string' &&
        proposal.proposed_url !== '',
    )
    .sort((a, b) => String(b.proposed_at || '').localeCompare(String(a.proposed_at || '')));
  const proposal = usable[0];
  if (!proposal) return null;
  const parsed = parseProposalNote(proposal.note);
  return {
    id: proposal.id || null,
    status: proposal.status || 'open',
    url: proposal.proposed_url,
    origin: parsed.origin,
    website: parsed.website,
    menu: parsed.menu,
    quote: parsed.quote,
    source: parsed.source,
    note: proposal.note || null,
  };
}

/** One Dekking row: the existing reason plus, for a dead end, the outcome, the
 * age and the one fitting next step of the same batch result. */
function coverageRow(entry, group, now) {
  const newest = group ? group.newest : null;
  const resultRow = newest ? newest.row : null;
  const deadEnd = Boolean(resultRow && DEAD_END_STATES.includes(resultRow.state));
  const proposal = discoveryProposalFromEntry(entry);
  const openProposal = proposal && proposal.status === 'open' ? proposal : null;
  const acceptedProposal = proposal && proposal.status === 'accepted' ? proposal : null;
  const knownUrl = (entry && entry.known_url) || null;
  // A proposal is a found source: the row shows it and checks it once the human
  // has confirmed it. An open proposal is the next step; nothing is automatic.
  const url = openProposal ? openProposal.url : knownUrl || (acceptedProposal ? acceptedProposal.url : null) || (resultRow && resultRow.url) || null;
  const reason = (entry && entry.not_in_queue_reason) || (deadEnd ? DEAD_END_REASON : null);
  const resultAt = (resultRow && resultRow.resultAt) || (newest && newest.at) || null;
  return {
    restaurantId: String((entry && entry.restaurant_id) || group.restaurantId),
    name: (entry && entry.name) || (group && group.name) || '',
    wijk: (entry && entry.wijk) || null,
    // The same shape the shared row/step helpers already understand, so
    // "Lees met AI" and "Handmatig toevoegen" keep their existing links.
    restaurant: {
      id: String((entry && entry.restaurant_id) || group.restaurantId),
      name: (entry && entry.name) || (group && group.name) || '',
    },
    url,
    reason,
    reasonLabel: NOT_IN_QUEUE_LABELS[reason] || 'Nog niet gecontroleerd',
    canCheck: Boolean(url),
    // A dead end shows its own outcome and one next step; every other row keeps
    // the existing "Controleer bron" action.
    deadEnd,
    outcome: resultRow ? resultRow.label : null,
    outcomeState: resultRow ? resultRow.state : null,
    detail: resultRow ? resultRow.detail : null,
    resultAt,
    age: ageLabel(resultAt, now),
    jobId: resultRow ? resultRow.jobId : null,
    batchId: newest ? newest.batchId : null,
    // BE-32: the proposal and its provenance, for the row's own text and step.
    proposal: openProposal || (acceptedProposal ? { ...acceptedProposal, confirmed: true } : null),
    proposedUrl: openProposal ? openProposal.url : acceptedProposal ? acceptedProposal.url : null,
    step: openProposal
      ? STEPS.confirm_proposal
      : deadEnd && resultRow.step
        ? resultRow.step
        : url
          ? acceptedProposal && !knownUrl
            ? STEPS.check_proposal
            : STEPS.check
          : null,
  };
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

/**
 * BE-32 (#75, criterion 7 / BE-31 leftover): "Oude resultaten opruimen" may only
 * act on a selection, or it must say out loud that it takes all N. The label is
 * decided here so the button, the dialog and the tests read the same sentence.
 */
function cleanupLabel(pickedCount, pickableCount) {
  const picked = Number.isInteger(pickedCount) && pickedCount > 0 ? pickedCount : 0;
  const total = Number.isInteger(pickableCount) && pickableCount > 0 ? pickableCount : 0;
  if (picked > 0) return `Opruimen (${picked} geselecteerd)`;
  return `Alle ${total} opruimen`;
}

/** The one confirmation line: names the number and whether it was a selection. */
function cleanupConfirmText({ count, all } = {}) {
  const n = Number.isInteger(count) ? count : 0;
  const noun = n === 1 ? 'resultaat' : 'resultaten';
  return `${all ? `Alle ${n}` : `${n}`} ${noun} afhandelen?`;
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
  TASK_ROW_STATES,
  DEAD_END_STATES,
  DEAD_END_REASON,
  MAX_BATCH_URLS,
  DAILY_URL_LIMIT,
  ageLabel,
  aiReadReady,
  rowForBatchItem,
  stepHref,
  safeReturnHref,
  menukopjesBackHref,
  rowNeedsAction,
  taskFromEntry,
  groupBatchResults,
  selectTasks,
  countTasks,
  filterTasks,
  effectiveTaskFilter,
  coverageRows,
  discoveryProposalFromEntry,
  checkSelection,
  canStartCheck,
  countSourceReviewTasks,
  cleanupLabel,
  cleanupConfirmText,
};

