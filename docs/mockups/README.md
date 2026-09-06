# Mockups

This directory stores the visual design references for BredaEats.

These mockups define the intended UX direction for the dish-first redesign.

Use them as guidance for:

- information hierarchy
- layout direction
- typography emphasis
- spacing
- mobile-first behavior

Do not treat them as a pixel-perfect implementation requirement.

## Recommended files

- [Homepage mockup](./homepage-v1.png)
- [Search results mockup](./search-results-v1.png)
- [Restaurant menu mockup](./restaurant-menu-v1.png)

## Internal tooling (addition, 2026-09-06)

Consumer-facing pages are the primary scope above; this project's
`internal`-only tools (e.g. `/internal/import-inbox`) also get a mockup
once one exists, so a presentation redesign has a concrete acceptance
reference instead of ad hoc judgment calls:

- [Internal candidate triage mockup](./internal-candidate-triage-v1.png) —
  visual reference for `/internal/import-inbox`'s "Review Overview"
  section (`planning/specs/tickets/market-05-normalization-deduplication.md`'s
  own "MARKET-05A" section covers the underlying feature/data contract;
  this mockup governs layout/visual language only, per this file's own
  "Do not treat them as a pixel-perfect implementation requirement" note
  above). **Correction (2026-09-06):** this entry originally named the
  section "Triage overview" and the page "Candidate triage" — both were
  renamed for terminology consistency ("Review Overview" on the page
  "Imported Restaurant Review") after this mockup image itself was
  captured; the image file is unchanged and still shows those older
  labels, since it governs layout only, never exact text (see this
  file's own top-level note). Full detail:
  `planning/specs/tickets/market-05-normalization-deduplication.md`'s
  own terminology glossary. **Correction (2026-09-06, later still):**
  the page name above, "Imported Restaurant Review", is itself now
  stale — the page title is "Dashboard imported Restaurant Data" as of
  that ticket's "information-hierarchy update" section; "Review
  Overview" is unchanged. This mockup still governs layout/visual
  language only, not exact text.

## Naming

Prefer clear versioned names such as:

- `homepage-v1.png`
- `homepage-v2.png`
- `search-results-v1.png`
- `restaurant-menu-v1.png`

Keep only the latest approved versions referenced from planning and design docs.
