// BE-17 Menuconcepten beoordelen v1 — the real dependencies wired into the
// menu-concept review handlers by the route files (server only). The
// current menu is only read; nothing here fetches or publishes.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { computeCanonicalContentHash } from '@/src/lib/menuSnapshotHash'
import { createMenuConceptReviewHandlers } from '@/src/lib/menuConceptReviewHandlers'
import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'

export const menuConceptReviewHandlers = createMenuConceptReviewHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
  liveMenus: menusData,
  computeMenuHash: computeCanonicalContentHash,
})
