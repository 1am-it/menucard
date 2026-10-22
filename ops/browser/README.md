# Isolated browser fixture — #59 menu import/review

This directory holds the reproducible **fixture-only** browser check for the
existing batch import and menu-review UI, and for the existing concept list and
detail pages. It is not live integration, staging, authenticated or production
acceptance.

## What it does

`run-menu-review-browser-check.js` starts the real Next.js app on a local port
with fictional `NEXT_PUBLIC_SUPABASE_*` values, launches a locally installed
Edge/Chrome through the Chrome DevTools Protocol, installs a fictional
in-page session and same-origin API responses, and drives the real
`/internal/source-triage/batch`, `/internal/menu-concepts` and
`/internal/menu-concepts/[id]` routes with the real
`BatchAnalysisView`, `MenuReview`, `ConceptList` and `ConceptReview`
components. No HTML is rebuilt in the harness.

The fictional data is generated through the product's own helpers
(`summarizeRecognisedMenu`, `buildMenuConcept`, `buildExtractionResult`,
`readConceptProduct`, `buildProductReviewView`, `storedConceptInput`) in
`fixtures/menuReviewFixtures.js`. Every URL is on `.invalid`. No production
identity, credential, database or write is used, and the check never confirms a
source, saves a concept, records a decision, exports, publishes or calls a
provider.

## Concept list and detail coverage

Four fictional lineages exercise the existing pages:

- a valid v1 concept with no blockers (approve/reject remain usable);
- a stored `menu-extraction-product/v2` envelope, read-only, with separate
  glass/bottle prices, an unresolved supplement, unknown allergens, provenance
  quotes and coverage limitations;
- an unknown/invalid versioned-looking row that must not become v1;
- an exact `menus: []` v2 envelope, visibly empty and blocked.

The check performs real list → exact detail → back clicks, asserts that each
selected id and restaurant name match, and covers empty list, load error,
missing access (403), detail error and a 404. It also covers keyboard focus and
Enter activation, light/dark tokens and 320/390/1024 px.
`clickpaths` in the evidence records the concrete click inventory.

Only these fictional concept reads are mocked:

- `GET /api/internal/v1/menu-concepts` (list);
- `GET /api/internal/v1/menu-concepts/<id>` (detail, exactly one segment).

Every concept write (`POST` list/detail, `versions`, `decision`, `export`) and
every unknown or nested API route is refused by the guard before a handler or
native fetch is reached. A forced approve click and forced script POSTs are
recorded as deliberate negative probes. That proves the network guard only:
`src/lib/menuConceptReviewHandlers.test.js` remains the authority for
server-side refusal. The UI block is not presented as proof that a server
would refuse.

## Isolation is fail-closed

`lib/network-policy.js` is the single policy for two layers:

- the in-page guard for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`
  and `sendBeacon`;
- the CDP `Fetch` interception in the harness, which also covers subresources
  and frame/document navigation.

Only explicit local app resources and the explicit fictional fixture API
routes are allowed. Unknown external URLs, protocol-relative external URLs,
unknown API routes and non-GET app requests are refused with
`fixture_network_blocked: <reason>` and recorded in
`window.__FIXTURE_NETWORK_VIOLATIONS__`. Chromium additionally runs with
`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost` as defense in depth.

The check deliberately attempts an external fetch, a protocol-relative external
URL, an unknown local API write and an external WebSocket, plus an external
image/iframe that only the CDP layer can stop. Those deliberate attempts are
recorded in the evidence as `network.deliberateViolations`; any unexpected
app-phase request fails the run. Negative unit regressions run the real
bootstrap in a Node VM with a native-fetch spy and no network:
`lib/fixture-page.test.js` and `lib/network-policy.test.js`.

## Loopback and CDP boundary

The harness starts and stops its own `next dev` process on
`http://localhost:3137` (override with `BROWSER_FIXTURE_PORT`) and its own local
Edge/Chrome process with a temporary profile, controlled over CDP. It only
exercises those two processes; no remote host is contacted. The evidence names
this boundary under `environment.loopback` and marks the run `fixtureOnly`.

## Run

```bash
npm run test:browser:menu-review
```

Requirements: Node 22, the repository's installed dependencies, and an
installed Edge or Chrome. Override the browser with `BROWSER_PATH`; override the
app port with `BROWSER_FIXTURE_PORT` (default 3137).

Generated artifacts (gitignored):

- `output/next-dev.log` — local dev-server log;
- `output/*.png` — screenshots at 320/390/1024 px, light/dark and the
  empty/partial/error/concept states;
- `evidence/menu-review-browser-evidence.json` — machine-readable result with
  every check, clickpath, each screenshot's SHA-256 and dimensions, the mocked
  reads and the deliberate refusals.

The evidence file is committed; screenshots stay local. A reviewer can rerun
the command to reproduce the same fixture evidence.

Screenshots whose name ends in `-clickpath.png` follow a real link and therefore
use the fixture's default dark theme: a real click drops the query string.
Explicit light/dark evidence comes from the direct-URL scenarios, including
`concept-detail-v2-1024-light.png`, `concept-detail-v2-1024-dark.png`,
`concept-detail-v2-390-light.png`, `concept-detail-v2-390-dark.png` and
`concept-detail-v2-320-light.png`.

## Uncertain section structure (#59 review 6307703713)

`fixture=structure` drives a result whose section structure the extractor marks
uncertain. The check opens "Menukaart controleren", asserts that each uncertain
section shows its path, source route and locator, keeps one section and corrects
the other with a real typed path, and only then finds an enabled "Bevestig bron"
that opens the existing confirmation panel with "gehandhaafd"/"gecorrigeerd".
The final write is deliberately not sent: the fixture guard refuses non-GET app
requests, so this is UI evidence, not a saved confirmation. The same scenario
runs at 390 px in light and dark, by keyboard (Tab + Space) and read-only for a
colleague. `fixture=structure-readonly` proves the colleague never gets an
enabled decision or a confirmation button.

## Handmatige AI-import (#59 fase 2, review 6348147293)

`fixture=manual` drives the new internal page `/internal/menu-import` in its
three steps. Step 1 makes the prompt from a fictional source and shows the
source line in plain language plus the collapsed technical details. Step 2
pastes a fictional answer, and the check asserts that the paste field is
cleared after checking and that the page shows only
"✓ Antwoord ontvangen: 1 menukaart, 3 gerechten" — never the pasted JSON.
Step 3 resolves the two open points the way a human must: choose a price for
the line with two prices, then confirm the line that is not in the source with a
required reason, after which "Concept opslaan" becomes enabled and reports the
existing concept-route result with "niets gepubliceerd". The same page is
checked by keyboard (Tab + Enter makes the prompt) and at 320/390 px in light
and dark.

Only these fictional writes are mocked, all with the fixed import id
`fixture-import`:

- `POST /api/internal/v1/manual-menu-import/bundles`;
- `POST /api/internal/v1/manual-menu-import/imports`;
- `POST /api/internal/v1/manual-menu-import/imports/fixture-import/decisions`;
- `POST /api/internal/v1/manual-menu-import/imports/fixture-import/follow-up`;
- `POST /api/internal/v1/manual-menu-import/imports/fixture-import/save`.

The fixture data is built with the product modules themselves
(`buildImportBundle`, `buildImportReport`, `decideRow`, `reviewView`,
`buildConceptDraft`), so the browser sees the real shapes. Every other import
path — another id, another method, the real `/usage` read — stays unknown and is
refused by the guard. The app calls no provider in any scenario, so there is no
AI traffic to intercept. This remains fixture evidence: no real source, no real
concept write, no independent review.

## Coverage

- exact breadcrumb, source and "handmatig beoordelen" links;
- the starter view and a read-only colleague view (no save or confirmation);
- section paths, item counts, prices, a missing price and multiple
  undecomposed prices;
- duplicate, price and missing-price blockers kept separate;
- shared uncertainty grouped per section, with no accept-all action;
- a disabled "Concept opslaan" while blockers remain;
- empty, partial (source found, zero items) and load-error states;
- an image/scan-only menu with the explicit non-supported status, the reason, no
  confirmation, and a working click into Bronnen beoordelen with the restaurant
  preselected and the reason still visible;
- concept list: four lineages, exact row hrefs, valid v1 next to blocked rows;
- concept detail: v1 usable, v2 read-only with glass/bottle/supplement/
  unknown allergens/provenance/coverage, invalid and exact `menus: []` blocked;
- concept states: empty list, load error, missing access, detail error and 404;
- concept keyboard reachability and Enter navigation; light/dark and 320/390 px
  without horizontal overflow;
- keyboard reachability and Enter activation of the batch review controls;
- light/dark tokens and 320/390 px without horizontal overflow;
- fail-closed network isolation: external fetch, protocol-relative URL, concept
  write, unknown local API write, XHR, WebSocket, image/iframe subresource and
  frame navigation are blocked and recorded; the explicit fixture API still
  answers.

## Limits

This is fixture evidence. It does not prove a live Supabase session, a real
source import, a real concept save or decision, a browser rendering of an
actual restaurant site, or production behaviour. The product extraction
runtime remains disabled. The fictional session/API is intercepted in the page;
it never falls through to a real API or an external host. A green browser run
is not independent review and not authenticated acceptance.
