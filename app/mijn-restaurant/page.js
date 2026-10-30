// BE-47 (#111) — /mijn-restaurant, het eigen overzicht van een restauranthouder.
//
// Server Component, zelfde reden als bij app/restaurant/[id]/page.js: alleen de
// kleine statische index (naam + kaart-ids per restaurant) gaat naar de browser,
// nooit de volledige data/restaurants.json of data/menus.json. De sessie, de
// rollen (`GET /api/internal/v1/me`) en de claims (`GET /api/claims/mine`)
// worden client-side opgehaald; alle beslissingen daarover staan in
// src/lib/ownerRestaurantOverview.js en src/lib/ownerAccess.js en zijn daar met
// `node --test` getest.

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'
import { buildOwnerRestaurantIndex } from '@/src/lib/ownerRestaurantIndex'
import OwnerDashboard from './OwnerDashboard'

export default function MijnRestaurantPage() {
  return <OwnerDashboard restaurantIndex={buildOwnerRestaurantIndex(restaurantsData, menusData)} />
}
