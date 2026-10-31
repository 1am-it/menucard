'use strict';

// BE-59 (#146, aanvulling 30 okt) — de restaurantnaam bij een owner-rol.
//
// GET /api/internal/v1/me geeft de rollen van de ingelogde gebruiker terug als
// `{ role, restaurant_id }[]`. Voor "Restauranthouder van [naam]" is de naam
// nodig, en die staat niet in de sessie. De server leest de naam uit dezelfde
// statische index die "Mijn restaurant" al gebruikt (data/restaurants.json via
// src/lib/ownerRestaurantIndex.js); de browser krijgt alleen de naam mee.
//
// Puur en zonder netwerk: geen React, geen Supabase, `node --test` laadt dit
// direct. Een onbekende of ontbrekende id levert géén naam op — de rij blijft
// dan ongewijzigd en de weergave valt terug op "Restauranthouder" zonder plaats.
// Niets hier verleent toegang; het voegt alleen een publieke naam toe.

function withOwnerRestaurantNames(roles, restaurants) {
  if (!Array.isArray(roles)) return [];
  const index = restaurants && typeof restaurants === 'object' ? restaurants : {};

  return roles.map((row) => {
    if (!row || typeof row !== 'object' || row.role !== 'owner') return row;
    const id = typeof row.restaurant_id === 'string' ? row.restaurant_id : '';
    const entry = id ? index[id] : null;
    const name = entry && typeof entry === 'object' && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) return row;
    return { ...row, restaurant_name: name };
  });
}

module.exports = { withOwnerRestaurantNames };
