// BE-31 herstel (#74) — de echte afhankelijkheden van "Oude resultaten
// opruimen". Alleen bestaande onderdelen: de interne aanmelding en de
// service-role client die BE-30 ook gebruikt voor de additieve schrijf op
// `restaurant_source_analysis_jobs.field_evidence`. Geen nieuwe tabel, geen
// migratie, geen tweede client en geen AI.

import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { createBatchResultHandlingHandlers } from '@/src/lib/batchResultHandling'

export const batchResultHandlingHandlers = createBatchResultHandlingHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: () => getSupabaseAdmin(),
})
