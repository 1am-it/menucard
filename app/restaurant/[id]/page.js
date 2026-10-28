// BE-08 — performance cleanup.
//
// Server Component: looks up just this one restaurant/menu server-side so
// the full restaurants.json/menus.json dataset is never bundled to the
// client for this route (previously imported directly in a 'use client'
// page — see docs/changelog/README.md's BE-08 entry). All interactivity
// lives in RestaurantDetailView, which receives only the already-looked-up
// data as props.
//
// BE-42 (#98) 2A — de menukaarten staan in tabbladen. De keuze komt uit de
// URL (`?kaart=<id>`), dus de server rendert het actieve tabblad en de hele
// kaart daarvan; zonder JavaScript werkt hetzelfde. De standaardkeuze is de
// eerste kaart in de vaste volgorde (src/lib/menuTabs.js), nooit de klok. Van
// de andere kaarten gaan alleen naam en aantal gerechten mee: nooit alle
// kaarten tegelijk in de HTML of in de props. Het restaurantrecord uit
// data/restaurants.json draagt zelf een volledige tweede kopie van alle kaarten
// (`menus`); die strip `restaurantForView` er server-side af, want de view
// gebruikt hem niet.

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'
import { restaurantMenus, restaurantForView } from '@/src/lib/menuTabs'
import RestaurantDetailView from './RestaurantDetailView'

export default async function RestaurantPage({ params, searchParams }) {
  const { id } = await params
  const query = (await searchParams) || {}
  const restaurant = restaurantsData[id] || null
  const menus = restaurant
    ? restaurantMenus({
        restaurantId: id,
        menuLinks: restaurant.menuLinks,
        menus: menusData,
        requested: query.kaart,
      })
    : null

  return <RestaurantDetailView id={id} restaurant={restaurantForView(restaurant)} menus={menus} />
}


