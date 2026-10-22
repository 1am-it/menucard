// #59 fase 2 — de echte afhankelijkheden van de handmatige AI-import
// (server only). Hergebruikt de bestaande veilige ophaalroute, de bestaande
// protocollezer en de bestaande conceptopslag. Geen provider, geen AI-call en
// geen nieuwe schrijver.

import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { loadMenuExtractionProtocol } from '@/src/lib/menuExtractionProtocol'
import { fetchWebsiteSafely } from '@/src/lib/safeOutboundFetch'
import { checkRobotsForUrl, fetchSameSiteWithRedirects } from '@/src/lib/restaurantSourceFetch'
import { computeCanonicalContentHash } from '@/src/lib/menuSnapshotHash'
import { createConceptVersion } from '@/src/lib/menuConceptStore'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { readManualImportSources } from '@/src/lib/manualMenuImportSource'
import { sharedBundleStore } from '@/src/lib/manualMenuImportBundle'
import { sharedImportStore } from '@/src/lib/manualMenuImportReview'
import { sharedUsageLedger } from '@/src/lib/manualMenuImportUsage'
import { createManualMenuImportHandlers } from '@/src/lib/manualMenuImportHandlers'

const MAX_SOURCE_BYTES = 15 * 1024 * 1024

function robotsCheck(url) {
  return checkRobotsForUrl(url, { fetchImpl: fetchWebsiteSafely })
}

/** Elke hop door dezelfde veilige fetch met hetzelfde robotsbeleid. */
async function fetchOne(url, options = {}) {
  const { response } = await fetchSameSiteWithRedirects(url, {
    fetchImpl: fetchWebsiteSafely,
    fetchOptions: { ...options, maxBytes: options.maxBytes || MAX_SOURCE_BYTES },
    robotsCheck,
  })
  return response
}

/** Alleen de bestaande conceptroute; niets publiceren of bevestigen. */
async function saveConcept(input) {
  const supabase = getSupabaseAdmin()
  const result = await createConceptVersion(
    supabase,
    {
      restaurantId: input.restaurantId,
      menuContext: input.menuContext,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      qualityScore: input.qualityScore,
      content: input.content,
      originallyFetchedAt: input.originallyFetchedAt,
      createdBy: input.actorUserId,
      expectedVersion: input.expectedVersion,
    },
    { computeMenuHash: computeCanonicalContentHash, now: () => new Date() },
  )
  return { status: result.status, body: result.body }
}

export const manualMenuImportHandlers = createManualMenuImportHandlers({
  authenticate: authenticateInternalRequest,
  readSources: ({ urls, now }) => readManualImportSources({ urls, fetchImpl: fetchOne, robotsCheck, now }),
  loadProtocol: () => loadMenuExtractionProtocol(),
  generateId: generateUuidV7,
  saveConcept,
  bundleStore: sharedBundleStore,
  importStore: sharedImportStore,
  usageLedger: sharedUsageLedger,
})
