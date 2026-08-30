// BE-08 — performance cleanup.
//
// Server Component: looks up just this one restaurant's menu items server-
// side so the full menus.json/restaurants.json dataset is never bundled to
// the client for this route. Filtering/printing interactivity lives in
// NvwaView, which receives only the already-derived items as props.

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'
import NvwaView from './NvwaView'

// Derive all menu items for a restaurant from menus.json
function getMenuItems(restaurantId) {
  const sections = []
  for (const [key, menu] of Object.entries(menusData)) {
    if (!key.startsWith(`${restaurantId}-`)) continue
    const mealType = key.split('-').slice(1).join('-')
    for (const cat of (menu.categories || [])) {
      for (const item of (cat.items || [])) {
        sections.push({
          key: `${key}-${cat.name}-${item.name}`,
          mealType,
          menuSubtitle: menu.subtitle,
          category: cat.name,
          name: item.name,
          desc: item.desc || '',
          allergens: item.allergens || null, // null = unknown, [] = none, [1,7] = has these
        })
      }
    }
  }
  return sections
}

export default async function NvwaPage({ params }) {
  const { id } = await params
  const restaurant = restaurantsData[id] || null
  const allItems = restaurant ? getMenuItems(id) : []

  return <NvwaView id={id} restaurant={restaurant} allItems={allItems} />
}
