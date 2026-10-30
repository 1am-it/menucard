// BE-55 stap B, deel 4 (#135) — de echte afhankelijkheden van de interne
// werkvoorraad (server only).
//
// Alleen hier komen de bestaande server-admin-client (service role) en de
// bestaande interne auth (`authenticateInternalRequest`, met hetzelfde
// TOTP-niveau als elke andere /internal-pagina) binnen. De logica staat in
// src/lib/daghapBeheerHandlers.js en is met een nep-client getest. De service
// role is nodig omdat de tabellen van 0023 RLS aan hebben en bewust geen
// policy voor anon of authenticated: er gaat nooit een sleutel naar de browser.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { createDaghapBeheerHandlers } from '@/src/lib/daghapBeheerHandlers'

export const daghapBeheerHandlers = createDaghapBeheerHandlers({
  getSupabase: getSupabaseAdmin,
  authenticate: authenticateInternalRequest,
})
