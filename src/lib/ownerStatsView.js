'use strict';

// BE-57 (#139, deel 2) — wat "Mijn restaurant" per restaurant toont, als één
// geteste beslissing.
//
// De pagina haalt `GET /api/mijn-restaurant/<id>/cijfers` op en geeft het
// antwoord hier binnen; deze module bepaalt daarna de titels, de vier cijfers
// van "Deze week", de top 4 met balkjes, de regel over privacy, "Je menukaart"
// met de datum van de laatste bijwerking, en de standen "net geclaimd" en "nog
// geen cijfers". Geen React, geen netwerk, geen klok.
//
// De privacydrempel wordt hier nóg een keer toegepast: ook als een antwoord ooit
// een klein getal meebrengt, toont dit scherm "minder dan 5" en nooit het aantal.
//
// Wat het contract níet vraagt, staat er ook niet: geen QR-code, geen mail, geen
// label "Bevestigd" en geen knop "Menukaart bijwerken". De drie dingen om mee te
// beginnen zijn tekst zonder link, want de onderdelen waar ze over gaan bestaan
// nog niet.

const { UNDER_MINIMUM_LABEL, isVisibleCount } = require('./ownerRestaurantStats');

const STATS_STATUS_READY = 'cijfers';

const VIEW_STATUS_READY = 'cijfers';
const VIEW_STATUS_WELCOME = 'net-geclaimd';
const VIEW_STATUS_UNAVAILABLE = 'niet-beschikbaar';

const TOP_LIMIT = 4;

const OWNER_STATS_MESSAGES = Object.freeze({
  weekTitle: 'Deze week',
  privacy: 'Alleen totalen, nooit wie.',
  topTitle: 'Gerechten die het meest opvallen',
  topEmpty: 'Nog geen gerechten die opvallen.',
  topUnknownDish: 'Gerecht niet meer op je menukaart',
  menuTitle: 'Je menukaart',
  menuUpdatedPrefix: 'Laatst bijgewerkt op',
  menuUnknownDate: 'De datum van de laatste bijwerking is nog niet bekend.',
  menuMissing: 'Er staat nog geen menukaart online.',
  menuLink: 'Bekijk je menukaart op de publieke pagina',
  welcomeTitle: 'Net geclaimd',
  welcomeBody:
    'Welkom. Je cijfers beginnen te lopen zodra gasten je pagina en je menukaart bezoeken. Hieronder zie je wat er in je eerste maand al is geteld.',
  monthTitle: 'De afgelopen maand',
  startTitle: 'Drie dingen om mee te beginnen',
  startItems: Object.freeze([
    'Deel je menukaart met je gasten, bijvoorbeeld via je eigen website of sociale media.',
    'Vraag je gasten om gerechten te bewaren; die tellingen zie je hier terug.',
    'Klopt er iets niet aan je menukaart? Meld het bij de redactie; zelf aanpassen volgt in een latere stap.',
  ]),
  unavailableBody: 'Het ophalen van je cijfers lukte nu niet. Probeer het later opnieuw.',
  forbiddenBody: 'Alleen de eigenaar van dit restaurant kan deze cijfers zien.',
});

const MONTH_NAMES = Object.freeze([
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
]);

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** '2026-03-25' → '25 maart 2026'; al het andere → null. */
function formatDutchDate(day) {
  const text = textOf(day);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const month = MONTH_NAMES[Number(match[2]) - 1];
  const dayNumber = Number(match[3]);
  if (!month || !Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return null;
  return `${dayNumber} ${month} ${match[1]}`;
}

/** Een cijfer zoals het scherm het toont: nooit een aantal onder de drempel. */
function shownOf(value) {
  return isVisibleCount(value) ? String(Number(value)) : UNDER_MINIMUM_LABEL;
}

/** De vier cijfers van een periode; onbekende ids vallen af. */
function figuresOf(figures) {
  const list = Array.isArray(figures) ? figures : [];
  return list
    .filter((figure) => figure && typeof figure === 'object')
    .map((figure) => ({
      id: textOf(figure.id),
      label: textOf(figure.label),
      value: shownOf(figure.value),
      // Alleen een verschil dat beide weken haalt is een verschil (privacy).
      change: figure.change && typeof figure.change === 'object' ? textOf(figure.change.label) : '',
      direction: figure.change && typeof figure.change === 'object' ? figure.change.direction || null : null,
    }))
    .filter((figure) => figure.id && figure.label);
}

/** De top 4: naam uit de statische index, aantal met de drempel, balk 0–100. */
function topRowsOf(top, dishes) {
  const names = dishes && typeof dishes === 'object' ? dishes : {};
  const list = Array.isArray(top) ? top : [];
  return list
    .filter((entry) => entry && typeof entry === 'object')
    .slice(0, TOP_LIMIT)
    .map((entry) => {
      const dishKey = textOf(entry.dishKey);
      const percent = Number(entry.barPercent);
      return {
        dishKey,
        name: textOf(names[dishKey]) || OWNER_STATS_MESSAGES.topUnknownDish,
        shown: shownOf(entry.total),
        percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
      };
    })
    .filter((entry) => entry.dishKey);
}

/** "Je menukaart": de datum uit de bestaande gegevens en de publieke link. */
function menuBlock({ menuHref, menuUpdatedOn } = {}) {
  const href = textOf(menuHref);
  const updated = formatDutchDate(menuUpdatedOn);
  if (!href) {
    return { title: OWNER_STATS_MESSAGES.menuTitle, note: OWNER_STATS_MESSAGES.menuMissing, href: null, linkLabel: null };
  }
  return {
    title: OWNER_STATS_MESSAGES.menuTitle,
    note: updated ? `${OWNER_STATS_MESSAGES.menuUpdatedPrefix} ${updated}.` : OWNER_STATS_MESSAGES.menuUnknownDate,
    href,
    linkLabel: OWNER_STATS_MESSAGES.menuLink,
  };
}

/** De welkomststand: welkom, het cijfer van de afgelopen maand, drie punten. */
function welcomeBlock(month) {
  const figures = figuresOf(month && month.figures).map((figure) => ({
    id: figure.id,
    label: figure.label,
    value: figure.value,
  }));
  return {
    title: OWNER_STATS_MESSAGES.welcomeTitle,
    body: OWNER_STATS_MESSAGES.welcomeBody,
    monthTitle: OWNER_STATS_MESSAGES.monthTitle,
    figures,
    startTitle: OWNER_STATS_MESSAGES.startTitle,
    startItems: OWNER_STATS_MESSAGES.startItems.slice(),
  };
}

/**
 * @param {object} input
 * @param {string} [input.restaurantId]
 * @param {object} [input.stats]  het antwoord van GET /api/mijn-restaurant/<id>/cijfers
 * @param {string} [input.menuHref], [input.menuUpdatedOn]  uit de statische index
 * @param {object} [input.dishes]  gerechtnamen uit de statische index
 * @param {boolean} [input.forbidden]  waar als de API 403 gaf
 * @returns {{status: string, restaurantId: string|null, week: object|null,
 *   top: object|null, menu: object, welcome: object|null, problem: string|null}}
 */
function buildStatsView(input) {
  const settings = input || {};
  const stats = settings.stats && typeof settings.stats === 'object' ? settings.stats : null;
  const restaurantId = textOf(settings.restaurantId) || null;
  const menu = menuBlock({ menuHref: settings.menuHref, menuUpdatedOn: settings.menuUpdatedOn });
  const base = { restaurantId, menu, week: null, top: null, welcome: null, problem: null };

  if (settings.forbidden) {
    return { ...base, status: VIEW_STATUS_UNAVAILABLE, problem: OWNER_STATS_MESSAGES.forbiddenBody };
  }
  if (!stats) {
    return { ...base, status: VIEW_STATUS_UNAVAILABLE, problem: OWNER_STATS_MESSAGES.unavailableBody };
  }

  // Zonder migratie of zonder week aan tellingen: de stand "nog geen cijfers",
  // met de welkomstmelding en het cijfer van de afgelopen maand.
  if (stats.status !== STATS_STATUS_READY) {
    return { ...base, status: VIEW_STATUS_WELCOME, welcome: welcomeBlock(stats.month) };
  }

  return {
    ...base,
    status: VIEW_STATUS_READY,
    week: {
      title: OWNER_STATS_MESSAGES.weekTitle,
      privacy: OWNER_STATS_MESSAGES.privacy,
      figures: figuresOf(stats.week),
    },
    top: {
      title: OWNER_STATS_MESSAGES.topTitle,
      emptyNote: OWNER_STATS_MESSAGES.topEmpty,
      rows: topRowsOf(stats.top, settings.dishes),
    },
  };
}

module.exports = {
  OWNER_STATS_MESSAGES,
  STATS_STATUS_READY,
  TOP_LIMIT,
  UNDER_MINIMUM_LABEL,
  VIEW_STATUS_READY,
  VIEW_STATUS_UNAVAILABLE,
  VIEW_STATUS_WELCOME,
  buildStatsView,
  figuresOf,
  formatDutchDate,
  menuBlock,
  shownOf,
  topRowsOf,
  welcomeBlock,
};


