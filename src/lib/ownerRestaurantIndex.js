'use strict';

// BE-47 (#111) — de kleine, statische index achter "Mijn restaurant".
//
// data/restaurants.json (133 kB) en data/menus.json (170 kB) blijven op de
// server: de pagina stuurt per restaurant alleen de naam en de ids van de
// gepubliceerde menukaarten mee (25 korte regels), nooit de volledige dataset.
// Dezelfde src/lib/menuTabs.js bepaalt welke kaarten bij een restaurant horen als
// op de publieke restaurantpagina, dus de link op "Mijn restaurant" wijst altijd
// naar een kaart die daar echt bestaat.
//
// BE-57 (#139, deel 2) voegt twee dingen toe aan die index, allebei uit de
// bestaande gegevens en zonder database:
//   - `menuUpdatedOn`: de laatste `scraped`-datum van de gepubliceerde kaarten,
//     voor "Je menukaart" (contract punt 3);
//   - `dishes`: de namen van de gerechten op die kaarten, zodat de top 4 een
//     gerecht bij naam kan noemen. Alleen namen, geen prijzen, beschrijvingen of
//     allergenen.

const { dishIdOf } = require('./dishList');
const { restaurantMenus } = require('./menuTabs');

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * De ids, de laatste bijwerkdatum en de gerechtnamen van de kaarten van één
 * restaurant. Een kaart die niet in data/menus.json staat levert niets op.
 */
function menuSummary({ tabs, menusData } = {}) {
  const list = Array.isArray(tabs) ? tabs : [];
  const menuIds = [];
  const dishes = {};
  let menuUpdatedOn = '';

  for (const tab of list) {
    const menuId = tab && typeof tab.id === 'string' ? tab.id.trim() : '';
    if (!menuId) continue;
    menuIds.push(menuId);

    const menu = menusData && typeof menusData === 'object' ? menusData[menuId] : null;
    if (!menu || typeof menu !== 'object') continue;

    const scraped = textOf(menu.scraped);
    if (DAY_PATTERN.test(scraped) && scraped > menuUpdatedOn) menuUpdatedOn = scraped;

    const categories = Array.isArray(menu.categories) ? menu.categories : [];
    categories.forEach((category, catIdx) => {
      const items = category && Array.isArray(category.items) ? category.items : [];
      items.forEach((item, itemIdx) => {
        const id = dishIdOf({ menuId, catIdx, itemIdx });
        const name = textOf(item && item.name);
        if (id && name) dishes[id] = name;
      });
    });
  }

  return { menuIds, menuUpdatedOn: menuUpdatedOn || null, dishes };
}

/**
 * @param {object} restaurantsData  de volledige data/restaurants.json
 * @param {object} menusData  de volledige data/menus.json
 * @returns {Object<string, {name: string, menuIds: string[], menuUpdatedOn: string|null,
 *   dishes: Object<string, string>}>}
 */
function buildOwnerRestaurantIndex(restaurantsData, menusData) {
  const restaurants = restaurantsData && typeof restaurantsData === 'object' ? restaurantsData : {};
  const index = {};

  for (const id of Object.keys(restaurants)) {
    const record = restaurants[id];
    if (!record || typeof record !== 'object') continue;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!id || !name) continue;

    const menus = restaurantMenus({
      restaurantId: id,
      menuLinks: record.menuLinks,
      menus: menusData,
      requested: null,
    });
    const summary = menuSummary({ tabs: menus && menus.tabs, menusData });

    index[id] = {
      name,
      menuIds: summary.menuIds,
      menuUpdatedOn: summary.menuUpdatedOn,
      dishes: summary.dishes,
    };
  }

  return index;
}

module.exports = { buildOwnerRestaurantIndex, menuSummary };
