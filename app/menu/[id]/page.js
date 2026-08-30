// BE-08 — performance cleanup.
//
// Server Component: looks up just this one menu (+its restaurant) server-
// side so the full menus.json/restaurants.json dataset is never bundled to
// the client for this route. All interactivity (search, filters, category
// scroll-spy) lives in MenuView, which receives only the already-looked-up
// data as props.

import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'
import MenuView from './MenuView'

export default async function MenuPage({ params }) {
  const { id } = await params
  const r = menusData[id] || null
  const baseId = id.split('-')[0]
  const restaurant = restaurantsData[baseId] || {}
  const availableMeals = r
    ? ['lunch', 'diner', 'borrel', 'specialiteiten'].filter(m => menusData[`${baseId}-${m}`])
    : []

  return <MenuView id={id} r={r} restaurant={restaurant} availableMeals={availableMeals} />
}
