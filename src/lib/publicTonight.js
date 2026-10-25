'use strict';

// BE-28 — "Vanavond op de kaart" op de home (#65, owner decision 2026-10-25).
//
// Alleen echte gerechten met een echte prijs, uit de bestaande data en de
// bestaande zoeklogica (src/services/dishSearch.js). Geen nieuwe API-route,
// geen migratie en geen verzonnen gerecht of prijs: elk veld komt uit
// data/menus.json / data/restaurants.json. Kan de selectie niets eerlijks
// vinden, dan geeft ze een lege lijst terug en laat de home de sectie weg.
//
// De keuze is deterministisch per dag (offset = dag van het jaar), zodat de
// home niet bij elke request een andere selectie toont en de ISR-cache van
// 5 minuten niet blijft wisselen. Eén gerecht per restaurant, maximaal drie,
// alleen dinergerechten (het is "vanavond") met een echte, numerieke prijs.

const { searchDishes } = require('../services/dishSearch');
const restaurantsData = require('../../data/restaurants.json');

const MEAL = 'diner';
const MAX_DISHES = 3;

// Decoratief teken bij het gerecht. Alleen op basis van woorden die echt in
// naam of categorie staan; onbekend blijft het neutrale bord. Het emoji
// draagt geen betekenis (aria-hidden in de opmaak).
const EMOJI_RULES = [
  [/soep|bouillon|bisque/i, '🍲'],
  [/pasta|spaghetti|penne|lasagne|tagliatelle|risotto/i, '🍝'],
  [/pizza/i, '🍕'],
  [/burger|biefstuk|steak|entrecote|tartaar|spare ?ribs|lams|kalf|varken|kip|eend/i, '🍖'],
  [/vis|zalm|tonijn|garnalen|kabeljauw|mossel|homard|kreeft|sushi/i, '🐟'],
  [/salade|groente|vega/i, '🥗'],
  [/taart|gebak|dessert|ijs|chocolade|tiramisu|panna/i, '🍰'],
  [/brood|sandwich|toast|bagel/i, '🥪'],
  [/kaas/i, '🧀'],
];

function dishEmoji(name, category) {
  const text = `${name || ''} ${category || ''}`;
  for (const [pattern, glyph] of EMOJI_RULES) {
    if (pattern.test(text)) return glyph;
  }
  return '🍽️';
}

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / 86400000);
}

/**
 * @param {Date} [now] injectable for a deterministic test
 * @returns {Array<{dishId:string,name:string,restaurantId:string,restaurantName:string,
 *   menuLink:string,priceDisplay:string,priceOnRequest:boolean,emoji:string,
 *   openingHours:Record<string,string>|null}>}
 */
function selectTonightDishes(now = new Date()) {
  const { results } = searchDishes({ meal: MEAL, limit: 50 });

  const byRestaurant = new Map();
  for (const dish of results) {
    // Alleen een echte, numerieke prijs telt: "op aanvraag" is geen prijs
    // om op de home te tonen.
    if (dish.priceOnRequest || !dish.priceDisplay || dish.priceValue == null) continue;
    if (byRestaurant.has(dish.restaurantId)) continue;
    byRestaurant.set(dish.restaurantId, dish);
  }

  const candidates = [...byRestaurant.values()].sort((a, b) =>
    a.restaurantName.localeCompare(b.restaurantName, 'nl') ||
    a.name.localeCompare(b.name, 'nl')
  );
  if (candidates.length === 0) return [];

  const offset = dayOfYear(now) % candidates.length;
  const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];

  return rotated.slice(0, MAX_DISHES).map((dish) => {
    const restaurant = restaurantsData[dish.restaurantId] || {};
    return {
      dishId: dish.dishId,
      name: dish.name,
      restaurantId: dish.restaurantId,
      restaurantName: dish.restaurantName,
      menuLink: dish.menuLink,
      priceDisplay: dish.priceDisplay,
      priceOnRequest: !!dish.priceOnRequest,
      emoji: dishEmoji(dish.name, dish.category),
      openingHours: restaurant.openingHours || null,
    };
  });
}

module.exports = { selectTonightDishes, dishEmoji, dayOfYear, MAX_DISHES };
