// BE-19 — a safe wrapper around BE-17's existing, unchanged
// menu_snapshot_proposals write path (0011_be17_menu_snapshot_foundation.sql,
// app/api/internal/v1/menu-snapshots/route.js's own insert logic), never
// a modification of that route. `internal`-only.
//
// **Hard boundary, enforced here structurally**: a menu snapshot proposal
// may only ever be created when this url_intakes row already carries a
// confirmed, existing `data/restaurants.json` key
// (`matched_restaurant_id`) — never for a `restaurant_match_type` of
// `'none'`/`'multiple'`, and never against a restaurant concept's own
// id (see docs/api/url-intake-schema.md's own "Hard boundary"
// section). `restaurant_id` and `captured_content` are read exclusively
// from this url_intakes row's own, already-server-stored
// `menu_candidate_summary` — never from anything the client submits in
// this request body. The client may only choose WHICH already-found menu
// context(s) to turn into a proposal, by slug — never supply new content.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { computeCanonicalContentHash } from '@/src/lib/menuSnapshotHash'
import { validateSnapshotProposalInput, snapshotProposalValidationMessage } from '@/src/lib/menuSnapshotProposals'

export async function POST(request, { params }) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can create a menu snapshot proposal' }, { status: 403 })
  }

  const { id: urlIntakeId } = await params

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const requestedSlugs = Array.isArray(body && body.menu_context_slugs)
    ? body.menu_context_slugs.filter((s) => typeof s === 'string' && s.trim().length > 0)
    : []
  if (requestedSlugs.length === 0) {
    return NextResponse.json({ error: 'menu_context_slugs is required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { data: intake, error: intakeError } = await supabase
    .from('url_intakes')
    .select('matched_restaurant_id, menu_candidate_summary, canonical_source_url')
    .eq('id', urlIntakeId)
    .maybeSingle()
  if (intakeError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  if (!intake) return NextResponse.json({ error: 'URL intake not found' }, { status: 404 })

  // The one, structural enforcement point of the hard boundary: no
  // confirmed restaurant identity, no menu proposal — ever, regardless
  // of what the request body asks for.
  if (!intake.matched_restaurant_id) {
    return NextResponse.json(
      { error: 'Dit restaurant is nog niet bevestigd — er kan pas een menuvoorstel worden gemaakt zodra dit een bestaand restaurant is.' },
      { status: 409 }
    )
  }

  const summary = Array.isArray(intake.menu_candidate_summary) ? intake.menu_candidate_summary : []
  const results = []

  for (const slug of requestedSlugs) {
    const menu = summary.find((m) => m && m.contextSlug === slug)
    if (!menu) {
      results.push({ context_slug: slug, ok: false, error: 'Onbekende menucontext.' })
      continue
    }

    const capturedContent = { categories: menu.categories || [] }
    const validation = validateSnapshotProposalInput({
      restaurantId: intake.matched_restaurant_id,
      menuContext: `${intake.matched_restaurant_id}-${slug}`,
      // The real, canonical URL this menu was actually read from —
      // never a placeholder. This is the same canonicalized (no query,
      // no fragment) form url_intakes itself stores, per
      // docs/api/url-intake-schema.md's own "URL data minimisation".
      sourceUrl: intake.canonical_source_url,
      sourceType: 'own_website',
      qualityScore: 'medium',
      capturedContent,
    })
    if (!validation.valid) {
      results.push({ context_slug: slug, ok: false, error: snapshotProposalValidationMessage(validation.reason) })
      continue
    }

    const contentHash = computeCanonicalContentHash(validation.capturedContent)
    const { data, error } = await supabase
      .from('menu_snapshot_proposals')
      .insert({
        restaurant_id: validation.restaurantId,
        menu_context: validation.menuContext,
        source_url: validation.sourceUrl,
        source_type: validation.sourceType,
        originally_fetched_at: new Date().toISOString(),
        content_hash: contentHash,
        version: 1,
        quality_score: validation.qualityScore,
        captured_content: validation.capturedContent,
      })
      .select('id, restaurant_id, menu_context')
      .single()

    if (error) {
      const conflict = error.code === '23505'
      results.push({ context_slug: slug, ok: false, error: conflict ? 'A snapshot with this restaurant/menu/version already exists.' : 'Creating the snapshot failed' })
      continue
    }
    results.push({ context_slug: slug, ok: true, snapshot: data })
  }

  return NextResponse.json({ results })
}
