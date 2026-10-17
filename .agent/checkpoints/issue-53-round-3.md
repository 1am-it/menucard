# Issue 53 - Round 3 Checkpoint

STATE: BUILDING (rounds 1-3 delivered; required browser acceptance still open,
not READY_FOR_REVIEW).
CONTRACT: planning/specs/tickets/internal-task-flow-53.md (revision 3).
ROLE: developer (DeepSeek through Cline); Delivery Lead: ChatGPT/Codex.
ISSUE: https://github.com/1am-it/menucard/issues/53
PR: https://github.com/1am-it/menucard/pull/56 (existing draft; no second PR).
BRANCH: feat/compact-source-flow-53.

## Saved Commit And Remote

- Round code commit: `f309d98e51188daca9ed8c21df6954cb6231ff32`.
- Remote `origin/feat/compact-source-flow-53` verified at the same commit after
  `git fetch`; this checkpoint document is committed on top of it.
- No export PR, merge, production action, migration, workflow change, source
  activation or publication was performed.

## Delivered Outcome

The user-facing flow is now exactly **Importeren -> Controleren -> Publiceren**.
The old `Klaarzetten voor publicatie` progress label and profile-draft
publication wording are gone; a profile draft remains an internal concept, not
a separate publication phase.

### Proven publication readiness

New pure rule `src/lib/menuConceptPublication.js` derives readiness from the
existing gates, never from a stored export:

- latest current concept version;
- internal approval;
- no current blockers;
- source confirmed and not blocked;
- same content not rejected before;
- no unsaved corrections;
- GitHub integration configured.

`Klaar voor publicatie` and the task action `Publiceren` are shown only when
every check passes and no export exists yet. The concept detail displays the
same checklist. Any failed check shows the concrete reason and an action that
opens the existing concept controls, never an optimistic readiness claim.

Workqueue's publication task now opens the exact concept at
`/internal/menu-concepts/<id>#mcr-publication`; the detail page focuses that
existing publication card after it renders. Opening the link performs no write:
the detail GET uses a new read-only export lookup (stored row plus read-only
GitHub PR state, no database update).

Export states are represented honestly:

- pending/opened -> `Review-PR open` / `wordt aangemaakt`; `Bekijk publicatie`;
- failed/closed -> real failure/closed reason; explicit `Maak review-PR` remains
  available only when all gates still pass;
- merged -> not open work and never called live. The detail says explicitly:
  merged is not automatically live; production publication is only confirmed
  after a successful deployment, which this app does not confirm.
- A stored export alone never creates readiness.

### Existing export safety preserved

`Maak review-PR` remains explicit and server-guarded: internal role only, latest
approved version, no blockers, confirmed/unblocked source, no prior rejection,
no stale base, one complete menu scope, GitHub configured, idempotent reuse of
an existing PR, one-open-export-per-restaurant protection and retry after a
failed attempt. The existing regression tests for idempotency, duplicate
protection, GitHub failure and scope still pass.

## Evidence

- `npm test`: **1927 pass, 0 fail**.
- `npm run build`: **success**; `/internal` 8.95 kB, `/internal/workqueue`
  6.56 kB, `/internal/menu-concepts/[id]` 1.49 kB.
- New/updated focused tests:
  - `menuConceptPublication.test.js` — every gate, blocked reasons, active /
    failed / closed / merged states, no export-as-proof;
  - `menuConceptReviewHandlers.test.js` — list/detail readiness, missing GitHub
    integration is not ready, detail GET writes nothing;
  - `menuConceptExport.test.js` — read-only export status does not mutate the
    stored row;
  - `internalWorkqueue.test.js` — `Publiceren` only for ready, blocked/active
    states explicit, exact anchor;
  - `menuConceptReviewSurface.test.js` — readiness UI, deployment wording, no
    write in navigation;
  - `batchAnalysis.test.js` — exact three labels.

## Full Acceptance Matrix After Round 3

| Contract row | Evidence in this branch | Status |
| --- | --- | --- |
| Open Werkvoorraad: actual pending items, zero module cards | round-1 task list + tests | Implemented; browser screenshot/click path still open |
| Inspect a pending menu: one click to exact concept | exact concept hrefs + tests | Implemented; browser click path still open |
| Finish internal review: approved/export-eligible concept is `Klaar voor publicatie`; no extra prepare/approve task | derived rule + detail checklist + Workqueue `Publiceren`; no separate phase labels | Implemented and unit-tested; browser click path still open |
| Ineligible concept shows the real reason, never misleading readiness | blocked reasons from version/approval/blockers/source/rejection/save/GitHub; tests | Implemented |
| Open publication: `Publiceren` opens exact concept's existing controls; no write on navigation | anchor `#mcr-publication`, focus effect, read-only detail export lookup; tests | Implemented; browser click path still open |
| `Maak review-PR` explicit, existing rights, PR reuse, duplicate protection | existing server/export tests unchanged plus read-only export test | Implemented; live GitHub export not executed (prohibited) |
| Open/merged/closed export uses real status, no second publication task | active/failed/closed/merged states; merged excluded from tasks; tests | Implemented |
| Merged is not automatically live | explicit deployment wording; no live claim | Implemented; actual deployment status is not available in-app |
| Existing export reused, no duplicate | idempotent/duplicate regression tests | Implemented; not live-executed |
| Review source/proposal/candidate/draft/claim | exact-record deep links from rounds 1-2 | Preserved; browser click paths still open |
| Open Beheer: four sections, direct content, no link-only hub | round-2 section implementation + structural tests | Preserved; browser screenshot still open |
| Find restaurant/source under Beheer | round-2 records + selected details/history | Preserved; browser check still open |
| Find an earlier import | round-2 URL batches vs dataset runs, exact links, bounds | Preserved; browser check still open |
| Find a decision | round-2 concepts/decisions/drafts, exact links | Preserved; browser check still open |
| Unknown restaurant | existing contextual Onboarding flow unchanged | Unchanged |
| No tasks / provider failure | Werkvoorraad partial/error/empty; Beheer per-provider states | Implemented and unit-tested |
| Different staff role / nonstarter | internal/editor/owner matrix; server gates unchanged | Unit/structural tested; live role check still open |
| Mobile and keyboard | responsive CSS, native links/buttons, focus-visible; publication hash focus | Implemented; browser check at 320/390 still open |
| Light/dark | existing theme tokens; new readiness banners use existing token classes | Implemented; visual check in both themes still open |
| No separate `Klaarzetten voor publicatie` phase | IMPORT_STEPS exactly `Importeren/Controleren/Publiceren`; profile labels changed; tests | Implemented |
| No production action / merge / export PR | no prohibited action executed | Respected |

## Known Limitations And Open Acceptance

- **No live Preview/browser acceptance or screenshots** were possible in this
  checkout. Keyboard operation, light/dark and 320/390 px against mockup v3
  remain unverified; preview credentials were not available and were not copied
  from the original checkout. This is required before `READY_FOR_REVIEW`.
- Readiness is a pre-export display state. It checks the available concept,
  source, blocker and integration gates; the explicit `Maak review-PR` action
  still performs the existing live GitHub base/staleness and menu-scope checks.
  A readiness label never promises that the export call itself will succeed.
- On detail navigation, an opened PR's state is read from GitHub read-only; if
  GitHub is unavailable the stored status is shown honestly. No database write
  occurs on navigation.
- The app has no deployment feed. A merged PR is therefore never presented as
  live; only the separate production deployment can confirm that, outside this
  app's evidence.
- Import-history bounds remain those of the existing APIs (recent batches and
  recent runs); older records stay stored but outside the bounded list.
- Beheer shows the latest version per concept lineage; full version history
  remains in the existing concept detail.
- The intentional round-1 duplicate rules remain: same-step source rows are
  replaced by their concrete record, while identity questions, independent
  source problems, distinct proposals/concepts and distinct editor records stay
  visible.

## Review Handoff

Next owner: **AI Delivery Lead (ChatGPT/Codex) for independent review** of
rounds 1-3. The Delivery Lead should first complete the required live browser/
Preview acceptance (screens and click paths, roles, empty/partial states,
keyboard, light/dark, 320/390) and verify the exact approved v3 reference. Do
not mark `READY_FOR_REVIEW` while that acceptance is missing. The Product Owner
retains release/merge authority; this checkpoint grants no production action.
