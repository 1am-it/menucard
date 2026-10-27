// BE-32 (#75) — de echte afhankelijkheden van "Vind bronnen", "Zoek de bron voor
// mij" en "Nieuw gevonden". Alleen bestaande onderdelen:
//  - de interne aanmelding (BE-24) en de service-role-client;
//  - de begrensde, veilige ophaalroute met robotsbeleid (BE-20/#59);
//  - de bestaande zelfde-website-zoekfunctie (BE-20, max. 5 kandidaten);
//  - de bestaande AI-client, hetzelfde model en dezelfde maandteller als
//    "Lees met AI" en BE-30 — geen tweede client, geen nieuwe sleutel;
//  - de bestaande BE-24-RPC's voor een voorstel; geen nieuwe tabel, geen
//    migratie en geen tweede schrijver.
//
// Geen productiegegevens in deze module; alles komt uit de bestaande routes.

import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { fetchWebsiteSafely } from '@/src/lib/safeOutboundFetch'
import { checkRobotsForUrl, fetchSameSiteWithRedirects } from '@/src/lib/restaurantSourceFetch'
import { readAllAiUsageRows } from '@/src/lib/manualMenuImportUsageSource'
import { createAnthropicStructuredCall } from '@/src/lib/menuExtractionAnthropicCall'
import { findSameHostMenuCandidates } from '@/src/lib/sameHostDiscovery'
import { fetchOverpassBusinesses } from '@/src/lib/osmOverpass'
import {
  createSourceDiscoveryHandlers,
  buildChoiceRequest,
  buildSearchRequest,
} from '@/src/lib/sourceDiscoveryHandlers'
import restaurantsData from '@/data/restaurants.json'

const MAX_HOMEPAGE_BYTES = 2 * 1024 * 1024

function robotsCheck(url) {
  return checkRobotsForUrl(url, { fetchImpl: fetchWebsiteSafely })
}

/**
 * One homepage, through the safe fetch and the existing robots policy. A page
 * that cannot be read is `{ ok: false }` — never fabricated text.
 */
async function readHomepage(url) {
  try {
    const gate = await robotsCheck(url)
    if (!gate || gate.shouldFetchPage !== true) return { ok: false, reason: 'robots_blocked' }
    const { response, finalUrl } = await fetchSameSiteWithRedirects(url, {
      fetchImpl: fetchWebsiteSafely,
      fetchOptions: { encoding: 'buffer', maxBytes: MAX_HOMEPAGE_BYTES },
      robotsCheck,
    })
    if (!response) return { ok: false, reason: 'unreachable' }
    if (typeof response.statusCode === 'number' && response.statusCode >= 400) return { ok: false, reason: 'http_error' }
    const html = response.bytes ? response.bytes.toString('utf8') : String(response.body || '')
    if (!html) return { ok: false, reason: 'empty' }
    return { ok: true, html, finalUrl: response.finalUrl || finalUrl || url }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

async function marketId(supabase) {
  const { data, error } = await supabase.from('markets').select('id').eq('slug', 'breda').maybeSingle()
  if (error || !data) return null
  return data.id
}

/** The only write: the existing BE-24 proposal RPC, with the provenance in its note. */
async function saveProposal({ restaurantId, proposedUrl, note, actorUserId }) {
  const supabase = getSupabaseAdmin()
  const market = await marketId(supabase)
  if (!market) return { ok: false, reason: 'market_missing' }
  const { data, error } = await supabase.rpc('create_source_triage_proposal', {
    p_proposal_id: generateUuidV7(),
    p_market_id: market,
    p_restaurant_id: restaurantId,
    p_kind: 'add_candidate',
    p_proposed_url: proposedUrl,
    p_current_url: null,
    p_unusable_reason: null,
    p_note: note,
    p_actor_user_id: actorUserId,
  })
  if (error) {
    if (error.code === 'P0030') return { ok: false, reason: 'open_exists' }
    return { ok: false, reason: 'save_failed' }
  }
  return { ok: true, id: data && data.id }
}

/**
 * "Negeren" of an OSM place that is not ours: the same BE-24 RPC, on the OSM
 * object's own key (`osm-node-…`). A triage view only knows restaurant ids from
 * data/restaurants.json, so this record never becomes work elsewhere.
 */
async function ignoreBusiness({ restaurant_id, kind, current_url, unusable_reason, note, actorUserId }) {
  const supabase = getSupabaseAdmin()
  const market = await marketId(supabase)
  if (!market) return { ok: false, reason: 'market_missing' }
  const { data, error } = await supabase.rpc('create_source_triage_proposal', {
    p_proposal_id: generateUuidV7(),
    p_market_id: market,
    p_restaurant_id: restaurant_id,
    p_kind: kind,
    p_proposed_url: null,
    p_current_url: current_url,
    p_unusable_reason: unusable_reason,
    p_note: note,
    p_actor_user_id: actorUserId,
  })
  if (error) {
    if (error.code === 'P0030') return { ok: false, reason: 'open_exists' }
    return { ok: false, reason: 'save_failed' }
  }
  return { ok: true, id: data && data.id }
}

/** The remembered ignores: BE-24 proposals on an `osm-…` key. Read only. */
async function readIgnoredIds() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('source_triage_proposals')
    .select('restaurant_id, kind')
    .like('restaurant_id', 'osm-%')
    .eq('kind', 'mark_unusable')
    .limit(1000)
  if (error) return { ok: false, code: 'read_failed' }
  return { ok: true, ids: (Array.isArray(data) ? data : []).map((row) => row.restaurant_id).filter(Boolean) }
}

export const sourceDiscoveryHandlers = createSourceDiscoveryHandlers({
  authenticate: authenticateInternalRequest,
  restaurants: restaurantsData,
  loadBusinesses: () => fetchOverpassBusinesses(),
  readHomepage,
  findMenuCandidates: findSameHostMenuCandidates,
  // Dezelfde client en hetzelfde model als "Lees met AI"; de sleutel en de
  // vlag worden pas in de call gelezen. Zonder sleutel of vlag: enabled false.
  createCall: ({ budget, purpose }) =>
    createAnthropicStructuredCall({
      env: process.env,
      budget,
      buildRequest: purpose === 'search' ? buildSearchRequest : buildChoiceRequest,
    }),
  readSpend: () => readAllAiUsageRows(getSupabaseAdmin()),
  saveProposal,
  readIgnoredIds,
  ignoreBusiness,
})
