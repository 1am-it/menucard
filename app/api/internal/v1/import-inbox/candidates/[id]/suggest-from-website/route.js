// MARKET-05A — "Suggest data from website." `internal`-only, POST only,
// triggered exclusively by an explicit reviewer button click — never
// automatically on candidate load, never scheduled. Uses only the
// candidate's own already-stored website (raw or enriched — never a
// URL supplied by the caller) as the fetch target, so this can never be
// used as an open proxy for arbitrary URLs.
//
// **Never writes to Supabase.** Every query here is a `select` — no
// mutating call of any kind exists in this file. A suggestion becomes a
// real enrichment only if a human reviewer
// separately, explicitly confirms it per field through the pre-existing
// `POST .../candidates/{id}/enrichments` route — this route has no
// awareness of that one and never calls it.
//
// **Scope: contact fields only.** Only `address`/`phone`/`website` are
// ever extracted from the fetched page (src/lib/candidateSuggestions.js)
// — never a dish list, prices, photos, marketing copy, or any other
// content.
//
// **SSRF defenses**: see src/lib/safeOutboundFetch.js's own header
// comment for the full list (protocol allowlist, guarded DNS lookup
// rejecting private/loopback/link-local addresses even after a
// redirect, bounded redirects/response size/timeout, no cookies/session
// forwarding). This route never overrides any of those defaults.
//
// **robots.txt**: honored as a product policy — if the candidate's
// website disallows this path, the page is not fetched at all. This is
// a technical gate this feature imposes on itself, never treated as a
// claim of legal permission when robots.txt happens to allow (or lack)
// a rule — see docs/api/import-inbox-api.md and
// planning/specs/tickets/market-05-normalization-deduplication.md's own
// "Website suggestions" sections for the full policy.
//
// Correction (2026-09-05): this gate now fails closed. If robots.txt
// cannot be fetched at all (network error, non-2xx status, timeout, or
// a disallowed SSRF target), the target page is never fetched — a
// failed confirmation is treated exactly like an explicit disallow, not
// like "no restriction declared." See classifyRobotsGate in
// src/lib/candidateSuggestions.js. Redirects are also disabled entirely
// for both the robots.txt fetch and the page fetch (`maxRedirects: 0`)
// so a redirect can never land on a path/host that was never checked
// against robots.txt.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly, computeEnrichedFields, buildEnrichmentSourceByCandidateId } from '@/src/lib/importInbox'
import { fetchWebsiteSafely, SafeFetchError } from '@/src/lib/safeOutboundFetch'
import {
  classifyRobotsGate,
  parseContactSuggestionsFromHtml,
  buildSuggestionResult,
} from '@/src/lib/candidateSuggestions'

const ROBOTS_MAX_BYTES = 200 * 1024
const ROBOTS_TIMEOUT_MS = 5000

export async function POST(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can request website suggestions' }, { status: 403 })
  }

  const { id } = await params

  const supabase = getSupabaseAdmin()
  const { data: candidate, error: candidateError } = await supabase
    .from('import_extraction_records')
    .select('id, extracted_fields')
    .eq('id', id)
    .maybeSingle()
  if (candidateError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  if (!candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

  const { data: enrichmentRows, error: enrichmentError } = await supabase
    .from('import_candidate_enrichments')
    .select('id, candidate_id, field_name, value, source_url, recorded_at, reviewer_id')
    .eq('candidate_id', id)
  if (enrichmentError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const enrichmentSourceByCandidateId = buildEnrichmentSourceByCandidateId(enrichmentRows)
  const enrichedFields = computeEnrichedFields(candidate.extracted_fields, enrichmentSourceByCandidateId[id] || {})

  const website = enrichedFields.website
  if (!website || typeof website !== 'string' || website.trim().length === 0) {
    return NextResponse.json({ error: 'No website on file for this candidate' }, { status: 400 })
  }

  let websiteUrl
  try {
    websiteUrl = new URL(website.trim())
  } catch {
    return NextResponse.json({ error: "The candidate's website is not a valid URL" }, { status: 400 })
  }

  // robots.txt must be positively confirmed before the target page is
  // ever fetched. Any failure to fetch it — network error, non-2xx
  // status, timeout, or a disallowed SSRF target — fails closed exactly
  // like an explicit disallow (see classifyRobotsGate). Redirects are
  // disabled entirely (`maxRedirects: 0`) so a redirect can never land
  // on a destination whose own robots.txt/path was never checked.
  let robotsFetchFailed = false
  let robotsTxtBody = ''
  try {
    const robotsResult = await fetchWebsiteSafely(`${websiteUrl.origin}/robots.txt`, {
      maxBytes: ROBOTS_MAX_BYTES,
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxRedirects: 0,
    })
    robotsTxtBody = robotsResult.body
  } catch (err) {
    robotsFetchFailed = true
  }

  const robotsGate = classifyRobotsGate({ robotsFetchFailed, robotsTxtBody, pathname: websiteUrl.pathname })

  if (!robotsGate.shouldFetchPage) {
    const warnings = robotsGate.status === 'unconfirmed'
      ? ["robots.txt could not be confirmed for this site — no suggestion was made."]
      : ["This page is disallowed by the site's robots.txt and was not fetched."]
    return NextResponse.json({
      source_url: websiteUrl.href,
      robots_txt_status: robotsGate.status,
      suggestions: null,
      warnings,
    })
  }

  let fetchResult
  try {
    fetchResult = await fetchWebsiteSafely(websiteUrl.href, { maxRedirects: 0 })
  } catch (err) {
    const reason = err instanceof SafeFetchError ? err.reason : 'fetch-failed'
    return NextResponse.json({ error: `Could not fetch the website (${reason})` }, { status: 502 })
  }

  const parsed = parseContactSuggestionsFromHtml(fetchResult.body)
  const result = buildSuggestionResult({
    parsed,
    candidateFields: enrichedFields,
    sourceUrl: fetchResult.finalUrl,
  })

  return NextResponse.json({
    source_url: result.source_url,
    fetched_at: new Date().toISOString(),
    robots_txt_status: robotsGate.status,
    parsed_from: result.parsed_from,
    suggestions: result.suggestions,
    warnings: result.warnings,
  })
}
