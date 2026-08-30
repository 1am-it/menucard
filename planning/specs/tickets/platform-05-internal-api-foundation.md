# PLATFORM-05 — Internal API Foundation

## Depends on

`PLATFORM-03` (schema), `PLATFORM-04` (persistence + API architecture
decision).

## Objective

Build the first write-capable, authenticated, internal-only API endpoints —
the foundation every later write-facing ticket (`PLATFORM-06`–`08`) builds
on.

## User story

As an internal operator (not yet a public restaurant owner or community
contributor), I want to write verified data changes through an API instead
of hand-editing JSON files, with provenance recorded automatically.

## Scope

- Implement authenticated internal endpoints per `planning/specs/platform-api.md`
  and the persistence/auth decisions from `PLATFORM-04`.
- Endpoints can read and write trust-bearing fields using `PLATFORM-03`'s
  schema, recording provenance on every write.
- Versioned routes (e.g. `/api/internal/v1/...`).

## Out of scope

- Any public-facing route or submission form.
- The moderation queue UI (`PLATFORM-06`) — this ticket is the API those
  tools will call, not the tools themselves.
- Owner-facing or community-facing endpoints (`PLATFORM-07`/`08`).

## Dependencies

Hard dependency on `PLATFORM-03` and `PLATFORM-04` being decided first.

## Data model needs

Implements persistence for `PLATFORM-03`'s schema on the technology chosen
in `PLATFORM-04`.

## Moderation/verification needs

None yet — internal callers are already trusted; moderation logic starts at
`PLATFORM-06`.

## Risks

- Building this with a single is-admin auth flag instead of real permission
  scopes, which would need rework once `PLATFORM-06`/`07` introduce distinct
  editor/owner roles.
- Skipping provenance recording "for now" — every write from this point
  onward must carry correct provenance, or the trust model becomes
  unreliable immediately.

## Acceptance criteria

- [ ] Internal endpoints exist, authenticated, not reachable publicly.
- [ ] Every write records correct provenance per `PLATFORM-03`'s schema.
- [ ] Endpoints are versioned per `platform-api.md`.
- [ ] Permission checks are scope-based, not a single admin flag.

## Suggested order

Fifth ticket — first of the internal-write wave.
