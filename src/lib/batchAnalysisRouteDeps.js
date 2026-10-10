// BE-25 fase 2 — the real dependencies wired into the batch-analysis
// handlers by the three route files (server only).

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { analyzeSourceUrl } from '@/src/lib/sourceAnalysisPipeline'
import { computeAnalysisResultHash } from '@/src/lib/urlIntakeReceiptHash'
import { createBatchAnalysisHandlers } from '@/src/lib/batchAnalysisHandlers'
import restaurantsData from '@/data/restaurants.json'

export const batchAnalysisHandlers = createBatchAnalysisHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
  generateId: generateUuidV7,
  analyze: analyzeSourceUrl,
  computeHash: computeAnalysisResultHash,
})
