# Issue 53 - Round 2 Checkpoint

STATE: BUILDING (round 2 delivered; browser acceptance still open, not READY_FOR_REVIEW).
CONTRACT: planning/specs/tickets/internal-task-flow-53.md (revision 3).
ROLE: developer (DeepSeek through Cline); Delivery Lead: ChatGPT/Codex.
ISSUE: https://github.com/1am-it/menucard/issues/53
PR: https://github.com/1am-it/menucard/pull/56 (existing draft; no second PR).
BRANCH: feat/compact-source-flow-53.

## Saved Commit And Remote

- Round code commit: `a4d4ed92c62b2c1961327a27cf9c6226102fff71`.
- Remote `origin/feat/compact-source-flow-53` verified at the same commit after
  `git fetch`; this checkpoint document is committed on top of it.
- Base for this round: `416f845` (round 1 checkpoint on top of `58c1987`).
- No merge, production action, publication, migration or workflow change.

## Delivered Outcome

Beheer (`/internal`) now opens real content immediately and has the four
approved sections as secondary navigation:

1. **Overzicht** (default): the existing coverage data rendered directly
   (menu-coverage hero, the same four metrics, priority neighbourhood gaps,
   methodology caveat). The full existing `/internal/coverage` dashboard stays
   reachable as a secondary detail link.
2. **Restaurants en bronnen**: every existing source-triage restaurant record,
   searchable by name/buurt/domein. A selected record shows its existing source
   URL, both status dimensions, last check, attention, next step, full proposal
   history, and links to the exact source-workqueue/source-triage record.
3. **Importhistorie**: two clearly distinguished existing histories — URL
   batches (1-10 URLs, link to the exact `/internal/nieuwe-import?batch=`) and
   dataset/source import runs (link to `/internal/import-inbox?run=`). Error
   details and honest API bounds are shown; nothing can be started or retried.
4. **Concepten en besluiten**: latest recorded menu concept per lineage,
   decided source proposals (accepted/rejected only) and active+discarded
   profile drafts. Each links to its exact existing record. Open daily work is
   not repeated as a second queue.

Section tabs use real URLs (`/internal?section=...`), support Back/Forward and
ordinary links. Old module URLs remain unchanged and reachable: coverage,
import-inbox, menu-concepts, source-workqueue, source-triage, profile-drafts,
moderation, nieuwe-import and contextual onboarding.

Role boundary: only an `internal` account receives the four sections. An
editor-only or owner-only account gets no internal administration data and no
empty hub; it sees one status panel pointing to Werkvoorraad. A role-less
account keeps the existing no-access status with sign out only.

## Round 1 Corrections In This Round

- An **identity question** is no longer suppressed by an open source proposal.
  Deciding a source URL does not establish which restaurant an ambiguous source
  belongs to; both tasks remain independent (tested).
- Several pending moderation changes/claims for one restaurant, two menu contexts
  for one restaurant, and a newer candidate review next to an active profile
  draft all remain separate tasks (tested).
- Approved concepts no longer say `Klaar voor publicatie` anywhere. With no
  stored export the copy is `publicatiestatus niet vastgesteld` and the action
  is `Controleer publicatie`; opened/pending exports say `Bekijk publicatie`;
  failed/closed show their real status; a merged export is not open work.
- Beheer's concept rows show the stored export status only and never derive
  readiness from approval alone (tested).

## Evidence

- `npm test`: **1916 pass, 0 fail**.
- `npm run build`: **success**; `/internal` route built at 8.95 kB.
- `node --test src/lib/internalBeheer.test.js src/lib/internalWorkqueue.test.js`:
  44 pass.
- Structural tests assert: four real sections, no module cards, only existing
  read-only endpoints, no POST/write in any panel, exact links, old URLs still
  present, no `Klaar voor publicatie` in Beheer, identity/candidate independence.

## Acceptance Matrix After Round 2

| Contract row | Evidence in this branch | Status |
| --- | --- | --- |
| Open Werkvoorraad: actual pending items, zero module cards | round-1 task list + tests | Implemented; browser screenshot/click path still open |
| Inspect a pending menu: one click to exact concept | exact concept hrefs + tests | Implemented; browser click path still open |
| Finish internal review / publication readiness | waiting concepts open detail; approved concepts never claim readiness without a stored export | Partly implemented; full readiness/click-count acceptance is round 3 |
| Open publication: exact concept controls, no write on navigation | `Open/Bekijk/Controleer publicatie` opens the exact concept; merged excluded | Partly implemented; publication navigation is round 3 |
| Existing export reused, no duplicate | stored export status shown; merged is not a task; no export action on Beheer | Implemented read-only; no live GitHub refresh in the list |
| Review source/proposal/candidate/draft/claim | exact-record deep links for every provider | Implemented; browser click paths still open |
| Open Beheer: coverage content after one main-nav click, no link-only page | default Overzicht renders hero, metrics and priority gaps directly | Implemented; browser screenshot still open |
| Find restaurant/source under Beheer | Restaurants en bronnen lists all records; selected record shows source/details/history | Implemented; browser check still open |
| Find an earlier import | URL batches and dataset runs distinguished with exact links and honest bounds | Implemented; browser check still open |
| Find a decision | latest concepts, decided source proposals and draft history with exact links | Implemented; full version history remains in the existing concept detail |
| Unknown restaurant | existing contextual Onboarding Restaurant flow unchanged | Unchanged; no new implicit restaurant CRUD |
| No tasks / provider failure | Werkvoorraad partial/error/empty; Beheer panels partial/error/empty per provider | Implemented and unit-tested |
| Different staff role / nonstarter | internal vs editor vs owner matrix; editor-only Beheer gate; server gates unchanged | Unit/structural tested; live role check still open |
| Mobile and keyboard | responsive Beheer/workqueue CSS, native links/buttons, focus-visible styles | Implemented; 320/390 browser check still open |

## Known Limitations

- **No live Preview/browser acceptance or screenshots** were possible in this
  checkout. This explicitly remains open; preview credentials were not available
  and were not copied from the original checkout.
- URL batches are shown from the existing bounded batch-analysis response
  (the 10 most recent); dataset runs from the existing import-inbox limit. The
  page says older results remain stored but are outside the list.
- Menu concept rows show the latest version per lineage; earlier versions and
  their reviews remain inspectable in the existing concept detail.
- Publication readiness uses the stored export row, not a fresh GitHub check in
  Beheer. The existing concept detail keeps its own refresh behaviour.
- `Gebruikers en rechten` remains an identified missing capability. It is a
  footnote, not a tab or dead button; building it needs a separate contract.
- The intentional round-1 suppression remains: a generic source-check row is
  replaced by an open proposal for the same restaurant, and a generic review row
  is replaced by its concrete menu concept. Identity questions, source problems
  next to a menu review, distinct proposals/concepts and distinct editor records
  stay independent.
- No production, merge, migration, source activation, export or publication was
  performed.

## Remaining Work And Next Safe Step

1. Perform the live Preview acceptance for rounds 1-2: actual screens and click
   paths for all four sections, roles (internal/editor/owner), empty/partial
   states, exact-record links and 320/390 widths.
2. Round 3 within the same contract: the shorter publication navigation and the
   remaining publication/status click-path acceptance.
3. Only after those checks and Delivery Lead review may the task move to
   `READY_FOR_REVIEW`; the Product Owner keeps release/merge authority.
