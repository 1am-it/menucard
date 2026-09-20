// BE-18 (fase 1) — "Onboarding Menu via URL": reads one internal-
// reviewer-supplied URL and returns the menu structure found on it,
// without ever creating a new proposal record. `internal`-only,
// POST-only, triggered exclusively by an explicit reviewer action —
// never automatic, never scheduled.
//
// **This is the first route in this project where the fetch target is
// a URL the caller freely supplies**, rather than one already stored on
// an existing record (contrast with
// app/api/internal/v1/import-inbox/candidates/[id]/suggest-from-website/route.js,
// which only ever fetches a candidate's own already-stored website).
// The underlying SSRF defenses (src/lib/safeOutboundFetch.js) are
// unchanged and unconditionally sufficient regardless of who chose the
// URL, but this route additionally logs every fetch attempt (see
// `logUrlFetchAttempt` below) precisely because an `internal` account
// can now make the server fetch any URL, not just a pre-vetted one.
//
// Mirrors the existing suggest-from-website route's shape exactly:
// authenticateInternalRequest, a role check, a robots.txt fetch that
// fails closed on any problem (network error, non-2xx, timeout, or a
// disallowed SSRF target — see classifyRobotsGate), then the page fetch
// itself, both with `maxRedirects: 0` so a redirect can never land on a
// path whose own robots.txt was never checked.
//
// **Never writes to Supabase.** This route performs no database call of
// any kind — it only reads the fetched page and the static
// `data/restaurants.json` file. A new proposal row is only ever created
// by a separate, explicit call to the existing, unchanged snapshot
// creation route — this route has no awareness of that one and never
// calls it.
//
// **Content-type gate**: only `text/html`/`application/xhtml+xml` is
// parsed. `application/pdf` gets its own clear, Dutch "not yet
// supported" message (fase 1 non-goal — see
// planning/specs/tickets/be-18-onboarding-menu-via-url.md's own
// "Non-goals / later work"). Anything else is rejected the same way,
// generically. `safeOutboundFetch.js` itself returns `contentType` but
// never validates it — that responsibility belongs here, the caller.
//
// **No internal error detail is ever returned** — every failure path
// (unsafe URL, robots-disallowed, fetch error, unsupported content
// type, no reliable structure) returns one honest, generic, Dutch
// message. Nothing here attempts a fallback scrape of free page text.

import { NextResponse } from 'next/server'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { fetchWebsiteSafely } from '@/src/lib/safeOutboundFetch'
import { classifyRobotsGate } from '@/src/lib/candidateSuggestions'
import { extractMenusFromHtml } from '@/src/lib/menuJsonLdExtraction'
import { matchRestaurantByHostname, buildRestaurantChoiceList } from '@/src/lib/restaurantHostMatch'
import restaurantsData from '@/data/restaurants.json'

const ROBOTS_MAX_BYTES = 200 * 1024
const ROBOTS_TIMEOUT_MS = 5000

// Minimal, privacy-safe structured server log — actor, timestamp,
// hostname, an outcome category, and (when known) how many menus were
// found. Deliberately never the full URL (query parameters may carry
// identifying tokens), never any fetched page content, never a token or
// cookie. This is a plain server/application log line — ephemeral,
// rotated by the hosting platform, not a durable or independently
// queryable record — so it is never described as a formal, long-lived
// tracking mechanism. No new table, no new migration, per BE-18's own
// decision on this point.
function logUrlFetchAttempt({ actor, hostname, outcome, menuCount }) {
  console.log(
    JSON.stringify({
      event: 'onboarding_menu_url_fetch',
      actor,
      at: new Date().toISOString(),
      hostname,
      outcome,
      menus_found: typeof menuCount === 'number' ? menuCount : undefined,
    })
  )
}

export async function POST(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can read a menu source URL' }, { status: 403 })
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

  // robots.txt must be positively confirmed before the target page is
  // ever fetched — fails closed on any problem, including an unsafe
  // URL shape (safeOutboundFetch.js rejects that itself). Redirects are
  // disabled entirely for both fetches, exactly like suggest-from-website.
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
    logUrlFetchAttempt({ actor: auth.userId, hostname: sourceUrl.hostname, outcome: 'robots_or_unsafe_blocked' })
    return NextResponse.json({ error: 'Deze pagina kan niet automatisch worden opgehaald.' }, { status: 400 })
  }

  let fetchResult
  try {
    fetchResult = await fetchWebsiteSafely(sourceUrl.href, { maxRedirects: 0 })
  } catch {
    logUrlFetchAttempt({ actor: auth.userId, hostname: sourceUrl.hostname, outcome: 'fetch_error' })
    return NextResponse.json({ error: 'Het ophalen van deze pagina is mislukt.' }, { status: 502 })
  }

  if (fetchResult.contentType === 'application/pdf') {
    logUrlFetchAttempt({ actor: auth.userId, hostname: sourceUrl.hostname, outcome: 'pdf_not_supported' })
    return NextResponse.json(
      { error: 'PDF-bronnen worden nog niet ondersteund — dat komt later.', reason: 'pdf_not_supported' },
      { status: 400 }
    )
  }
  if (fetchResult.contentType !== 'text/html' && fetchResult.contentType !== 'application/xhtml+xml') {
    logUrlFetchAttempt({ actor: auth.userId, hostname: sourceUrl.hostname, outcome: 'unsupported_content_type' })
    return NextResponse.json({ error: 'Dit type bron wordt niet ondersteund.' }, { status: 400 })
  }

  const menus = extractMenusFromHtml(fetchResult.body)

  if (menus.length === 0) {
    logUrlFetchAttempt({ actor: auth.userId, hostname: sourceUrl.hostname, outcome: 'no_reliable_structure', menuCount: 0 })
    return NextResponse.json({
      source_url: fetchResult.finalUrl,
      menus: [],
      restaurant_match: { type: 'none', restaurant_id: null, candidates: [] },
      warning: 'Deze pagina kon niet automatisch worden uitgelezen. Probeer een andere bron, of wacht op ondersteuning voor deze paginavorm.',
    })
  }

  const match = matchRestaurantByHostname(restaurantsData, fetchResult.finalUrl)
  const needsExplicitChoice = match.matchType !== 'exact'

  logUrlFetchAttempt({ actor: auth.userId, hostname: sourceUrl.hostname, outcome: 'ok', menuCount: menus.length })

  return NextResponse.json({
    source_url: fetchResult.finalUrl,
    menus,
    restaurant_match: {
      type: match.matchType,
      restaurant_id: match.restaurantId,
      restaurant_name: match.matchType === 'exact' ? match.candidates[0].name : null,
      candidates: needsExplicitChoice ? buildRestaurantChoiceList(restaurantsData) : [],
    },
    warning: needsExplicitChoice
      ? 'De bron van deze pagina komt niet automatisch overeen met één bekend restaurant — kies handmatig het juiste restaurant.'
      : null,
  })
}
