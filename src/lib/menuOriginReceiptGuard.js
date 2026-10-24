'use strict';

// Read-only authority guard for the original analysis receipt behind a stored
// concept version (BE-17/BE-19/BE-27).
//
// Every existing write/approve/export ingress must read the receipt version
// through this one helper. A v1-projection alone is not authoritative when the
// receipt it came from carries a `menu-extraction-product/v2` envelope: the
// receipt is then read through `readReceiptProjection` and any v2/unknown/
// invalid envelope refuses the action before its hash, insert, update, RPC,
// claim or GitHub call.
//
// Only one bounded projection is selected. A lookup error is reported as an
// error so every caller fails closed; it is never interpreted as "no receipt".

const { readReceiptProjection } = require('./menuProductIntegrationV2');

// The legacy projection and the versioned envelope are selected side by side,
// so a v2 receipt is never judged from the older `menus` key alone.
const ORIGIN_RECEIPT_SELECT = 'id, canonical_source_url, fetched_at, menus:candidate_summary->menus, product:candidate_summary->menuExtractionV2';

async function loadOriginReceipt(supabase, receiptId) {
  if (!receiptId) return { receipt: null, error: null };
  const { data, error } = await supabase
    .from('url_intake_analysis_receipts')
    .select(ORIGIN_RECEIPT_SELECT)
    .eq('id', receiptId)
    .maybeSingle();
  if (error) return { receipt: null, error };
  const receipt = data ? { ...data, productInfo: readReceiptProjection(data) } : null;
  return { receipt, error: null };
}

/**
 * The concrete refusal for an origin receipt whose version is not legacy v1.
 * Returns null for a v1 receipt or when there is no receipt at all.
 */
function originReceiptBlock(receipt) {
  if (!receipt || !receipt.productInfo || receipt.productInfo.kind === 'v1') return null;
  return { ...receipt.productInfo, reason: 'receipt_product_v2_authoritative' };
}

module.exports = { ORIGIN_RECEIPT_SELECT, loadOriginReceipt, originReceiptBlock };
