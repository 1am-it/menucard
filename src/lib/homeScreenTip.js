// BE-62 (#153, ontwerp punt 4) — de tip "Zet ons op je beginscherm".
//
// De tip verschijnt vanaf het tweede bezoek, nooit bij het eerste, nooit in de
// app-stand (display-mode: standalone) en nooit op desktop. Na sluiten komt hij
// nooit meer terug.
//
// Bezoeken tellen we uitsluitend in `localStorage`, onder één sleutel:
// `{ visits, dismissed }`. `sessionStorage` is alleen de markering "dit bezoek
// is al geteld", zodat een tweede pagina in hetzelfde bezoek niet als een
// nieuw bezoek telt. Alles in try/catch: zonder opslag geen tip en geen fout.
// Er gaat niets naar de server; er komt geen cookie en geen tracking bij.

'use strict';

const TIP_STORAGE_KEY = 'bredaeats_beginscherm_tip';
const TIP_SESSION_KEY = 'bredaeats_beginscherm_tip_sessie';
const TIP_SESSION_VALUE = '1';

const TIP_TITLE = 'Zet ons op je beginscherm';
const TIP_BODY = 'Dan vind je ons net zo snel als een app. Tik op Delen en daarna op Zet op beginscherm.';
// Dezelfde zin in stukjes, zodat de component "Delen" en "Zet op beginscherm"
// vet kan zetten zonder de woorden op twee plekken te hebben.
const TIP_BODY_SEGMENTS = [
  { text: 'Dan vind je ons net zo snel als een app. Tik op ' },
  { text: 'Delen', bold: true },
  { text: ' en daarna op ' },
  { text: 'Zet op beginscherm', bold: true },
  { text: '.' },
];
const TIP_CLOSE_LABEL = 'Tip sluiten';
const TIP_LOGO_TEXT = 'om';

// De tip hoort bij de telefoon; dezelfde grens als het ontwerp (≤ 640 px).
const TIP_MAX_WIDTH = 640;
const TIP_MEDIA_QUERY = `(max-width: ${TIP_MAX_WIDTH}px)`;
const STANDALONE_MEDIA_QUERY = '(display-mode: standalone)';

// Alleen publieke pagina's. De interne omgeving en de eigenaarspagina's zijn
// geen plek voor een tip aan een bezoeker.
const PRIVATE_PATHS = ['/internal', '/mijn-restaurant', '/inloggen', '/api', '/claim'];

function emptyState() {
  return { visits: 0, dismissed: false };
}

/**
 * De bewaarde stand. Ontbrekende, kapotte of onbruikbare opslag geeft de
 * neutrale stand terug; er wordt nooit een fout doorgegeven.
 */
function readTipState(storage) {
  if (!storage || typeof storage.getItem !== 'function') return emptyState();
  try {
    const raw = storage.getItem(TIP_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();
    const visits = Number(parsed.visits);
    return {
      visits: Number.isFinite(visits) && visits > 0 ? Math.floor(visits) : 0,
      dismissed: parsed.dismissed === true,
    };
  } catch (error) {
    return emptyState();
  }
}

/** Bewaren; zonder opslag of met een fout blijft de pagina gewoon werken. */
function writeTipState(storage, state) {
  const value = {
    visits: state && Number.isFinite(Number(state.visits)) ? Math.max(0, Math.floor(Number(state.visits))) : 0,
    dismissed: !!(state && state.dismissed === true),
  };
  if (!storage || typeof storage.setItem !== 'function') return { ok: false, state: value };
  try {
    storage.setItem(TIP_STORAGE_KEY, JSON.stringify(value));
    return { ok: true, state: value };
  } catch (error) {
    return { ok: false, state: value };
  }
}

/** Draait de site al als app? Een ontbrekende of kapotte matchMedia is "nee". */
function isStandalone(matchMediaFn) {
  if (typeof matchMediaFn !== 'function') return false;
  try {
    const query = matchMediaFn(STANDALONE_MEDIA_QUERY);
    return !!(query && query.matches === true);
  } catch (error) {
    return false;
  }
}

/** Is dit een telefoonscherm (≤ 640 px)? */
function isPhoneWidth(matchMediaFn) {
  if (typeof matchMediaFn !== 'function') return false;
  try {
    const query = matchMediaFn(TIP_MEDIA_QUERY);
    return !!(query && query.matches === true);
  } catch (error) {
    return false;
  }
}

/** Telt een bezoek hoogstens één keer per sessie. */
function markSession(session) {
  if (!session || typeof session.getItem !== 'function' || typeof session.setItem !== 'function') {
    return { ok: false, counted: false };
  }
  try {
    if (session.getItem(TIP_SESSION_KEY) === TIP_SESSION_VALUE) return { ok: true, counted: false };
    session.setItem(TIP_SESSION_KEY, TIP_SESSION_VALUE);
    return { ok: true, counted: true };
  } catch (error) {
    return { ok: false, counted: false };
  }
}

/**
 * Het bezoek tellen en beslissen of de tip mag verschijnen.
 *
 * - Geen leesbare `localStorage` of `sessionStorage`: geen tip (contract).
 * - Al gesloten: nooit meer.
 * - Eerste bezoek: tellen, maar niet tonen.
 * - Tweede bezoek of later: tonen, als het een telefoon is en de site niet al
 *   als app draait.
 */
function decideTip({ storage, session, matchMedia } = {}) {
  const state = readTipState(storage);
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return { show: false, visits: state.visits, counted: false };
  }
  const marked = markSession(session);
  if (!marked.ok) return { show: false, visits: state.visits, counted: false };
  let visits = state.visits;
  if (marked.counted) {
    visits += 1;
    writeTipState(storage, { visits, dismissed: state.dismissed });
  }
  const show = !state.dismissed
    && visits >= 2
    && isPhoneWidth(matchMedia)
    && !isStandalone(matchMedia);
  return { show, visits, counted: marked.counted };
}

/** Sluiten: vanaf nu nooit meer tonen, ook niet in een later bezoek. */
function dismissTip(storage) {
  const state = readTipState(storage);
  return writeTipState(storage, { visits: state.visits, dismissed: true });
}

/** Alleen publieke pagina's krijgen de tip. */
function isPublicPath(pathname) {
  const path = String(pathname === undefined || pathname === null ? '' : pathname).trim();
  if (!path.startsWith('/')) return false;
  return !PRIVATE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** De opslag van de browser, of null als die niet beschikbaar is. */
function browserStorage(kind) {
  try {
    const store = globalThis[kind];
    if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') return null;
    return store;
  } catch (error) {
    return null;
  }
}

module.exports = {
  PRIVATE_PATHS,
  STANDALONE_MEDIA_QUERY,
  TIP_BODY,
  TIP_BODY_SEGMENTS,
  TIP_CLOSE_LABEL,
  TIP_LOGO_TEXT,
  TIP_MAX_WIDTH,
  TIP_MEDIA_QUERY,
  TIP_SESSION_KEY,
  TIP_SESSION_VALUE,
  TIP_STORAGE_KEY,
  TIP_TITLE,
  browserStorage,
  decideTip,
  dismissTip,
  isPhoneWidth,
  isPublicPath,
  isStandalone,
  readTipState,
  writeTipState,
};
