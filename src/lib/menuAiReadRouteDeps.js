// #59 / BE-21 (Lead review 6380804419) — de echte afhankelijkheden van de
// AI-lezing ("Lees met AI", route B in de app). Alleen bestaande onderdelen:
// de interne aanmelding, de veilige ophaalroute, de vastgepinde instructie, de
// bestaande provider-call, de bestaande staatscipher en de bestaande
// conceptopslag. Geen nieuwe tabel, geen migratie, geen tweede schrijver.
//
// Twee bronnen zijn toegestaan en geen enkele andere:
//   1. het ondertekende toestandstoken van stap 1 van de handmatige import
//      (een capture die deze server zelf las en verzegelde);
//   2. het id van een bestaande analyse-opdracht, waarvan de URL in de
//      database wordt opgezocht. Een URL uit het verzoek wordt nooit gebruikt.

import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { loadMenuExtractionProtocol } from '@/src/lib/menuExtractionProtocol'
import { fetchWebsiteSafely } from '@/src/lib/safeOutboundFetch'
import { checkRobotsForUrl, fetchSameSiteWithRedirects } from '@/src/lib/restaurantSourceFetch'
import { computeCanonicalContentHash } from '@/src/lib/menuSnapshotHash'
import { createConceptVersion } from '@/src/lib/menuConceptStore'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { readManualImportSources } from '@/src/lib/manualMenuImportSource'
import { readAllAiUsageRows } from '@/src/lib/manualMenuImportUsageSource'
import { createManualImportStateCipher } from '@/src/lib/manualMenuImportState'
import { createAnthropicStructuredCall } from '@/src/lib/menuExtractionAnthropicCall'
import { createMenuAiReadHandlers } from '@/src/lib/menuAiReadHandlers'
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
    },
    { computeMenuHash: computeCanonicalContentHash, now: () => new Date() },
  )
  return { status: result.status, body: result.body }
}

/**
 * De toegestane bron van een bestaande analyse-opdracht. De URL komt uit de
 * database; de vaste menupagina's die de analyse al vond gaan mee, zodat een
 * AI-lezing dezelfde bronnen ziet. Niets uit het verzoek bepaalt de URL.
 */
async function resolveJob({ jobId }, { restaurantId }) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('restaurant_source_analysis_jobs')
    .select('id, canonical_source_url, status, result_receipt_id, menu_source_urls:field_evidence->menu_source_urls')
    .eq('id', jobId)
    .maybeSingle()
  if (error || !data || typeof data.canonical_source_url !== 'string') return { ok: false }
  const urls = [data.canonical_source_url]
  for (const url of Array.isArray(data.menu_source_urls) ? data.menu_source_urls : []) {
    if (typeof url === 'string' && url.trim() !== '' && !urls.includes(url)) urls.push(url)
  }
  let matched = null
  if (data.result_receipt_id) {
    const { data: receipt } = await supabase
      .from('url_intake_analysis_receipts')
      .select('matched_restaurant_id')
      .eq('id', data.result_receipt_id)
      .maybeSingle()
    matched = receipt && typeof receipt.matched_restaurant_id === 'string' ? receipt.matched_restaurant_id : null
  }
  return { ok: true, urls, restaurantId: matched || restaurantId || null }
}

function restaurantExists(id) {
  return Boolean(restaurantsData && Object.prototype.hasOwnProperty.call(restaurantsData, String(id)))
}

export const menuAiReadHandlers = createMenuAiReadHandlers({
  authenticate: authenticateInternalRequest,
  env: () => process.env,
  // BE-30 (#72): dezelfde maandteller voor elke AI-uitgave — de AI-lezingen en
  // de AI-adviezen samen, tegen hetzelfde plafond van 1000 cent.
  readUsageRows: () => readAllAiUsageRows(getSupabaseAdmin()),
  readSources: ({ urls, now }) => readManualImportSources({ urls, fetchImpl: fetchOne, robotsCheck, now }),
  resolveJob: (request) => resolveJob(request, { restaurantId: null }),
  restaurantExists,
  loadProtocol: () => loadMenuExtractionProtocol(),
  // Dezelfde versleutelde tussenstap als de handmatige import; ontbreekt het
  // bestaande servergeheim, dan volgt een concrete fout en geen stille doorgang.
  openState: (token) => createManualImportStateCipher({ secret: process.env.SUPABASE_SERVICE_ROLE_KEY }).open(token),
  sealState: (state) => createManualImportStateCipher({ secret: process.env.SUPABASE_SERVICE_ROLE_KEY }).seal(state),
  saveConcept,
  // De sleutel wordt pas hier gelezen; zonder sleutel of vlag geeft de handler
  // 'ai_not_configured' en wordt er niets aangeroepen.
  createCall: ({ budget }) => createAnthropicStructuredCall({ env: process.env, budget }),
  generateId: generateUuidV7,
})
