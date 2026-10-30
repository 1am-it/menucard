// BE-46 (#106, criterium 2) — de echte afhankelijkheden van de kies-routes
// (server only).
//
// Alleen hier komen de bestaande server-admin-client (service role), de echte
// menukaarten en restaurants en de bestaande reserveerroutering (BE-07)
// binnen; de handler zelf (src/lib/kiesHandlers.js) kent geen Supabase en is
// met een nep-client getest. Eén instantie per serverproces, net als
// dishCounterRouteDeps.
//
// De service role is hier nodig omdat de twee tabellen van 0022 RLS aan hebben
// en bewust geen policy voor anon of authenticated: niemand leest of schrijft
// rechtstreeks, alleen deze routes. Er gaat nooit een sleutel naar de browser.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { createKiesHandlers } from '@/src/lib/kiesHandlers'
import { getReservationActions } from '@/src/utils/reservation'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'

export const kiesHandlers = createKiesHandlers({
  getSupabase: getSupabaseAdmin,
  menus: menusData,
  restaurants: restaurantsData,
  // Dezelfde routering als op de menukaart: de eerste echte actie van BE-07.
  reservationFor: (restaurant) => getReservationActions(restaurant || {})[0] || null,
})
