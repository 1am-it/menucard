# PLATFORM-06 — Moderation/Review Queue

## Depends on

`PLATFORM-05` (internal API to read/write pending and live data).

## Objective

Give trusted editors a queue to review, approve, or reject proposed data
changes before they affect live consumer-facing data.

## User story

As a trusted editor, I want to see proposed changes with their evidence and
provenance side by side with current data, so I can approve or reject
quickly without needing to independently re-verify from scratch.

## Scope

- Admin-only queue UI listing pending changes (per the mockup's
  "Prijswijziging · Pasta al Tartufo: Oud €18,50 (imported) → Nieuw €19,50
  (community + foto menu)" pattern).
- Approve/reject actions that write through `PLATFORM-05`'s API, recording
  `editor` provenance on approval.
- Testable and shippable against internally-seeded pending changes, since no
  public contribution source exists yet at this point in the sequence.

## Out of scope

- Any public contribution intake (`PLATFORM-08`) — this ticket only needs
  *something* pending to review, which can be seeded internally.
- Owner-facing claim/verification (`PLATFORM-07`).
- Automated approval/scoring — every change is reviewed by a human editor.

## Dependencies

Hard dependency on `PLATFORM-05`. Will later receive real input from
`PLATFORM-07`/`08`, but does not depend on either to ship and be validated.

## Data model needs

Reads/writes `PLATFORM-03`'s schema through `PLATFORM-05`'s API; no new
schema of its own beyond a "pending change" record if not already covered by
`PLATFORM-03`.

## Moderation/verification needs

This ticket **is** the moderation workflow — approve/reject with visible
evidence, provenance recorded on decision.

## Risks

- Building this only against hypothetical future public contributions
  instead of real, internally-seeded edits, making it hard to validate
  before `PLATFORM-08` exists.
- Approving a change without correctly updating provenance (e.g. losing the
  original `community`/`imported` source once an editor approves it) —
  editor approval should add `editor`-verified status, not erase the
  original source's history.

## Acceptance criteria

- [ ] An editor can view a pending change with its evidence/provenance.
- [ ] Approve/reject actions work end-to-end against internally-seeded
      pending changes.
- [ ] Approving updates live data with correct, complete provenance.
- [ ] Internal/admin surface — exempt from the consumer performance budget
      per [[009-consumer-vs-internal-performance-budget]].

## Suggested order

Sixth ticket — second of the internal-write wave.
