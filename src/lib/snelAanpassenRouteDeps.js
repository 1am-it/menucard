// BE-58 deel 1 (#143) — de echte afhankelijkheden van de menukaartroutes
// (server only).
//
// Alleen hier komen de bestaande server-admin-client (service role), de
// bestaande houderssessie (`authenticateAnyUser`, dezelfde als /api/claims/*),
// de bestaande interne auth (`authenticateInternalRequest`) en de bestaande
// menukaarten binnen; de handler zelf (src/lib/snelAanpassenHandlers.js) kent
// geen Supabase en is met een nep-client getest.
//
// De service role is nodig omdat de drie tabellen van 0025 RLS aan hebben en
// bewust geen policy voor anon of authenticated: niemand leest of schrijft
// rechtstreeks, alleen deze routes. Er gaat nooit een sleutel naar de browser.
// De statische kaart (data/menus.json) is de bron voor de huidige prijs en de
// gerechtnaam; de overlay schrijft daar nooit in.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateAnyUser } from '@/src/lib/claimAuth'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { createSnelAanpassenHandlers } from '@/src/lib/snelAanpassenHandlers'
import menusData from '@/data/menus.json'

export const snelAanpassenHandlers = createSnelAanpassenHandlers({
  getSupabase: getSupabaseAdmin,
  authenticate: authenticateAnyUser,
  authenticateInternal: authenticateInternalRequest,
  menus: menusData,
})
