'use strict';

// BE-47 (#111) — de kleine, statische index achter "Mijn restaurant".
//
// data/restaurants.json (133 kB) en data/menus.json (170 kB) blijven op de
// server: de pagina stuurt per restaurant alleen de naam en de ids van de
// gepubliceerde menukaarten mee (25 korte regels), nooit de volledige dataset.
// Dezelfde src/lib/menuTabs.js bepaalt welke kaarten bij een restaurant horen als
// op de publieke restaurantpagina, dus de link op "Mijn restaurant" wijst altijd
// naar een kaart die daar echt bestaat.

const { restaurantMenus } = require('./menuTabs');

/**
 * @param {object} restaurantsData  de volledige data/restaurants.json
 * @param {object} menusData  de volledige data/menus.json
 * @returns {Object<string, {name: string, menuIds: string[]}>}
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
    const menuIds =
      menus && Array.isArray(menus.tabs)
        ? menus.tabs.map((tab) => (tab && typeof tab.id === 'string' ? tab.id : '')).filter(Boolean)
        : [];

    index[id] = { name, menuIds };
  }

  return index;
}

module.exports = { buildOwnerRestaurantIndex };
