// Auth guard for the internal API (PLATFORM-05).
//
// Verifies the caller's Supabase Auth session server-side via the
// Authorization header and looks up their staff_roles rows — never trusts
// a role or restaurant_id claimed by the client itself. Source/confidence
// for a write are derived here from the resolved role, per
// docs/api/data-trust-model.md's status-label mapping — never accepted
// from client input (see planning/specs/platform-trust-model.md's "never
// silently upgrade confidence" requirement).
//
// BE-48 (#112): the guard now also refuses an `internal` or `editor` account
// whose token is still `aal1` (password only) with 403 "Tweede inlogstap
// vereist", so the second step cannot be skipped by bypassing the login screen.
// The decision logic (including reading `aal` from the verified token) lives in
// src/lib/internalAuthCore.js, where it is unit-tested with a fictional client;
// this file only injects the real one and keeps the existing import path and
// exports for every route.

import { getSupabaseAdmin } from '@/src/lib/supabaseAdmin'
import { createInternalAuth, getAccessForRestaurant } from '@/src/lib/internalAuthCore'

const guard = createInternalAuth({ getSupabase: getSupabaseAdmin })

export const authenticateInternalRequest = guard.authenticateInternalRequest

export { getAccessForRestaurant }
