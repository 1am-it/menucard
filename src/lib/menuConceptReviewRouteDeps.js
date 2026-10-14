// BE-17 Menuconcepten beoordelen v1 — the real dependencies wired into the
// menu-concept review handlers by the route files (server only). The
// current menu is only read; nothing here fetches or publishes.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { computeCanonicalContentHash } from '@/src/lib/menuSnapshotHash'
import { createMenuConceptReviewHandlers, sourceStatus } from '@/src/lib/menuConceptReviewHandlers'
import { createMenuConceptExportHandler } from '@/src/lib/menuConceptExport'
import { createGithubClient } from '@/src/lib/githubClient'
import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'

// BE-27: the GitHub integration exists only when the server environment
// provides it; without it "Maak review-PR" refuses clearly (no fallback).
// The token is read here, on the server, and never reaches a browser.
const github = createGithubClient({
  token: process.env.GITHUB_EXPORT_TOKEN,
  repository: process.env.GITHUB_EXPORT_REPOSITORY,
})

export const menuConceptReviewHandlers = createMenuConceptReviewHandlers({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
  liveMenus: menusData,
  computeMenuHash: computeCanonicalContentHash,
  github,
})

export const menuConceptExportHandler = createMenuConceptExportHandler({
  authenticate: authenticateInternalRequest,
  getSupabase: getSupabaseAdmin,
  restaurants: restaurantsData,
  liveMenus: menusData,
  computeMenuHash: computeCanonicalContentHash,
  github,
  sourceStatus,
})
