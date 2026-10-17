# Issue 53 - Delivery Review And Preview Acceptance

Date: 2026-10-17. Reviewer: ChatGPT/Codex, Delivery Lead.
STATE: BUILDING - substantial acceptance completed, remaining checks below.
Reviewed developer handoff: 3f56f9019b65c9617dd1060e34976ed861d690ad.
First review fixes: ad26fa82bf63d7a4c687d4e1017ca9874daa1305.
Contract: planning/specs/tickets/internal-task-flow-53.md, approved v3.
PR: https://github.com/1am-it/menucard/pull/56 (same draft, no second PR).

## Findings And Repairs

1. Waiting menu-review tasks also targeted #mcr-publication. They now open the
   exact concept at its review entry; only approved publication tasks use the
   publication anchor. Model regression verifies the distinct destinations.
2. Source-workqueue deep links narrowed by restaurant name, so namesakes could
   remain mixed. They now additionally filter by unique restaurant ID. Editing
   the search field releases that exact selection. A namesake regression covers
   exact ID, missing ID and ordinary free search.
3. Selecting a Beheer restaurant rendered details below the whole list without
   moving keyboard focus. The detail heading now receives focus and scrolls
   into view. Verified with Enter in the real 320px preview.
4. An already rejected current concept could pass the previous-content guard
   because that helper excluded the current version. The current rejected
   version now counts as rejection evidence too. Detail exposes that blocker,
   and approval returns 409 previously_rejected without an RPC/write. Changing
   actual content remains the existing route to a new reviewable version.

The reviewer implemented these repairs as an explicitly combined review/repair
role. They are not a claim of a second independent reviewer of those repairs.
The underlying DeepSeek changes were reviewed independently of their author.

## Technical Evidence

- Full suite after all repairs: 1930 tests, 1928 pass, 0 fail, 2 skipped.
  The two skipped integration cases require Docker/GDAL. No skip was added.
- Focused source/task tests: 71 pass. Concept-review/export tests: 30 pass.
- Structure tests: 6 pass. Corpus v1.1.0: 24 pass, 0 fail, 1 known unclassified
  case (STRUCT-018, JSON-LD hierarchy), not a newly introduced failure.
- Final production build: pending verification in this review checkpoint.
- git diff --check clean; no .github/, data/ or supabase/ diff against main.
- An initial restricted-network run failed on local test connections. With
  network permission the actual full suite passed; those failures were not
  hidden or "fixed" by weakening tests. A build retry is run separately after
  a Windows-generated-directory EPERM rather than called successful.

## Actual Preview Evidence

Existing authenticated internal preview session reused. No password/token was
read, copied or changed. No new access or account was created.

| Scenario | Actual observation | Scope |
| --- | --- | --- |
| Werkvoorraad | Two real source-review tasks; no five module cards; one action per task | Authenticated internal account |
| Source task | One click selects Blossem ID 2 and expands its existing guidance panel | Real preview, mobile 390 and desktop 1280 |
| Beheer overview | Real coverage immediately rendered, four secondary links, methodology caveat | Real preview |
| Restaurants | 25 records, search to Blossem, exact source URLs, status and history | Real preview |
| Keyboard selection | Enter selects record; detail heading receives focus and scroll | Repaired preview, 320px dark |
| Import history | URL batches separated from dataset imports; exact batch hrefs; bounds explained | Real preview; dataset history empty |
| Decisions | Latest Zuyd concept, source decisions, empty profile-history state | Real preview |
| Concept detail | Exact existing Zuyd version, review tabs and public/current preview switch accessible | Read-only; rejected legacy test content not approved |
| Compact phases | Importeren / Controleren / Publiceren on website import | Real preview, no import submitted |
| Partial data | Temporarily blocked source-triage GET shows explicit partial banner while real tasks remain | Browser-only fault simulation, removed afterwards |
| Retry | Restored network and Opnieuw laden clears partial banner | Real preview, GET only |
| Layout | No document overflow in inspected 320/390/1280 views; light/dark inspected | Not a claim that every combination was exercised |
| Read-only navigation | Captured own-origin internal navigation requests were GET only | Observed requests, not proof for every possible route |

Local screenshots are stored outside the app repository in the sibling
menucard-review-53-evidence folder: concept-320-light/dark, beheer-320-dark,
restaurant-320-dark, workqueue-390-light/dark, source-390-light,
source-1280-light and workqueue-partial-1280. Screenshots are evidence, not
production content; they are not copied into the public app.

## Remaining Acceptance And Honest Boundaries

- No live editor-only, owner-only or second-starter session was provisioned.
  Role filtering and server refusal are covered by automated tests, not a
  claimed multi-account browser walkthrough. No permissions were expanded.
- The available preview has no eligible approved concept with a configured
  export integration. Full ready/opened/closed/merged publication browser
  transitions and #mcr-publication focus still require representative authorized
  data. Server/model tests cover them; no export PR was created for evidence.
- Candidate/profile/claim direct links have model/structural evidence; no
  representative live records were created merely to satisfy the matrix.
- A merged export never proves production deployment. There is no deployment
  feed, and adding one remains outside this contract.
- Stored export status on list views can lag GitHub; detail checks GitHub
  read-only. A network failure falls back to the stored value. No claim of
  continuously refreshed list status or confirmed production availability.
- No migration, workflow change, source activation, real concept decision,
  export PR, merge, production action or publication performed by this review.

## Next Owner

Delivery Lead retains acceptance ownership. Keep BUILDING/draft until the
remaining required browser scenarios are evidenced or the Product Owner
explicitly accepts a documented limitation. No new feature-build round is
needed merely to collect that evidence. Record the final remote head and
actual build outcome in issue #53 / PR #56 after saving this checkpoint.
