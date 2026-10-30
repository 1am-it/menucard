// BE-55 stap B (#135) — /mijn-restaurant/aanbod.
//
// Server Component, net als /mijn-restaurant: alleen de kleine statische index
// (naam + kaart-ids per restaurant) gaat naar de browser, nooit de volledige
// data/restaurants.json of data/menus.json. De sessie, de rollen en het aanbod
// haalt AanbodView client-side op; alle beslissingen staan in
// src/lib/ownerAanbod.js en src/lib/daghapFormulier.js en zijn daar getest.

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'
import { buildOwnerRestaurantIndex } from '@/src/lib/ownerRestaurantIndex'
import AanbodView from './AanbodView'

export default function AanbodPage() {
  return <AanbodView restaurantIndex={buildOwnerRestaurantIndex(restaurantsData, menusData)} />
}
