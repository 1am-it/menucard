# PLATFORM-03 — Provenance/Trust Data Model

## Depends on

None functionally, but should follow `PLATFORM-01`/`02` per the approved wave
order (modeling before write infrastructure).

## Objective

Define the per-field provenance/trust schema that every write-capable
`PLATFORM-*` ticket after this one depends on.

## User story

As a future editor or consumer, I want to know not just what a piece of data
says, but who confirmed it and how recently, so I can judge how much to trust
it.

## Scope

Per `planning/specs/platform-trust-model.md`:

- Define the `source` / `confidence` / `verifiedAt` / `verifiedBy` shape.
- Define the five status labels (Owner verified / Community confirmed /
  Editor verified / Imported / Stale) and their mapping to the shape above.
- Define the staleness window.
- Document which fields this applies to first (price, hours, reservation
  method, item availability, allergens).

## Out of scope

- Implementing persistence for this schema (`PLATFORM-04`/`05`).
- Any UI to display trust labels (each consuming ticket's own scope).
- Automated confidence scoring/decay beyond the simple staleness window.

## Dependencies

None on other tickets to *define* this; `PLATFORM-05` depends on this being
defined before it can implement writes.

## Data model needs

This ticket **is** the data model definition. Output: a documented schema
(JSDoc type or markdown table, matching the convention `BE-02a` used for the
dish-result shape).

## Moderation/verification needs

Defines the vocabulary (`source`, `confidence`) that `PLATFORM-06`'s
moderation queue will operate on, but does not build the queue itself.

## Risks

- Under-scoping to restaurant-level trust instead of true per-field
  provenance — the existing `reservation.verified` boolean is a useful
  precedent but not sufficient on its own.
- Choosing a staleness window arbitrarily instead of grounding it in how
  often real menu data actually changes.

## Acceptance criteria

- [ ] Documented schema exists and is referenceable by later tickets.
- [ ] Status labels are defined precisely enough that `PLATFORM-06`'s
      moderation queue and any consumer-facing display can implement against
      them without re-interpreting.
- [ ] Staleness window is defined with stated reasoning, not an arbitrary
      number.
- [ ] No implementation/persistence work included.

## Suggested order

Third ticket — first of the modeling/architecture wave.
