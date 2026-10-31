// BE-57 (#139, deel 1) — de echte afhankelijkheden van de tellerroute
// "bekeken" (server only).
//
// Alleen hier komen de bestaande server-admin-client en de echte restaurants
// binnen; de handler zelf (src/lib/restaurantViewHandlers.js) kent geen
// Supabase en is met een nep-client getest. Eén instantie per serverproces, net
// als bij dishCounterRouteDeps: de geheugenlimiet van één verzoek per seconde
// per restaurant hoort bij die ene instantie.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { createRestaurantViewHandlers } from '@/src/lib/restaurantViewHandlers'
import restaurantsData from '@/data/restaurants.json'

export const restaurantViewHandlers = createRestaurantViewHandlers({
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
})
