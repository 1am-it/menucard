// BE-17 — internal Onboarding Menu route. `internal`-only for creating a
// new menu snapshot proposal; readable by `internal` or `editor` (an
// editor needs to see the list to review it, even though editors never
// create a snapshot themselves). Mirrors the existing Data-inbox routes'
// shape exactly (app/api/internal/v1/import-inbox/candidates/route.js):
// authenticateInternalRequest first, then a role check specific to this
// route, then a single Supabase call.
//
// GET lists every menu_snapshot_proposals row together with its full,
// append-only menu_snapshot_reviews history and the effective status
// derived from that history in pure application code
// (src/lib/menuSnapshotProposals.js's deriveEffectiveSnapshotStatus) —
// never a stored status column, on either table. Small-scale, pilot-only
// listing: no pagination, no filters — the same simplicity this ticket's
// own pilot scope calls for.
//
// POST inserts exactly one new menu_snapshot_proposals row via a plain
// `.insert()` — never an RPC, since a single-table, single-row write
// needs no atomicity wrapper, and no new migration/function is in scope
// here. `content_hash` is always computed here, server-side, from the
// request's own `captured_content` (never accepted as caller-supplied
// input, so it cannot silently drift from what it claims to describe).
// `version` is always 1 for a brand-new (restaurant_id, menu_context)
// lineage in this first pilot — a later re-capture incrementing it is
// explicitly out of scope for this route.
//
// This route never mutates or removes an existing row on either table,
// and never references any public/canonical restaurant or menu data
// source — see this file's own structural safety-net test.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { authenticateInternalRequest } from '@/src/lib/internalAuth'
import { isInternalOnly } from '@/src/lib/importInbox'
import { computeCanonicalContentHash } from '@/src/lib/menuSnapshotHash'
import {
  deriveEffectiveSnapshotStatus,
  groupReviewsBySnapshotId,
  validateSnapshotProposalInput,
  snapshotProposalValidationMessage,
} from '@/src/lib/menuSnapshotProposals'

// Same one-line definition as
// app/api/internal/v1/moderation/pending/route.js and
// app/api/internal/v1/claims/pending/route.js — kept deliberately in
// sync, not a subtly different copy.
function isEditor(roles) {
  return Array.isArray(roles) && roles.some((r) => r && r.role === 'editor')
}

export async function GET(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles) && !isEditor(auth.roles)) {
    return NextResponse.json({ error: 'Only internal or editor staff can view menu snapshots' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()

  const { data: snapshots, error: snapshotsError } = await supabase
    .from('menu_snapshot_proposals')
    .select('id, restaurant_id, menu_context, source_url, source_type, originally_fetched_at, last_reconfirmed_at, content_hash, version, quality_score, captured_content, created_at')
    .order('created_at', { ascending: false })

  if (snapshotsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const { data: reviews, error: reviewsError } = await supabase
    .from('menu_snapshot_reviews')
    .select('id, snapshot_id, reviewer_id, decided_at, decision, reason, note')
    .order('decided_at', { ascending: false })
    .order('id', { ascending: false })

  if (reviewsError) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const reviewsBySnapshotId = groupReviewsBySnapshotId(reviews)
  const enriched = (snapshots || []).map((s) => {
    const ownReviews = reviewsBySnapshotId[String(s.id)] || []
    return {
      ...s,
      effective_status: deriveEffectiveSnapshotStatus(ownReviews),
      reviews: ownReviews,
    }
  })

  return NextResponse.json({ snapshots: enriched })
}

export async function POST(request) {
  const auth = await authenticateInternalRequest(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isInternalOnly(auth.roles)) {
    return NextResponse.json({ error: 'Only internal staff can create a menu snapshot proposal' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let capturedContent = body && body.captured_content
  if (typeof capturedContent === 'string') {
    try {
      capturedContent = JSON.parse(capturedContent)
    } catch {
      return NextResponse.json({ error: 'captured_content must be valid JSON.' }, { status: 400 })
    }
  }

  const validation = validateSnapshotProposalInput({
    restaurantId: body && body.restaurant_id,
    menuContext: body && body.menu_context,
    sourceUrl: body && body.source_url,
    sourceType: body && body.source_type,
    qualityScore: body && body.quality_score,
    capturedContent,
  })
  if (!validation.valid) {
    return NextResponse.json({ error: snapshotProposalValidationMessage(validation.reason) }, { status: 400 })
  }

  const contentHash = computeCanonicalContentHash(validation.capturedContent)

  const supabase = getSupabaseAdmin()
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
    .select('id, restaurant_id, menu_context, source_url, source_type, originally_fetched_at, last_reconfirmed_at, content_hash, version, quality_score, captured_content, created_at')
    .single()

  if (error) {
    const conflict = error.code === '23505'
    return NextResponse.json(
      { error: conflict ? 'A snapshot with this restaurant/menu/version already exists.' : 'Creating the snapshot failed' },
      { status: conflict ? 409 : 500 }
    )
  }

  return NextResponse.json({ snapshot: { ...data, effective_status: 'unreviewed', reviews: [] } }, { status: 201 })
}
