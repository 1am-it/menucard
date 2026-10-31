'use strict';

// BE-55 stap B (#135) — welke restaurants mag deze houder van aanbod voorzien?
//
// De pagina /mijn-restaurant/aanbod haalt twee dingen op (`GET
// /api/internal/v1/me` en `GET /api/claims/mine` bestaat al voor het
// dashboard), maar heeft alleen de goedgekeurde restaurants nodig. Deze module
// is de enige plek die dat bepaalt:
//   - alleen een `owner`-rol met een restaurant_id telt (dezelfde rij die de
//     API als eigendom controleert, uit een goedgekeurde claim);
//   - de naam komt uit de bestaande statische index; onbekend blijft onbekend,
//     maar het restaurant verdwijnt niet;
//   - elk restaurant staat er één keer in, gesorteerd op naam.
//
// Geen React, geen netwerk: `node --test` laadt dit direct.

function tekst(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {{ roles?: Array<object>, restaurantIndex?: object }} input
 * @returns {Array<{ id: string, name: string }>}
 */
function eigenRestaurants({ roles, restaurantIndex } = {}) {
  const rijen = Array.isArray(roles) ? roles : [];
  const index = restaurantIndex && typeof restaurantIndex === 'object' ? restaurantIndex : {};
  const gezien = new Map();

  for (const rij of rijen) {
    if (!rij || typeof rij !== 'object') continue;
    if (tekst(rij.role) !== 'owner') continue;
    const id = tekst(rij.restaurant_id);
    if (!id || gezien.has(id)) continue;
    const entry = index[id];
    const naam = entry && typeof entry === 'object' ? tekst(entry.name) : '';
    gezien.set(id, { id, name: naam || id });
  }

  return Array.from(gezien.values()).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

module.exports = { eigenRestaurants };
