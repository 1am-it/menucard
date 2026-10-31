'use strict';

// BE-60 (#150) — de goedgekeurde houderwijzigingen als overlay op de
// zoekresultaten.
//
// Een goedgekeurde wijziging (BE-58, #143) verandert de statische menukaart
// nooit. Op /menu/[id] en /restaurant/[id] legt de pagina de overlay erover
// (src/lib/menukaartOverlay.js). Deze module doet precies dat voor de
// zoekresultaten: de nieuwe prijs, het label "Tijdelijk niet beschikbaar", en
// het prijsfilter dat met de nieuwe prijs rekent.
//
// Belangrijk: de overlay wordt vóór het filteren toegepast (zie
// src/services/dishSearch.js), zodat het filter "Tot € x" de nieuwe prijs
// gebruikt. Sorteren gebeurt op tier, afstand, restaurantnaam en gerechtnaam —
// nooit op prijs — dus de volgorde blijft identiek met en zonder overlay.
//
// Bewust CommonJS, zoals snelAanpassen.js: de zoeklaag en de tests gebruiken
// dezelfde code.

const { pasWijzigingToeOpGerecht } = require('./snelAanpassen');

/** Hetzelfde label als op de menukaart (BE-58, src/components/MenuBody.js). */
const TIJDELIJK_NIET_BESCHIKBAAR = 'Tijdelijk niet beschikbaar';

function tekst(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** De menukaart van een wijziging (`23-lunch`), in beide bestaande vormen. */
function menuIdVan(wijziging) {
  return tekst(wijziging.menu_id !== undefined ? wijziging.menu_id : wijziging.menuId);
}

/** `categorie-gerecht` van een wijziging, of null als de positie ongeldig is. */
function positieVan(wijziging) {
  const categorie = Number(wijziging.categorie_index !== undefined ? wijziging.categorie_index : wijziging.categorieIndex);
  const gerecht = Number(wijziging.gerecht_index !== undefined ? wijziging.gerecht_index : wijziging.gerechtIndex);
  if (!Number.isInteger(categorie) || !Number.isInteger(gerecht) || categorie < 0 || gerecht < 0) return null;
  return `${categorie}-${gerecht}`;
}

/**
 * De overlay per gerecht, gesleuteld op hetzelfde id dat de zoekindex gebruikt:
 * `restaurantId-maaltijd-categorie-gerecht` (zie buildDishIndex in
 * src/services/dishSearch.js). Een wijziging zonder menukaart of met een
 * ongeldige positie wordt overgeslagen: die kan nergens veilig landen. De
 * laatste wijziging per gerecht wint, net als in pasOverlayToe().
 *
 * @param {object|Map} overlay - restaurantId → wijzigingen (publieke vorm of
 *   de databaserij; beide komen hier samen)
 * @returns {Map<string, object>}
 */
function overlayPerGerecht(overlay) {
  const perGerecht = new Map();
  if (!overlay || typeof overlay !== 'object') return perGerecht;
  const entries = overlay instanceof Map ? overlay.entries() : Object.entries(overlay);
  for (const [restaurantId, wijzigingen] of entries) {
    if (!tekst(restaurantId)) continue;
    for (const wijziging of Array.isArray(wijzigingen) ? wijzigingen : []) {
      if (!wijziging || typeof wijziging !== 'object') continue;
      const menuId = menuIdVan(wijziging);
      const positie = positieVan(wijziging);
      if (!menuId || !positie) continue;
      perGerecht.set(`${menuId}-${positie}`, wijziging);
    }
  }
  return perGerecht;
}


/**
 * Eén zoekgerecht met de overlay erop. Zonder raakvlak komt exact hetzelfde
 * object terug, zodat een zoekopdracht zonder wijzigingen niets extra kost.
 * Alleen de prijs en het label veranderen; elk ander veld blijft gelijk.
 */
function pasZoekOverlayToeOpGerecht(dish, perGerecht) {
  if (!dish || !perGerecht || perGerecht.size === 0) return dish;
  const wijziging = perGerecht.get(dish.dishId);
  if (!wijziging) return dish;
  const basis = { price: dish.priceDisplay, priceValue: dish.priceValue };
  const nieuw = pasWijzigingToeOpGerecht(basis, wijziging);
  if (nieuw === basis) return dish;
  const resultaat = { ...dish };
  if (nieuw.price !== basis.price || nieuw.priceValue !== basis.priceValue) {
    resultaat.priceDisplay = nieuw.price;
    resultaat.priceValue = nieuw.priceValue;
    // Een goedgekeurde prijs is een echte prijs: het gerecht is niet langer
    // "op aanvraag", ook al stond dat zo op de statische kaart.
    resultaat.priceOnRequest = false;
  }
  if (nieuw.tijdelijkNietBeschikbaar === true) resultaat.tijdelijkNietBeschikbaar = true;
  return resultaat;
}

/** De restaurant-id's die in dit zoekresultaat te zien zijn, zonder dubbelen. */
function verzamelRestaurantIds(result) {
  const ids = [];
  const gezien = new Set();
  const toevoegen = (id) => {
    const waarde = tekst(id);
    if (!waarde || gezien.has(waarde)) return;
    gezien.add(waarde);
    ids.push(waarde);
  };
  for (const rij of Array.isArray(result && result.results) ? result.results : []) toevoegen(rij && rij.restaurantId);
  for (const groep of Array.isArray(result && result.restaurantGroups) ? result.restaurantGroups : []) {
    toevoegen(groep && groep.restaurantId);
  }
  return ids;
}

/** De al opgehaalde overlay aangevuld met nieuwe restaurants. */
function voegOverlaySamen(bestaand, nieuw) {
  const samen = bestaand && typeof bestaand === 'object' ? bestaand : {};
  if (!nieuw || typeof nieuw !== 'object') return samen;
  const entries = nieuw instanceof Map ? nieuw.entries() : Object.entries(nieuw);
  for (const [restaurantId, wijzigingen] of entries) {
    const id = tekst(restaurantId);
    const lijst = (Array.isArray(wijzigingen) ? wijzigingen : [])
      .filter((wijziging) => wijziging && typeof wijziging === 'object');
    if (!id || lijst.length === 0) continue;
    samen[id] = [...(Array.isArray(samen[id]) ? samen[id] : []), ...lijst];
  }
  return samen;
}

/**
 * Zoeken met de overlay van de restaurants in beeld.
 *
 * `zoek(overlay)` doet één zoekopdracht met de overlay die er dan is;
 * `laadOverlay(ids)` haalt de overlay van precies die restaurants op (de
 * zoekroute gebruikt daarvoor dezelfde gecachte functie als BE-58). Eerst
 * zoeken, dan alleen de restaurants uit dat resultaat ophalen, en alleen als
 * daar wijzigingen bij zitten opnieuw zoeken. Zonder wijzigingen is het eerste
 * resultaat het antwoord: dan verandert er niets aan de zoekopdracht.
 *
 * Bewuste grens: een gerecht waarvan de *nieuwe* prijs pas binnen "Tot € x"
 * valt terwijl de statische prijs erbuiten valt, komt mee zodra dat restaurant
 * al met een ander gerecht in het resultaat staat (dan is de overlay bekend).
 * Staat het restaurant nergens anders in beeld, dan is zijn overlay niet
 * opgehaald — dat kost anders een opvraag voor elke restaurant uit de dataset
 * bij elke zoekopdracht, en dat is precies wat dit ticket verbiedt.
 */
async function zoekMetOverlay({ zoek, laadOverlay } = {}) {
  if (typeof zoek !== 'function') throw new TypeError('zoekMetOverlay heeft een zoekfunctie nodig');
  const eerste = zoek(null);
  if (typeof laadOverlay !== 'function') return eerste;
  const ids = verzamelRestaurantIds(eerste);
  if (ids.length === 0) return eerste;
  let overlay = null;
  try {
    overlay = await laadOverlay(ids);
  } catch (error) {
    // Een storing in de overlay mag een zoekopdracht nooit stukmaken: dan
    // blijven de statische prijzen staan.
    return eerste;
  }
  const aantal = overlay instanceof Map ? overlay.size : Object.keys(overlay || {}).length;
  if (aantal === 0) return eerste;
  return zoek(overlay);
}

module.exports = {
  TIJDELIJK_NIET_BESCHIKBAAR,
  overlayPerGerecht,
  pasZoekOverlayToeOpGerecht,
  verzamelRestaurantIds,
  zoekMetOverlay,
};
