// #59 fase 2 — de echte afhankelijkheden van de handmatige AI-import
// (server only). Hergebruikt de bestaande veilige ophaalroute, de bestaande
// protocollezer en de bestaande conceptopslag. Geen provider, geen AI-call en
// geen nieuwe schrijver.
//
// Sinds herstelronde 6350337273 (K1) is er geen gedeeld geheugen meer nodig: de
// tussenstap reist in een AES-GCM-token waarvan de sleutel met HKDF uit het
// bestaande `SUPABASE_SERVICE_ROLE_KEY` komt. Dat is geen nieuw geheim en geen
// nieuwe env-variabele. Ontbreekt het geheim, dan geeft de handler een concrete
// fout in plaats van stil door te gaan.

import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { loadMenuExtractionProtocol } from '@/src/lib/menuExtractionProtocol'
import { fetchWebsiteSafely } from '@/src/lib/safeOutboundFetch'
import { checkRobotsForUrl, fetchSameSiteWithRedirects } from '@/src/lib/restaurantSourceFetch'
import { computeCanonicalContentHash } from '@/src/lib/menuSnapshotHash'
import { createConceptVersion } from '@/src/lib/menuConceptStore'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { readManualImportSources } from '@/src/lib/manualMenuImportSource'
import { sharedUsageLedger } from '@/src/lib/manualMenuImportUsage'
import { createManualImportStateCipher } from '@/src/lib/manualMenuImportState'
import { createManualMenuImportHandlers } from '@/src/lib/manualMenuImportHandlers'
import restaurantsData from '@/data/restaurants.json'

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
  // De sleutel wordt pas bij de eerste stap afgeleid; een ontbrekend geheim
  // geeft dan een concrete fout (state_config_missing) en nooit een stille
  // doorgang.
  stateCipher: createManualImportStateCipher({ secret: process.env.SUPABASE_SERVICE_ROLE_KEY }),
  restaurants: restaurantsData,
  usageLedger: sharedUsageLedger,
})
