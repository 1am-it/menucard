# Isolated browser fixture — #59 menu import/review

This directory holds the reproducible **fixture-only** browser check for the
existing batch import and menu-review UI. It is not live integration, staging or
production acceptance.

## What it does

`run-menu-review-browser-check.js` starts the real Next.js app on a local port
with fictional `NEXT_PUBLIC_SUPABASE_*` values, launches a locally installed
Edge/Chrome through the Chrome DevTools Protocol, installs a fictional
in-page session and same-origin API responses, and drives the real
`/internal/source-triage/batch` route with the real `BatchAnalysisView` and
`MenuReview` components.

The fictional data is generated through the product's own helpers
(`summarizeRecognisedMenu`, `buildMenuConcept`, `buildExtractionResult`) in
`fixtures/menuReviewFixtures.js`. Every URL is on `.invalid`. No production
identity, credential, database or write is used, and the check never confirms a
source, saves a concept, exports, publishes or calls a provider.

## Isolation is fail-closed

The fixture no longer falls back to the browser's native fetch for unknown
URLs. `lib/network-policy.js` is the single policy for two layers:

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
  empty/partial/error/keyboard states;
- `evidence/menu-review-browser-evidence.json` — machine-readable result with
  every check and each screenshot's SHA-256 and dimensions.

The evidence file is committed; screenshots stay local. A reviewer can rerun
the command to reproduce the same fixture evidence.

## Coverage

- exact breadcrumb, source and "handmatig beoordelen" links;
- the starter view and a read-only colleague view (no save or confirmation);
- section paths, item counts, prices, a missing price and multiple
  undecomposed prices;
- duplicate, price and missing-price blockers kept separate;
- shared uncertainty grouped per section, with no accept-all action;
- a disabled "Concept opslaan" while blockers remain;
- empty, partial (source found, zero items) and load-error states;
- keyboard reachability and Enter activation of the review/section controls;
- light/dark tokens and 320/390 px without horizontal overflow;
- fail-closed network isolation: external fetch, protocol-relative URL, unknown
  local API write, XHR, WebSocket, image/iframe subresource and frame
  navigation are blocked and recorded; the explicit fixture API still answers.

## Limits

This is fixture evidence. It does not prove a live Supabase session, a real
source import, a real concept save, a browser rendering of an actual restaurant
site, or production behaviour. The product extraction runtime remains disabled.
The fictional session/API is intercepted in the page; it never falls through to
a real API or an external host.
