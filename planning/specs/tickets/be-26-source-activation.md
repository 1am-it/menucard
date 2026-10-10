# BE-26 — Bron activeren na een geaccepteerd bronvoorstel (v1)

## Status

Documentation only. Recorded 2026-10-10 as BE-24 follow-up phase 1
("applying an accepted proposal"), under
`planning/decisions/016-publication-path.md`. Nothing is built. Depends
on BE-25 fase 1 and 2 being live first.

## Voortgang

BE-26 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2a. Documentatiecommit lokaal gemaakt — made together with this
  text; checked in the next status update
- [ ] 2b. Documentatiecommit gepusht
- [ ] 3. Implementatie-readinessreview groen
- [ ] 4. Lokale productcode gebouwd en getest
- [ ] 5. Onafhankelijke pre-commitreview groen
- [ ] 6. Lokale codecommit gemaakt
- [ ] 7. Gecombineerde pre-pushreview groen
- [ ] 8. Code gepusht
- [ ] 9. Productiecontrole

See `015-be-ticket-structure-and-time-boxing.md`.

## Goal

A confirmed source becomes the restaurant's **active source** for one
kind, with evidence and an audit trail, so that BE-27 can prepare
concepts from it. Activating changes no public data.

## Depends on

- BE-24 (`source_triage_proposals`, events, self-review marking).
- BE-25 ("Bevestig bron", strict high-certainty rule, stored job results,
  status vocabulary).
- BE-20 discovery as amended in `docs/api/url-intake-schema.md`,
  "Amendment (2026-10-10, decision 016)" (candidate kinds).
- Decision 016 (the four separate steps).

## What activation is

- **Input:** an accepted BE-24 proposal whose URL has a stored,
  successful analysis result (a BE-20/BE-25 job with its receipt,
  `field_evidence` and `analysis_result_hash`). "Bevestig bron" in BE-25
  accepts the proposal and activates the source in the same human action.
- **A proposal without a stored result** (a URL typed into BE-24 and
  never analysed) can be accepted as today, but is **not** activated: it
  first needs an analysis.
- **Kinds:** `menukaart`, `bedrijfsgegevens` or `aanvullend`, taken from
  the discovery label of the analysed candidate. At most one active
  source per restaurant per kind; activating a new one ends the previous
  one, which stays in the history.
- **What is stored per activation:** restaurant (`data/restaurants.json`
  key), kind, canonical source URL, the originating job and BE-24
  proposal, the evidence reference, the content hash, the activation
  time, the acting staff member, and an event trail (activated, ended).
  Rows are never deleted.

## What activation never does

- It changes no public data: `data/restaurants.json`, `data/menus.json`,
  `pending_changes`, `field_provenance` and menu snapshots stay
  untouched. Preparing concepts is BE-27.
- It never fetches: it uses only the already stored analysis result.
- It never activates automatically, in bulk without the BE-25 per-result
  checks, or for an unknown restaurant (that stays Onboarding Restaurant).
- A later source block (`Robots geblokkeerd`, unreachable, failed
  analysis) never removes an active source or any live data; it is shown
  as a status for a human.

## Data and routes (input for the build)

- One additive migration (number assigned at build time; `0016` is
  BE-25's): an active-source table plus an events table, RLS on with no
  policies, writes only through `security invoker` RPCs with a fixed
  `search_path`, `service_role`-only grants per the 0015 pattern.
- An activation RPC that, in one transaction, checks the accepted
  proposal, the stored job result (status `succeeded`, hash match as in
  BE-25 B2), the kind and the restaurant, ends a previous active source
  of that kind and records the events.
- Internal-only routes: the BE-25 confirm route calls it; BE-24's page
  shows the active source per kind. Same authorization as BE-24
  (`internal` only, actor from the session, `editor`/`owner` refused).

## Non-goals

Concepts and publication (BE-27); `SYNC-0` or any re-check schedule;
external sources; opening hours; route or identifier renames.

## Acceptance criteria

- [ ] Activation needs an accepted BE-24 proposal and a stored successful
      result; without either it is refused.
- [ ] At most one active source per restaurant per kind; history kept.
- [ ] No fetch and no write to public data, `pending_changes`,
      `field_provenance` or menu snapshots (structurally tested).
- [ ] Kind, evidence, hash, time, actor and events are stored and shown.
- [ ] Every route refuses a missing session, `editor` or `owner`.

## Time estimate (decision 015)

Medium: one migration with structural tests, one RPC, two route changes.
Estimate and report each work block before starting it.
