// BE-44 (#105, criterium 5) — de echte afhankelijkheden van de tellerroute
// (server only).
//
// Alleen hier komen de bestaande server-admin-client en de echte menukaarten
// binnen; de handler zelf (src/lib/dishCounterHandlers.js) kent geen Supabase
// en is met een nep-client getest. Eén instantie per serverproces, net als
// batchAnalysisRouteDeps: de geheugenlimiet van één verzoek per seconde per
// gerecht en gebeurtenis hoort bij die ene instantie.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { createDishCounterHandlers } from '@/src/lib/dishCounterHandlers'
import menusData from '@/data/menus.json'

export const dishCounterHandlers = createDishCounterHandlers({
  getSupabase: getSupabaseAdmin,
  menus: menusData,
})
