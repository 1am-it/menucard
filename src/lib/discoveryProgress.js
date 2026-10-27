'use strict';

// BE-34 (#81, criterion 4) — "laten zien dat de app bezig is".
//
// The one place that decides what the screens say while a long run is going on:
//   - "Nieuw gevonden" while OpenStreetMap is fetched;
//   - the running step list of "Vind bronnen" ("🗺️ OpenStreetMap ✓ · 🌐 Websites
//     4 van 10 · 🤖 AI-zoeken 1 van 2") and its progress bar;
//   - "⏳ Zoeken…" on the row the app is working on;
//   - "Bijgewerkt om HH:MM" afterwards;
//   - the honest reason after a failure ("duurde te lang", "server bezet") and
//     the "Opnieuw proberen" button.
//
// Pure: no clock, no fetch, no DOM. Every number comes from what the page already
// knows (the selection it sent and the results it received), never from a guess
// at server progress it cannot see.

const NEW_FOUND_LOADING = '🗺️ OpenStreetMap wordt opgehaald… (± 20 seconden, eerste keer per dag)';
const ROW_SEARCHING = '⏳ Zoeken…';
const BUSY_LABEL = 'Bezig…';
const RETRY_LABEL = 'Opnieuw proberen';
const OSM_DONE_LABEL = '🗺️ OpenStreetMap ✓';
const OSM_RUNNING_LABEL = '🗺️ OpenStreetMap…';

/**
 * What the run will do, counted from the selection itself: one website check per
 * chosen restaurant, and an AI search only for a restaurant without a known
 * website (the same rule as sourceDiscovery.planLayers).
 */
function discoveryPlan(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const aiSearches = list.filter((row) => !(typeof row.url === 'string' && row.url.trim() !== '')).length;
  return { total: list.length, websites: list.length, aiSearches };
}

/**
 * The running step list. `done` is the number of restaurants whose own search
 * finished, `aiDone` the AI searches that actually ran; a run that did more AI
 * searches than planned never shows "4 van 3".
 */
function discoverySteps({ plan, done = 0, aiDone = 0, osmDone = false } = {}) {
  const total = plan && Number.isInteger(plan.total) ? plan.total : 0;
  const websites = plan && Number.isInteger(plan.websites) ? plan.websites : total;
  const planned = plan && Number.isInteger(plan.aiSearches) ? plan.aiSearches : 0;
  const checked = Math.max(0, Math.min(websites, Number.isInteger(done) ? done : 0));
  const aiRan = Math.max(0, Number.isInteger(aiDone) ? aiDone : 0);
  const aiTotal = Math.max(planned, aiRan);
  const steps = [
    { key: 'osm', label: osmDone ? OSM_DONE_LABEL : OSM_RUNNING_LABEL, state: osmDone ? 'done' : 'running' },
    { key: 'websites', label: `🌐 Websites ${checked} van ${websites}`, state: checked >= websites && websites > 0 ? 'done' : 'running' },
    { key: 'ai', label: `🤖 AI-zoeken ${aiRan} van ${aiTotal}`, state: aiTotal > 0 && aiRan >= aiTotal ? 'done' : aiTotal === 0 ? 'skip' : 'running' },
  ];
  const percent = websites === 0 ? 0 : Math.min(100, Math.round((checked / websites) * 100));
  return { steps, line: steps.map((step) => step.label).join(' · '), percent };
}

/** How many AI searches the engine actually ran, from its own layer reports. */
function countAiSearches(results) {
  let ran = 0;
  for (const result of Array.isArray(results) ? results : []) {
    const layers = result && Array.isArray(result.layers) ? result.layers : [];
    const search = layers.find((layer) => layer && layer.key === 'ai_search');
    if (!search) continue;
    if (search.outcome === 'hit' || search.outcome === 'error' || search.outcome === 'rejected') ran += 1;
  }
  return ran;
}

/** "Bijgewerkt om 14:05", or null when there is no usable time. */
function updatedLabel(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  return `Bijgewerkt om ${time}`;
}

/**
 * A failure in plain language: a run that took too long, a busy server, or the
 * server's own Dutch message. The reason is never a technical code on screen.
 */
function discoveryFailure({ status = null, timedOut = false, error = null } = {}) {
  if (timedOut) return { reasonLabel: 'duurde te lang', message: 'Het zoeken duurde te lang.', retryLabel: RETRY_LABEL };
  if (status === 502 || status === 503 || status === 504) {
    return { reasonLabel: 'server bezet', message: 'De server is even bezet.', retryLabel: RETRY_LABEL };
  }
  if (status === 429) return { reasonLabel: 'te veel gevraagd', message: 'Even te veel gevraagd; probeer het zo opnieuw.', retryLabel: RETRY_LABEL };
  if (status === 401 || status === 403) {
    return { reasonLabel: 'geen toegang', message: 'Meld je opnieuw aan.', retryLabel: null };
  }
  if (typeof error === 'string' && error.trim() !== '') {
    return { reasonLabel: null, message: error.trim(), retryLabel: RETRY_LABEL };
  }
  return { reasonLabel: null, message: 'Het zoeken lukte niet.', retryLabel: RETRY_LABEL };
}

module.exports = {
  NEW_FOUND_LOADING,
  ROW_SEARCHING,
  BUSY_LABEL,
  RETRY_LABEL,
  OSM_DONE_LABEL,
  OSM_RUNNING_LABEL,
  discoveryPlan,
  discoverySteps,
  countAiSearches,
  updatedLabel,
  discoveryFailure,
};
