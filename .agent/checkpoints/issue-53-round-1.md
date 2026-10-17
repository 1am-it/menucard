# Issue 53 - Round 1 Checkpoint

STATE: BUILDING (product task; first approved round delivered, not READY_FOR_REVIEW).
CONTRACT: planning/specs/tickets/internal-task-flow-53.md (revision 3).
ROLE: developer (DeepSeek through Cline); Delivery Lead: ChatGPT/Codex.
ISSUE: https://github.com/1am-it/menucard/issues/53
PR: https://github.com/1am-it/menucard/pull/56 (existing draft; no second PR).
BRANCH: feat/compact-source-flow-53.

## Saved Commit And Remote

- Round commit: `726d8024789e8ce9e6f0dc120f527ca6960ada0e`.
- Remote `origin/feat/compact-source-flow-53` verified at the same commit after
  `git fetch`.
- Base: `74b0cb2` (prepared handoff on top of main `fc12bbc`).
- No merge, publication, production action or source activation was performed.

## Delivered Outcome

Werkvoorraad now renders one list of concrete human tasks instead of the five
module-navigation cards. Each row shows restaurant/item, task, why attention is
needed, optional context/date and exactly one next action.

New pure model: `src/lib/internalWorkqueue.js` (CommonJS, tested).

Providers (existing read-only APIs only):

| Provider | Task | Exact destination |
| --- | --- | --- |
| menu-concepts | waiting review; approved publication (export-aware) | `/internal/menu-concepts/[id]` |
| source-workqueue | source/identity check or manual menu review | `/internal/source-workqueue?restaurant=<id>` (adapter added) |
| source-triage | open source proposal | `/internal/source-triage?restaurant=<id>` (adapter added) |
| import-candidates | new, needs-enrichment, approved-without-draft | `/internal/import-inbox?run=<id>&candidate=<id>#candidate-<id>` (adapter added) |
| profile-drafts | active prepared draft | `/internal/profile-drafts#draft-<id>` (adapter added) |
| moderation (editor only) | pending field change | `/internal/moderation#pending-<id>` (adapter added) |
| claims (editor only) | owner claim | `/internal/moderation#claim-<id>` (adapter added) |

Duplicate rules implemented and tested:

- same stable record renders once;
- a ready source row plus a menu concept for the same restaurant is one review
  step — the concrete concept wins;
- an open source proposal replaces the generic source-check row for that
  restaurant;
- a candidate with an active profile draft is covered by that draft, not twice;
- distinct records/steps (different restaurant, source check next to a menu
  review, proposal next to a menu review, same-name candidates with different
  ids) stay independent.

Honest states implemented: true empty, per-provider partial (never "all done"),
all-providers error, retry. Editor-only accounts never receive internal tasks
and vice versa; owner-only gets no task data.

Publication handling: the existing menu-concepts list now includes the latest
stored export row (read-only select, no GitHub refresh, no write). A merged
export is not a task; pending/opened/failed/closed exports show their real
stored status. No new export, PR, merge or publication is triggered by opening
a task.

## Evidence

- `node --test src/lib/internalWorkqueue.test.js src/lib/menuConceptReviewHandlers.test.js`
  : 38 pass.
- `npm test` : 1897 pass, 0 fail (includes the updated
  `src/lib/internalNav.test.js` structural check for the new page).
- `npm run build` : success (Next.js 15.5.15); `/internal/workqueue` built at
  6.34 kB route size.
- Structural tests assert: no module cards on Werkvoorraad, no direct Supabase
  access from the page, all five deep-link adapters present, partial/error/empty
  copy present, merged exports excluded.

## Acceptance Matrix For This Round

| Contract row | Round-1 evidence | Status |
| --- | --- | --- |
| Open Werkvoorraad: actual pending items, zero module cards | concrete task list + structural test | Implemented; no browser screenshot yet |
| Inspect a pending menu: one click to exact concept | exact concept href + model test | Implemented; click path not browser-verified |
| Finish internal review / publication readiness | waiting concepts open exact detail; approved concept opens exact publication controls | Partly implemented; full readiness/click-count acceptance is a later round |
| Existing export | stored export status shown; merged excluded; no duplicate export | Implemented (read-only); GitHub refresh still only on concept detail |
| Review source/proposal/candidate/draft/claim | exact-record deep links for each provider | Implemented and tested structurally |
| Beheer > four sections | not started | Later round in same contract |
| No tasks / provider failure | empty/partial/error states, no fake zero | Implemented and unit-tested |
| Role boundaries | internal vs editor vs owner filtering | Unit-tested; server gates unchanged |
| Mobile/keyboard | responsive CSS breakpoint, focus-visible styles, native links | Implemented; not visually verified |

## Known Limitations

- No live Preview/browser walkthrough or screenshots were possible in this
  checkout; preview credentials were not available and were not copied from the
  original checkout.
- Publication readiness is derived from stored export data, not freshly
  re-checked against GitHub on the list page. The concept detail keeps its
  existing refresh behaviour.
- Beheer's four sections, reachability of the five complete module indexes and
  the shorter publication navigation are explicitly later rounds. Until then
  those indexes are reachable through task links and direct URLs, not through
  module cards.
- The source-workqueue deep link narrows by restaurant name; identical names
  could show more than one row, but the exact target row still opens expanded.
- Import candidates are fetched per pending review status; each endpoint's own
  bound (2000) and server-side role gate are unchanged.

## Remaining Work And Next Safe Step

1. Round 2 of the approved contract: Beheer's four sections and reachability of
   existing features.
2. Then the shorter publication navigation and full acceptance-matrix evidence.
3. Run the live Preview acceptance (screens and click paths, including roles,
   empty/partial states and 320/390 widths) when access is provided.

Do not mark READY_FOR_REVIEW after this first round. Nothing in this checkpoint
authorizes a merge, workflow change, migration, production action or
publication.
