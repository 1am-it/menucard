// BE-28b (#68) — de sorteer-, filter- en telregels van /alle-restaurants.
//
// Bewust een pure module: de pagina haalt de bestaande restaurantdata via
// GET /api/restaurants (src/services/restaurantIndex.js), en deze functies
// bepalen daarna — zonder nieuwe API, data of dependency — de volgorde, de
// chips, de telling en het kaartmodel. Zo is het gedrag testbaar zonder React
// of een browser, dezelfde conventie als src/lib/dishDeepLink.js.
//
// Standaardvolgorde (eigenaarsbesluit 2026-10-25): "Met menukaart eerst",
// daarbinnen alfabetisch. "A–Z" is het alternatief. Er wordt nooit een
// restaurant verzonnen of weggefilterd zonder dat de gebruiker dat kiest.

'use strict';

const { cuisineFamily, cuisineEmoji } = require('./cuisineStyle');

const PRICE_LEVEL_LABEL = { 1: 'laag', 2: 'gemiddeld', 3: 'hoog' };
const SORTS = ['menu-first', 'az'];
const DEFAULT_SORT = 'menu-first';

function normalizeSort(value) {
  return value === 'az' ? 'az' : DEFAULT_SORT;
}

function compareNames(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'nl');
}

// Een kopie; de aanroeper se array blijft onaangeroerd.
function sortRestaurants(restaurants, sort) {
  const list = [...(restaurants || [])];
  if (normalizeSort(sort) === 'az') return list.sort(compareNames);
  return list.sort((a, b) => {
    const menuDelta = (b.hasMenu ? 1 : 0) - (a.hasMenu ? 1 : 0);
    return menuDelta !== 0 ? menuDelta : compareNames(a, b);
  });
}

function filterRestaurants(restaurants, { onlyWithMenu = false, family = null } = {}) {
  return (restaurants || []).filter((restaurant) => {
    if (onlyWithMenu && !restaurant.hasMenu) return false;
    if (family && cuisineFamily(restaurant.cuisine) !== family) return false;
    return true;
  });
}

function countWithMenu(restaurants) {
  return (restaurants || []).filter((restaurant) => restaurant.hasMenu).length;
}

// Chips komen uit de echte data: alleen keukens die daadwerkelijk voorkomen,
// met hun echte aantal. Sorteren op aantal (grootste eerst), daarna op naam.
function cuisineChips(restaurants) {
  const counts = new Map();
  for (const restaurant of restaurants || []) {
    const family = cuisineFamily(restaurant.cuisine);
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([family, count]) => ({ family, count, emoji: cuisineEmoji(family) }))
    .sort((a, b) => (b.count - a.count) || a.family.localeCompare(b.family, 'nl'));
}

function priceSummary(restaurant) {
  const glyph = restaurant.priceLevel ? '€'.repeat(restaurant.priceLevel) : null;
  const label = restaurant.priceLevel ? PRICE_LEVEL_LABEL[restaurant.priceLevel] : null;
  return { glyph, label };
}

// BE-42 (#98) — 1A: elke menukaart is een eigen knop naar díe kaart
// (/menu/<id>). Alleen links met een echt id worden een knop; de rest van de
// kaart blijft ongewijzigd. Er wordt geen menukaart verzonnen of samengevoegd.
const MENU_BUTTON_FALLBACK_LABEL = 'Menukaart';

function menuButtonsOf(restaurant) {
  const menuLinks = Array.isArray(restaurant.menuLinks) ? restaurant.menuLinks : [];
  return menuLinks
    .filter((link) => link && link.id)
    .map((link) => ({
      id: link.id,
      href: `/menu/${link.id}`,
      label: link.label || MENU_BUTTON_FALLBACK_LABEL,
    }));
}

// Eén kaartmodel voor de lijst. De restaurantnaam is sinds BE-42 de link naar
// de restaurantpagina; de menukaarten zijn losse knoppen met hun eigen href.
// Zonder menukaart is er nooit een grote knop (acceptatiecriterium 1).
function cardModel(restaurant) {
  const { glyph, label } = priceSummary(restaurant);
  const menuButtons = menuButtonsOf(restaurant);
  const menuCount = menuButtons.length;
  const hasMenu = Boolean(restaurant.hasMenu) && menuCount > 0;
  const kind = [restaurant.cuisine, glyph].filter(Boolean).join(' · ');
  const address = restaurant.address || (restaurant.buurt ? `Buurt: ${restaurant.buurt}` : null);

  return {
    href: `/restaurant/${restaurant.restaurantId}`,
    name: restaurant.name,
    emoji: cuisineEmoji(restaurant.cuisine),
    kind,
    priceLabel: label,
    address,
    hasMenu,
    menuCount,
    menuButtons,
    noMenuLabel: 'Nog geen menukaart',
    restaurantLabel: 'Bekijk restaurant',
  };
}

module.exports = {
  DEFAULT_SORT,
  SORTS,
  normalizeSort,
  sortRestaurants,
  filterRestaurants,
  countWithMenu,
  cuisineChips,
  cardModel,
};
