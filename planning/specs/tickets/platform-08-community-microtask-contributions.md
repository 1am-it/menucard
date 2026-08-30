# PLATFORM-08 — Community Micro-task Contributions

## Depends on

`PLATFORM-03` (trust model), `PLATFORM-05` (API), `PLATFORM-06` (moderation
queue — contributions must land here, not directly on live data).

## Objective

Let the public contribute small, structured, factual corrections/confirmations
without needing an account or deep commitment, per the mockup's micro-task
pattern — while keeping every contribution unmoderated-until-reviewed.

## User story

As a visitor who just noticed a restaurant's hours are wrong, I want to
confirm or correct that single fact in a few seconds, without creating an
account, and know that my input is being taken seriously (via a moderation
step) rather than either ignored or blindly trusted.

## Scope

- Structured micro-tasks: confirm a fact (yes/no), fill a specific missing
  field (price, one dish), answer a specific question (reservation channel)
  — per the mockup's task cards.
- Mobile-first interaction — this is explicitly meant to be usable "op
  straat, in de rij of na het eten" (per the reference mockup).
- Every submission lands in `PLATFORM-06`'s moderation queue with
  `community` provenance — never written directly to live data.
- Basic abuse/rate-limiting protection (e.g. per-IP or per-session limits).

## Out of scope

- Free-form reviews, ratings, or opinion content — remains out of scope per
  `planning/specs/dish-first-discovery.md`'s non-goals (see the 2026-08-30
  note there).
- Any account system beyond what's minimally needed for abuse mitigation
  (this ticket does not require full user accounts).
- Direct writes to live data — everything routes through moderation.

## Dependencies

Hard dependency on `PLATFORM-03`, `PLATFORM-05`, and `PLATFORM-06` all being
in place first — this is deliberately the last write-capable ticket to
depend on, not the first to build.

## Data model needs

Contribution records referencing `PLATFORM-03`'s schema fields, tagged
`source: community`, entering `PLATFORM-06`'s queue rather than the live
dataset directly.

## Moderation/verification needs

100% of contributions require editor review before affecting live data — no
auto-approval threshold in this initial ticket.

## Risks

- Spam/abuse from unauthenticated public submissions — must be designed in
  from the start, not added after a problem occurs.
- Task fatigue/low-quality low-effort answers if tasks are too easy to
  game (e.g. binary yes/no tasks answered randomly) — moderation review is
  the safeguard, not an assumption that community input is reliable
  unmoderated.
- Overwhelming the (human) moderation queue if volume exceeds editor
  capacity — worth a stated fallback (e.g. queue prioritization) even if not
  solved in this first ticket.

## Acceptance criteria

- [ ] Contribution tasks are structured, single-fact, and mobile-first.
- [ ] All contributions land in the moderation queue with correct provenance
      — none write directly to live data.
- [ ] Basic abuse/rate-limiting protection exists before public launch.
- [ ] No review/rating/opinion content is accepted.

## Suggested order

Eighth ticket — deliberately not an early ticket. Requires the trust model,
internal API, and moderation queue to already exist.
