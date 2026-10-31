// BE-63 (#155, ronde 3) — de goedkope kant van het lijstje.
//
// De kop staat op elke publieke pagina en toont bij "Mijn lijstje" alleen een
// aantal. Tot ronde 3 importeerde de kop daarom `src/lib/dishList.js`, en dat
// bestand sleept de deellinks en de dieplinkopbouw mee: elke pagina groeide.
//
// Daarom staan de opslagsleutel, het event en de teller hier op één plek, in een
// bestand zonder andere imports. `src/lib/dishList.js` leest dezelfde sleutel en
// hetzelfde event hier vandaan en geeft ze door, zodat er nergens een tweede
// `bredaeats_bewaard` of `bredaeats:bewaard` ontstaat. De teller telt precies
// zoals `readSavedList` leest: alleen geldige gerechten, zonder dubbelen en
// hooguit 20 (zie src/lib/savedListStorage.test.js).
//
// Bewust CommonJS, zoals dishList.js: direct testbaar met `node --test`.

'use strict';

// Opslagsleutel in dezelfde stijl als `bredaeats_theme` (app/layout.js).
const SAVED_LIST_KEY = 'bredaeats_bewaard';
const SAVED_LIST_LIMIT = 20;
// Een eigen event, zodat de knop, de onderbalk en de lijstpagina dezelfde stand
// zien zonder dat er een tweede bron van waarheid ontstaat.
const SAVED_LIST_EVENT = 'bredaeats:bewaard';

// Dezelfde vorm als de id van een bewaard gerecht: `<menukaart>-<categorie>-<gerecht>`.
const DISH_ID_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d+)-(\d+)$/i;

/**
 * `localStorage`, of null als er geen venster is of de browser hem weigert
 * (privémodus, beleid). Alle lezers en schrijvers accepteren null.
 */
function safeBrowserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch (error) {
    return null;
  }
}

/** De canonieke id van een bewaard gerecht, of null als het geen gerecht is. */
function savedEntryId(value) {
  if (!value || typeof value !== 'object') return null;
  const text = String(value.id === undefined || value.id === null ? '' : value.id).trim();
  const match = DISH_ID_PATTERN.exec(text);
  if (!match) return null;
  const name = String(value.name === undefined || value.name === null ? '' : value.name).trim();
  if (!name) return null;
  return `${match[1]}-${Number(match[2])}-${Number(match[3])}`;
}

/**
 * Het aantal bewaarde gerechten, zonder de rest van het lijstje te laden.
 * Zonder opslag, met een fout of met kapotte JSON: 0, net als `readSavedList`.
 */
function savedListCount(storage) {
  const target = storage === undefined ? safeBrowserStorage() : storage;
  if (!target || typeof target.getItem !== 'function') return 0;
  try {
    const raw = target.getItem(SAVED_LIST_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    const ids = new Set();
    for (const value of parsed) {
      const id = savedEntryId(value);
      if (!id || ids.has(id)) continue;
      ids.add(id);
      if (ids.size >= SAVED_LIST_LIMIT) break;
    }
    return ids.size;
  } catch (error) {
    return 0;
  }
}

module.exports = {
  SAVED_LIST_EVENT,
  SAVED_LIST_KEY,
  SAVED_LIST_LIMIT,
  safeBrowserStorage,
  savedEntryId,
  savedListCount,
};
