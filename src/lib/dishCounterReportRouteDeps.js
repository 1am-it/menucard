// BE-45 (#114) — de echte afhankelijkheden van de tellertabel-route (server
// only).
//
// Alleen hier komen de bestaande authenticatie, de server-admin-client en de
// echte menukaarten en restaurants binnen; de handler zelf
// (src/lib/dishCounterReportHandlers.js) kent geen Supabase en is met een
// nep-client getest. Dezelfde resolutie als de deeplink: de gerechtnaam komt uit
// data/menus.json en de restaurantnaam uit data/restaurants.json (contract
// criterium 2), nooit uit de tellertabel.

import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { createDishCounterReportHandlers } from '@/src/lib/dishCounterReportHandlers'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'

export const dishCounterReportHandlers = createDishCounterReportHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  menus: menusData,
  restaurants: restaurantsData,
})
