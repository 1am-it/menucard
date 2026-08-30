// BE-08 — performance cleanup.
//
// Server Component: looks up just this one restaurant/menu server-side so
// the full restaurants.json/menus.json dataset is never bundled to the
// client for this route (previously imported directly in a 'use client'
// page — see docs/changelog/README.md's BE-08 entry). All interactivity
// lives in RestaurantDetailView, which receives only the already-looked-up
// data as props.

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'
import RestaurantDetailView from './RestaurantDetailView'

function getMenuPreview(restaurantId) {
  // Return first menu found for this restaurant
  const keys = Object.keys(menusData).filter(k => k.startsWith(`${restaurantId}-`))
  if (!keys.length) return null
  const key = keys[0]
  const menu = menusData[key]
  const items = []
  for (const cat of (menu.categories || [])) {
    for (const item of (cat.items || [])) {
      items.push({ ...item, category: cat.name })
      if (items.length >= 6) break
    }
    if (items.length >= 6) break
  }
  return { key, menu, items }
}

export default async function RestaurantPage({ params }) {
  const { id } = await params
  const restaurant = restaurantsData[id] || null
  const menuPreview = restaurant ? getMenuPreview(id) : null

  return <RestaurantDetailView id={id} restaurant={restaurant} menuPreview={menuPreview} />
}
