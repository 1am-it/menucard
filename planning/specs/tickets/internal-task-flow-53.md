# Internal Task Flow - Issue 53, Revision 3

## Status And Authority

2026-10-17: **BUILDING - revision 3 approved for implementation**.
The Product Owner explicitly approved revision 3 in chat: "ok akkoord om te
bouwen". Issue #53 records that approval against reference commit
f8b44abd64e8085737e5dad6b225eaf5aef1efc3. This handoff preparation does not
claim the requested screen changes are built or accepted.
PR #56's green technical checks do not establish product acceptance.

- Live contract: https://github.com/1am-it/menucard/issues/53
- Existing delivery branch/PR: https://github.com/1am-it/menucard/pull/56
- Shared design rules: `docs/guides/design-reference.md`.
- Proposed reference: `docs/mockups/internal-task-flow-v3.html`.
- Previous proposals v1/v2 are historical, not retroactively approved.

The design gate is satisfied. Continue only the approved contract in PR #56
after the isolated handoff; do not start competing Claude/DeepSeek writers.
No production, credential, migration, public-data, merge or release authority
is granted by this documentation or the design approval.

## User Outcome

An employee sees the actual work that needs attention and opens the specific
item in one click. They never choose a technical module before seeing work.
Administration contains the existing overview, records and history without a
single-link landing page. Existing capabilities remain reachable.

Primary navigation remains `Werkvoorraad | Nieuwe import | Beheer`.

### Three User-Facing Phases

The compact flow is **Importeren -> Controleren -> Publiceren**. These are
three phases, not a promise that all required checks take exactly three clicks.
There is no separate `Klaarzetten voor publicatie` phase, task or approval.

- **Importeren**: use the existing website import and its existing safeguards.
- **Controleren**: inspect the source/menu, resolve attention points and use
  the existing explicit source, save and internal-decision controls. Group
  these within the review experience; do not silently confirm/save/approve
  or remove required human decisions to reduce the visible phase count.
- **Publiceren**: an approved, export-eligible concept is `Klaar voor
  publicatie`; its task action `Publiceren` opens that exact concept's existing
  publication controls directly, never a preparation screen or module index.
  The action itself neither creates a PR nor publishes. `Maak review-PR`
  remains explicit and guarded; afterwards show `Review-PR openen` and the
  real status. A human still merges in GitHub; only a successful production
  deployment makes the new menu live. No new in-app merge or automatic export.

An approved concept that fails a source/blocker/version/integration check
must show the actual reason, not misleadingly claim publication readiness.
An open/merged/closed export is represented with its existing real status,
not offered as a second new publication task. Readiness is a derived display
state, not a new stored workflow state or a migration.

## Capability Inventory And Destinations

| Capability | Existing evidence | Target destination | Boundary |
| --- | --- | --- | --- |
| Source checks and source/menu states | `/internal/source-workqueue`; GET `/api/internal/v1/source-workqueue` | Actionable items in Werkvoorraad; records under Beheer > Restaurants en bronnen | Keep the two source/menu status dimensions; a never-checked restaurant is not a new intake |
| Source proposals and decisions | `/internal/source-triage`; source-triage handlers/API and events | Pending decisions in Werkvoorraad; decisions remain inspectable under Beheer | Link to the exact restaurant/proposal, not the unfiltered module index |
| URL imports, results, retry/reanalysis | `/internal/nieuwe-import`; batch-analysis handlers/API | Input in Nieuwe import; actionable results in Werkvoorraad; earlier batches in Importhistorie | 1-10 URLs and 25/day unchanged; processing/confirmation/save still starter-only |
| Dataset/source import runs and candidates | `/internal/import-inbox`; GET import-inbox/runs and candidates | Candidate decisions in Werkvoorraad; runs in Importhistorie | Separate run type from URL batches; do not imply the CITY-0 URL engine exists |
| Menu concepts and version/review history | `/internal/menu-concepts/[id]`; GET menu-concepts, decision/version/export routes | Pending review/publication in Werkvoorraad; recorded concepts/decisions under Beheer | Latest-version, blockers, source and idempotency checks unchanged; no separate preparation stage |
| Restaurant profile drafts | `/internal/profile-drafts`; GET profile-drafts includes active/discarded records | Genuine pending draft action in Werkvoorraad; draft history under Beheer | No invented canonical editing, promotion, export or publication capability |
| Field changes and owner claims | `/internal/moderation`; moderation/pending and claims/pending APIs | Editor-only item-level tasks in Werkvoorraad | Internal is not editor; owners do not gain staff access |
| Coverage and restaurant/menu data presence | `/internal/coverage`; GET coverage | Beheer > Overzicht (default, directly rendered) | Preserve computation and caveats; data presence is not completeness/verification |
| Canonical restaurant editing | No general restaurant CRUD page/API in this inventory | Not added implicitly | Restaurants en bronnen is an existing-data overview, not a new free-form editor |
| User and role administration | Staff roles and auth exist; no application administration UI or admin-role gate | Future Beheer capability, explicitly unavailable in this revision | No fake link, Supabase admin shortcut, default internal privilege escalation or credential UI |

## Screen Contract

### Werkvoorraad

- Default staff landing page; one list of concrete items, not module cards.
- Each row shows restaurant/item, task, why attention is needed, and exactly
  one enabled next action when the actor is authorized. Context/age may be
  secondary. No raw technical origin is needed to choose the action.
- The action opens the specific item, preselected and expanded if its legacy
  screen needs a deep-link adapter. A link to an unfiltered queue is not done.
- Existing detail/decision components are reused; no second review engine.
- A source result, proposal and concept representing the same next step are
  not three duplicate tasks. Distinct independent menu/profile/claim tasks are
  not silently merged. Stable identity and explicit precedence need tests.
- Show real human work only. Completed/rejected items belong in history;
  a technical job running by itself is not a review task. A starter-owned
  import needing its open page may offer `Hervat import` when truly applicable.
- Editor and internal tasks respect their existing gates. A colleague cannot
  receive the starter's confirm/save/process action, or their identity.
- No open work: a true empty state, not links to modules or invented counts.
- Partial/unavailable providers: explicit partial/error state, never `Alles
  klaar`. Count the shown/available tasks honestly; preserve query limits.
- Counts, timestamps and priorities come from data, never mockup literals.

### Nieuwe import

- Keep `Websites importeren`, one input and `Import starten` for 1-10 URLs.
- No single/batch mode choice and no global Onboarding Restaurant shortcut.
- Existing result review and fresh reanalysis remain reachable. Saved concepts
  open directly. Linking an unknown restaurant is contextual to that item.
- Progress labels are exactly `Importeren -> Controleren -> Publiceren`;
  no four-step rail and no separate publication-preparation step.
- No import-engine, fetch, AI/OCR, daily-limit or cache-policy changes here.

### Beheer

Opens real content immediately, with secondary navigation:

1. **Overzicht**: existing Dekkingsoverzicht, the default view.
2. **Restaurants en bronnen**: existing restaurant/source records and their
   current states; a selected record exposes its existing source/details/history.
3. **Importhistorie**: earlier URL batches AND existing dataset/source runs,
   clearly distinguished, with result/error details and honest bounds.
4. **Concepten en besluiten**: recorded menu concept versions/reviews, source
   decisions and profile-draft history that the existing permissions expose.

These are views over existing capabilities, not four new backend products.
Pending work can be linked from a record, but no second daily workqueue is
rendered in Beheer. Old URLs remain compatible and preserve orientation.
An editor-only account gets no internal-only administration data or empty
administration hub; show its permitted existing history only if available,
otherwise keep Werkvoorraad as the useful entry point.

`Gebruikers en rechten` is an identified missing capability, not a working
navigation tab. Building it requires a separate security/product contract.
It is shown as unavailable in the proposed Beheer reference, not a dead button.

## User Scenarios And Acceptance Matrix

| Scenario | Observable acceptance | Reference |
| --- | --- | --- |
| Open Werkvoorraad | Actual pending restaurant/items visible immediately; zero module cards | Mockup Werkvoorraad |
| Inspect a pending menu | One task click opens that exact concept/result, not a list to search again | Menu task detail |
| Finish internal review | Export-eligible approved concept reads `Klaar voor publicatie`; no extra prepare/approve task; ineligible concepts show the real reason | Three phases + publication detail |
| Open publication | `Publiceren` opens that exact concept's publication controls; no write on navigation; `Maak review-PR` remains explicit; no automatic merge/publication | Publication detail + safety tests |
| Existing export | Existing PR/status is reused; no duplicate export, no live claim before successful production deployment | Publication status + idempotency tests |
| Review a source/candidate/profile/claim | Exact authorized record opens; no previously available capability is lost | Inventory + provider-specific tests |
| Open Beheer | Coverage content visible after one main-nav click; no page with just a coverage link | Beheer > Overzicht |
| Find restaurant/source | Existing records and separate source/menu states visible under Beheer | Beheer > Restaurants en bronnen |
| Find an earlier import | URL batch versus dataset run identifiable; open the exact existing result | Beheer > Importhistorie |
| Find a decision | Stored status, version and available audit remain inspectable; no silent new version | Beheer > Concepten en besluiten |
| Unknown restaurant | Linking/details offered from that specific import/task only | Contextual task detail |
| No tasks / provider failure | Honest empty versus partial/error state; no fake zero/all-done | Required state checks |
| Different staff role / nonstarter | No unauthorized read or action; direct server request also refused | Role matrix |
| Mobile and keyboard | Same destinations/actions at 320/390 and desktop in both themes; focus usable, no overflow | Responsive reference + browser evidence |

## Verification And Release Gate

Before `READY_FOR_REVIEW`, map every acceptance row to a test/screenshot or
an explicitly documented limitation. Compare the actual candidate with the
exact approved mockup version, screen AND click path. Include old-link and
role regression tests. Green route/unit/build checks alone do not close UX
acceptance. New mockup examples must remain fictional.

The pending approval covers the information architecture and click paths, not
every illustrative count or the public data. No migration, workflow, secret,
production action, automatic source activation, export/merge or publication
is authorized. Preview writes still require their own existing task approval.

## Delivery Steps After Approval

1. Record approval on #53 and pin the reference path and commit/version.
2. Implement unified tasks, direct item opening and Beheer views in PR #56.
3. Update the role/deep-link/status tests and run relevant suite/build checks.
4. Verify the acceptance matrix on isolated Preview, including partial/empty
   states and actual click counts. Reuse existing source/concept safeguards.
5. Report product acceptance separately from technical checks; leave release
   approval to the Product Owner. Never close a missing capability by hiding it.
