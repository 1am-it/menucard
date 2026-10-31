// BE-65 (#157) — de kleinste lezer van het bewaarlijstje.
//
// De bewaar- en deelknoppen staan op / en /search meteen in de eerste lading.
// Hun logica komt pas bij de klik (Lead-besluit, ronde 2). Wat niet kan
// wachten is de stand van de knop: die moet bij het laden al kloppen. Daarvoor
// is dit bestand er — alleen de opslagsleutel, een try/catch om `localStorage`
// en het uitlezen van de bewaarde id's. Geen deelcode, geen React, geen
// menukaart, dus een paar honderd bytes in plaats van de hele dishList.
//
// De vorm is precies die van src/lib/dishList.js: sleutel `bredaeats_bewaard`,
// een lijst met `{ id, ... }`, hooguit 20. savedListRead.test.js toetst dat
// deze lezer dezelfde stand geeft als isDishSaved() daar, zodat er geen tweede
// waarheid ontstaat. Bewust CommonJS, zoals dishList.js: direct testbaar met
// `node --test`, zonder browser of React.

'use strict';

const SAVED_LIST_KEY = 'bredaeats_bewaard';
// Dezelfde eventnaam als SAVED_LIST_EVENT in dishList.js: de knop, de balk en
// de lijstpagina horen elkaar ook zonder dat de zware module al geladen is.
const SAVED_LIST_EVENT_NAME = 'bredaeats:bewaard';
const SAVED_LIST_LIMIT = 20;

/**
 * `localStorage`, of null als er geen venster is of de browser hem weigert
 * (privémodus, beleid). Nooit een harde fout: zonder opslag is de stand
 * gewoon "niet bewaard".
 */
function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch (error) {
    return null;
  }
}

/**
 * De canonieke gerecht-id (`<menukaart>-<categorie>-<gerecht>`), precies zoals
 * parseDishId + dishIdOf in dishList.js hem maken. Ongeldig blijft null.
 */
function normalizeDishId(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d+)-(\d+)$/i.exec(text);
  if (!match) return null;
  return `${match[1]}-${Number(match[2])}-${Number(match[3])}`;
}

/** De bewaarde id's, in volgorde, zonder dubbelen en met hooguit 20. */
function readSavedIds(storage) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  let raw = null;
  try {
    raw = storage.getItem(SAVED_LIST_KEY);
  } catch (error) {
    return [];
  }
  if (!raw) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids = [];
  const seen = new Set();
  for (const value of parsed) {
    const id = normalizeDishId(value && value.id);
    if (!id || seen.has(id)) continue;
    if (ids.length >= SAVED_LIST_LIMIT) break;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Staat dit gerecht al op het lijstje? */
function hasSavedId(storage, id) {
  const wanted = normalizeDishId(id);
  if (!wanted) return false;
  return readSavedIds(storage).some((candidate) => candidate === wanted);
}

/** Het aantal bewaarde gerechten, voor de balk na het bewaren. */
function savedCount(storage) {
  return readSavedIds(storage).length;
}

/** "1 gerecht bewaard" of "3 gerechten bewaard". */
function savedCountLabel(count) {
  const n = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${n} ${n === 1 ? 'gerecht' : 'gerechten'} bewaard`;
}

/**
 * De hele regel van de balk: "n gerecht(en) bewaard · Stuur je lijstje, met of
 * zonder stemmen". Dezelfde tekst staat in het contract (uitkomst 3).
 */
function savedBarText(count) {
  return `${savedCountLabel(count)} · Stuur je lijstje, met of zonder stemmen`;
}

module.exports = {
  SAVED_LIST_EVENT_NAME,
  SAVED_LIST_KEY,
  SAVED_LIST_LIMIT,
  browserStorage,
  hasSavedId,
  normalizeDishId,
  readSavedIds,
  savedBarText,
  savedCount,
  savedCountLabel,
};
