# BE-17 — Menu Proposal Snapshot Foundation

## Status

Implemented, committed, pushed, and live-verified in production, with a
follow-up build fix also committed and pushed. Verified: local product
code built and tested (targeted and full test suites green), an
independent pre-commit review, and a combined pre-push review, each
conducted separately for the feature commit (`9fee5f7`, "feat(internal):
add onboarding menu flow") and its Vercel build-fix follow-up
(`dedb31e`, "fix(internal): separate menu snapshot hash from client
bundle"). Verified directly against Vercel's own deployment log: the
production deployment built from `dedb31e` compiled successfully and is
aliased to the production domain.

**Also verified live, via an authenticated production session** (a
non-mutating UI smoketest, not a data-mutating end-to-end proposal/review
test — see Voortgang step 9 below for exactly what this confirms and
does not confirm): `https://menucard-kappa.vercel.app/internal` shows
the title `Beheer`, the roles `internal, editor`, and a reachable
`Onboarding Menu` card/link; `https://menucard-kappa.vercel.app/internal/onboarding-menu`
renders correctly with `New proposal` and `No menu snapshots yet`. One
non-blocking UX issue was observed during this same check: on a fresh
load, `No internal access for this account` briefly appeared before the
correct page rendered — a role-resolution loading-state timing issue,
not evidence of an authorization defect (server-side authorization was
never bypassed; the final, settled rendered state was correct). This is
recorded as a forward-looking acceptance requirement in
`be-18-onboarding-menu-via-url.md`, not fixed on this already-shipped
ticket.

This ticket's own "Onboarding Menu via URL" successor is tracked
separately as `be-18-onboarding-menu-via-url.md`.

## Voortgang

BE-17 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [x] 2a. Documentatiecommit lokaal gemaakt
- [x] 2b. Documentatiecommit gepusht
- [x] 3. Implementatie-readinessreview groen
- [x] 4. Lokale productcode gebouwd en getest
- [x] 5. Onafhankelijke pre-commitreview groen
- [x] 6. Lokale codecommit gemaakt
- [x] 7. Gecombineerde pre-pushreview groen
- [x] 8. Code gepusht
- [x] 9. Productiecontrole

See `015-be-ticket-structure-and-time-boxing.md` for what this checklist
means and how it must be kept up to date.

## Depends on

A series of independent, read-only production checks this same effort
already ran and confirmed, without which this ticket could not safely be
written: local and live migration history for `0001`–`0010` match
exactly; a direct, read-only, rolled-back catalog inspection of the
existing `field_provenance`, `staff_roles`, `pending_changes`,
`restaurant_claims`, `import_extraction_records`,
`import_candidate_reviews`, `import_candidate_enrichments`,
`restaurant_profile_drafts`, and `restaurant_profile_draft_field_facts`
tables succeeded against the real production schema. Reuses, as design
precedent only (never as storage): the append-only review/decision
pattern in `import_candidate_reviews` (fixed status values, a reason
required exactly when the decision needs one, no update/delete grant for
any role) and the append-only correction pattern in
`import_candidate_enrichments` (a mandatory, format-checked source per
correction, never edited in place).

## Relationship to `market-02b-menu-proposal-publication-contract.md`

`MARKET-02B` already designs a much larger, general-purpose
`MenuProposal`/canonical-publication contract — multi-source, multi-city,
covering owner input, imported evidence, community submissions, OCR, and
a full canonical versioned menu layer. It remains **proposed, not
started**, documentation-only, and this ticket does not implement it,
rename itself to it, or pre-empt any of its open contract questions.

BE-17 is a deliberately smaller, Breda-only, internal-only first slice
that answers one narrower question: can a single reviewed menu snapshot
be captured, reviewed, and corrected safely and traceably, with nothing
public changing yet? To avoid any naming or schema collision with
`MARKET-02B`'s own eventual `MenuProposal` model, this ticket's own
records are called **menu snapshot proposals** throughout, never
`MenuProposal`. If and when `MARKET-02B` is scheduled, it may reuse,
extend, or fully replace this ticket's tables — that decision is
explicitly not made here.

## Problem

Menu content genuinely worth publishing already exists for 4 of Breda's
25 restaurants (11 menu documents in `data/menus.json`), each carrying a
source URL and an original scrape date — but no version marker, no
content hash, no review status, and no confidence score. The 21 remaining
restaurants have no menu content at all. Neither the existing
restaurant-wide `field_provenance` table (a single-current-row-per-field
overwrite model, no review status, a fixed five-field allow list that
does not include menu content) nor `pending_changes` (a mutable
moderation queue) can safely serve as an append-only menu audit log —
both have real, documented mutation paths that a genuine audit trail must
not have.

This ticket adds the smallest new, additive foundation that can capture a
menu as a reviewable snapshot, record a full review history for it, and
allow a correction without ever overwriting what a previous reviewer
actually saw and decided — without touching anything currently public.

## Data model — Fase 1 only

Two new tables, both additive, neither replacing nor extending any
existing table:

### `menu_snapshot_proposals` — immutable snapshot record

One row per captured attempt to review a restaurant's menu (or one of its
dayparts) as a coherent unit. Once inserted, a row is never updated —
only ever superseded by a new row (a re-capture, a correction, or a
re-confirmation all produce a new row, never an edit of an old one).

- `restaurant_id` — references the existing restaurant identifier scheme
  (`data/restaurants.json`'s own string keys, matching
  `field_provenance.restaurant_id`'s type) — not a foreign key into any
  table that does not yet exist.
- `menu_context` — the menu/daypart this snapshot covers (e.g. the
  existing `{restaurantId}-{mealType}` shape `data/menus.json` already
  uses), so one restaurant can have more than one open snapshot at once
  without them colliding.
- `source_url`, `source_type` (a fixed, small enum — e.g. `own_website`,
  `pdf`, `manual` — never free text).
- `originally_fetched_at` — when this content was first captured.
- `last_reconfirmed_at` — when someone last checked this snapshot's
  content against its own source; nullable, since a brand-new snapshot
  has not been reconfirmed yet.
- `content_hash` — a canonical SHA-256 of the captured content, computed
  the same deterministic way every time (stable field order, stable
  whitespace handling) so two independent captures of unchanged content
  hash identically.
- `version` — a small integer, incrementing per `(restaurant_id,
  menu_context)` lineage, so a reviewer can see "this is the 3rd captured
  version of T-Huis's Dinerkaart" without inferring it from timestamps.
- `quality_score` — a small, fixed-vocabulary confidence indicator (not a
  computed statistic in this first version — a reviewer-assigned level is
  enough for the pilot).
- `captured_content` — the proposed menu content itself, stored as one
  structured snapshot (see "Non-goals" — no separate category/dish/option
  tables in this version).

No `review_status` or `publication_status` column exists on this table —
deliberately. Status is a derived read, never a stored, mutable field
here (see "Correction pattern" below).

### `menu_snapshot_reviews` — append-only review-event history

One row per review event against a `menu_snapshot_proposals` row —
multiple rows per snapshot are the normal, expected case, exactly like
`import_candidate_reviews`.

- `snapshot_id` — references the snapshot this event is about.
- `reviewer_id` — who made this decision.
- `decided_at` — when.
- `decision` — a fixed, small set of allowed values (see "Validation
  rules" below) — never free text.
- `reason` — required exactly when the decision needs one, forbidden
  otherwise, enforced the same symmetric way as
  `import_candidate_reviews.rejection_reason`.
- `note` — optional, bounded free text for a human correction or
  clarification, the same shape as `import_candidate_enrichments`'s own
  correction pattern.

The **current, effective status** of a snapshot is always derived by
picking its latest `menu_snapshot_reviews` row (same tie-break logic as
`pickLatestReviewRow`/`computeEffectiveReviewStatus` in
`src/lib/importInbox.js`) — never read from, or written to, a status
column anywhere else.

## Validation rules

- `decision` is constrained to a small, fixed set — at minimum
  `needs_review`, `approved_internal`, `rejected`, `deferred` (naming to
  be finalized against `import_candidate_reviews`'s own vocabulary during
  implementation, not invented independently).
- `reason` is required if and only if `decision` is `rejected` (or
  `deferred`, if that path needs one) — a single, symmetric check
  constraint, added **valid from creation**, never `NOT VALID`. An
  existing reason-shaped constraint elsewhere in this schema is known to
  have been added without full historical validation; this ticket does
  not repeat that gap.
- `content_hash` is required and is always recomputed from
  `captured_content` at write time — never accepted as caller-supplied
  input, so it cannot silently drift from what it claims to describe.
- `menu_context` must match the existing `{restaurantId}-{mealType}`
  shape already used by `data/menus.json` — no new addressing scheme
  invented for this ticket.

## Access and RLS (deliberately narrow)

This ticket does **not** copy any existing grant, RLS policy, or the
absence of triggers from `field_provenance`, `pending_changes`, or the
import-review tables and assume it already fits. Both new tables get
their own, newly reasoned rights, decided during implementation against
exactly what this pilot needs — starting from nothing, not from a
template:

- No `UPDATE`, `DELETE`, or `TRUNCATE` grant on `menu_snapshot_reviews`
  for any role, ever — matching the append-only guarantee this ticket
  depends on, verified the same way `import_candidate_reviews` already
  is (grants inspected directly, not assumed from a migration's intent).
- Whether `menu_snapshot_proposals` needs an `UPDATE` grant at all (for
  example, to fill in `last_reconfirmed_at` without creating a whole new
  row) or must be equally insert-only is an open implementation question,
  not decided here — but if any mutability is added, it must be scoped to
  exactly the columns that need it, never a blanket table-level grant.
- RLS policies for both tables are written fresh for this ticket's own
  access pattern (internal/editor read and write, no public or consumer
  access whatsoever) rather than copied from a table serving a different
  purpose.

## Correction pattern

A mistake — a wrong reviewer decision, a bad snapshot capture, a stale
reconfirmation — is never fixed by editing an existing
`menu_snapshot_proposals` or `menu_snapshot_reviews` row. It is fixed by:

- a new `menu_snapshot_reviews` row recording the corrected decision
  (e.g. an earlier `approved_internal` later found to be wrong gets a new
  `rejected` row with its own reason — the old row stays exactly as it
  was), or
- a new `menu_snapshot_proposals` row (a fresh capture, a new `version`)
  when the underlying content itself needs to change.

This mirrors `import_candidate_enrichments`'s own "new row per
correction, never edit" discipline exactly.

## Minimal internal review route

If a working end-to-end pilot needs more than direct database access to
be testable, this ticket allows exactly one small, internal-only,
role-gated route/screen pair for creating a snapshot and recording a
review decision against it — reusing this project's existing internal
auth/role pattern and the append-only-log UI conventions already proven
in the import inbox (a plain list, a decision form with a required-reason
field exactly when needed). This is explicitly **not** a dashboard: no
charts, no summary tiles, no filters beyond what makes a short pilot list
usable, and no new visual pattern.

## Non-goals / later work (explicitly out of scope for this ticket)

- **A separate, controlled promotion route** from an `approved_internal`
  snapshot into publicly visible menu data. That route, and the decision
  of exactly how and when it runs, is later work — this ticket produces
  reviewed snapshots and nothing more.
- **Any public menu change, automatic publication, batch publication, or
  automatic conflict resolution.** `data/menus.json` and every other
  publicly served file are untouched by this ticket, in every phase.
- **A review dashboard, a broad source inventory, a batch review queue,
  any form of mass scraping, POS integrations, direct restaurant
  self-service input, or expansion beyond the existing 4 pilot
  restaurants toward 25 or 100+.** All remain future, separately
  scoped work.
- **Normalization into separate category/dish/option entities.** This
  first version stores one versionable, structured snapshot per
  `(restaurant, menu_context)` capture — not a relational breakdown into
  individual dish or option rows. That normalization, if ever needed, is
  a later, explicitly separate step.
- **Running the actual pilot** against the 4 historical restaurants and
  11 existing menus. This ticket builds the foundation the pilot would
  use; the pilot's own execution — including re-confirming that the 11
  existing menus are still accurate against their real, current sources
  — is separate, later work. Today's 11 historical menus remain review
  starting points only, never treated as an already-current source of
  truth.
- **A version-incrementing recapture through the internal review route.**
  The route currently supports only a snapshot's first capture, always as
  `version = 1`; a recapture for the same `(restaurant_id, menu_context)`
  as a new proposal with a higher `version` (the second path under
  "Correction pattern" above) is deliberately not yet available and
  remains later work. Correction via a new, append-only
  `menu_snapshot_reviews` row (the first path under "Correction pattern")
  is already supported.

## Acceptance criteria

- [ ] `menu_snapshot_proposals` exists with exactly the fields listed
      above, no `review_status`/`publication_status` column, and
      `content_hash` always server-computed, never caller-supplied.
- [ ] `menu_snapshot_reviews` exists, append-only (no `UPDATE`/`DELETE`
      grant for any role, verified directly against real grants — not
      assumed), with `decision` constrained to a fixed set and `reason`
      required exactly when `decision` requires it, via a constraint that
      is valid from creation (never added `NOT VALID`).
- [ ] The effective status of any snapshot is demonstrably derived from
      its latest review row only — no status or publication field exists
      anywhere else to read it from instead.
- [ ] A correction to an existing decision or snapshot is demonstrated by
      inserting a new row, with the original row provably unchanged
      (its own `decided_at`/content byte-for-byte identical before and
      after).
- [ ] Neither `field_provenance` nor `pending_changes` is modified,
      extended, or reused as the storage for this ticket's review
      history.
- [ ] No row in either new table is reachable from any public route —
      verified directly against RLS policies and grants, not assumed from
      intent.
- [ ] `data/menus.json`, `data/restaurants.json`, and every other
      currently public data source are byte-for-byte unchanged after this
      ticket ships.

## Suggested order

1. This ticket's own documentation commit, made and pushed.
2. An independent, read-only implementation-readiness review of this
   ticket.
3. The exact `decision` vocabulary and whether `menu_snapshot_proposals`
   ever needs a scoped `UPDATE` grant (see "Access and RLS") are settled
   during implementation, not before — consciously deferred, not an
   oversight.

Implementation, an independent pre-commit review, a combined pre-push
review, the code push, and a production check follow, in that order —
tracked in this ticket's own `## Voortgang` checklist above, per
`015-be-ticket-structure-and-time-boxing.md`.
