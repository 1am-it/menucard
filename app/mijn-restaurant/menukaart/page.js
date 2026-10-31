// BE-58 deel 2 (#143) — /mijn-restaurant/menukaart: "Snel aanpassen".
//
// Server Component, zelfde reden als /mijn-restaurant: alleen de kleine
// statische index (naam en kaart-ids per restaurant) gaat naar de browser. De
// gerechten van de eigen kaart komen per kaart uit
// GET /api/v1/menukaart/gerechten, de eigen wijzigingen uit
// GET /api/v1/menukaart/wijzigingen; beide weigeren een niet-houder (403).

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'
import { buildOwnerRestaurantIndex } from '@/src/lib/ownerRestaurantIndex'
import MenukaartBeheer from './MenukaartBeheer'

export default function MijnMenukaartPage() {
  return <MenukaartBeheer restaurantIndex={buildOwnerRestaurantIndex(restaurantsData, menusData)} />
}
