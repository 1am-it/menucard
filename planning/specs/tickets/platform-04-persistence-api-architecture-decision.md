# PLATFORM-04 — Persistence + Internal/External API Architecture Decision

## Depends on

`PLATFORM-03` (the schema this persistence layer needs to store).

## Objective

Decide how MenuCard gains a real, write-capable persistence layer, and how
the internal/external API boundary is drawn — as an explicit, documented
decision before any write-path code is built.

## User story

As the engineer building `PLATFORM-05`, I need to know what to build against
— which database, what auth model, what API boundary — rather than making
that call implicitly while writing the first endpoint.

## Scope

- Choose a persistence technology, considering that the app is currently a
  fully static Next.js deployment with zero backend dependencies.
- Decide how this coexists with the current deployment model (e.g. does the
  static consumer-facing read path stay as-is, with only new write-capable
  surfaces touching the new persistence layer).
- Define the internal/external API boundary and versioning approach per
  `planning/specs/platform-api.md`.
- Define the authentication mechanism for internal/trusted callers (owners,
  editors) at a conceptual level — detailed implementation is `PLATFORM-05`.

## Out of scope

- Implementation of any endpoint (`PLATFORM-05`).
- Public/external API design, docs, or key issuance.
- Choosing specific auth libraries/vendors beyond stating the approach.

## Dependencies

`PLATFORM-03` should exist first so the persistence choice is evaluated
against a real schema, not an abstract one.

## Data model needs

Validates that `PLATFORM-03`'s schema is representable in the chosen
persistence technology; does not change the schema itself.

## Moderation/verification needs

None directly — but the auth model decided here must support the distinct
roles `PLATFORM-06`/`07` will need (editor, owner).

## Risks

- Choosing persistence and the API boundary as two separate, sequential
  decisions instead of one — retrofitting an external-facing boundary onto
  an already-built internal-only API is expensive.
- Under-specifying auth as a single is-admin flag instead of scoped
  permissions, which `PLATFORM-06`/`07`'s distinct roles will need.

## Acceptance criteria

- [ ] A documented, accepted decision record for the persistence technology
      and its coexistence with the current static deployment.
- [ ] A documented internal/external API boundary and versioning approach.
- [ ] A documented, at-least-conceptual authentication/permission-scope
      approach.
- [ ] No application code changes — this ticket is a decision, not an
      implementation.

## Suggested order

Fourth ticket — final ticket of the modeling/architecture wave, immediately
before any write-path implementation begins.
