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
import {
  checkRobotsForUrl,
  fetchSameSiteWithRedirects,
  describeRedirects,
  describeRobotsBlock,
  RedirectPolicyError,
} from '@/src/lib/restaurantSourceFetch'
import { matchRestaurantByHostname, buildRestaurantChoiceList } from '@/src/lib/restaurantHostMatch'
import { canonicalizeSourceUrl, buildCandidateSummary, computeReceiptExpiry } from '@/src/lib/urlIntakes'
import { computeAnalysisResultHash } from '@/src/lib/urlIntakeReceiptHash'
import { runRestaurantSourceAnalysis, buildUnknownMenuContext } from '@/src/lib/restaurantSourceAnalysis'
import { PdfExtractionError } from '@/src/lib/pdfTextExtraction'
import {
  isValidJobStatus,
  isValidJobErrorReason,
  canTransitionJobStatus,
  rollUpPdfAdapterErrorReason,
} from '@/src/lib/restaurantSourceAnalysisJobs'
import { generateUuidV7 } from '@/src/lib/uuidv7'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import restaurantsData from '@/data/restaurants.json'

// robots.txt and redirects (2026-10-03): this route uses
// src/lib/restaurantSourceFetch.js — a robots.txt 404/410 counts as
// `missing` (allowed); 401/403/429, 5xx/network and anything unknown still
// block, with the real reason; at most a few same-site redirects are
// followed, each hop re-validated by safeOutboundFetch and robots.txt. This
// is a deliberate, BE-20-only refinement of the shared gate the BE-18
// read-url and MARKET-05A suggestion routes keep using unchanged — see
// that module's own header. Every fetch still goes through
// fetchWebsiteSafely, passed in explicitly as `fetchImpl`.
//
// Generous for a real menu PDF but still a real, technical bound — same
// reasoning src/lib/pdfTextExtraction.js's own DEFAULT_MAX_BYTES already
// documents; a same-host candidate PDF fetch uses this file's own default
// safeOutboundFetch.js maxBytes (2 MB) unless raised here explicitly.
const CANDIDATE_PDF_MAX_BYTES = 15 * 1024 * 1024

/** Every market-bound record in this project resolves `market_id` this
 * same way: a server-side lookup by this project's own single, stable
 * `slug` — never hardcoded, never client-supplied. Resolved once per
 * request and reused for both the job row and the eventual receipt, so
 * this route never performs the lookup twice. */
async function resolveMarketId() {
  const supabase = getSupabaseAdmin()
  const { data: marketRow, error } = await supabase.from('markets').select('id').eq('slug', 'breda').maybeSingle()
  if (error || !marketRow) return null
  return marketRow.id
}

async function insertJob({ jobId, marketId, actorUserId, canonicalSourceUrl }) {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('restaurant_source_analysis_jobs').insert({
    id: jobId,
    market_id: marketId,
    actor_user_id: actorUserId,
    canonical_source_url: canonicalSourceUrl,
    status: 'pending',
  })
  return !error
}

/**
 * The one, single place any job-status transition actually happens.
 * Validates the transition itself (never a status/error_reason string this
 * project's own contract, src/lib/restaurantSourceAnalysisJobs.js, does
 * not recognize) and writes it as a compare-and-swap: the `update` only
 * ever matches a row whose *current* status is still one of `fromStatuses`
 * (`.in('status', fromStatuses)`), and `.select('id')` proves whether a row
 * was actually changed — never assumed from the mere absence of a
 * Supabase-reported error. Returns `true` only when the transition is
 * CONFIRMED to have been durably written; `false` for every other
 * outcome (a database error, or zero rows matched because the job's real
 * current status was not what the caller expected). A caller must never
 * report a status to the reviewer that this function did not confirm.
 */
async function transitionJob(jobId, fromStatuses, toStatus, extraFields = {}) {
  if (!isValidJobStatus(toStatus)) {
    throw new Error(`Unknown target job status: ${toStatus}`)
  }
  for (const fromStatus of fromStatuses) {
    if (!isValidJobStatus(fromStatus)) {
      throw new Error(`Unknown source job status: ${fromStatus}`)
    }
    if (!canTransitionJobStatus(fromStatus, toStatus)) {
      throw new Error(`Disallowed job status transition: ${fromStatus} -> ${toStatus}`)
    }
  }
  if (typeof extraFields.error_reason === 'string' && !isValidJobErrorReason(extraFields.error_reason)) {
    throw new Error(`Unknown job error_reason: ${extraFields.error_reason}`)
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('restaurant_source_analysis_jobs')
      .update({ status: toStatus, updated_at: new Date().toISOString(), ...extraFields })
      .eq('id', jobId)
      .in('status', fromStatuses)
      .select('id')
    if (error || !data || data.length === 0) return false
    return true
  } catch {
    return false
  }
}

async function updateJobRunning(jobId) {
  return transitionJob(jobId, ['pending'], 'running')
}

/** `fromStatuses` must name every status this specific failure can
 * realistically occur from — never a blanket "any status," so an already-
 * terminal job can never be silently overwritten. */
async function updateJobFailed(jobId, fromStatuses, errorReason) {
  return transitionJob(jobId, fromStatuses, 'failed', { error_reason: errorReason })
}

async function updateJobSucceeded(jobId, fromStatuses, { receiptId, fieldEvidencePayload }) {
  return transitionJob(jobId, fromStatuses, 'succeeded', {
    result_receipt_id: receiptId,
    field_evidence: fieldEvidencePayload,
  })
}

/**
 * Builds the "failed" HTTP response — but only ever claims `job.status:
 * 'failed'` in the body once `updateJobFailed` has actually CONFIRMED that
 * write. If the durable transition itself could not be confirmed (a
 * database error, or the job was no longer in a state this failure could
 * apply to), the response is a plain, generic error with no `job` claim at
 * all — never a status the database does not actually hold. This is the
 * one, single response-building path every failure branch below uses, so
 * this guarantee cannot be accidentally skipped at a new call site.
 */
async function respondFailed(jobId, fromStatuses, errorReason, message, httpStatus) {
  const confirmed = await updateJobFailed(jobId, fromStatuses, errorReason)
  if (confirmed) {
    return NextResponse.json({ error: message, job: { id: jobId, status: 'failed', error_reason: errorReason } }, { status: httpStatus })
  }
  return NextResponse.json({ error: message }, { status: httpStatus })
}

// Mirrors app/api/internal/v1/onboarding-menu/read-url/route.js's own
// issueAnalysisReceipt closely — deliberately duplicated rather than
// shared, matching that route's own existing, un-exported, route-local
// helper pattern (it is not a lib export either). One deliberate
// difference from that route's own copy: `marketId` is passed in rather
// than looked up again here, since this route already resolved it once
// for the job row itself (see resolveMarketId above) — a small,
// intentional divergence to avoid a second, redundant lookup within the
// same request, not a change in what is looked up or how. Returns `null`
// (never throws) on any database failure, same "no internal error
// detail" fail-closed convention.
async function issueAnalysisReceipt({ marketId, actorUserId, canonicalSourceUrl, sourceHostname, restaurantMatchType, matchedRestaurantId, candidateSummary }) {
  try {
    const supabase = getSupabaseAdmin()

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
      market_id: marketId,
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

/** robots.txt check for one URL, always through fetchWebsiteSafely. */
function robotsGateFor(url) {
  return checkRobotsForUrl(url, { fetchImpl: fetchWebsiteSafely })
}

/** Builds the real `fetchCandidate` implementation passed into
 * runRestaurantSourceAnalysis: a robots.txt check, then a
 * `encoding: 'buffer'` fetch (a same-host candidate may be HTML or a
 * PDF) that follows at most a few same-site redirects, each hop
 * re-checked (see src/lib/restaurantSourceFetch.js), dispatched by
 * content type. Every fetch still goes exclusively through
 * safeOutboundFetch.js — no second egress path. Each followed redirect is
 * appended to `redirectNotes` as reviewable, plain-language metadata. */
function createCandidateFetcher(redirectNotes) {
  return async function fetchCandidateSafely(url) {
    let target
    try {
      target = new URL(url)
    } catch {
      return { status: 'blocked' }
    }

    const robotsGate = await robotsGateFor(target.href)
    if (!robotsGate.shouldFetchPage) {
      return { status: 'blocked' }
    }

    let fetchResult
    try {
      const fetched = await fetchSameSiteWithRedirects(target.href, {
        fetchImpl: fetchWebsiteSafely,
        fetchOptions: { encoding: 'buffer', maxBytes: CANDIDATE_PDF_MAX_BYTES },
        robotsCheck: robotsGateFor,
      })
      fetchResult = fetched.response
      redirectNotes.push(...describeRedirects(fetched.redirects))
    } catch (err) {
      return err instanceof RedirectPolicyError && err.reason === 'redirect-robots-blocked' ? { status: 'blocked' } : { status: 'error' }
    }

    return dispatchCandidateResponse(fetchResult)
  }
}

function dispatchCandidateResponse(fetchResult) {
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

  const marketId = await resolveMarketId()
  if (!marketId) {
    return NextResponse.json({ error: 'Het starten van de analyse is mislukt.' }, { status: 500 })
  }

  const jobId = generateUuidV7()
  const jobInserted = await insertJob({ jobId, marketId, actorUserId: auth.userId, canonicalSourceUrl: initialCanonical.canonicalUrl })
  if (!jobInserted) {
    // No row exists at all — there is nothing to transition or report a
    // status for.
    return NextResponse.json({ error: 'Het starten van de analyse is mislukt.' }, { status: 500 })
  }

  const runningConfirmed = await updateJobRunning(jobId)
  if (!runningConfirmed) {
    // The job row exists (insert above succeeded) but the pending->running
    // transition could not be confirmed — the row can only still be
    // 'pending' at this point, so that is the only state this failure
    // transition is attempted from.
    return respondFailed(jobId, ['pending'], 'internal_error', 'Het starten van de analyse is mislukt.', 500)
  }

  // From this point on, the job's own durable status is confirmed
  // 'running'. Every failure below transitions it from exactly that state,
  // and this whole block is wrapped in one last-resort catch: any
  // unexpected exception anywhere in this analysis (a future regression,
  // an edge case no explicit branch below anticipated) is still mapped to
  // a closed, generic failure — the job always reaches a durable terminal
  // status and the client never sees a raw internal error.
  try {
    // ── robots.txt gate for the entry URL itself ────────────────────────
    // The job's closed error vocabulary keeps `robots_disallowed` for every
    // robots block (no migration); the message names the real reason
    // (disallow, access denied, unreachable, or unreadable).
    const robotsGate = await robotsGateFor(sourceUrl.href)
    if (!robotsGate.shouldFetchPage) {
      return respondFailed(jobId, ['running'], 'robots_disallowed', describeRobotsBlock(robotsGate), 400)
    }

    // ── the entry fetch itself — always as raw bytes, since the entry URL
    // may turn out to be either an HTML page or a digital PDF menu. At most
    // a few same-site redirects are followed, each hop re-validated by
    // safeOutboundFetch and robots.txt; anything else fails closed. ──────
    let fetchResult
    const redirectNotes = []
    try {
      const fetched = await fetchSameSiteWithRedirects(sourceUrl.href, {
        fetchImpl: fetchWebsiteSafely,
        fetchOptions: { encoding: 'buffer', maxBytes: CANDIDATE_PDF_MAX_BYTES },
        robotsCheck: robotsGateFor,
      })
      fetchResult = fetched.response
      redirectNotes.push(...describeRedirects(fetched.redirects))
    } catch (err) {
      if (err instanceof RedirectPolicyError && err.reason === 'redirect-robots-blocked') {
        return respondFailed(jobId, ['running'], 'robots_disallowed', describeRobotsBlock(err.robotsGate), 400)
      }
      const message =
        err instanceof RedirectPolicyError
          ? 'Deze pagina stuurt door naar een adres dat niet veilig automatisch kan worden gevolgd.'
          : 'Het ophalen van deze pagina is mislukt.'
      return respondFailed(jobId, ['running'], 'fetch_failed', message, 502)
    }

    let analysis
    if (fetchResult.contentType === 'text/html' || fetchResult.contentType === 'application/xhtml+xml') {
      analysis = await runRestaurantSourceAnalysis({
        homepageHtml: fetchResult.bytes.toString('utf8'),
        homepageUrl: fetchResult.finalUrl,
        fetchCandidate: createCandidateFetcher(redirectNotes),
      })
    } else if (fetchResult.contentType === 'application/pdf') {
      // The entry URL itself is a digital PDF menu — BE-20's own general
      // extension of BE-18's HTML-only entry point. No same-host discovery
      // is possible here (there is no HTML to discover links from), so
      // this produces exactly one unknown menu context and no restaurant
      // fields.
      try {
        analysis = {
          restaurantCandidateFields: {},
          fieldEvidence: {},
          menuContexts: [],
          unknownMenuContexts: [await buildUnknownMenuContext(fetchResult.bytes, fetchResult.finalUrl)],
          description: '',
          notes: ['Deze bron is een PDF zonder bijbehorende HTML-pagina — restaurantgegevens konden hier niet uit worden afgeleid.'],
        }
      } catch (err) {
        // Any failure here — a properly-typed PdfExtractionError, or, as
        // defense in depth, any other unexpected error — rolls up to the
        // job's own closed pdf_extraction_failed reason. Never re-thrown:
        // one bad PDF must never crash this whole request after the job is
        // already durably 'running'.
        const errorReason = err instanceof PdfExtractionError ? rollUpPdfAdapterErrorReason(err.reason) : 'pdf_extraction_failed'
        return respondFailed(jobId, ['running'], errorReason, 'Deze PDF kon niet worden gelezen.', 400)
      }
    } else {
      return respondFailed(jobId, ['running'], 'unsupported_content_type', 'Dit type bron wordt niet ondersteund.', 400)
    }

    // Followed redirects are reviewable metadata, shown with the other notes.
    analysis.notes = [...redirectNotes, ...analysis.notes]

    const match = matchRestaurantByHostname(restaurantsData, fetchResult.finalUrl)
    const needsExplicitChoice = match.matchType !== 'exact'
    // The receipt stays bound to the URL the reviewer entered — identical
    // to the final URL whenever no redirect was followed, and the URL
    // BE-19's url-intake step compares against. A same-site redirect's
    // final URL is recorded in the notes above instead.
    const canonical = canonicalizeSourceUrl(sourceUrl.href)
    const candidateSummary = buildCandidateSummary({ restaurantCandidateFields: analysis.restaurantCandidateFields, menus: analysis.menuContexts })

    const receipt = canonical
      ? await issueAnalysisReceipt({
          marketId,
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
      // check constraint requires 'succeeded' to always carry a receipt,
      // so a receipt that could not be issued always means this job
      // failed, even though the analysis itself may have found real
      // content.
      return respondFailed(jobId, ['running'], 'internal_error', 'De analyse kon niet worden vastgelegd.', 500)
    }

    const fieldEvidencePayload = {
      fields: analysis.fieldEvidence,
      unknown_menu_contexts: analysis.unknownMenuContexts,
      description: analysis.description,
      notes: analysis.notes,
    }
    const succeededConfirmed = await updateJobSucceeded(jobId, ['running'], { receiptId: receipt.id, fieldEvidencePayload })
    if (!succeededConfirmed) {
      // The receipt already exists (durable and reusable on its own), but
      // this job's own row could not be confirmed to reach 'succeeded' —
      // never claim it did. Mirrors respondFailed's own "never report a
      // status that was not actually confirmed" rule, just for the
      // opposite (succeeded) transition.
      return respondFailed(jobId, ['running'], 'internal_error', 'De analyse kon niet worden vastgelegd.', 500)
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
  } catch {
    // Last-resort safety net — never let a raw exception (message or
    // stack) reach the client, and never leave the job stuck at 'running'
    // forever.
    return respondFailed(jobId, ['running'], 'internal_error', 'De analyse is onverwacht mislukt.', 500)
  }
}
