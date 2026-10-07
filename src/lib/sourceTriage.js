// Brontriage (BE-24) — pure logic behind /internal/source-triage.
// Deliberately CommonJS, same reasoning as sourceWorkqueue.js: directly
// testable with this project's `node --test`, no new dependency, usable by
// both the API handlers and the page.
//
// This module never touches Supabase, the network, the DOM or React. A
// proposed URL is validated as TEXT only — it is never requested. Nothing
// here publishes, analyses or changes data; it only validates proposal
// input and turns existing rows (BE-23's workqueue, the restaurant list and
// stored proposals) into what the page shows.
//
// Contract: planning/specs/tickets/be-24-internal-source-triage.md.

'use strict';

const { SOURCE_LABELS, MENU_LABELS, NOT_IN_QUEUE_LABELS } = require('./sourceWorkqueue');

/** Shown literally next to every proposal action and on the page. */
const TRIAGE_NOTICE = 'Wijzigingen worden pas na controle verwerkt.';

const PROPOSAL_KINDS = ['add_candidate', 'replace_source', 'mark_unusable'];

const KIND_LABELS = {
  add_candidate: 'URL toevoegen als kandidaatbron',
  replace_source: 'Bron vervangen',
  mark_unusable: 'Bron markeren als onbruikbaar',
};

const UNUSABLE_REASONS = ['site_offline', 'other_business', 'no_menu_on_source', 'access_blocked', 'other'];

const UNUSABLE_REASON_LABELS = {
  site_offline: 'Website niet meer online',
  other_business: 'Website hoort bij een andere zaak',
  no_menu_on_source: 'Geen menukaart op deze bron',
  access_blocked: 'Website staat automatisch lezen niet toe',
  other: 'Andere reden',
};

const PROPOSAL_STATUSES = ['open', 'accepted', 'rejected'];

const STATUS_LABELS = {
  open: 'Wacht op controle',
  accepted: 'Geaccepteerd',
  rejected: 'Afgewezen',
};

// Kleurtaal v2 role + StatusIcon name per proposal status. `--status-action`
// stays unused: Kleurtaal v2 reserves it until a product decision.
const STATUS_ROLES = {
  open: { tone: 'neutral', icon: 'clock' },
  accepted: { tone: 'positive', icon: 'check' },
  rejected: { tone: 'neutral', icon: 'cross' },
};

// BE-23's Bron/Menukaart badges, same Kleurtaal v2 mapping as
// app/internal/source-workqueue/page.js (design-reference.md, "BE-23
// mapping"); icons are StatusIcon names.
const SOURCE_BADGES = {
  reachable: { tone: 'positive', icon: 'check' },
  unreachable: { tone: 'blocked', icon: 'cross' },
  access_limited: { tone: 'old', icon: 'alert' },
  identity_changed: { tone: 'old', icon: 'alert' },
};
const MENU_BADGES = {
  ready_for_review: { tone: 'file', icon: 'alert' },
  structure_not_recognized: { tone: 'old', icon: 'alert' },
  no_menu_found: { tone: 'neutral', icon: 'dot' },
  not_assessed: { tone: 'neutral', icon: 'dot' },
};

const DECISIONS = ['accepted', 'rejected'];

// The only allowed transitions. `accepted` and `rejected` are final.
const TRANSITIONS = {
  open: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
};

const EVENT_LABELS = {
  proposed: 'Voorgesteld',
  accepted: 'Geaccepteerd',
  rejected: 'Afgewezen',
};

const NEXT_STEPS = ['review_proposal', 'add_candidate', 'replace_or_mark', 'inspect_or_mark', 'check_via_onboarding'];

const NEXT_STEP_LABELS = {
  review_proposal: 'Voorstel beoordelen',
  add_candidate: 'URL toevoegen als kandidaatbron',
  replace_or_mark: 'Bron vervangen of markeren als onbruikbaar',
  inspect_or_mark: 'Website zelf bekijken; eventueel markeren als onbruikbaar',
  check_via_onboarding: 'Bron controleren via Onboarding Restaurant',
};

const NOTE_MAX = 280;
const URL_MAX = 2048;

// Special-use and internal top-level labels (RFC 2606/6761/6762 and common
// private use). A source on one of these can never be a public restaurant
// website.
const BLOCKED_TLDS = new Set(['localhost', 'local', 'internal', 'invalid', 'test', 'example', 'onion', 'arpa', 'home', 'lan', 'corp']);

const URL_ERRORS = {
  missing: 'Vul een URL in.',
  too_long: 'Deze URL is te lang.',
  whitespace: 'Een URL mag geen spaties of regeleinden bevatten.',
  unparseable: 'Dit is geen geldige URL.',
  scheme: 'Begin de URL met https:// of http://.',
  credentials: 'Een URL met gebruikersnaam of wachtwoord is niet toegestaan.',
  port: 'Een URL met een poortnummer is niet toegestaan.',
  ip_literal: 'Gebruik een domeinnaam, geen IP-adres.',
  host: 'Deze domeinnaam is niet geldig.',
  reserved_host: 'Dit is geen openbaar webadres.',
};

// IPv4 dotted (also partial/hex/octal forms the URL parser normalizes) and
// bracketed IPv6. Every IP literal is refused — not only private ranges.
function isIpLiteral(hostname) {
  if (hostname.startsWith('[')) return true;
  return /^[0-9.]+$/.test(hostname) || /^0x[0-9a-f.]+$/i.test(hostname);
}

/**
 * Validates and canonicalizes a proposed source URL — as text only, never
 * fetched. Returns `{ ok: true, url, host }` with `url` = scheme + host +
 * path (query string and fragment dropped, the 0013 data-minimisation
 * shape), or `{ ok: false, reason, message }`.
 */
function validateProposedUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return urlError('missing');
  const text = raw.trim();
  if (text.length > URL_MAX) return urlError('too_long');
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return urlError('whitespace');
  if (!/^https?:\/\//i.test(text)) return urlError('scheme');
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return urlError('unparseable');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return urlError('scheme');
  if (parsed.username || parsed.password) return urlError('credentials');
  if (parsed.port !== '') return urlError('port');
  // An explicit default port (":443") is normalized away by the parser;
  // refuse it too, by looking at the typed authority itself.
  const authority = text.slice(text.indexOf('//') + 2).split(/[/?#]/)[0];
  if (authority.replace(/^\[[^\]]*\]/, '').includes(':')) return urlError('port');
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return urlError('host');
  if (isIpLiteral(hostname)) return urlError('ip_literal');
  if (hostname === 'localhost') return urlError('reserved_host');
  const labels = hostname.split('.');
  if (labels.length < 2) return urlError('host');
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return urlError('host');
    if (!/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-')) return urlError('host');
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return urlError('host');
  if (BLOCKED_TLDS.has(tld)) return urlError('reserved_host');
  const url = `${parsed.protocol}//${hostname}${parsed.pathname}`;
  if (url.length > URL_MAX) return urlError('too_long');
  return { ok: true, url, host: hostname };
}

function urlError(reason) {
  return { ok: false, reason, message: URL_ERRORS[reason] };
}

/**
 * The canonical form of a restaurant's KNOWN website (data/restaurants.json
 * `website`), or `null`. More lenient than validateProposedUrl only in one
 * way: a stored value without a scheme ("eetcafe.nl/menu") is read as
 * https, the same reading BE-23's hostOf uses. Everything else must pass
 * the same rules.
 */
function canonicalizeKnownWebsite(website) {
  if (typeof website !== 'string' || website.trim() === '') return null;
  let text = website.trim();
  if (text.startsWith('//')) text = `https:${text}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  const result = validateProposedUrl(text);
  return result.ok ? result.url : null;
}

/** `{ ok: true, note }` (null when empty) or `{ ok: false, reason, message }`. */
function normalizeNote(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return required ? { ok: false, reason: 'note_required', message: 'Geef een korte toelichting.' } : { ok: true, note: null };
  }
  if (typeof raw !== 'string') return { ok: false, reason: 'note_invalid', message: 'De toelichting is ongeldig.' };
  const note = raw.trim().replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(note)) return { ok: false, reason: 'note_invalid', message: 'De toelichting bevat ongeldige tekens.' };
  if (note.length > NOTE_MAX) return { ok: false, reason: 'note_too_long', message: `Houd de toelichting korter dan ${NOTE_MAX + 1} tekens.` };
  return { ok: true, note };
}

/**
 * Validates a new proposal against the restaurant it is about.
 *
 *   body:       { restaurant_id, kind, proposed_url?, unusable_reason?, note? }
 *   restaurant: the data/restaurants.json entry for body.restaurant_id, or
 *               null/undefined when unknown
 *
 * Returns `{ ok: true, value }` — the exact values to store, with
 * `current_url` derived from the restaurant entry, never from the body — or
 * `{ ok: false, status, reason, message }`.
 */
function validateProposalInput(body, restaurant) {
  const fail = (status, reason, message) => ({ ok: false, status, reason, message });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'body', 'Ongeldig verzoek.');
  const restaurantId = typeof body.restaurant_id === 'string' ? body.restaurant_id.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(restaurantId)) return fail(400, 'restaurant_id', 'Ongeldig restaurant.');
  if (!restaurant || typeof restaurant !== 'object' || typeof restaurant.name !== 'string' || !restaurant.name.trim()) {
    return fail(404, 'restaurant_unknown', 'Dit restaurant is niet bekend.');
  }
  const kind = body.kind;
  if (!PROPOSAL_KINDS.includes(kind)) return fail(400, 'kind', 'Kies een geldige voorstelactie.');

  const currentUrl = canonicalizeKnownWebsite(restaurant.website);
  if (kind !== 'add_candidate' && !currentUrl) {
    return fail(400, 'no_current_url', 'Er is geen bekende bron-URL. Voeg eerst een URL toe als kandidaatbron.');
  }

  let proposedUrl = null;
  let unusableReason = null;
  if (kind === 'add_candidate' || kind === 'replace_source') {
    if (body.unusable_reason !== undefined && body.unusable_reason !== null) return fail(400, 'unexpected_reason', 'Een reden hoort alleen bij markeren als onbruikbaar.');
    const url = validateProposedUrl(body.proposed_url);
    if (!url.ok) return fail(400, `url_${url.reason}`, url.message);
    proposedUrl = url.url;
    if (currentUrl && proposedUrl === currentUrl) return fail(400, 'same_url', 'Deze URL is al de bekende bron.');
  } else {
    if (body.proposed_url !== undefined && body.proposed_url !== null && body.proposed_url !== '') {
      return fail(400, 'unexpected_url', 'Bij markeren als onbruikbaar hoort geen nieuwe URL.');
    }
    if (!UNUSABLE_REASONS.includes(body.unusable_reason)) return fail(400, 'reason', 'Kies een reden.');
    unusableReason = body.unusable_reason;
  }

  const note = normalizeNote(body.note, { required: unusableReason === 'other' });
  if (!note.ok) return fail(400, note.reason, note.message);

  return {
    ok: true,
    value: {
      restaurant_id: restaurantId,
      kind,
      proposed_url: proposedUrl,
      current_url: currentUrl,
      unusable_reason: unusableReason,
      note: note.note,
    },
  };
}

/** `{ ok: true, decision, note }` or `{ ok: false, status, reason, message }`. */
function validateDecisionInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, reason: 'body', message: 'Ongeldig verzoek.' };
  if (!DECISIONS.includes(body.decision)) return { ok: false, status: 400, reason: 'decision', message: 'Kies accepteren of afwijzen.' };
  const note = normalizeNote(body.note, { required: body.decision === 'rejected' });
  if (!note.ok) {
    const message = note.reason === 'note_required' ? 'Geef een reden voor het afwijzen.' : note.message;
    return { ok: false, status: 400, reason: note.reason, message };
  }
  return { ok: true, decision: body.decision, note: note.note };
}

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * The one safe next step for a restaurant. `row` is a BE-23 workqueue row
 * (with `source`) or a "not in queue" entry (with `reason`).
 */
function nextStepFor({ row, hasOpenProposal, knownUrl }) {
  if (hasOpenProposal) return 'review_proposal';
  if (!knownUrl) return 'add_candidate';
  if (row && (row.source === 'unreachable' || row.source === 'identity_changed')) return 'replace_or_mark';
  if (row && row.source === 'access_limited') return 'inspect_or_mark';
  return 'check_via_onboarding';
}

/** Why a source needs attention, in plain words — never a guessed status. */
function attentionFor(entry) {
  if (!entry) return null;
  if (entry.source) {
    if (entry.source !== 'reachable') return `Bron: ${SOURCE_LABELS[entry.source]}`;
    if (entry.menu && entry.menu !== 'ready_for_review') return `Menukaart: ${MENU_LABELS[entry.menu]}`;
    return 'Menukaart wacht op beoordeling';
  }
  return NOT_IN_QUEUE_LABELS[entry.reason] || null;
}

/** How a staff member is shown: never a name or e-mail address. */
function actorRef(userId, viewerId) {
  if (!userId) return { self: false, ref: null };
  return { self: Boolean(viewerId) && userId === viewerId, ref: String(userId).slice(0, 8) };
}

/**
 * Builds the page's restaurant list.
 *
 *   queue:       buildSourceWorkqueue(...) output (BE-23, unchanged)
 *   restaurants: data/restaurants.json
 *   proposals:   stored proposal rows, each optionally with
 *                `source_triage_proposal_events: [...]`
 *   viewerId:    the authenticated user's id (only to mark "jij")
 */
function buildTriageView({ queue, restaurants, proposals, viewerId }) {
  const known = restaurants && typeof restaurants === 'object' ? restaurants : {};
  const byRestaurant = new Map();
  let orphanProposals = 0;
  for (const p of Array.isArray(proposals) ? proposals : []) {
    if (!p || typeof p !== 'object') continue;
    const id = String(p.restaurant_id);
    if (!Object.prototype.hasOwnProperty.call(known, id)) {
      orphanProposals += 1;
      continue;
    }
    if (!byRestaurant.has(id)) byRestaurant.set(id, []);
    byRestaurant.get(id).push(shapeProposal(p, viewerId));
  }
  for (const list of byRestaurant.values()) list.sort((a, b) => timeValue(b.proposed_at) - timeValue(a.proposed_at));

  const entries = [];
  const pushEntry = (base) => {
    const restaurant = known[base.restaurantId] || {};
    const list = byRestaurant.get(base.restaurantId) || [];
    const knownUrl = canonicalizeKnownWebsite(restaurant.website);
    const open = list.find((p) => p.status === 'open') || null;
    entries.push({
      restaurant_id: base.restaurantId,
      name: base.name,
      wijk: base.wijk || null,
      domain: base.domain || null,
      known_url: knownUrl,
      source: base.source || null,
      menu: base.menu || null,
      not_in_queue_reason: base.reason || null,
      checked_at: base.checkedAt || null,
      attention: attentionFor(base),
      next_step: nextStepFor({ row: base, hasOpenProposal: Boolean(open), knownUrl }),
      open_proposal_id: open ? open.id : null,
      proposals: list,
    });
  };
  for (const row of (queue && queue.rows) || []) pushEntry(row);
  for (const row of (queue && queue.notInQueue) || []) pushEntry(row);
  return { restaurants: sortTriage(entries), orphanProposals };
}

function shapeProposal(p, viewerId) {
  const events = Array.isArray(p.source_triage_proposal_events) ? p.source_triage_proposal_events : [];
  return {
    id: p.id,
    kind: p.kind,
    proposed_url: p.proposed_url || null,
    current_url: p.current_url || null,
    unusable_reason: p.unusable_reason || null,
    note: p.note || null,
    status: p.status,
    proposed_at: p.proposed_at || null,
    proposed_by: actorRef(p.proposed_by, viewerId),
    decided_at: p.decided_at || null,
    decided_by: p.decided_by ? actorRef(p.decided_by, viewerId) : null,
    decision_note: p.decision_note || null,
    events: events
      .map((e) => ({ event: e.event, actor: actorRef(e.actor_user_id, viewerId), note: e.note || null, created_at: e.created_at || null }))
      .sort((a, b) => timeValue(a.created_at) - timeValue(b.created_at)),
  };
}

function timeValue(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

// Open proposals first, then restaurants that need a source action, then
// the rest; by name within each group.
const STEP_RANK = { review_proposal: 0, add_candidate: 1, replace_or_mark: 1, inspect_or_mark: 2, check_via_onboarding: 3 };
function sortTriage(entries) {
  return [...entries].sort((a, b) => {
    const r = (STEP_RANK[a.next_step] ?? 9) - (STEP_RANK[b.next_step] ?? 9);
    if (r !== 0) return r;
    return String(a.name).localeCompare(String(b.name), 'nl', { sensitivity: 'base' });
  });
}

const TRIAGE_FILTERS = ['all', 'open_proposal', 'needs_source', 'no_check'];
const TRIAGE_FILTER_LABELS = {
  all: 'Alles',
  open_proposal: 'Open voorstel',
  needs_source: 'Bron vraagt aandacht',
  no_check: 'Nog niet gecontroleerd',
};

function matchesFilter(entry, filter) {
  switch (filter) {
    case 'open_proposal':
      return Boolean(entry.open_proposal_id);
    case 'needs_source':
      return entry.next_step === 'add_candidate' || entry.next_step === 'replace_or_mark' || entry.next_step === 'inspect_or_mark';
    case 'no_check':
      return Boolean(entry.not_in_queue_reason);
    default:
      return true;
  }
}

function filterTriage(entries, { filter = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(entries) ? entries : []).filter((e) => {
    if (!matchesFilter(e, filter)) return false;
    if (q && !String(e.name || '').toLowerCase().includes(q) && !String(e.domain || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function countTriage(entries) {
  const counts = {};
  for (const f of TRIAGE_FILTERS) counts[f] = 0;
  for (const e of Array.isArray(entries) ? entries : []) for (const f of TRIAGE_FILTERS) if (matchesFilter(e, f)) counts[f] += 1;
  return counts;
}

module.exports = {
  TRIAGE_NOTICE,
  PROPOSAL_KINDS,
  KIND_LABELS,
  UNUSABLE_REASONS,
  UNUSABLE_REASON_LABELS,
  PROPOSAL_STATUSES,
  STATUS_LABELS,
  STATUS_ROLES,
  SOURCE_BADGES,
  MENU_BADGES,
  DECISIONS,
  TRANSITIONS,
  EVENT_LABELS,
  NEXT_STEPS,
  NEXT_STEP_LABELS,
  NOTE_MAX,
  URL_MAX,
  BLOCKED_TLDS,
  TRIAGE_FILTERS,
  TRIAGE_FILTER_LABELS,
  validateProposedUrl,
  canonicalizeKnownWebsite,
  normalizeNote,
  validateProposalInput,
  validateDecisionInput,
  canTransition,
  isUuid,
  nextStepFor,
  attentionFor,
  actorRef,
  buildTriageView,
  filterTriage,
  countTriage,
};
