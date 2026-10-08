# BE-24 — Internal source triage (Brontriage) v1

## Status

Nothing is live. BE-24 ships as two separate releases (see "Release
sequencing"):

1. **Schema release** (this release): migration `0015`, its structural
   test (`src/lib/sourceTriageMigration.test.js`) and the release-gate
   alignment in `.github/workflows/production-db-migrate.yml`. `0015`
   is not applied anywhere yet.
2. **App release** (a separate, later release): the API routes, the
   Brontriage page, the internal navigation entry, the mockup and an
   end-to-end check. It is merged and deployed only after `0015` is
   confirmed live. It is not part of this release.

The sections "Routes", "Next step per restaurant" and "Design" below
specify the app release; nothing in them ships with the schema release.

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
  dependencies or production configuration. The only workflow change is
  the release gate for `0015`: the two documented version lists in
  `production-db-migrate.yml` (applied `0001`–`0014`, release `0015`),
  following the earlier "align production migration workflow" commits.
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
  calls (to be tested behaviourally with an injected client in the app
  release).
- Proposing, accepting and rejecting all need `internal`. `editor` and
  `owner` alone are refused, as for every other Data-inbox route.
- The actor is always the authenticated user id from the server, never a
  value from the request body.
- Self-review is allowed in v1: the same person may propose and decide.
  The page will mark it ("Je beoordeelt je eigen voorstel."). Whether a second person is
  required is an open product decision.
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
role checks and "no write before authorization" can be tested
behaviourally in the app release.

## Next step per restaurant (app release)

| Situation | Next step |
|---|---|
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
- No horizontal page overflow at 1280, 390 and 320px.
- Visible brand: the existing `InternalNav` wordmark (Onze Menukaarten).
- Design source: the Kleurtaal v2 handoff "(Brontriage)" is not stored in
  the repository and its Brontriage screens were not adopted as a page
  mockup (`docs/mockups/README.md`). This ticket therefore builds on BE-23's
  layout and Kleurtaal v2's rules. The app release records its layout as
  `docs/mockups/internal-source-triage-v1.png` (fictional data).

## Release sequencing

Per `docs/guides/production-migration-pipeline.md`: `0015` is released
and verified live first, as this migration-only release, before the app
release that depends on it is merged or deployed.

Release gate: `production-db-migrate.yml` only applies a release whose
versions match its documented lists. They now read applied `0001`–`0014`,
release `0015`.

`0014` is live according to existing, read-only audit evidence:
production-db-migrate.yml run
https://github.com/1am-it/menucard/actions/runs/36601808246 (2026-09-29,
success) verified live history as exactly `0001`–`0014` in its own
read-only post-verification step, and no migrate or history-reconcile run
has happened since (checked read-only on 2026-10-08). This is evidence,
not a fresh measurement: a fresh read-only `production-db-preflight.yml`
run (applied `0001`–`0014`, staged `0015`) is still mandatory before
`0015` is applied.

Order after merge: preflight → approved `production-db-migrate.yml`
(release `0015`) → second preflight → live privilege check → record
"0015 live" in `planning/CONTEXT.md` → only then the app release.

## Follow-up phases (not built)

1. Applying an accepted proposal to the published restaurant data (an
   explicit, reviewed data change), and optionally starting a Broncontrole
   for an accepted URL by hand.
2. A second-person rule for decisions, if the product owner wants it.
3. Public URL submissions and photos (PLATFORM-08B direction): moderation,
   abuse limits, privacy review, storage and retention decisions first.
   Not part of this ticket.

## Open product decisions

- Navigation label and position: `Brontriage` under `Werkvoorraad`, after
  `Bronwerkvoorraad` (Kleurtaal v2 left the item open).
- Self-review allowed or not (see "Roles and authorization").
- The unusable-reason list.

## Verification (schema release)

Local, 2026-10-08, on the schema release branch:

- `node --test src/lib/sourceTriageMigration.test.js`: 13/13. Structural
  checks on `0015`: the two tables and their constraints, the partial
  unique index, both RPCs (security invoker, fixed `search_path`, typed
  errors, an audit event per change), and the exact grant and revoke set
  of the privilege model above. 17 targeted mutations of the privileges
  were all caught.
- `git diff --check` is clean.
- Not yet verified: a real Postgres replay of `0001`–`0015`. That first
  happens in the `validate-migrations` CI run on this release (no local
  database was used).

This release claims no API, page, browser, navigation or mockup
verification; those belong to the app release.
