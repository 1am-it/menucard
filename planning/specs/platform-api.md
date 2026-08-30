# Spec — Internal/External API Principles

**Status (2026-08-30): the persistence/auth vendor is decided.** See
[`planning/decisions/010-platform-persistence-and-api.md`](../decisions/010-platform-persistence-and-api.md)
for the concrete choice — Supabase for persistence, Supabase Auth for the
role/scope model — and how it coexists with the current static consumer
read path. This file's principles below still govern the API shape itself;
`PLATFORM-05` is the first ticket that implements against them.

## Goal

Design the first write-capable API (`PLATFORM-05`) so it can be extended to
external consumers later (`PLATFORM-10` and beyond) without a rewrite —
without building or exposing anything external now.

## Scope boundary

- **Internal API** (in scope for `PLATFORM-05`): authenticated endpoints used
  by MenuCard's own admin/moderation tooling and internal contribution
  intake. Not reachable by the public.
- **External API** (out of scope until explicitly planned): a
  publicly-documented, versioned API for third parties. Not built now — this
  spec only asks that internal design decisions don't foreclose it later.

## Principles

- **Version from day one.** Prefix internal routes (e.g. `/api/internal/v1/...`)
  even though only one version will ever exist for a while. Retrofitting
  versioning after external consumers exist is far more disruptive than
  starting with it.
- **Auth scopes, not a single admin flag.** Design permission checks around
  what an action requires (e.g. "can write to restaurant X's data", "can
  approve moderation items"), not a single is-admin boolean — owners,
  trusted editors, and future external API keys all need different, narrower
  scopes.
- **Response shape mirrors the existing dish-result contract where
  applicable.** Reuse `docs/api/dish-result-shape.md`'s field-selection
  discipline (return only what's needed) for any new endpoint, rather than
  inventing a new response convention.
- **Rate limiting hooks, not necessarily rate limiting itself yet.** Internal
  callers don't need to be rate-limited today, but request handling should
  not assume trusted, unlimited-volume callers forever.
- **No public API keys, docs, or terms of use yet.** That is explicitly
  `PLATFORM-10`-or-later scope, contingent on a real product/business
  decision to open the platform externally — not a natural consequence of
  building the internal API well.

## What PLATFORM-04 must decide before this can be implemented

- The actual persistence layer (managed database vs. other option) and how
  it coexists with the app's current fully-static deployment model.
- Where internal API route handlers live relative to the existing Next.js
  route handler pattern (`app/api/search/route.js`).
- The authentication mechanism for internal/trusted callers (even a simple
  one) — this spec assumes scoped auth exists, it doesn't design it.

## Out of scope for this spec

- The persistence technology choice itself (`PLATFORM-04`).
- Public/external API design, docs, or key issuance (future, not scoped).
- The moderation workflow that consumes these endpoints (`PLATFORM-06`).
