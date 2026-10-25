// BE-29 (#70) — de seizoenskalender van de home en het seizoenslabel van een
// menukaart. Eén geteste tabel, geen AI, geen nieuwe data en geen nieuwe
// zoekroute: een seizoenstegel is een gewone bestaande zoekopdracht
// (`/search?q=...`).
//
// Eigenaarsbesluit 2026-10-25 (issue #70): 🌿 Asperges (apr–jun),
// 🦪 Mosselen (sep–mrt), 🦌 Wild (okt–dec), 🎃 Pompoen (sep–nov).
//
// Het label "🌿 Seizoen" is streng: alleen als de kaart het zelf zegt (een
// Wildkaart, een Seizoenskaart of de rubriek "Seizoen"). Een gerechtnaam als
// "Seizoensgroenten" in een gewone rubriek is geen seizoenskaart en levert
// dus nooit dat label op.
//
// Bewust CommonJS, zoals src/lib/cuisineStyle.js en src/lib/dishDeepLink.js.

'use strict';

// `months` gebruikt de gewone kalendermaand 1-12. Mosselen loopt over de
// jaarwisseling heen (sep–mrt) en heeft daarom beide jaargangen in de lijst.
const SEASONS = [
  { id: 'asperges', label: 'Asperges', emoji: '🌿', months: [4, 5, 6], query: 'asperges' },
  { id: 'mosselen', label: 'Mosselen', emoji: '🦪', months: [9, 10, 11, 12, 1, 2, 3], query: 'mosselen' },
  { id: 'wild', label: 'Wild', emoji: '🦌', months: [10, 11, 12], query: 'wild' },
  { id: 'pompoen', label: 'Pompoen', emoji: '🎃', months: [9, 10, 11], query: 'pompoen' },
];

const SEASON_MENU_PATTERN = /wildkaart|seizoenskaart/i;
const SEASON_CATEGORY_PATTERN = /^seizoen$/i;

function validMonth(month) {
  const value = Number(month);
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
}

/** De seizoenen die in deze kalendermaand (1-12) lopen. */
function seasonsForMonth(month) {
  const value = validMonth(month);
  if (value === null) return [];
  return SEASONS.filter((season) => season.months.includes(value));
}

/**
 * Tegels voor de home: altijd een bestaande zoekopdracht, nooit een nieuwe
 * route. De pagina toont een tegel pas als die zoekopdracht echte resultaten
 * heeft (dat bepaalt de browser met de bestaande /api/search-route).
 */
function seasonTiles(month) {
  return seasonsForMonth(month).map((season) => ({
    id: season.id,
    label: season.label,
    emoji: season.emoji,
    query: season.query,
    href: `/search?q=${encodeURIComponent(season.query)}`,
  }));
}

/**
 * Zegt de menukaart zelf dat ze een seizoenskaart is? Alleen dan mag het
 * label "🌿 Seizoen" verschijnen.
 * @param {{title?:string,subtitle?:string,categories?:Array<{name?:string}>}} entry
 * @returns {{label:string,emoji:string}|null}
 */
function seasonLabelForMenu(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const menuText = [entry.title, entry.subtitle].filter(Boolean).join(' ');
  const categories = Array.isArray(entry.categories) ? entry.categories : [];
  const categorySaysSeason = categories.some(
    (category) => category && typeof category.name === 'string' && SEASON_CATEGORY_PATTERN.test(category.name.trim())
  );
  if (SEASON_MENU_PATTERN.test(menuText) || categorySaysSeason) {
    return { label: 'Seizoen', emoji: '🌿' };
  }
  return null;
}

module.exports = {
  SEASONS,
  seasonsForMonth,
  seasonTiles,
  seasonLabelForMenu,
};
