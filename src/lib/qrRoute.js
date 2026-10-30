'use strict';

// BE-56 (#137, punt 5) — het vaste korte QR-adres /r/<id>.
//
// Waarom dit bestaat: een geprinte QR-code mag nooit stukgaan. Het id van een
// restaurant is stabiel, de naam en het pagina-adres zijn dat niet. Een code
// die naar /r/6 wijst blijft dus werken als /restaurant/6 ooit verandert; deze
// module bepaalt waar zo'n code heen gaat.
//
// Een optionele naam achter het id wordt genegeerd: /r/6-blossem is dezelfde
// code als /r/6. Een onbekend id is geen gok en geen doorverwijzing naar de
// home, maar een 404 (zie app/r/[id]/page.js).
//
// Bewust CommonJS, zoals dishShare.js en siteUrl.js: direct testbaar met
// `node --test`, zonder React of netwerk.

// Het korte adres en de pagina waar het heen gaat.
const QR_ROUTE_PREFIX = '/r';
const RESTAURANT_ROUTE_PREFIX = '/restaurant';

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/**
 * Het id vóór de eerste streep: '/r/6-blossem' → '6'. Alleen letters en
 * cijfers tellen; al het andere is geen id.
 */
function qrRestaurantId(value) {
  const text = textOf(value);
  if (!text) return null;
  const [head] = text.split('-');
  if (!/^[a-z0-9]+$/i.test(head)) return null;
  return head;
}

/**
 * Het bestaande restaurant-id achter een QR-adres, of null als dat er niet is.
 * Eerst het hele id (voor het geval een id zelf een streepje heeft), dan het
 * stuk vóór de eerste streep.
 */
function qrRestaurantTarget({ id, restaurants } = {}) {
  const list = restaurants && typeof restaurants === 'object' ? restaurants : {};
  const known = (value) => Object.prototype.hasOwnProperty.call(list, value);
  const text = textOf(id);
  if (text && known(text)) return text;
  const base = qrRestaurantId(text);
  if (!base) return null;
  return known(base) ? base : null;
}

/** De restaurantpagina van dit id; null zonder id. */
function restaurantHref(id) {
  const text = textOf(id);
  if (!text) return null;
  return `${RESTAURANT_ROUTE_PREFIX}/${text}`;
}

/** Het korte QR-adres van dit id; null zonder id. */
function qrRestaurantHref(id) {
  const text = textOf(id);
  if (!text) return null;
  return `${QR_ROUTE_PREFIX}/${text}`;
}

module.exports = {
  QR_ROUTE_PREFIX,
  RESTAURANT_ROUTE_PREFIX,
  qrRestaurantHref,
  qrRestaurantId,
  qrRestaurantTarget,
  restaurantHref,
};
