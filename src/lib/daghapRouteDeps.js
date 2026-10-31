// BE-55 stap A (#135) — de echte afhankelijkheden van de daghap-routes
// (server only).
//
// Alleen hier komen de bestaande server-admin-client (service role), de
// bestaande sessiecontrole voor houders (`authenticateAnyUser`, dezelfde als
// /api/claims/*) en de bestaande menukaarten en restaurants binnen; de handler
// zelf (src/lib/daghapHandlers.js) kent geen Supabase en is met een nep-client
// getest. Eén instantie per serverproces, net als kiesRouteDeps.
//
// De service role is hier nodig omdat de drie tabellen van 0023 RLS aan hebben
// en bewust geen policy voor anon of authenticated: niemand leest of schrijft
// rechtstreeks, alleen deze routes. Er gaat nooit een sleutel naar de browser.
//
// De duurste prijs op de kaart komt uit de echte data (data/menus.json) en
// bepaalt de 3×-prijsgrens van het filter; zonder kaartdata vervalt die grens.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateAnyUser } from '@/src/lib/claimAuth'
import { createDaghapHandlers } from '@/src/lib/daghapHandlers'
import { duursteKaartPrijsCent } from '@/src/lib/daghapAanbod'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'

export const daghapHandlers = createDaghapHandlers({
  getSupabase: getSupabaseAdmin,
  authenticate: authenticateAnyUser,
  duursteKaartPrijs: (restaurantId) => duursteKaartPrijsCent({
    restaurantId,
    restaurant: restaurantsData[restaurantId],
    menus: menusData,
  }),
})
