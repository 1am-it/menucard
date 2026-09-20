// Server-only hash logic for BE-17's menu snapshot proposals
// (menu_snapshot_proposals.content_hash,
// supabase/migrations/0011_be17_menu_snapshot_foundation.sql). Split out
// of src/lib/menuSnapshotProposals.js (see that file's own header) so
// that module can stay safely importable from a 'use client' component.
// This one uses `node:crypto` and must never be imported from client
// code or any code path that could ship it to the browser — only
// server-side route handlers
// (app/api/internal/v1/menu-snapshots/route.js) are intended callers.
// Mirrors the server-only convention already established in
// src/lib/supabaseAdmin.js.
//
// Deliberately CommonJS, same reasoning as
// src/lib/menuSnapshotProposals.js — directly testable via this
// project's existing `node --test` tooling, no new dependency.

'use strict'

const crypto = require('node:crypto')

/**
 * Recursively sorts every object's own keys (arrays keep their existing
 * order — a snapshot's dish order is meaningful content, not something
 * to normalize away) so that two independently constructed but
 * semantically identical `captured_content` values always serialize to
 * the exact same string, regardless of the key order either producer
 * happened to build them in. This is what makes
 * computeCanonicalContentHash deterministic across two independent
 * captures of unchanged content.
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort()
    const result = {}
    for (const key of sortedKeys) {
      result[key] = canonicalize(value[key])
    }
    return result
  }
  return value
}

/**
 * The migration's own `content_hash` column requires exactly this shape
 * (64 lowercase hex characters) — hex-encoded SHA-256 of the canonical
 * JSON form of `content`. Always recomputed here, server-side, from the
 * actual `captured_content` being written — a caller must never be able
 * to supply its own hash, or the hash could silently drift from what it
 * claims to describe.
 */
function computeCanonicalContentHash(content) {
  const canonicalJson = JSON.stringify(canonicalize(content))
  return crypto.createHash('sha256').update(canonicalJson).digest('hex')
}

module.exports = {
  computeCanonicalContentHash,
}
