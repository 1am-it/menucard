// BE-30 (#72) — de echte afhankelijkheden van het AI-advies bij een onzekere
// rubriekindeling. Alleen bestaande onderdelen: de interne aanmelding, de
// bestaande job- en receiptuitlezing, dezelfde provider-call als "Lees met AI"
// (zelfde model, zelfde sleutel, zelfde enable-vlag, zelfde kostentelling) en de
// bestaande maandteller. Geen nieuwe tabel, geen migratie, geen tweede client.
//
// Het advies wordt vastgelegd in de bestaande, additieve kolom
// `restaurant_source_analysis_jobs.field_evidence` onder `structureAdvice`
// (kind `ai_suggested`). Die kolom is al schrijfbaar voor service_role (0014) en
// heeft een CHECK die alleen eist dat hij bij een geslaagde job gevuld is; de
// analyse zelf wordt niet gewijzigd en de receipt heeft zijn eigen hash.

import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import {
  ANTHROPIC_MODEL,
  THINKING_CONFIG,
  createAnthropicStructuredCall,
} from '@/src/lib/menuExtractionAnthropicCall'
import { buildAdviceRequest } from '@/src/lib/menuStructureAdvice'
import { createMenuStructureAdviceHandlers } from '@/src/lib/menuStructureAdviceHandlers'
import { readAllAiUsageRows } from '@/src/lib/manualMenuImportUsageSource'

const JOB_COLUMNS = 'id, status, actor_user_id, batch_id, result_receipt_id, structure_advice:field_evidence->structureAdvice'
const RECEIPT_COLUMNS = 'id, analysis_result_hash, menus:candidate_summary->menus'

/** Alleen de eigen, geslaagde job van deze medewerker, met zijn eigen receipt. */
async function readSource({ jobId, actorUserId }) {
  const supabase = getSupabaseAdmin()
  const { data: job, error } = await supabase
    .from('restaurant_source_analysis_jobs')
    .select(JOB_COLUMNS)
    .eq('id', jobId)
    .maybeSingle()
  if (error || !job || job.status !== 'succeeded' || job.actor_user_id !== actorUserId || !job.result_receipt_id) {
    return { ok: false }
  }
  const { data: receipt, error: receiptError } = await supabase
    .from('url_intake_analysis_receipts')
    .select(RECEIPT_COLUMNS)
    .eq('id', job.result_receipt_id)
    .maybeSingle()
  if (receiptError || !receipt) return { ok: false }
  return {
    ok: true,
    receiptId: receipt.id,
    receiptHash: typeof receipt.analysis_result_hash === 'string' ? receipt.analysis_result_hash : null,
    menus: Array.isArray(receipt.menus) ? receipt.menus : [],
    storedAdvice: job.structure_advice || null,
  }
}

/** Additief bijwerken: het bestaande bewijs blijft staan, alleen `structureAdvice` komt erbij. */
async function saveAdvice({ jobId, actorUserId, record }) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('restaurant_source_analysis_jobs')
    .select('id, status, actor_user_id, field_evidence')
    .eq('id', jobId)
    .maybeSingle()
  if (error || !data || data.status !== 'succeeded' || data.actor_user_id !== actorUserId) {
    return { ok: false, reason: 'advice_not_stored' }
  }
  const evidence = data.field_evidence && typeof data.field_evidence === 'object' && !Array.isArray(data.field_evidence) ? data.field_evidence : {}
  const { error: updateError } = await supabase
    .from('restaurant_source_analysis_jobs')
    .update({ field_evidence: { ...evidence, structureAdvice: record } })
    .eq('id', jobId)
    .eq('actor_user_id', actorUserId)
    .eq('status', 'succeeded')
  if (updateError) return { ok: false, reason: 'advice_not_stored' }
  return { ok: true }
}

export const menuStructureAdviceHandlers = createMenuStructureAdviceHandlers({
  authenticate: authenticateInternalRequest,
  env: () => process.env,
  readSource,
  readUsageRows: () => readAllAiUsageRows(getSupabaseAdmin()),
  // Dezelfde provider-call als "Lees met AI"; alleen de vraag (buildRequest) is
  // eigen aan dit advies. Zonder sleutel geeft die call 'provider_not_configured'.
  createCall: ({ budget }) =>
    createAnthropicStructuredCall({
      env: process.env,
      budget,
      buildRequest: (input) => buildAdviceRequest({ ...input, model: ANTHROPIC_MODEL, thinking: THINKING_CONFIG }),
    }),
  saveAdvice,
  generateId: generateUuidV7,
})
