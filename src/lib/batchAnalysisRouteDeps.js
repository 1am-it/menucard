// BE-25 fase 2 — the real dependencies wired into the batch-analysis
// handlers by the three route files (server only).

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { analyzeSourceUrl } from '@/src/lib/sourceAnalysisPipeline'
import { computeAnalysisResultHash } from '@/src/lib/urlIntakeReceiptHash'
import { computeCanonicalContentHash } from '@/src/lib/menuSnapshotHash'
import { createBatchAnalysisHandlers } from '@/src/lib/batchAnalysisHandlers'
import { disabledMenuExtractionRuntime } from '@/src/lib/menuExtractionRuntime'
import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'

// No provider is configured. The hook is deliberately present so the import
// chain has one injectable seam; replacing it requires the provider/budget/
// data-processing decision, not a hidden environment toggle.
const structuredExtraction = disabledMenuExtractionRuntime()

export const batchAnalysisHandlers = createBatchAnalysisHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
  generateId: generateUuidV7,
  analyze: (url) => analyzeSourceUrl(url, { structuredExtraction }),
  computeHash: computeAnalysisResultHash,
  computeMenuHash: computeCanonicalContentHash,
  liveMenus: menusData,
})
