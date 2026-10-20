'use strict';

// BE-17 — the generic Onboarding Menu review-decision write, extracted from
// its route so the v2 guard is testable with an injected fake database.
// This route remains `editor`-only and append-only: one new review row, never
// an update, delete, source confirmation or publication.
//
// A versioned v2 snapshot is refused before the insert. Reviewing it through
// the old generic row would record an approval for content this round may only
// display; the concrete reason is returned instead.

const { validateSnapshotReviewInput, snapshotReviewValidationMessage } = require('./menuSnapshotProposals');
const { readConceptProduct, productActionRefusal } = require('./menuProductIntegrationV2');
const { loadOriginReceipt, originReceiptBlock } = require('./menuOriginReceiptGuard');

function isEditor(roles) {
  return Array.isArray(roles) && roles.some((r) => r && r.role === 'editor');
}

function reply(status, body) {
  return { status, body };
}

function createMenuSnapshotReviewHandlers({ authenticate, getSupabase }) {
  async function record(request, rawId) {
    const auth = await authenticate(request);
    if (!auth || !auth.ok) {
      return reply((auth && auth.status) || 401, { error: (auth && auth.error) || 'Not authenticated' });
    }
    if (!isEditor(auth.roles)) {
      return reply(403, { error: 'Only editor staff can record a snapshot review decision' });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: 'Invalid JSON body' });
    }

    const validation = validateSnapshotReviewInput({
      decision: body && body.decision,
      reason: body && body.reason,
      note: body && body.note,
    });
    if (!validation.valid) {
      return reply(400, { error: snapshotReviewValidationMessage(validation.reason) });
    }

    const supabase = getSupabase();
    const { data: snapshot, error: loadError } = await supabase
      .from('menu_snapshot_proposals')
      .select('id, captured_content, origin_receipt_id')
      .eq('id', rawId)
      .maybeSingle();
    if (loadError) return reply(500, { error: 'Recording the review failed' });
    if (!snapshot) return reply(404, { error: 'Snapshot not found' });

    const product = readConceptProduct(snapshot.captured_content);
    if (product.kind !== 'v1') return productActionRefusal('decide', product);

    // The same receipt-authority guard as the internal review route: a v1
    // projection next to a v2/unknown/invalid origin receipt may not be
    // approved through this generic editor row either. A lookup error fails
    // closed instead of downgrading to "no receipt".
    const receiptState = await loadOriginReceipt(supabase, snapshot.origin_receipt_id);
    if (receiptState.error) return reply(500, { error: 'Recording the review failed' });
    const originBlock = originReceiptBlock(receiptState.receipt);
    if (originBlock) return productActionRefusal('decide', originBlock);

    const { data, error } = await supabase
      .from('menu_snapshot_reviews')
      .insert({
        snapshot_id: rawId,
        reviewer_id: auth.userId,
        decision: validation.decision,
        reason: validation.reason,
        note: validation.note,
      })
      .select('id, snapshot_id, reviewer_id, decided_at, decision, reason, note')
      .single();

    if (error) {
      const notFound = error.code === '23503';
      return reply(notFound ? 404 : 500, { error: notFound ? 'Snapshot not found' : 'Recording the review failed' });
    }

    return reply(201, { review: data });
  }

  return { record };
}

module.exports = { createMenuSnapshotReviewHandlers, isEditor };
