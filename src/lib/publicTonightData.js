// BE-29 (#70) — server-side opbouw van de compacte kandidatenlijst voor
// "Vanavond op de kaart".
//
// Alleen deze module leest data/menus.json en data/restaurants.json. De home
// (app/page.js) geeft de compacte lijst als props aan de browser; de pure
// selectie in src/lib/publicTonight.js kiest daarna per moment van de dag.
// Zo komt het volledige menu-archief nooit in de clientbundel terecht.
//
// Wat hier al wordt weggelaten (en dus nooit kan worden getoond):
// - een niet-gepubliceerde menukaart (niet in de `menuLinks` van het
//   restaurant);
// - een rubriek die geen bestelbaar gerecht is (dranken, sauzen,
//   bijgerechten, zoetigheid, arrangementen);
// - een gerecht zonder echte prijs ("op aanvraag", leeg, supplement of een
//   meervoudige prijs zonder één prijswaarde).
//
// Bewust CommonJS, net als src/services/dishSearch.js.

'use strict';

const menusData = require('../../data/menus.json');
const restaurantsData = require('../../data/restaurants.json');
const { dishEmoji, isMainDishCategory, honestPriceLabel } = require('./publicTonight');
const { dailyDishInfo } = require('./dailyDish');
const { seasonLabelForMenu } = require('./seasonCalendar');

function publishedMenuIds(restaurant) {
  if (!restaurant || !Array.isArray(restaurant.menuLinks)) return null;
  return new Set(restaurant.menuLinks.map((link) => link && link.id).filter(Boolean));
}

function realPrice(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.priceOnRequest) return false;
  if (item.priceIsMultiple) return false;
  if (item.priceIsSupplement) return false;
  if (!item.price || typeof item.price !== 'string' || !item.price.trim()) return false;
  return item.priceValue != null && Number.isFinite(item.priceValue) && item.priceValue > 0;
}

/**
 * @param {{menus?:object,restaurants?:object}} [data] injectable for tests
 * @returns {Array<object>} compacte, serialiseerbare kandidaten
 */
function buildTonightCandidates({ menus = menusData, restaurants = restaurantsData } = {}) {
  const candidates = [];

  for (const [menuKey, entry] of Object.entries(menus || {})) {
    if (!entry || !Array.isArray(entry.categories)) continue;
    const parts = menuKey.split('-');
    const restaurantId = parts[0];
    const mealType = parts.slice(1).join('-');
    const restaurant = restaurants && restaurants[restaurantId];
    if (!restaurant) continue;

    const published = publishedMenuIds(restaurant);
    if (published && !published.has(menuKey)) continue;

    const seasonalMenu = seasonLabelForMenu(entry);
    const sourceDate = typeof entry.scraped === 'string' ? entry.scraped : null;

    entry.categories.forEach((category, categoryIndex) => {
      if (!category || !isMainDishCategory(category.name)) return;
      ;(category.items || []).forEach((item, itemIndex) => {
        if (!realPrice(item)) return;
        const daily = dailyDishInfo(item, {
          category: category.name,
          menuTitle: entry.title,
          menuSubtitle: entry.subtitle,
          sourceDate,
        });
        const tags = Array.isArray(item.tags) ? item.tags : [];
        candidates.push({
          dishId: `${menuKey}-${categoryIndex}-${itemIndex}`,
          name: item.name || '',
          restaurantId,
          restaurantName: restaurant.name || '',
          cuisine: restaurant.cuisine || '',
          mealType,
          category: category.name || '',
          isMainCourse: /hoofdgerecht/i.test(category.name || ''),
          priceDisplay: honestPriceLabel(item),
          priceValue: item.priceValue,
          vegetarian: tags.includes('vegetarisch') || tags.includes('vegan'),
          seasonal: Boolean(seasonalMenu),
          sourceDate,
          // Alleen de datum gaat mee: het label "Daghap" en de datumregel
          // worden pas in de browser opgebouwd, zodat er geen daghap in de
          // server-HTML staat.
          daily: daily ? { sourceDate: daily.sourceDate } : null,
          emoji: dishEmoji(item.name, category.name),
          menuLink: `/menu/${menuKey}`,
          openingHours: restaurant.openingHours || null,
        });
      });
    });
  }

  return candidates.sort(
    (a, b) =>
      a.mealType.localeCompare(b.mealType) ||
      a.restaurantName.localeCompare(b.restaurantName, 'nl') ||
      a.dishId.localeCompare(b.dishId)
  );
}

module.exports = {
  buildTonightCandidates,
  realPrice,
  publishedMenuIds,
};
