# BE-24 — Internal source triage (Brontriage) v1

## Status

The schema is live; the app is not released. BE-24 ships as two
separate releases (see "Release sequencing"):

1. **Schema release** (done): migration `0015`, its structural test
   (`src/lib/sourceTriageMigration.test.js`) and the release-gate
   alignment in `.github/workflows/production-db-migrate.yml`. `0015`
   was applied to production and verified on 2026-10-08.
2. **App release** (not released): the API routes, the Brontriage page,
   the internal navigation entry and the mockup. It is merged and
   deployed only after its own independent review and an explicit merge
   approval.

The sections "Routes", "Next step per restaurant" and "Design" below
specify the app release; nothing in them shipped with the schema
release.

## Goal

BE-23's Bronwerkvoorraad is a safe, read-only overview. Brontriage makes
it usable for editors: per restaurant, an internal staff member can see
the source situation and record a **proposal** about the source, which a
staff member then explicitly accepts or rejects. Nothing is fetched,
analysed or published by any of this.

Per restaurant the page shows:

- the source status (BE-23's Bron and Menukaart, unchanged), or why the
  restaurant is not in the workqueue yet (BE-23's reasons);
- why the source needs attention;
- the known source URL (`data/restaurants.json` `website`);
- when the last usable check happened (BE-23's "Gecontroleerd");
- the one safe next step;
- open and decided proposals, with their audit trail.

## Non-goals (v1)

- No automatic fetch, crawl, analysis job, OCR, AI or provider call — not
  on proposing, not on accepting. A proposed URL is validated as text
  only and never requested.
- No publication and no change to any published dataset. Accepting a
  proposal records a human decision; it does **not** change
  `data/restaurants.json`, a menu, a profile draft, a URL intake or an
  analysis job. Applying an accepted proposal to the published data is a
  separate, later step (see "Follow-up phases").
- No public form, anonymous account, photo upload or file storage.
- No change to BE-23's classification, BE-20's analysis, BE-22's
  benchmark, public routes, SEO, reservation logic, auth flow,
  dependencies or production configuration. The schema release's only
  workflow change was the release gate for `0015`: the two documented
  version lists in `production-db-migrate.yml` (applied `0001`–`0014`,
  release `0015`), following the earlier "align production migration
  workflow" commits. The app release changes no workflow.
- No bulk actions, no notifications, no counts in the navigation.

## Three separate things

| | What it is | Where it lives | Who starts it |
|---|---|---|---|
| **Bronvoorstel** (this ticket) | A recorded proposal about which URL is a restaurant's source, plus a human accept/reject decision | `source_triage_proposals` + `source_triage_proposal_events` (0015) | An internal staff member, by hand |
| **Broncontrole** | Reading a source and classifying it | BE-20 analysis jobs (0014), shown by BE-23 | An internal staff member, by hand, in Onboarding Restaurant |
| **Publicatie** | Changing what visitors see | The published restaurant/menu data | A separate, explicit step — not built here |

An accepted proposal never starts a Broncontrole and never publishes. The
page says so literally: **"Wijzigingen worden pas na controle verwerkt."**

## Proposal kinds

| `kind` | Label | Requires | Allowed when |
|---|---|---|---|
| `add_candidate` | URL toevoegen als kandidaatbron | `proposed_url` | Always |
| `replace_source` | Bron vervangen | `proposed_url`, differs from the known source | A known source URL exists |
| `mark_unusable` | Bron markeren als onbruikbaar | `unusable_reason` (fixed list) | A known source URL exists |

Unusable reasons (fixed list, so no free-text personal data is needed):

| Code | Label |
|---|---|
| `site_offline` | Website niet meer online |
| `other_business` | Website hoort bij een andere zaak |
| `no_menu_on_source` | Geen menukaart op deze bron |
| `access_blocked` | Website staat automatisch lezen niet toe |
| `other` | Andere reden (toelichting verplicht) |

A short note (at most 280 characters) is optional, and required for
`other`. The form tells the user not to write personal data in it.

`no_menu_on_source` is a human observation recorded on a proposal. It is
**not** fed into BE-23's `Geen menukaart aangetroffen`: that status keeps
needing the explicit evidence field BE-23 describes ("Datamodelkloof").

## Proposal statuses and transitions

| Status | Label | Status role (Kleurtaal v2) | Icon |
|---|---|---|---|
| `open` | Wacht op controle | neutral | clock |
| `accepted` | Geaccepteerd | positive | check |
| `rejected` | Afgewezen | neutral | cross |

Allowed transitions — and only these:

- `open → accepted` (optional note);
- `open → rejected` (note required: the reason).

`accepted` and `rejected` are final. A changed mind is a new proposal.
At most one `open` proposal per restaurant (partial unique index): a
second proposal waits until the first is decided.

`--status-action` ("Actie nodig") is deliberately not used: Kleurtaal v2
reserves it until a product decision assigns it.

## URL validation (text only, never fetched)

`validateProposedUrl` in `src/lib/sourceTriage.js`, server-side and
mirrored in the form:

- a string of at most 2048 characters without whitespace or control
  characters;
- an explicit `http://` or `https://` scheme (no guessing);
- no user name or password;
- no explicit port;
- a host name, not an IP literal; not `localhost`; at least two labels;
  only letters, digits and hyphens per label (international names arrive
  as `xn--`); a top-level label of letters (or `xn--`);
- not a special-use or internal top-level domain (`localhost`, `local`,
  `internal`, `invalid`, `test`, `example`, `onion`, `arpa`, `home`,
  `lan`, `corp`);
- stored canonical: scheme, lower-case host and path. **Query string and
  fragment are dropped** (same data minimisation as BE-19's
  `canonical_source_url`); the form shows the stored form before saving.

## Roles and authorization

- Every route calls `authenticateInternalRequest` and then requires
  `isInternalOnly` (the `internal` staff role) **before** parsing the
  body, validating input or creating a database client. A missing,
  invalid or non-internal session gets `401`/`403` with zero database
  calls. This is tested behaviourally with an injected client in
  `src/lib/sourceTriageHandlers.test.js` (no session, expired session, no
  staff role, `editor`, `owner` and `editor` + `owner`, for all three
  routes).
- Proposing, accepting and rejecting all need `internal`. `editor` and
  `owner` alone are refused, as for every other Data-inbox route.
- The actor is always the authenticated user id from the server, never a
  value from the request body.
- Self-review is allowed in v1: the same person may propose and decide.
  The page marks it ("Je beoordeelt je eigen voorstel."). A future
  second-person rule is a separate product change.
- The database is defence in depth: RLS on, no policies, writes only
  through two RPCs (see "Privilege model").

## Audit trail

- `source_triage_proposals` keeps who proposed (`proposed_by`, `proposed_at`)
  and who decided (`decided_by`, `decided_at`, `decision_note`). Only
  `status`, `decided_by`, `decided_at` and `decision_note` are updatable,
  and only by the decision RPC, only from `open`.
- `source_triage_proposal_events` is append-only (no update or delete
  grant): one `proposed` event on creation and one `accepted`/`rejected`
  event on decision, written in the same transaction as the change.
- No row is ever deleted. The page shows every proposal of a restaurant
  with its events ("Geschiedenis").

## Privacy

- Stored: restaurant id (the `data/restaurants.json` key), the canonical
  URLs, a fixed reason code, short notes, and staff user ids with
  timestamps. No names, e-mail addresses, IP addresses, user agents,
  page content or screenshots.
- The API shows staff only as "jij" or a short, non-identifying reference
  (the first 8 characters of the user id), never a name or e-mail.
- Notes are capped at 280 characters, and the form asks not to enter
  personal data.

## Data model (migration `0015_be24_source_triage.sql`)

- `source_triage_proposals` — one row per proposal; `id` is a UUIDv7
  generated by the application (0010/0013 convention). Symmetric checks:
  a URL exactly for `add_candidate`/`replace_source`, a reason exactly
  for `mark_unusable`, a known `current_url` for `replace_source` and
  `mark_unusable`, a note for `other`, decision columns set exactly when
  not `open`, a note for `rejected`. URL columns repeat the 0013 shape
  check (`^https?://`, no `?`/`#`/whitespace, at most 2048 characters).
- `source_triage_proposal_events` — append-only audit rows; its id comes
  from the identity sequence `source_triage_proposal_events_id_seq`.
- `create_source_triage_proposal(...)` and
  `decide_source_triage_proposal(...)` — `security invoker`, fixed
  `search_path`, EXECUTE for `service_role` only. Typed errors: `P0030`
  (an open proposal already exists), `P0031` (proposal not found or not
  open), `P0032` (rejection without a note), `P0033` (invalid decision).
- The restaurant id is not a foreign key: restaurants live in
  `data/restaurants.json`, not in the database. The API checks that the
  id exists there before writing.

## Privilege model (migration `0015`)

Supabase's default privileges in schema `public` grant rights on every
new table, sequence and function directly to `anon`, `authenticated` and
`service_role` — not through `PUBLIC`. A revoke from `PUBLIC` alone would
leave them in place. `0015` therefore:

- revokes both tables from `public`, `anon` and `authenticated`, and
  separately from `service_role`;
- revokes the sequence `source_triage_proposal_events_id_seq` from
  `public`, `anon`, `authenticated` and `service_role`;
- revokes both RPC functions from `public`, `anon`, `authenticated` and
  `service_role`;
- then grants `service_role` exactly this, and nothing else:
  - SELECT and INSERT on `source_triage_proposals`, plus UPDATE on its
    four decision columns (`status`, `decided_by`, `decided_at`,
    `decision_note`);
  - SELECT and INSERT on `source_triage_proposal_events`;
  - USAGE on the events sequence (no SELECT, no UPDATE);
  - EXECUTE on `create_source_triage_proposal` and
    `decide_source_triage_proposal`;
  - USAGE on schema `public`.

No GRANT ALL, no DELETE, no TRUNCATE, no policies, no default-privilege
change. Both functions stay `security invoker` with `search_path = public`.
`anon` and `authenticated` can therefore not read, write or execute
anything this migration creates.

## Routes (app release, all internal)

- `GET /api/internal/v1/source-triage` — read only: BE-23's workqueue
  (same queries, same classifier, unchanged) plus the proposals and their
  events. No outbound fetch.
- `POST /api/internal/v1/source-triage/proposals` — creates a proposal
  via the RPC.
- `POST /api/internal/v1/source-triage/proposals/[id]/decision` —
  accepts or rejects via the RPC.
- `/internal/source-triage` — the page, reachable under `Werkvoorraad` →
  `Brontriage` in `InternalNav` (no count).

Route handlers are thin: the logic lives in
`src/lib/sourceTriageHandlers.js` with injected dependencies, so the
role checks and "no write before authorization" are tested behaviourally
(`src/lib/sourceTriageHandlers.test.js`).

## Next step per restaurant (app release)

| Situation | Next step |
|---|---|
| Proposals could not be loaded | Onbekend — voorstellen zijn tijdelijk niet beschikbaar |
| An open proposal exists | Voorstel beoordelen |
| No website known | URL toevoegen als kandidaatbron |
| Bron `Niet bereikbaar` or `Identiteit gewijzigd` | Bron vervangen of markeren als onbruikbaar |
| Bron `Toegang beperkt` | Website zelf bekijken; eventueel markeren als onbruikbaar |
| Any other state | Bron controleren via Onboarding Restaurant (manual start) |

## Design (app release)

- Kleurtaal v2 tokens only (`docs/guides/design-reference.md`); no
  hard-coded colours. Light and dark per the existing theme contract.
- List plus detail on desktop (two columns from 960px); stacked on
  mobile. Selecting a restaurant moves focus to the detail heading.
- Status always icon plus text. Bron/Menukaart badges reuse BE-23's
  mapping; proposal statuses use the table above.
- Proposal actions are labelled as proposals ("Voorstel opslaan"), never
  as publishing. The accept button says "Voorstel accepteren", with
  "Wijzigingen worden pas na controle verwerkt." next to it.
- Save feedback sits in two permanent live regions at the top of the
  detail pane (a polite status region for success and notices, an alert
  region for errors). They are rendered before any message exists, so a
  message placed in them is announced. After every save or failed save,
  focus moves to the feedback, so it is never lost when the submitted
  form disappears. The message is set only after the list is refreshed.
  If the save succeeds but the refresh fails, the last known list and
  detail stay on screen, and the message says the change was saved but
  the page could not be refreshed.
- Form errors belong to the control they are about. "Andere reden"
  without a note marks the note (not the reason select) with
  `aria-invalid`, links the error through `aria-describedby`, marks it
  `aria-required`, and moves focus to it. URL and reason errors do the
  same for their own field.
- When the proposals cannot be loaded, no proposal state is derived: the
  next step is "Onbekend — voorstellen zijn tijdelijk niet beschikbaar"
  for every restaurant. The filters "Open voorstel" and "Bron vraagt
  aandacht" show an unknown count and are disabled, and the list is
  sorted by name only. Each item shows "Voorstellen: tijdelijk onbekend".
  A neutral banner explains this, and the proposal forms stay hidden.
- No horizontal page overflow at 1280, 390 and 320px.
- Visible brand: the existing `InternalNav` wordmark (Onze Menukaarten).
- Design source: the Kleurtaal v2 handoff "(Brontriage)" is not stored in
  the repository and its Brontriage screens were not adopted as a page
  mockup (`docs/mockups/README.md`). This ticket therefore builds on BE-23's
  layout and Kleurtaal v2's rules. The app release records its layout as
  `docs/mockups/internal-source-triage-v1.png` (fictional data).

## Release sequencing

Per `docs/guides/production-migration-pipeline.md`, `0015` was released
and verified live before this app release is considered for merge or
deployment. The app release still needs its own review and the product
decisions listed below.

Release gate: `production-db-migrate.yml` only applies a release whose
versions match its documented lists. The live migration history is
`0001`–`0015` (evidence below). The workflow file deliberately still
holds the historical gate of the `0015` release itself:
`DOCUMENTED_APPLIED_VERSIONS` `0001`–`0014` and
`DOCUMENTED_RELEASE_VERSIONS` `0015`. These lists describe that release,
not the current live state. **Follow-up for the next schema release**
(not part of this app branch, which changes no workflow): move `0015`
into the applied list and declare the new release version, the same way
as the earlier "align production migration workflow" commits.

`0014` is live according to production-db-migrate run
https://github.com/1am-it/menucard/actions/runs/36601808246 (2026-09-29,
success), whose read-only post-apply step reported history `0001` through
`0014`.

`0015` was then applied alone by production-db-migrate run
https://github.com/1am-it/menucard/actions/runs/37811864210 (2026-10-08,
success). The approved preflight
https://github.com/1am-it/menucard/actions/runs/37810992211 first found
live `0001` through `0014` with `0015` staged; the second preflight
https://github.com/1am-it/menucard/actions/runs/37812236504 confirmed exact
live and local history `0001` through `0015`. A read-only production catalog
check then confirmed RLS on both tables, no policies, no table/sequence/RPC
rights for `anon` or `authenticated`, only the documented minimum rights for
`service_role`, and `SECURITY INVOKER` RPCs with `search_path=public`.
Neither the migration nor the checks inserted a proposal or audit event.

The "`0014` and `0015` live" record for `planning/CONTEXT.md` is a
separate, docs-only change on branch
`docs/record-be24-migration-0015-live` (commit `c9fb9a6`). It is not part
of this app branch, and it lands before the app PR.

Remaining release sequence: that docs change lands, then an independent
review of this app branch, then one separate app PR. Only an explicit
merge approval may deploy the app/API/UI. The product decisions are
recorded below.

## Follow-up phases (not built)

1. Applying an accepted proposal to the published restaurant data (an
   explicit, reviewed data change), and optionally starting a Broncontrole
   for an accepted URL by hand. Documented 2026-10-10 under decision 016
   as BE-26 (source activation, no public change) and BE-27 (concepts and
   publication); not built.
2. A second-person rule for decisions, if the product owner wants it.
3. Public URL submissions and photos (PLATFORM-08B direction): moderation,
   abuse limits, privacy review, storage and retention decisions first.
   Not part of this ticket.

## V1 product decisions

These are decided for v1; none of them is an open product decision.

- Navigation: `Brontriage` is an internal-only item under `Werkvoorraad`,
  directly after `Bronwerkvoorraad`.
- Self-review is allowed and visibly marked. A second-person rule remains a
  separate future product decision, not an implicit requirement for v1.
- The unusable-reason list is fixed to `site_offline`, `other_business`,
  `no_menu_on_source`, `access_blocked`, and `other`; `other` requires a
  short explanation.

## Verification

### Schema release

- `node --test src/lib/sourceTriageMigration.test.js`: 13/13. Structural
  checks cover the tables and constraints, partial unique index, both RPCs,
  append-only events, and the exact grant/revoke model; 17 targeted privilege
  mutations were caught.
- The schema PR's `validate-migrations` check successfully replayed
  `0001` through `0015` against a throwaway PostgreSQL database.
- The production preflight, migration, second preflight, and read-only
  privilege check are recorded above. No app route, page, or API was part of
  the schema release.

### App release (current)

Local, 2026-10-08, on the app branch after the hardening commit
("make Brontriage feedback, field errors and unknown proposals
reliable"). No network, no database, fictional data only.

- Targeted `node --test` run: 195/195. Per file:
  - `sourceTriage.test.js` 29/29
  - `sourceTriageHandlers.test.js` 17/17
  - `sourceTriageSurface.test.js` 11/11
  - `sourceTriageMigration.test.js` 13/13
  - `internalNav.test.js` 47/47
  - `sourceWorkqueue.test.js` 40/40
  - `colourLanguage.test.js` 38/38
- These tests cover the behaviour and accessibility points in "Design":
  - Pure helpers, unit tested: `validateProposalForm`,
    `validateDecisionForm`, `saveFeedback`, `effectiveFilter`, and the
    unknown-proposals view.
  - The page wiring is covered by structural tests: permanent live
    regions, focus to the feedback, field-bound errors, no clearing of
    data after a failed refresh, and unknown filters.
  - Six deliberate mutations of the page and library (for example,
    putting the note error on the select, or making the feedback region
    conditional) were each caught.
- Full suites:
  - `src/lib` 1135/1164
  - `app` 54/54
  - `ops` 306/315
  - `src/components` 59/59
  - All 38 failures are outside BE-24, and none of them is in a file this
    ticket changes. They come from missing local dependencies in this
    worktree: there is no `node_modules` and nothing was installed.
    `pdfjs-dist` is needed by the PDF extraction tests, and
    `@supabase/supabase-js` by two import CLI tests. The remaining failure
    is the known CRLF working-copy check in `menuSnapshotProposals.test.js`.
- Production build: **not run**. No lockfile-conformant `node_modules`
  is available locally, and installing was out of scope. As a syntax
  check only (not a build), the page and the two libraries were parsed
  with the SWC JSX parser, loaded read-only from another local checkout's
  `node_modules`.
- Not done for this head: a browser check (both themes, 1280/390/320px,
  keyboard, screen-reader announcement of the feedback) and any
  production UI/session check. The app/API/UI remains unreleased until
  its separate PR is independently reviewed and explicitly approved.

Historical context only: an earlier local validation on 2026-10-07
(different base, before the hardening commit) included a local build and
a browser check with fictional data and all non-local requests blocked.
Its test totals are not reproducible on this head and are not evidence
for it.
