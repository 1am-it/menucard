// BE-25 fase 2 — Batchanalyse: pure, shared logic for the batch page and
// its server handlers. No fetch, no database, no side effects.
// Contract: planning/specs/tickets/be-25-batch-source-analysis-from-triage.md
// ("Status vocabulary and copy", "Where results go", "Design v2 decisions").
//
// Every URL gets exactly one status, derived from its batch item, its job
// and (on success) its receipt — never a new status value in the database.
// A result is "high certainty" only under the conservative v1 rule: a known
// restaurant (exact host match), recognised menu items, and every
// recognised menu on exactly that restaurant's own host (existing
// normalisation only: lower case, leading `www.` stripped). Anything less
// is "Beoordeel handmatig".

'use strict';

const { canonicalizeSourceUrl } = require('./urlIntakes');
const { hostOf, observeJob } = require('./sourceWorkqueue');

const MAX_BATCH_URLS = 10;
const DAILY_URL_LIMIT = 25;
const MAX_ATTEMPTS = 5;

const COPY = {
  start: 'Analyse starten',
  keepOpen: 'Houd dit scherm open. Sluit je het, dan pauzeert de analyse en gaat hij verder zodra je terugkomt.',
  nothingPublished: 'Niets wordt automatisch gepubliceerd.',
  alreadyActive: 'Deze URL staat al in een actieve analysebatch.',
  colleaguePaused: 'Analyse tijdelijk gepauzeerd.',
  colleagueReadOnly: 'Je kunt deze batch alleen bekijken.',
  confirmedText: (time) => `Bevestigd om ${time} na menselijke controle. Er is niets gepubliceerd.`,
};

// Status per URL: label (verbatim from the ticket), Kleurtaal v2 role, icon.
const STATUSES = {
  queued: { label: 'In wachtrij', role: 'neutral', icon: 'clock' },
  running: { label: 'Bezig', role: 'neutral', icon: 'progress' },
  menu_found: { label: 'Menukaart gevonden · controle nodig', role: 'file', icon: 'file' },
  needs_review: { label: 'Controle nodig', role: 'old', icon: 'warning' },
  no_menu: { label: 'Geen bruikbare menukaart gevonden', role: 'neutral', icon: 'minus' },
  recent: { label: 'Recent geanalyseerd', role: 'neutral', icon: 'recent' },
  robots: { label: 'Robots geblokkeerd', role: 'blocked', icon: 'lock' },
  invalid: { label: 'Ongeldige URL', role: 'blocked', icon: 'cross' },
  error: { label: 'Fout', role: 'blocked', icon: 'warning' },
  confirmed: { label: 'Bron bevestigd', role: 'positive', icon: 'check' },
  duplicate: { label: 'Dubbel in deze lijst', role: 'neutral', icon: 'dot' },
  not_queued: { label: 'Niet in wachtrij gezet', role: 'neutral', icon: 'dot' },
};

const ACTION_LABELS = {
  confirm: 'Bevestig bron',
  review_manually: 'Beoordeel handmatig',
  adjust_url: 'URL aanpassen',
  retry: 'Opnieuw proberen',
  reanalyze: 'Opnieuw analyseren',
  onboarding: 'Naar Onboarding Restaurant',
};

const TERMINAL_KEYS = new Set(['menu_found', 'needs_review', 'no_menu', 'recent', 'robots', 'invalid', 'error', 'confirmed', 'duplicate', 'not_queued']);

/** The non-empty, trimmed lines of a pasted list, in order. */
function splitLines(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Canonical http(s) URL (scheme, host, path; no query or fragment) or null. */
function canonicalLine(line) {
  if (typeof line !== 'string') return null;
  const text = line.trim();
  if (!/^https?:\/\/[^/\s]+/i.test(text) || /\s/.test(text)) return null;
  const canonical = canonicalizeSourceUrl(text);
  if (!canonical || !canonical.hostname.includes('.')) return null;
  return canonical.canonicalUrl;
}

/**
 * The pre-check shown before a batch exists: one entry per line with
 * `status` 'ok' | 'invalid' | 'duplicate' (`duplicateOf` = 1-based line).
 * More than MAX_BATCH_URLS lines is reported, never silently cut.
 */
function precheckLines(text) {
  const lines = splitLines(text);
  const seen = new Map();
  const entries = lines.map((raw, index) => {
    const url = canonicalLine(raw);
    if (!url) return { line: index + 1, raw, url: null, status: 'invalid' };
    if (seen.has(url)) return { line: index + 1, raw, url, status: 'duplicate', duplicateOf: seen.get(url) };
    seen.set(url, index + 1);
    return { line: index + 1, raw, url, status: 'ok' };
  });
  return {
    entries,
    tooMany: lines.length > MAX_BATCH_URLS,
    queueableCount: entries.filter((e) => e.status === 'ok').length,
  };
}

/** Canonical URLs of every recognised menu (stored by the batch processor
 * in field_evidence.menu_source_urls). */
function menuSourceUrls(analysis) {
  const urls = [];
  const add = (value) => {
    const url = typeof value === 'string' ? canonicalLine(value) : null;
    if (url && !urls.includes(url)) urls.push(url);
  };
  for (const menu of (analysis && analysis.menuContexts) || []) {
    const items = ((menu && menu.categories) || []).reduce((n, c) => n + ((c && Array.isArray(c.items) && c.items.length) || 0), 0);
    if (items > 0) add(menu.sourceUrl);
  }
  for (const context of (analysis && analysis.unknownMenuContexts) || []) {
    const sections = (context && Array.isArray(context.recognizedSections) && context.recognizedSections) || [];
    if (sections.some((s) => s && Array.isArray(s.items) && s.items.length > 0)) add(context.sourceUrl);
  }
  return urls;
}

function restaurantFor(receipt, restaurants) {
  if (!receipt || receipt.restaurant_match_type !== 'exact' || !receipt.matched_restaurant_id) return null;
  const id = String(receipt.matched_restaurant_id);
  if (!restaurants || !Object.prototype.hasOwnProperty.call(restaurants, id)) return null;
  const restaurant = restaurants[id];
  return restaurant && typeof restaurant === 'object' ? { id, ...restaurant } : null;
}

/**
 * The conservative v1 high-certainty rule for a succeeded job. Returns
 * { high: true, foundUrl } or { high: false, reason }.
 */
function certaintyOf({ job, receipt, restaurant }) {
  if (!restaurant) return { high: false, reason: 'unknown_restaurant' };
  const observation = observeJob(job, receipt);
  if (observation.kind !== 'classified' || observation.menu !== 'ready_for_review') return { high: false, reason: 'no_recognised_menu' };
  const urls = Array.isArray(job && job.menu_source_urls) ? job.menu_source_urls.filter((u) => typeof u === 'string') : [];
  if (urls.length === 0) return { high: false, reason: 'menu_source_unknown' };
  const restaurantHost = hostOf(restaurant.website);
  if (!restaurantHost || urls.some((u) => hostOf(u) !== restaurantHost)) return { high: false, reason: 'other_host' };
  if (sameAddress(urls[0], restaurant.website)) return { high: false, reason: 'already_known_source' };
  return { high: true, foundUrl: urls[0] };
}

/** Same host (existing normalisation) and same path. */
function sameAddress(a, b) {
  const pathOf = (value) => {
    const text = typeof value === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(value.trim()) ? `https://${value.trim()}` : value;
    const canonical = canonicalizeSourceUrl(text);
    return canonical ? new URL(canonical.canonicalUrl).pathname.replace(/\/+$/, '') : null;
  };
  return hostOf(a) !== null && hostOf(a) === hostOf(b) && pathOf(a) === pathOf(b);
}

const NOT_HIGH_TEXT = {
  menu_source_unknown: 'Er is een menukaart gevonden, maar de vindplaats is niet vastgelegd. Een medewerker beoordeelt hem handmatig.',
  other_host: 'De gevonden menukaart staat niet op de eigen website van dit restaurant. Een medewerker beoordeelt hem handmatig.',
  already_known_source: 'De menukaart staat op de al bekende bron. Een medewerker beoordeelt hem handmatig.',
};

/** The accepted BE-24 proposal that confirms this result, if any. */
function confirmationFor({ job, restaurant, foundUrl, proposals }) {
  if (!restaurant || !foundUrl || !Array.isArray(proposals)) return null;
  const since = job && (job.finished_at || job.updated_at);
  return (
    proposals.find(
      (p) =>
        p &&
        p.status === 'accepted' &&
        String(p.restaurant_id) === restaurant.id &&
        p.proposed_url === foundUrl &&
        (!since || !p.decided_at || new Date(p.decided_at).getTime() >= new Date(since).getTime())
    ) || null
  );
}

function view(key, extra) {
  const status = STATUSES[key];
  return { key, label: status.label, role: status.role, icon: status.icon, terminal: TERMINAL_KEYS.has(key), actions: [], text: null, ...extra };
}

/**
 * One URL's view.
 *   item:     { item_position, canonical_source_url, outcome, job_id, reused_job_id }
 *   job:      the item's job (queued) or the reused job (recent), or null
 *   receipt:  that job's receipt (succeeded), or null
 *   proposals: accepted BE-24 proposals (for "Bron bevestigd")
 *   duplicateOf: 1-based position of the first equal line (duplicate)
 *   formatTime(iso) → display time
 */
function deriveItemView({ item, job, receipt, restaurants, proposals, duplicateOf, now, formatTime }) {
  const fmt = typeof formatTime === 'function' ? formatTime : (v) => v;
  // Reviewer-facing analysis notes (redirects, pages read), never claims.
  const notes = job && Array.isArray(job.notes) ? job.notes.filter((n) => typeof n === 'string').slice(0, 10) : [];
  const base = { position: item.item_position, url: item.canonical_source_url || null, jobId: item.job_id || item.reused_job_id || null, restaurant: null, foundUrl: null, high: false, notes };

  if (item.outcome === 'invalid') {
    return view('invalid', { ...base, text: 'Geen geldig webadres; pas de regel aan.', actions: ['adjust_url'] });
  }
  if (item.outcome === 'duplicate') {
    return view('duplicate', { ...base, text: duplicateOf ? `Zelfde adres als regel ${duplicateOf}; wordt één keer geanalyseerd.` : 'Zelfde adres staat al in deze lijst.' });
  }
  if (item.outcome === 'already_active') {
    return view('not_queued', { ...base, text: COPY.alreadyActive });
  }

  const restaurant = restaurantFor(receipt, restaurants);
  const withRestaurant = { ...base, restaurant: restaurant ? { id: restaurant.id, name: restaurant.name || null, known: true } : null };
  const known = Boolean(restaurant);

  if (item.outcome === 'recent') {
    const days = job && (job.finished_at || job.updated_at) ? Math.max(0, Math.floor((new Date(now || Date.now()).getTime() - new Date(job.finished_at || job.updated_at).getTime()) / 86400000)) : null;
    const earlier = job && job.status === 'succeeded' ? certaintyOf({ job, receipt, restaurant }) : { high: false };
    const confirmed = earlier.high ? confirmationFor({ job, restaurant, foundUrl: earlier.foundUrl, proposals }) : null;
    const when = days === null ? 'kort geleden' : days === 0 ? 'vandaag' : days === 1 ? '1 dag geleden' : `${days} dagen geleden`;
    return view('recent', {
      ...withRestaurant,
      foundUrl: earlier.high ? earlier.foundUrl : null,
      high: Boolean(earlier.high && !confirmed),
      confirmedAt: confirmed ? confirmed.decided_at : null,
      text: `Resultaat van ${when}; niet opnieuw opgehaald.`,
      actions: earlier.high && !confirmed ? ['confirm', 'reanalyze'] : ['reanalyze'],
    });
  }

  if (!job) return view('queued', { ...withRestaurant });

  if (job.expired_at) {
    return view('error', { ...withRestaurant, text: 'De analyse is verlopen voordat hij klaar was. Er is niets gewijzigd.', actions: ['retry'] });
  }
  if (job.status === 'pending') {
    const later = job.next_attempt_at && new Date(job.next_attempt_at).getTime() > new Date(now || Date.now()).getTime();
    return view('queued', {
      ...withRestaurant,
      text: later ? `Nieuwe poging om ${fmt(job.next_attempt_at)} · poging ${job.attempt_count} van ${MAX_ATTEMPTS}.` : null,
    });
  }
  if (job.status === 'running') return view('running', { ...withRestaurant });

  if (job.status === 'failed') {
    if (job.error_reason === 'robots_disallowed') {
      return view('robots', {
        ...withRestaurant,
        text: 'De website staat automatische controle niet toe (robots.txt). Er is niets opgehaald; een medewerker kan de menukaart handmatig beoordelen.',
        actions: ['review_manually'],
      });
    }
    if (job.error_reason === 'unsafe_url') {
      return view('invalid', { ...withRestaurant, text: 'Dit adres kan niet veilig worden geanalyseerd; pas de regel aan.', actions: ['adjust_url'] });
    }
    if (job.error_reason === 'no_reliable_content_found') {
      return view('no_menu', {
        ...withRestaurant,
        text: 'Op deze website is geen bruikbare menukaart gevonden. Dat betekent niet dat het restaurant geen menukaart heeft.',
        actions: ['review_manually'],
      });
    }
    return view('error', {
      ...withRestaurant,
      text: `Technische fout: de analyse is na ${job.attempt_count || 1} ${job.attempt_count === 1 ? 'poging' : 'pogingen'} niet gelukt. Er is niets gewijzigd.`,
      actions: ['retry'],
    });
  }

  if (job.status !== 'succeeded') return view('queued', { ...withRestaurant });

  const observation = observeJob(job, receipt);
  const menu = observation.kind === 'classified' ? observation.menu : 'not_assessed';

  if (menu === 'not_assessed') {
    return view('no_menu', {
      ...withRestaurant,
      text: 'Op deze website is geen bruikbare menukaart gevonden. Dat betekent niet dat het restaurant geen menukaart heeft.',
      actions: ['review_manually'],
    });
  }

  if (!known) {
    if (receipt && receipt.restaurant_match_type === 'multiple') {
      return view('needs_review', { ...withRestaurant, text: 'Meer dan één bekend restaurant past bij deze website. Een medewerker beoordeelt hem handmatig.', actions: ['review_manually'] });
    }
    return view(menu === 'ready_for_review' ? 'menu_found' : 'needs_review', {
      ...withRestaurant,
      text: 'Dit restaurant staat nog niet in de catalogus. Een nieuwe aanmelding loopt via Onboarding Restaurant.',
      actions: ['onboarding'],
    });
  }

  if (menu === 'structure_not_recognized') {
    return view('needs_review', {
      ...withRestaurant,
      text: 'Er is een menukaart-kandidaat gevonden, maar de opbouw is niet herkend. Een medewerker beoordeelt hem handmatig in Bronnen beoordelen.',
      actions: ['review_manually'],
    });
  }

  const certainty = certaintyOf({ job, receipt, restaurant });
  if (!certainty.high) {
    return view('needs_review', { ...withRestaurant, text: NOT_HIGH_TEXT[certainty.reason] || NOT_HIGH_TEXT.menu_source_unknown, actions: ['review_manually'] });
  }
  const confirmed = confirmationFor({ job, restaurant, foundUrl: certainty.foundUrl, proposals });
  if (confirmed) {
    return view('confirmed', { ...withRestaurant, foundUrl: certainty.foundUrl, confirmedAt: confirmed.decided_at, text: COPY.confirmedText(fmt(confirmed.decided_at)) });
  }
  return view('menu_found', { ...withRestaurant, foundUrl: certainty.foundUrl, high: true, actions: ['confirm'] });
}

/** Progress and the per-next-step summary above the list. */
function summarizeItems(views) {
  const list = Array.isArray(views) ? views : [];
  const counted = list.filter((v) => v.key !== 'duplicate');
  const done = counted.filter((v) => v.terminal).length;
  const byAction = {};
  for (const v of counted) for (const a of v.actions) byAction[a] = (byAction[a] || 0) + 1;
  return {
    total: counted.length,
    done,
    running: counted.filter((v) => v.key === 'running').length,
    queued: counted.filter((v) => v.key === 'queued').length,
    open: counted.length - done,
    highCertainty: counted.filter((v) => v.high).length,
    byAction,
  };
}

/** UTC instant (ISO) of midnight today in Europe/Amsterdam. */
function amsterdamDayStart(now) {
  const date = new Date(now === undefined ? Date.now() : now);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  const y = Number(parts.year);
  const m = Number(parts.month) - 1;
  const d = Number(parts.day);
  for (const offsetHours of [1, 2, 0]) {
    const candidate = new Date(Date.UTC(y, m, d) - offsetHours * 3600000);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit' }).format(candidate);
    if (local.startsWith(String(d).padStart(2, '0')) && local.endsWith('00:00')) return candidate.toISOString();
  }
  return new Date(Date.UTC(y, m, d)).toISOString();
}

module.exports = {
  MAX_BATCH_URLS,
  DAILY_URL_LIMIT,
  MAX_ATTEMPTS,
  COPY,
  STATUSES,
  ACTION_LABELS,
  splitLines,
  canonicalLine,
  precheckLines,
  menuSourceUrls,
  certaintyOf,
  deriveItemView,
  summarizeItems,
  amsterdamDayStart,
};
