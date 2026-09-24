// BE-20 (fase 1) — "Onboarding Restaurant": creates and, for fase 1,
// synchronously processes one general restaurant source analysis job —
// the general-purpose extension of BE-18/19's own HTML-JSON-LD-only
// "Onboarding Menu via URL" flow (app/api/internal/v1/onboarding-menu/read-url/route.js),
// which this route never modifies. `internal`-only, POST-only, triggered
// exclusively by an explicit reviewer action — same authentication/role
// pattern as every other route in this project.
//
// Implements planning/specs/tickets/be-20-general-restaurant-source-extraction.md's
// own "Minimal durable analysis-job contract": a
// restaurant_source_analysis_jobs row (supabase/migrations/0014_be20_restaurant_source_analysis_jobs.sql,
// NOT YET APPLIED anywhere) is created first, moved to 'running', and
// then to a terminal 'succeeded'/'failed' — all within this one request,
// per that section's own explicit allowance ("a job can be processed
// inline, within the same request that creates it, for fase 1's own UI").
// No worker or queue is introduced here.
//
// **Idempotency is explicitly NOT implemented here** — the ticket's own
// "Idempotency" bullet leaves the exact mechanism (client token vs. a
// natural-key window) "an implementation decision for the next
// documentation round, not fixed here." Every POST creates a genuinely
// new job row; a reviewer retrying a failed analysis gets a new job, not
// a resumed one. This is a deliberate, documented fase-1 gap, not an
// oversight.
//
// **Reuses BE-19's own, unchanged receipt/url_intakes bridge.** On
// success, this route issues a normal url_intake_analysis_receipts row —
// the exact same table and shape app/api/internal/v1/onboarding-menu/read-url/route.js
// already issues from — so the existing, unchanged
// POST /api/internal/v1/url-intakes and POST /api/internal/v1/profile-drafts
// routes keep working completely unmodified against a receipt from
// either source. This route's own richer per-field confidence/evidence
// data is stored ONLY in this job's own additive `field_evidence` column
// (see the migration's own comment on that column) — never smuggled into
// `candidate_summary`, whose shape src/lib/urlIntakes.js's own
// buildCandidateSummary() documents as fixed and read verbatim by both
// existing RPCs.

import { NextResponse } from 'next/server'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { fetchWebsiteSafely } from '@/src/lib/safeOutboundFetch'
import { classifyRobotsGate } from '@/src/lib/candidateSuggestions'
import { matchRestaurantByHostname, buildRestaurantChoiceList } from '@/src/lib/restaurantHostMatch'
import { canonicalizeSourceUrl, buildCandidateSummary, computeReceiptExpiry } from '@/src/lib/urlIntakes'
import { computeAnalysisResultHash } from '@/src/lib/urlIntakeReceiptHash'
import { runRestaurantSourceAnalysis } from '@/src/lib/restaurantSourceAnalysis'
import { extractDigitalPdfText, PdfExtractionError } from '@/src/lib/pdfTextExtraction'
import { computeFieldEvidenceHash } from '@/src/lib/fieldEvidenceHash'
import { rollUpPdfAdapterErrorReason } from '@/src/lib/restaurantSourceAnalysisJobs'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import restaurantsData from '@/data/restaurants.json'

const ROBOTS_MAX_BYTES = 200 * 1024
const ROBOTS_TIMEOUT_MS = 5000
// Generous for a real menu PDF but still a real, technical bound — same
// reasoning src/lib/pdfTextExtraction.js's own DEFAULT_MAX_BYTES already
// documents; a same-host candidate PDF fetch uses this file's own default
// safeOutboundFetch.js maxBytes (2 MB) unless raised here explicitly.
const CANDIDATE_PDF_MAX_BYTES = 15 * 1024 * 1024

async function insertJob({ jobId, actorUserId, canonicalSourceUrl }) {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('restaurant_source_analysis_jobs').insert({
    id: jobId,
    actor_user_id: actorUserId,
    canonical_source_url: canonicalSourceUrl,
    status: 'pending',
  })
  return !error
}

async function updateJobRunning(jobId) {
  const supabase = getSupabaseAdmin()
  await supabase.from('restaurant_source_analysis_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', jobId)
}

async function updateJobFailed(jobId, errorReason) {
  try {
    const supabase = getSupabaseAdmin()
    await supabase
      .from('restaurant_source_analysis_jobs')
      .update({ status: 'failed', error_reason: errorReason, updated_at: new Date().toISOString() })
      .eq('id', jobId)
  } catch {
    // Best-effort — the caller's own response to the reviewer is never
    // blocked on this bookkeeping update succeeding.
  }
}

async function updateJobSucceeded(jobId, { receiptId, fieldEvidencePayload }) {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('restaurant_source_analysis_jobs')
    .update({
      status: 'succeeded',
      result_receipt_id: receiptId,
      field_evidence: fieldEvidencePayload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
  return !error
}

// Mirrors app/api/internal/v1/onboarding-menu/read-url/route.js's own
// issueAnalysisReceipt exactly — deliberately duplicated rather than
// shared, matching that route's own existing, un-exported, route-local
// helper pattern (it is not a lib export either). Returns `null` (never
// throws) on any database failure, same "no internal error detail" fail-
// closed convention.
async function issueAnalysisReceipt({ actorUserId, canonicalSourceUrl, sourceHostname, restaurantMatchType, matchedRestaurantId, candidateSummary }) {
  try {
    const supabase = getSupabaseAdmin()
    const { data: marketRow, error: marketError } = await supabase.from('markets').select('id').eq('slug', 'breda').maybeSingle()
    if (marketError || !marketRow) return null

    const analysisResultHash = computeAnalysisResultHash({
      actorUserId,
      canonicalSourceUrl,
      restaurantMatchType,
      matchedRestaurantId,
      candidateSummary,
    })
    const receiptId = generateUuidV7()
    const expiresAt = computeReceiptExpiry()

    const { error: insertError } = await supabase.from('url_intake_analysis_receipts').insert({
      id: receiptId,
      market_id: marketRow.id,
      actor_user_id: actorUserId,
      canonical_source_url: canonicalSourceUrl,
      source_hostname: sourceHostname,
      fetched_at: new Date().toISOString(),
      restaurant_match_type: restaurantMatchType,
      matched_restaurant_id: matchedRestaurantId,
      candidate_summary: candidateSummary,
      analysis_result_hash: analysisResultHash,
      expires_at: expiresAt,
    })
    if (insertError) return null

    return { id: receiptId, expires_at: expiresAt }
  } catch {
    return null
  }
}

/** The real `fetchCandidate` implementation passed into
 * runRestaurantSourceAnalysis: a robots.txt check, then a
 * `encoding: 'buffer'` fetch (a same-host candidate may be HTML or a
 * PDF), dispatched by content type. Every fetch still goes exclusively
 * through safeOutboundFetch.js — this function adds no second egress
 * path, only the robots-gate/content-type branching this ticket's own
 * "Vaststaande productkeuzes" §6 requires per candidate. */
async function fetchCandidateSafely(url) {
  let target
  try {
    target = new URL(url)
  } catch {
    return { status: 'blocked' }
  }

  let robotsFetchFailed = false
  let robotsTxtBody = ''
  try {
    const robotsResult = await fetchWebsiteSafely(`${target.origin}/robots.txt`, {
      maxBytes: ROBOTS_MAX_BYTES,
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxRedirects: 0,
    })
    robotsTxtBody = robotsResult.body
  } catch {
    robotsFetchFailed = true
  }
  const robotsGate = classifyRobotsGate({ robotsFetchFailed, robotsTxtBody, pathname: target.pathname })
  if (!robotsGate.shouldFetchPage) {
    return { status: 'blocked' }
  }

  let fetchResult
  try {
    fetchResult = await fetchWebsiteSafely(target.href, { maxRedirects: 0, encoding: 'buffer', maxBytes: CANDIDATE_PDF_MAX_BYTES })
  } catch {
    return { status: 'error' }
  }

  if (fetchResult.contentType === 'application/pdf') {
    return { status: 'pdf', bytes: fetchResult.bytes, finalUrl: fetchResult.finalUrl }
  }
  if (fetchResult.contentType === 'text/html' || fetchResult.contentType === 'application/xhtml+xml') {
    return { status: 'html', body: fetchResult.bytes.toString('utf8'), finalUrl: fetchResult.finalUrl }
  }
  return { status: 'error' }
}

export async function POST(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can start a restaurant source analysis' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawUrl = body && typeof body.url === 'string' ? body.url.trim() : ''
  if (!rawUrl) {
    return NextResponse.json({ error: 'Voer een URL in.' }, { status: 400 })
  }

  let sourceUrl
  try {
    sourceUrl = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'Dit is geen geldige URL.' }, { status: 400 })
  }
  if (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'Dit is geen geldige URL.' }, { status: 400 })
  }

  const initialCanonical = canonicalizeSourceUrl(sourceUrl.href)
  if (!initialCanonical) {
    return NextResponse.json({ error: 'Dit is geen geldige URL.' }, { status: 400 })
  }

  const jobId = generateUuidV7()
  const jobInserted = await insertJob({ jobId, actorUserId: auth.userId, canonicalSourceUrl: initialCanonical.canonicalUrl })
  if (!jobInserted) {
    return NextResponse.json({ error: 'Het starten van de analyse is mislukt.' }, { status: 500 })
  }
  await updateJobRunning(jobId)

  // ── robots.txt gate for the entry URL itself ──────────────────────────
  let robotsFetchFailed = false
  let robotsTxtBody = ''
  try {
    const robotsResult = await fetchWebsiteSafely(`${sourceUrl.origin}/robots.txt`, {
      maxBytes: ROBOTS_MAX_BYTES,
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxRedirects: 0,
    })
    robotsTxtBody = robotsResult.body
  } catch {
    robotsFetchFailed = true
  }
  const robotsGate = classifyRobotsGate({ robotsFetchFailed, robotsTxtBody, pathname: sourceUrl.pathname })
  if (!robotsGate.shouldFetchPage) {
    await updateJobFailed(jobId, 'robots_disallowed')
    return NextResponse.json(
      { error: 'Deze pagina kan niet automatisch worden opgehaald.', job: { id: jobId, status: 'failed', error_reason: 'robots_disallowed' } },
      { status: 400 }
    )
  }

  // ── the entry fetch itself — always as raw bytes, since the entry URL
  // may turn out to be either an HTML page or a digital PDF menu ────────
  let fetchResult
  try {
    fetchResult = await fetchWebsiteSafely(sourceUrl.href, { maxRedirects: 0, encoding: 'buffer', maxBytes: CANDIDATE_PDF_MAX_BYTES })
  } catch {
    await updateJobFailed(jobId, 'fetch_failed')
    return NextResponse.json(
      { error: 'Het ophalen van deze pagina is mislukt.', job: { id: jobId, status: 'failed', error_reason: 'fetch_failed' } },
      { status: 502 }
    )
  }

  let analysis
  if (fetchResult.contentType === 'text/html' || fetchResult.contentType === 'application/xhtml+xml') {
    analysis = await runRestaurantSourceAnalysis({
      homepageHtml: fetchResult.bytes.toString('utf8'),
      homepageUrl: fetchResult.finalUrl,
      fetchCandidate: fetchCandidateSafely,
    })
  } else if (fetchResult.contentType === 'application/pdf') {
    // The entry URL itself is a digital PDF menu — BE-20's own general
    // extension of BE-18's HTML-only entry point. No same-host discovery
    // is possible here (there is no HTML to discover links from), so this
    // produces exactly one unknown menu context and no restaurant fields.
    try {
      const pdfResult = await extractDigitalPdfText(fetchResult.bytes)
      analysis = {
        restaurantCandidateFields: {},
        fieldEvidence: {},
        menuContexts: [],
        unknownMenuContexts: [
          {
            sourceUrl: fetchResult.finalUrl,
            extractionMethod: 'pdf_text',
            pageCount: pdfResult.pageCount,
            contentHash: computeFieldEvidenceHash(pdfResult.text),
            textPreview: pdfResult.text.slice(0, 280),
          },
        ],
        description: '',
        notes: ['Deze bron is een PDF zonder bijbehorende HTML-pagina — restaurantgegevens konden hier niet uit worden afgeleid.'],
      }
    } catch (err) {
      if (!(err instanceof PdfExtractionError)) throw err
      const errorReason = rollUpPdfAdapterErrorReason(err.reason)
      await updateJobFailed(jobId, errorReason)
      return NextResponse.json(
        { error: 'Deze PDF kon niet worden gelezen.', job: { id: jobId, status: 'failed', error_reason: errorReason } },
        { status: 400 }
      )
    }
  } else {
    await updateJobFailed(jobId, 'unsupported_content_type')
    return NextResponse.json(
      { error: 'Dit type bron wordt niet ondersteund.', job: { id: jobId, status: 'failed', error_reason: 'unsupported_content_type' } },
      { status: 400 }
    )
  }

  const match = matchRestaurantByHostname(restaurantsData, fetchResult.finalUrl)
  const needsExplicitChoice = match.matchType !== 'exact'
  const canonical = canonicalizeSourceUrl(fetchResult.finalUrl)
  const candidateSummary = buildCandidateSummary({ restaurantCandidateFields: analysis.restaurantCandidateFields, menus: analysis.menuContexts })

  const receipt = canonical
    ? await issueAnalysisReceipt({
        actorUserId: auth.userId,
        canonicalSourceUrl: canonical.canonicalUrl,
        sourceHostname: canonical.hostname,
        restaurantMatchType: match.matchType,
        matchedRestaurantId: match.matchType === 'exact' ? match.restaurantId : null,
        candidateSummary,
      })
    : null

  if (!receipt) {
    // Never a partial success — restaurant_source_analysis_jobs' own
    // check constraint requires 'succeeded' to always carry a receipt, so
    // a receipt that could not be issued always means this job failed,
    // even though the analysis itself may have found real content.
    await updateJobFailed(jobId, 'internal_error')
    return NextResponse.json(
      { error: 'De analyse kon niet worden vastgelegd.', job: { id: jobId, status: 'failed', error_reason: 'internal_error' } },
      { status: 500 }
    )
  }

  const fieldEvidencePayload = {
    fields: analysis.fieldEvidence,
    unknown_menu_contexts: analysis.unknownMenuContexts,
    description: analysis.description,
    notes: analysis.notes,
  }
  const jobSucceeded = await updateJobSucceeded(jobId, { receiptId: receipt.id, fieldEvidencePayload })
  if (!jobSucceeded) {
    return NextResponse.json(
      { error: 'De analyse kon niet worden vastgelegd.', job: { id: jobId, status: 'failed', error_reason: 'internal_error' } },
      { status: 500 }
    )
  }

  return NextResponse.json({
    job: { id: jobId, status: 'succeeded' },
    source_url: fetchResult.finalUrl,
    restaurant_match: {
      type: match.matchType,
      restaurant_id: match.matchType === 'exact' ? match.restaurantId : null,
      restaurant_name: match.matchType === 'exact' ? match.candidates[0].name : null,
      candidates: needsExplicitChoice ? buildRestaurantChoiceList(restaurantsData) : [],
    },
    receipt,
    menus: analysis.menuContexts,
    field_evidence: analysis.fieldEvidence,
    unknown_menu_contexts: analysis.unknownMenuContexts,
    description: analysis.description,
    notes: analysis.notes,
    warning: needsExplicitChoice
      ? 'De bron van deze pagina komt niet automatisch overeen met één bekend restaurant — kies handmatig het juiste restaurant.'
      : null,
  })
}
