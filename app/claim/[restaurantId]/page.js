// PLATFORM-07 — server-side restaurant lookup, same pattern as BE-08's
// restaurant/menu/nvwa pages: only the looked-up data crosses to the
// client component, never the full dataset.

import restaurantsData from '@/data/restaurants.json'
import ClaimView from './ClaimView'

export default async function ClaimPage({ params }) {
  const { restaurantId } = await params
  const restaurant = restaurantsData[restaurantId] || null

  return <ClaimView restaurantId={restaurantId} restaurant={restaurant} />
}
