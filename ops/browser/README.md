# Isolated browser fixture — #59 menu import/review

## BE-55 part B: "Vandaag" and reporting (#135)

`run-be55-browser-check.js` (also `npm run test:browser:be55`) drives
`/restaurant/6` and `/menu/6-diner` with a fictional daghap API stubbed in the
page (ops/browser/lib/be55-daghap-stub.js), on a local dev server and a real
browser:

- the "Vandaag" block shows one card per offer with its name, price pill,
  description, labels, the season line, "Bewaar", "Deel" and "Klopt dit aanbod
  niet? Meld het"; the card has a 2 px border; the block is labelled by its own
  heading;
- no offer (`?leeg=1`) means no block at all;
- reporting shows a confirmation, a second tap from the same device says it was
  already reported, and exactly one random device value (no account, no IP) is
  sent;
- light and dark at 1280, 390 and 320 px, no horizontal overflow, a visible
  focus ring, a 44 px tap target and 4.5:1 contrast on the new text;
- screenshots and `be55-browser-evidence.json` in `ops/browser/evidence/`.

The server rules (three reports, limits, filter) are *not* proven here: they live
in `src/lib/daghapHandlers.test.js`. The harness runs `next dev`, so run
`next build` again before the performance budget test. Developer evidence on a
local machine — not production, not independent acceptance.

## BE-42 part 1: menu names as buttons and softer prices (#98)

`run-be42-browser-check.js` drives the real production build (`next start`, no
Supabase credentials) through CDP and records 1A and 3B of BE-42:

- `/alle-restaurants`: the card is no longer one big link, the restaurant name is
  the link to `/restaurant/<id>`, each menu card is its own button to
  `/menu/<id>`, the big "Bekijk N menukaarten" button is gone, a card without a
  menu keeps "Nog geen menukaart" plus "Bekijk restaurant →", the tab order is
  name → menu buttons, the focus ring is visible and every tap target is ≥ 44 px
  (also at 390 and 320 px, without horizontal overflow);
- the price surface on `/restaurant/6`, `/menu/6-diner`, `/search?q=steak`, the
  "op aanvraag" label and the home "Vanavond op de kaart" with the fixed BE-29
  clock: `var(--surface-soft)` background, `var(--text-primary)` text, bold,
  right-aligned and ≥ 4.5:1 in light and dark;
- the cold first transfer of `/alle-restaurants` and `/restaurant/6` (the
  "before" measurement for part 2, which stays under 250 KB);
- screenshots of `/alle-restaurants`, `/restaurant/6` and `/restaurant/1` at
  1280, 390 and 320 px in light and dark.

`--out <dir>` decides where the screenshots and `be42-browser-evidence.json`
land; by default that is outside the repository (`../be42-evidence`). No
restaurant in the local data has exactly one menu card, so `/restaurant/1`
(Wolfslaar, two cards) is the smallest real case; no data was added for it.
Developer evidence on a local machine — not production, not independent
acceptance.

## BE-42 part 2: the whole menu in tabs (#98)

The same script also records 2A:

- `/restaurant/6`: the section "Menukaarten" with one tab per menu card and the
  real dish count, in the fixed order lunch → diner → borrel → overige;
- the default tab is the first card in that order (lunch), never the clock, so
  the server HTML is the same at any time of day;
- every tab is a real link (`/restaurant/6?kaart=<id>`) that the server
  renders, so the tabs work without JavaScript; clicking one switches only the
  panel (one navigation entry in the performance timeline, no full reload);
- the source line and the link to the original menu stay, and `/menu/<id>` is
  still reachable;
- the raw server response (markup *and* the RSC payload) is fetched outside the
  browser: exactly one menu card is in it, an unknown `?kaart=` falls back to
  the default, and `/restaurant/1` shows one card out of two;
- the cold first transfer of `/restaurant/6` stays under 250 KB; the "before"
  value (169.9 KB) comes from the part 1 evidence, because this script always
  runs on the current code;
- screenshots of `/restaurant/6`, `/restaurant/6?kaart=6-borrel` (a switched
  tab) and `/restaurant/1` at 1280, 390 and 320 px in light and dark.


## BE-34 one-click AI reading and name search (#81)

`run-een-klik-browser-check.js` (also `npm run test:browser:een-klik`) is the
fixture browser check for the one-click "Lees met AI" row and for
"✨ Zoek op internet: <naam>, Breda". It drives the real `/internal/coverage`
row, the real `/internal/menu-import` review screen (reached through the row's
own "Bekijk en controleer") and the real `/internal/toevoegen` form, with a
fictional in-page session and fictional API answers
(`fixtures/eenKlikFixtures.js`, built with the product's own
`buildImportReport`/`reviewView`).

- the row before, during and after the reading, including the estimate, the
  measured cost and the small "Liever zelf plakken" link;
- the existing review screen with the reading already loaded and the
  "Alles nagelopen (N)" offer;
- a failed reading with its honest reason and "Handmatig toevoegen";
- the name search and its proposal (name, address, website, menu link,
  provenance, cost, "Toevoegen als nieuw restaurant").

At 1280 and 390 px in light and dark. `EEN_KLIK_MATRIX="1280:light"` limits the
matrix for a quick run. Screenshots go to the committed
`ops/browser/evidence/be-34/`, the record to
`ops/browser/evidence/een-klik-browser-evidence.json`. FIXTURE EVIDENCE: no
provider, database or production identity is involved and nothing is created.

## BE-28 public style check (#65) and BE-28b (#68)

`run-public-style-browser-check.js` (also `npm run test:browser:public-style`)
is the browser check for the fresh public style. Unlike the fixture checks
above it drives the **real production build** (`next start`) with placeholder
Supabase values, because it only measures public pages plus the token
readability of an internal screen:

- the initial transfer of `/` and of `/alle-restaurants` (cold cache, dark,
  1280 px) — the before/after measurements of #65 and #68 criterion 6; the
  optional `--root <checkout>` measures another checkout (for example the base
  commit) with exactly the same script;
- screenshots of home, search with results, all restaurants, one restaurant with
  and without a menu, one menu, `/claim` and `/nvwa` at 1280/390/320 px, light
  and dark, plus `/internal/login` and `/internal/coverage` in both themes;
  `/restaurants` is no longer screenshotted: the check asserts its permanent
  308 to `/alle-restaurants` (with `q`) instead;
- the BE-29 (#70) evidence: home screenshots at a fixed browser clock on three
  moments of the day (lunch, borrel, diner) at 1280/390/320 px in light and
  dark, the real season tiles (only with search results), the selected dishes
  and labels, the marked dish anchor on the menu, and the check that the
  server HTML contains no "Nu open" or daghap;
- live contrast of the new token pairs (including the `/alle-restaurants`
  cards, CTA, chips and count), no horizontal overflow, the phone tab bar only
  at ≤720 px, tap targets ≥ 44 px and the keyboard path from the search field
  to the Zoeken button;
- the BE-28b card rules: equal card heights, real menu/cuisine chips, the
  default "Met menukaart eerst" sort (`?sort=az` as the alternative), the real
  `25 restaurants · 4 met menukaart` count and the compact menu-less phone row
  with an arrow;
- since BE-42 (#98) 1A the card itself is no longer one whole link: the
  restaurant name is the link to `/restaurant/<id>`, every menu card is its own
  button to `/menu/<id>` (11 buttons over the four real menu cards) and the big
  "Bekijk N menukaarten" button is gone. A card without a menu keeps its own
  whole-card link with "Nog geen menukaart" and "Bekijk restaurant →".

Build first (`npm run build`), then run it. The evidence lands in
`ops/browser/evidence/public-style-browser-evidence.json`; screenshots go to
the git-ignored `ops/browser/output/be-28/`. It is developer evidence on a
local machine, not production or independent acceptance.

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
Sinds BE-57 integratie (#139) krijgt zo'n `next dev` een eigen bouwmap
(`NEXT_DIST_DIR=.next-browser-<poort>`, zie `next.config.js`), zodat hij nooit de
`.next` van een net gedraaide `next build` hergebruikt en halverwege de controle
volledig herlaadt. Zonder die variabele blijft de productieopbouw `.next`
gebruiken.

## Run

```bash
npm run test:browser:menu-review
npm run test:browser:menu-review -- --lijst
npm run test:browser:menu-review -- --alleen=concept-publication
```

Requirements: Node 22, the repository's installed dependencies, and an
installed Edge or Chrome. Override the browser with `BROWSER_PATH`; override the
app port with `BROWSER_FIXTURE_PORT` (default 3137).

### One scenario instead of all of them (BE-43, #101)

Every `run-*-browser-check.js` with more than one scenario reads the same two
flags:

- `--lijst` prints the scenario names and starts nothing;
- `--alleen=<naam>[,<naam>]` runs only the named scenarios, in the script's own
  order. An unknown name prints the error with every valid name and starts
  nothing (exit code 2).

Without a flag the check runs everything, exactly as before. The output is one
line per scenario with its passed/failed counts and duration; the details of a
check are printed only when it fails. A filtered run writes its record to
`evidence/<naam>.filtered.json` (gitignored) instead of the full evidence file,
and the record names its selection in `filter: [...]`. Only the full run may
replace the committed evidence.

During work use `--alleen`; at the end run the whole check once.

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

### Afgekeurd antwoord: leesbare problemen en herstelvraag (review 6376543234)

`?manualFail=schema` on the same page lets only the `POST …/imports` fixture
answer with the real `422 schema_violation` shape: a fictional answer that the
actual validator rejects, translated by `src/lib/manualMenuImportProblems.js`
(built in `fixtures/menuReviewFixtures.js`, not hand-written HTML). The check
opens the prompt, pastes a fictional answer, presses "Controleren" and asserts
that the page shows "Wat de AI moet herstellen" with at most five plain Dutch
sentences (naming the dish, section or menu card), no JSON path in that list, one
read-only copyable recovery question that starts with "Corrigeer alleen deze
punten", an inline check that the panel is inside the viewport for the
screenshot, and a collapsed "Technische details" block that still contains the
validator lines. It runs at 390 px/dark and 320 px/light without horizontal
overflow and records `manual-ai-import-problems-390-dark.png` and
`manual-ai-import-problems-320-light.png` in `output/` and in the evidence file.
The rejected answer stores nothing: the follow-up steps stay unavailable.

### Afgeleide telling en status: de melding op het reviewscherm (review 6377050602)

`?manualNormalize=1` op dezelfde pagina laat alleen de `POST …/imports`-fixture
antwoorden met hetzelfde fictieve antwoord, maar met een foute telling (`9`) en
een `complete`-status met een limitation. Dat antwoord wordt met de echte
`buildImportReport` gebouwd, dus de browser ziet dezelfde afleiding en dezelfde
melding als de server zou sturen. De check opent de prompt, plakt een fictief
antwoord, drukt "Controleren" en controleert dat:

- stap 2 "1 menukaart, 3 gerechten" toont (de afgeleide telling, niet de claim
  van 9);
- het blok "Door het systeem bijgesteld" (`role="status"`) twee zinnen in gewone
  taal toont: "Aantal gerechten door het systeem geteld: 3 (de AI zei 9)." en
  "Status bijgesteld naar gedeeltelijk, omdat de AI zelf een beperking noemde.";
- er geen JSON op het scherm staat en er geen accepteer-alles-knop is;
- de melding in beeld staat voor de screenshot en er geen horizontale overflow
  is op 390 px/dark en 320 px/light.

De screenshot `manual-ai-import-normalized-390-dark.png` staat in `output/` en
in het evidencebestand. Ook dit blijft fixturebewijs: geen provider, geen echte
bron, geen conceptopslag.

## "Lees met AI" als hoofdroute en de batchplek (review 6381657192)

`fixture=manual-ai` levert de fictieve status (sleutel + vlag aan), het
maandbedrag en één fictief leesantwoord. `?aiState=off` antwoordt als "niet
ingesteld"; `?aiState=slow` houdt het fictieve antwoord 2,5 s vast, zodat de
"AI bezig"-stand echt in beeld komt voordat het resultaat er is. Geen provider,
geen sleutel en geen echte kaart. De bestaande handmatige scenario's gebruiken
`aiState=off`, zodat zij de ongewijzigde handmatige flow blijven bewijzen.

Per thema (licht en donker, 390 px) controleert de check:

- het AI-blok is een zelfstandige kaart na "Bron kiezen" en zit niet in stap 1;
- de handmatige stappen zijn ingeklapt achter "Liever zelf invoeren of plakken"
  (`aria-expanded`/`aria-controls`), klappen open als je die kiest en weer dicht
  bij een tweede klik;
- na "Concept klaar" staat alleen het resultaat met "Nalopen"; stap 1, 2 en het
  reviewblok blijven weg tot die klik;
- zonder AI staat rustig "AI is niet ingesteld." en is de oude handmatige flow
  direct zichtbaar met de nummers 1, 2 en 3;
- de batchplek (`fixture=partial`) toont hetzelfde blok als mockupscherm 1 in
  het mislukte resultaat, met de knop naar de bestaande analyse-opdracht en de
  handmatige link;
- de AI-knop is met Tab en Enter te bedienen.

Screenshots in `output/` en in het evidencebestand: `ai-read-block`,
`ai-read-manual`, `ai-read-busy`, `ai-read-done`, `ai-read-review`,
`ai-read-off` en `ai-read-batch`, elk als `-390-light.png` en `-390-dark.png`.
Dit blijft fixture- en ontwikkelaarsbewijs, geen onafhankelijke review of echte
browseracceptatie.

### Variant 1: niet-overgenomen bronregels (order 6382189724)

`fixture=manual-coverage` antwoordt met een fictieve dinerkaart waarin twee
regels een prijs printen die geen gerecht dekt, en met de reviewstanden na
"Toevoegen" en na "Geen gerecht". `manualUncoveredScenario` controleert:

- het oranje blok staat boven de nalopen-lijst, met kop, citaat,
  "Pagina <bron> · regel N · onder <rubriek>", de twee knoppen en
  "Gratis: geen extra AI-aanroep nodig";
- de kleuren komen uit de aandachtrol (`--status-old`) van het actieve thema;
- "Toevoegen" verdwijnt met de regel en het nieuwe gerecht staat in nalopen als
  "rubriek controleren"; "Geen gerecht" laat het blok met de laatste regel
  verdwijnen;
- 390 px licht/donker en 320 px licht, geen horizontale overflow, en de
  toetsenbordroute (focus + Enter).

Screenshots: `ai-uncovered-390-dark.png`, `ai-uncovered-after-add-390-dark.png`,
`ai-uncovered-empty-390-dark.png`, `ai-uncovered-390-light.png` en
`ai-uncovered-320-light.png`.

### Variant 5: de kaart met markeringen (order 6382953597)

`fixture=manual-map` antwoordt met een fictieve bron waarin een prijs op een eigen
regel staat (naamregel + "11,00"), met een afwijkende prijs (rood), een
overgenomen regel (groen), een niet-overgenomen regel (oranje), een afgewezen
regel (grijs), een PDF met twee pagina's en een scan zonder tekstlaag. De review
en de kaartpagina's zijn met de echte productmodules gebouwd
(`reviewView`, `decideSourcePriceLine`, `decideUncoveredLine`, `sourceCardView`).

De fixture beantwoordt één extra, fictief leespad:
`POST /api/internal/v1/manual-menu-import/imports/fixture-import/source-map`. Elk
ander pad, een andere bron of een andere pagina wordt geweigerd. Elke fictieve
route die de pagina werkelijk aanroept staat in `window.__FIXTURE_CALLS__`, zodat
de check kan bewijzen dat een kaartpagina pas bij openen of bladeren wordt
opgevraagd.

`manualCardScenario` controleert:

- de review opent met de schakelaar **Lijst | Kaart** en zonder kaartverzoek;
- de kaart toont de legenda met vier markeringen (elk met vorm én tekst), de drie
  bronnen in volgorde en de regels van de bron; regels zonder prijs blijven
  ongemarkeerd; het paar heeft één markering;
- een tik op rood opent "Kaart 11,00 · concept € 12,50" met "Neem 11,00 over" en
  "Wijzig"; overnemen komt duurzaam terug in het paneel;
- een tik op oranje biedt "Toevoegen" en "Geen gerecht"; "Geen gerecht" maakt de
  regel grijs en laat hem staan; groen toont het gerecht;
- de PDF-pagina's komen per stuk binnen (pagina 2 pas na "Volgende") met de
  eerlijke melding over de ontbrekende pagina-afbeelding; de scan zonder tekst
  toont geen regels;
- "Bekijk op kaart" in de lijst opent de kaart, scrolt naar de regel en markeert
  hem;
- 390 px licht/donker, 320 px licht, geen horizontale overflow, en de
  toetsenbordroute (Tab naar "Kaart", Enter, focus op een markering, Enter opent
  het paneel).

Screenshots: `ai-map-390-light.png`, `ai-map-390-dark.png`, `ai-map-320-light.png`,
`ai-map-red-panel-*.png`, `ai-map-orange-panel-*.png`, `ai-map-pdf-*.png`,
`ai-map-from-list-*.png` en `ai-map-keyboard-390-light.png`.

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

## #62 — the internal navigation and the one entry (fixture evidence)

`run-internal-nav-browser-check.js` uses the same harness and isolation as the #59
check, with fictional numbers (`NAV62_COUNTS` in `lib/fixture-page.js`). It drives
the real `InternalNav`, the real `/internal/toevoegen` page and the real `/internal`
redirect:

- the bar shows Dekking, Werkvoorraad (N), "+ Restaurant of menu toevoegen",
  Licht/Donker and Sign out, and never "Onboarding Restaurant" or "Beheer";
- the menu is closed by default, opens with a click or Enter, lists the open work
  in the contract order and by the real numbers (Menuconcepten 7, Bronnen 2,
  Nieuwe aanleveringen 1, Beoordelen 1), then a separating line, then
  Stadsoverzicht and Restaurantgegevens (concept) without a number;
- Escape closes it and returns focus to the button; the focus order is proven;
- 390 and 320 px, light and dark: logo, Dekking, Werk (N) and a "+" button of at
  least 44 px, no horizontal overflow, and Licht/Donker + Sign out at the bottom
  of the menu;
- `/internal` lands on the section with the most open work;
- `?countsState=error` and `?countsState=partial` prove that a failed or partial
  count shows no number at all, never a fake 0, and no total.

Screenshots: `nav62-desktop-1280-{light,dark}-*.png`,
`nav62-{390,320}-{light,dark}-{bar,menu}.png`,
`nav62-390-light-counts-missing.png`,
`nav62-desktop-1280-light-counts-partial.png` and
`nav62-landing-menu-concepts-1280-light.png`. Evidence:
`evidence/internal-nav-browser-evidence.json`.

The approved mockup is an external Claude artifact; this check cannot fetch it.
The screenshots are the material for the Lead's/human visual comparison against
the four mockup screens. The nav counts are one fixed fictional API answer and
each fixture page keeps its own fictional list, so a number is not derived from
that page here; the real agreement with the pages' own definitions is unit-tested
in `src/lib/workqueueCounts.test.js`. This is fixture evidence, never real
acceptance.

## BE-29 (#70) — Vanavond, seizoen, daghap and `/restaurants`

The same public-style script also drives the BE-29 evidence with a fixed
browser clock (`2026-10-23`, a Friday):

- home at 12:30, 17:00 and 20:00 Europe/Amsterdam, at 1280/390/320 px in light
  and dark: the lunch and diner sections show three real dishes with a price,
  one per restaurant; the borrel moment honestly hides the section because the
  real data has fewer than three borrel restaurants;
- the October season tiles (mosselen, wild, pompoen) only when the existing
  search has results; no tile is invented;
- the menu opened from a home card, with the same dish marked through the
  `#gerecht-<id>` anchor;
- `/restaurants` answers 308 to `/alle-restaurants`, and `?q=bardot` is kept.

The fixed clock is a test instrument only (`Date` override before navigation);
the product code itself always uses the browser clock and
`Europe/Amsterdam`. Screenshots are `be29-home-*` and `be29-menu-marked-*` in
`ops/browser/output/be-28/`. This remains developer evidence, not production
or independent acceptance.


## BE-31 (#74) — Bronnen beoordelen, Dekking en afhandelen in de rij

`run-bronnen-browser-check.js` (also `npm run test:browser:bronnen`) uses the same
harness as the #59/#62 checks, with fictional data from
`fixtures/bronnenFixtures.js`. It drives the real `/internal/bronnen`,
`/internal/coverage` and `/internal/toevoegen` routes and the real
`BronnenView`, `ProposalDetail`, `CoverageCheckSection` and `SourceResultRow`
components at 1280, 390 and 320 px in light and dark, and saves screenshots of
screens 1-7 of the approved mockup to `ops/browser/output/be-31/`:

- screen 1: the task list with the real chip numbers (`Alles 3`, `🧪 Batches 1`,
  `💡 Voorstellen 1`, `📡 Aandacht 1`), one task per restaurant titled with that
  restaurant's name, the age of its newest result ("resultaat van 12 dagen
  geleden"), the detail still saying "Kies een taak links", the Werkvoorraad
  number equal to the number of tasks, and "🗄️ Oude resultaten opruimen" with
  one confirmation that names the number (7 results in the fixture);
- screen 2: a chosen batch task with one next step per row (✅ Bevestig bron,
  ⚠️ Menukopjes controleren, 📖 Lees met AI, ✍️ Handmatig toevoegen, ⏳ Even
  wachten), the BE-30 link of the same batch item, the age of each row and
  "Opnieuw controleren";
- screen 3: no work at all → only "✅ Geen open bronwerk" with the link to
  Dekking, no chips, no detail pane, and the bar's number at 0;
- screen 4: the chosen task in antraciet (dark);
- screen 5: Dekking's "Nog niet gecontroleerd (4)" with the existing reason
  texts, the per-row "🔎 Controleer bron", the selection that updates
  "🔎 Controleer N geselecteerde" and the existing limits and
  "loopt zolang de pagina open is", and the dead end of the same restaurant
  ("Laatste controle gaf geen bruikbaar resultaat" + its own outcome, age and
  "✍️ Handmatig toevoegen");
- screen 6: on 390/320 px a task opens as its own screen with a way back;
- screen 7: the same rows under the add form, with the same one next step.

The fixture follows the real shape of the Lead finding: one restaurant in
several old probe batches (only its newest result is a task), one batch with
five source URLs of the same restaurant, a dead end of another restaurant
(Dekking) and a restaurant with a confirmed source (no task). The older
batches' job ids are part of the same "Oude resultaten opruimen" confirmation,
so nothing silently resurfaces.

The evidence lands in `ops/browser/evidence/bronnen-browser-evidence.json`. It is
fixture evidence on a local machine: no production session, database, source
activation or publication happens, and a green run is not independent review or
production acceptance. The counts in the fixture are fictional; that the real
number is computed from the same task definition is unit-tested in
`src/lib/sourceReviewCount.test.js`.


## BE-33 (#79) — menukaarten die alleen als afbeelding of scan bestaan

`run-beeld-lezen-browser-check.js` (also `npm run test:browser:beeld-lezen`)
uses the same harness and fictional fixtures. It drives the real
`/internal/coverage` and `/internal/menu-import` routes with the real
`CoverageCheckSection`, `SourceResultRow`, `MenuSourceMap` and review
components at 1280 and 390 px in light and dark:

- the result row of a menu that only exists as an image: "📷 Lees met AI
  (afbeelding)" when the existing AI status says the AI is on and the budget
  allows a call, "✍️ Handmatig toevoegen" when it does not (`?aiState=off`),
  with the existing job link, the image flag and the honest reason text;
- the Kaart view of that same menu: the image itself (a fictional, generated
  menu PNG as a data URL, so the check stays offline) beside the dishes the AI
  read from it, each with "Controle nodig" and "gelezen van afbeelding N", the
  second image of the same menu, and "Nalopen in de lijst" back to that row.

A menu that only exists as an image is a dead end, not a ready decision: the
owner decision of 2026-10-27 keeps such a restaurant in Dekking
("Nog niet gecontroleerd") with its own fitting next step in the row, which is
what the first screenshots show.

The evidence lands in
`ops/browser/evidence/beeld-lezen-browser-evidence.json`; screenshots go to
`ops/browser/evidence/be-33/`. It is fixture evidence on a local machine: no
model, key, provider or real restaurant is involved, and a green run is not
independent review or production acceptance.

## BE-38 (#90) — "Straks op de kaart" and "Morgen op de kaart"

`run-straks-browser-check.js` (also `npm run test:browser:straks`) drives the
real production build with a fixed browser clock (`2026-10-23`, a Friday,
Europe/Amsterdam) and screenshots the home section at 1280 and 390 px in light
and dark:

- **16:30** — the real data has only two borrel dishes, so the section falls
  back to "Straks op de kaart · vanaf HH:MM" with the dinner dishes of the next
  moment, each labelled "🕒 Opent om HH:MM" instead of "Nu open"; the "vanaf"
  time in the title is the earliest of those labels;
- **20:00** — enough for the current moment: the normal title "Vanavond op de
  kaart", "Nu open" only on dishes that are really open, and no opening time
  anywhere;
- **23:30** — after closing time: "Morgen op de kaart" with tomorrow's lunch.

The check also asserts three real dishes with a real price, one per restaurant,
the dish deep link of every card, the "Alles" link of the shown meal type, no
horizontal overflow, and that the server HTML of `/` contains no "Nu open", no
daghap, no moment section and neither fallback title.

The fixed clock is a test instrument only (`Date` override before navigation);
the product code always uses the browser clock and `Europe/Amsterdam`. The
record lands in `ops/browser/evidence/straks-browser-evidence.json`, the
screenshots in `ops/browser/evidence/be-38/`. This remains developer evidence
on a local build: not production, not independent review.

Build first (`node node_modules/next/dist/bin/next build`, or `npm run build`).

## BE-39 (#93) — "Klaar voor publicatie" in the concept list

`run-klaar-voor-publicatie-browser-check.js` (also
`npm run test:browser:publicatie`) is the focused fixture check for the second
badge. It starts the app on its own local port, intercepts only the two concept
read routes and drives one scenario (`?fixture=concepts-publication`): five
fictional cards, one per publication state plus one waiting card. The
publication objects in `fixtures/menuReviewFixtures.js` are produced by the
product's own pure rule (`src/lib/menuConceptPublication.js`), never by a
hand-written copy, so the screen shows what the server would return:

- **Klaar voor publicatie** — every gate green;
- **Nog niet klaar: Bron nog niet bevestigd.** — the first plain-language reason;
- **Review-PR gemerged** — with the short line `live na de volgende deploy`;
- **Vorige poging mislukt** — the real stored export status;
- a waiting card with only its existing status badge.

The check asserts the second badge, the header line `1 klaar voor publicatie`,
the merged note and that waiting cards stay unchanged at 1280 and 390 px in
light and dark, plus the ready/merged detail card. Screenshots
(`be39-publicatie-*.png`, `be39-detail-1280-light.png`) stay in the git-ignored
`ops/browser/output/be-39/`; only
`ops/browser/evidence/klaar-voor-publicatie-browser-evidence.json` is committed.
This is fixture evidence on a local machine: not real acceptance and not
independent review.

## BE-44 (#105) — sharing one dish, saving and the list

`run-be44-browser-check.js` (also `npm run test:browser:be44`) starts its own
local dev server and browser through the same runtime as the other checks and
records seven scenarios (`--lijst`, `--alleen=<naam>`):

- **delen** — on `/menu/6-diner` the card of the real dish "Poussin" (€20,95)
  has the share icon button with the accessible name "Deel Poussin" (since
  BE-49 (#115) a 44 × 44 px icon button, no filled background), under the
  description and not in the row with the price, at 1280, 390 and 320 px in
  light and dark. The check pre-sets the BE-49 preference "telefoonmenu", so
  the behaviour of this scenario is unchanged: at 1280 px (no
  `navigator.share`) the clipboard receives the existing BE-12 deep link with
  `?stand=` for the current theme and "Link gekopieerd" appears in a
  `role="status"`; at 390 and 320 px exactly `{ url, title }` goes to
  `navigator.share` — never `text` — and the clipboard alternative is forced
  there as well so the message is recorded at every width.
- **ontvanger** — opening the shared link shows "Iemand deelde dit gerecht met
  je" above the highlighted card, and the `?stand=` in the link does not change
  the page's theme for the receiver.
- **bewaren** (deel 2, criterium 4) — the button "Bewaren" next to "Delen"
  becomes "Bewaard" with `aria-pressed="true"` and a filled bookmark, the dish
  lands in `localStorage`, the bottom bar says "1 bewaard · Bekijken →" and
  links to `/mijn-lijstje`, and that state survives a reload before it can be
  switched off again.
- **mijn-lijstje** (deel 2) — `/mijn-lijstje` lists both saved dishes with dish,
  restaurant and price (including "op aanvraag" when the source has no price),
  each row links to its menu deep link and has its own remove button; "Lijstje
  delen" copies exactly the list link with the ids and the stand; removing one
  dish leaves one in storage.
- **gedeeld-lijstje** (deel 2) — opening
  `/mijn-lijstje?lijst=<two ids>,<unknown id>&stand=` shows "Gedeeld lijstje ·
  2 gerechten", says "Niet meer beschikbaar: 1", lets every dish be tapped,
  does not follow the stand for its own theme, and "Zet ze op mijn eigen
  lijstje" puts both dishes in the receiver's own storage with the message "Op
  je lijstje gezet".
- **tellers** (deel 3, criterium 5) — a successful share, copy, save (only when
  switching on, never when removing) and a click on "Reserveer" each send one
  POST to `/api/v1/tellers` with exactly `{ dish, event }`, `keepalive` and
  without a cookie; the page intercepts that route, and with the stub failing
  the buttons, "Bewaard" and "Link gekopieerd" still work with no error on
  screen. The real route in this build (no Supabase key) answers 204 without a
  body to a valid request, an unknown dish, an unknown event and an empty
  request, and there is no read route (GET → 405).
- **server** — the server HTML of a shared dish link has `og:title`
  "Poussin · €20,95", `og:description` with the restaurant and the address,
  `og:url`, and an `og:image` of 1200 × 630 for both stands (two different
  PNGs); an invalid dish position answers 404 instead of inventing a card; a
  shared list link has its own `og:title` ("2 gerechten om uit te kiezen"),
  `og:description`, `og:url` and list `og:image` (1200 × 630, two different
  PNGs); an empty or invalid list answers 404; the apple-touch-icon is
  180 × 180; `/menu/6-diner` without a dish deep link keeps the general
  metadata.

The record lands in `ops/browser/evidence/be44-browser-evidence.json` (in git);
the screenshots and the four `og:image` PNGs plus the apple icon stay outside git
in the ignored `ops/browser/output/be-44/`. `navigator.share`, the clipboard and
`localStorage` are real browser APIs inside a temporary headless profile: the
check proves the payload, the message and the stored list, not the real share
sheet, the real system clipboard or a private-mode failure. Developer evidence
on a local build — not production, not independent review.

## BE-49 (#115) — rustiger gerechtkaart en snel delen

`run-be49-browser-check.js` (also `npm run test:browser:be49`) starts its own
local dev server and browser through the same runtime as the other checks and
records seven scenarios (`--lijst`, `--alleen=<naam>`):

- **kaart** — on `/menu/6-diner` the real dish "Poussin": name and price on top,
  the description in `var(--text-secondary)` with a measured contrast ≥ 4.5:1 on
  the card, and one bottom row with the label ("Aanbevolen") on the left and two
  44 × 44 px icon buttons on the right ("Deel Poussin", "Bewaar Poussin"), each
  with a visible icon of ±20 px and no filled background, at 1280, 390 and 320 px
  in light and dark. Per stand a small card PNG lands in
  `ops/browser/evidence/be-49/` (in git); the full-width screenshots stay in the
  ignored `ops/browser/output/be-49/`. Saved, the bookmark is filled and
  `aria-pressed="true"`, still without text or filled surface.
- **eerste-keer** — with no preference a tap on "Delen" opens the sheet "Hoe deel
  je meestal?" (real checkboxes, `aria-modal`), at most three can be chosen and
  the other checkboxes are disabled at that limit; saving opens the small menu
  with the two favourites plus "Meer…", the preference lands in
  `localStorage` under `deelvoorkeur`, and picking WhatsApp opens exactly
  `https://wa.me/?text=<encoded deep link>` and counts one `gedeeld`.
- **een-favoriet** — with one favourite the same tap opens the Telegram link
  immediately: no sheet, no menu, one `gedeeld`.
- **toetsenbord** — with the share button focused, Enter opens the sheet, the
  focus is on the first checkbox, Tab and Shift+Tab stay inside, Esc closes it
  and the focus returns to the button with `aria-expanded="false"`; the same for
  the small menu.
- **links** — each of WhatsApp, Telegram, Sms, E-mail and Link kopiëren builds
  exactly its link from the contract (URL-encoded, no accompanying text) and
  counts one `gedeeld` with only `{ dish, event }`.
- **meer** — "Meer…" falls back to copying with "Link gekopieerd" on desktop and
  uses `navigator.share` with exactly `{ url, title }` where it exists.
- **instellingen** — "Delen via" stands next to the theme choice, opens the same
  sheet with the current favourites checked, saves a change immediately and
  "Wissen" brings back "Hoe deel je meestal?" on the next tap.

The record lands in `ops/browser/evidence/be49-browser-evidence.json` (in git).
`navigator.share`, the clipboard, the share links and `localStorage` are stubbed
inside the temporary headless profile: the check proves the payloads, the links,
the messages and the stored preference, not a real share sheet, a real mail or
sms app, or a private-mode failure. The approved mockup is an external artifact;
the screenshots are for the visual comparison by the Lead or the owner.
Developer evidence on a local build — not production, not independent review.


## BE-45 (#114) — the counter table in the internal admin

`run-be45-browser-check.js` (also `npm run test:browser:be45`) starts its own
local dev server and headless browser through the shared runtime and drives the
real `/internal/tellers` page with a fictional session and fictional teller rows
(`ops/browser/lib/fixture-page.js`, route `tellers` in
`ops/browser/lib/network-policy.js`). Scenarios, each a named step:

- `desktop` (1280, light and dark): the three period buttons with `aria-pressed`
  (7 dagen active by default), the three totals, the five column headers as real
  buttons with `aria-sort`, the default "Gedeeld, aflopend" order, a real re-sort
  on "Bewaard", a period change that reloads, the dish name as a public deep link
  and the unknown key with "onbekend gerecht" and no link;
- `mobiel` (390 light, 390 dark, 320 light): the table is replaced by the list
  with a single sort choice (column + direction) that really re-orders it, the
  same four dishes, 44 px targets and no horizontal overflow;
- `leeg`: `?tellers=leeg` — "Nog geen tellingen in deze periode.", zero totals,
  no table, light and dark;
- `fout`: `?tellers=fout` (a 503 from the fixture) — "Tellers zijn nu niet
  beschikbaar.", no table and no invented 0.

Ten small screenshots stay in `ops/browser/evidence/be-45/` (in git), the
record in `ops/browser/evidence/be45-browser-evidence.json` (a filtered run
writes `*.filtered.json`, which is git-ignored). The approved mockup is an
external Claude artifact this check cannot fetch; the screenshots are for the
Lead/owner visual comparison. Fixture evidence on a local build — not a real
Supabase table, not production and not independent review.
## BE-48 internal sign-in with a second step (#112)

`run-be48-browser-check.js` drives the real `/internal/login` and the new
`/internal/wachtwoord-vergeten` in a local app with a **fictional Supabase**
(`lib/be48-auth-stub.js` + `lib/be48-stub-page.js`). The app code is unchanged:
the real Supabase client, the real `mfa.enroll/challenge/verify` calls, the real
pages. Only the HTTP layer is fictional, and every URL outside the fake auth
origin and the app's own read routes is refused and recorded.

Scenarios (`--lijst`, `--alleen=<naam>`):

- **inloggen-en-koppelen** — labels, `autocomplete`, the "Toon" button with
  `aria-pressed`, ≥ 44 px controls, the "Wachtwoord vergeten?" link and no
  "30 dagen onthouden"; then password → "Beveilig je account met een app" with a
  QR image that really renders and the manual key → a wrong code in Dutch
  (`role="alert"`, never Supabase's English) → the right code lands on the same
  place as before (`/internal/menu-concepts` for this fictional workqueue).
- **fout-wachtwoord** — the contract sentence, no English text, still on the
  login screen.
- **wachtwoord-vergeten** — the neutral answer for an unknown address, the code
  screen with "Nieuwe code sturen" and "Ander e-mailadres", a wrong code in
  Dutch, and the right code continuing to the existing `/internal/set-password`.
- **bestaande-app** — an account that already linked an app goes straight to
  "Code uit je app", with no QR.
- **eigenaar-zonder-app** — a restaurant owner (`owner` only) is not asked to
  link anything and lands on the existing status page; the second step is for
  `internal` and `editor` accounts (BE-47 owns the restaurant route).
- **claim-met-code** — the public claim on `/claim/6`: a labelled e-mail field
  with `autocomplete="email"` (no placeholder-only field), ≥ 44 px controls, then
  the code screen ("Code uit de e-mail", `inputmode="numeric"`,
  `autocomplete="one-time-code"`, "Nieuwe code sturen" and "Ander e-mailadres");
  the right code signs the visitor in with the typed address and the claim itself
  is submitted and shows "In afwachting van beoordeling".
- **claim-foute-code** — a wrong (expired) code gives the Dutch sentence in
  `role="alert"` and never the Supabase text; "Nieuwe code sturen" asks the
  fictional Supabase again for the same address, "Ander e-mailadres" returns to
  the address step with the typed address kept and the error cleared, and the
  right code still works afterwards.

The claim uses its own code (`emailCode`, `654321`) next to the authenticator
code (`totpCode`, `123456`), so a code from one screen can never pass on the
other. `/api/claims/mine` and `POST /api/claims` are answered with fictional
data; they need no staff role and no second step.

Screenshots (light and dark) of the password, code and link-an-app screens land
in the ignored `ops/browser/output/be-48/`. Criterion 7's screenshots — login,
code step, linking, forgot password and the claim's code screen, light and dark
at 390 px — are kept in the repository under
`ops/browser/evidence/be48-screenshots/` and named in the evidence JSON
(`screenshotsMobile`, `screenshotsDir`). The record is
`ops/browser/evidence/be48-browser-evidence.json`. A filtered run writes
`be48-browser-evidence.filtered.json` and is never the full evidence.

Limits: fixture evidence. No real Supabase project, no real authenticator app,
no real e-mail, no production data or credentials, and no acceptance of the real
second step — that needs the owner's real project after the release plan.

## BE-46 (#106) — samen kiezen: a stemlink and a card stack

`run-be46-browser-check.js` (also `npm run test:browser:be46`) starts its own
local dev server (port 3166, `BE46_FIXTURE_PORT`) and browser through the same
runtime as the other checks and records six scenarios (`--lijst`,
`--alleen=<naam>`):

- **maken** — the whole route from making to result: `Mijn lijstje` with four
  saved dishes shows "Samen kiezen" next to "Lijstje delen"; one tap opens a real
  `role="dialog"` sheet ("Tot wanneer mag er gestemd worden?") that says "Geen
  sluitingstijd" while empty; filling in 18:00 and pressing "Maak de stemlink"
  sends exactly `{ dish_keys, sluit_om }` (the four ids in list order and an ISO
  closing time) to `POST /api/v1/kies`, after which "Stemlink gemaakt" and
  "Open de stemlink" → `/kies/<code>` appear; "Deel de stemlink" copies that
  link through the existing BE-49 share route, shows "Link gekopieerd" and sends
  the anonymous `gedeeld` counter once per dish of the stemming and nothing
  else; opening the link, giving a roepnaam, swiping all four dishes and ending
  on the group result works in the same session.
- **route** — the stemlink itself: roepnaam, four dishes, progress in
  `role="status"` ("Gerecht 1 van 4"), vote buttons labelled with the dish name
  and ≥ 44 px, `touch-action: pan-y`, an undo button that starts disabled, the
  result as a real `<ul>`, the favourite first with "Favoriet" and the existing
  "Reserveer"/"Route" actions, the result on reopening the link, and light and
  dark at 390 px.
- **swipen** — pointer drags: 40% right shows "Lekker →" and votes `lekker =
  true`, 10% left shows "← Liever niet" but stays under the 30% threshold and
  votes nothing, 45% left votes `liever niet`; light and dark screenshots of the
  stack.
- **toetsenbord** — the stack is reachable with the keyboard; ArrowRight and
  ArrowLeft cast the same votes as the buttons.
- **ongedaan** — "Vorige stem ongedaan maken" brings the last dish back and sends
  one `DELETE` with only the anonymous browser id.
- **zonder-migratie** — with the stub answering like a missing table (503) the
  page shows "Samen kiezen is nog niet beschikbaar", no card stack and no crash.

The record lands in `ops/browser/evidence/be46-browser-evidence.json`; the
screenshots stay in the repository under `ops/browser/evidence/be-46/`. A
filtered run writes `be46-browser-evidence.filtered.json` and is never the full
evidence.

Limits: fixture evidence. `/api/v1/kies*` and `/api/v1/tellers` are answered by
`stubSource()` in the page with the shape of `src/lib/kiesHandlers.js`; the
database, the migration 0022 and the real counter table are not involved, and
the approved mockup (an external Claude artifact) can only be compared by the
Lead or the owner against these screenshots. This is not acceptance.

## BE-53 (#130) — menukopje wijzigen in "Beoordeel menuconcept"

`node ops/browser/run-be53-browser-check.js` (of
`npm run test:browser:be53`; `--lijst` toont het scenario `wijzigen`, `--alleen`
draait alleen dat scenario) start de echte app met `next dev` op poort 3193
(`BROWSER_FIXTURE_PORT`) en bestuurt een lokaal geïnstalleerde Edge/Chrome via
CDP. De fixture `concepts-section-rename` bevat één fictief concept met het
kopje "Proef het beste van het seizoen — Hoofd"; versie 2 wordt met dezelfde
pure regel (`renameSectionEdits`) gebouwd als het scherm gebruikt.

Per thema en breedte (1280 en 390 px, licht en donker) wordt bewezen:
Wijzig opent met het toetsenbord (Enter) een gelabeld tekstveld met de huidige
naam en zichtbare focus; Tab gaat naar "Opslaan in deze correctie"; een
ongewijzigde en een lege naam geven een melding; opslaan toont de nieuwe naam
met de oude doorgestreept en een "Ongedaan maken" per kopje; ongedaan maken zet
de oude naam terug; opnieuw wijzigen werkt; "Correcties opslaan als versie 2"
opent de nieuwe versie, die in Structuur én in het Publicatievoorbeeld
"Hoofdgerechten" toont.

BE-53 deel 2 (contractpunten 5-7) gebruikt het tweede fictieve concept
`concept-be53-0200` in dezelfde fixture: twee kopjes beginnen met
"PROEF HET BESTE VAN HET SEIZOEN — " en één kopje heet "VOOR". Per thema en
breedte wordt bewezen: het voorstel met de knop **Weghalen** (met het
toetsenbord, Enter), waarna beide kopjes "HOOFD" en "DESSERT" heten en los
ongedaan te maken zijn; de knop **Normale hoofdletters**, waarna "Hoofd",
"Dessert" en "Voor" ontstaan en de knop verdwijnt; de negen standaardnamen als
snelkeuze in het Wijzig-veld; ongedaan maken van één kopje terwijl de andere
twee hun correctie houden; opnieuw kiezen en opslaan; en versie 2
(`concept-be53-0201`) met de drie nieuwe kopjesnamen in Structuur en
Publicatievoorbeeld. Versie 2 wordt met dezelfde pure regels
(`renameSectionsEdits`) gebouwd als het scherm: het voorvoegsel, de
hoofdletters en de snelkeuze in die volgorde.

Eén schrijfroute is fictioneel beantwoord: `POST
/api/internal/v1/menu-concepts/concept-be53-0100/versions`, exact dat pad en
alleen in dit script (de gedeelde lijst blijft ongewijzigd). Voor het tweede
concept geldt precies zo'n route voor `concept-be53-0200`; de fixture antwoordt
per concept-id (`versionResponses`). Het antwoord is de
nieuwe versie uit de fixture; de verstuurde edits worden in `localStorage`
bewaard en in het bewijs samengevat. Elke andere schrijf-, export- en
publicatieroute blijft geweigerd. Bewijs:
`evidence/be53-browser-evidence.json`; screenshots in het gitignorde
`output/be-53/`. Dit is ontwikkelaarsbewijs op een lokale machine, geen echte
database, geen merge en geen publicatie.


## Limits

This is fixture evidence. It does not prove a live Supabase session, a real
source import, a real concept save or decision, a browser rendering of an
actual restaurant site, or production behaviour. The product extraction
runtime remains disabled. The fictional session/API is intercepted in the page;
it never falls through to a real API or an external host. A green browser run
is not independent review and not authenticated acceptance.


## BE-47 (#111) — de restauranthouder op /mijn-restaurant

`run-be47-browser-check.js` (also `npm run test:browser:be47`) drives the real
`/mijn-restaurant/inloggen`, `/mijn-restaurant` and `/internal` in a local app
with the same **fictional Supabase** as BE-48 (`lib/be48-auth-stub.js`), now with
fictional claims behind `/api/claims/mine` and a fictional
`POST /api/mijn-restaurant/account-verwijderen`. The app code is unchanged: the
real pages, the real flow module, the real client. Only the HTTP layer is
fictional, and every other URL is refused and recorded.

Scenarios (`--lijst`, `--alleen=<naam>`):

- **inloggen** (390 and 1280, light and dark) — the sign-in screen with a real
  `<label>`, `autocomplete="email"`, ≥ 44 px controls, the "Claim je restaurant"
  route and the `/internal/login` hint; **no phone field at all** while
  `NEXT_PUBLIC_OWNER_SMS_LOGIN` is off; the neutral "if this address is known to
  us" notice; a wrong code in Dutch in `role="alert"`; the right code landing on
  `/mijn-restaurant` with the restaurant's name, the public page link, the menu
  link and the approved chip.
- **statussen** — one approved, one pending and one rejected claim side by side:
  three chips, the waiting text, and only the rejected claim offering
  "Opnieuw claimen".
- **verwijderen** — the confirmation, then a fresh code, a wrong code refused in
  Dutch with the account still there, the right code deleting the fictional
  account and signing out; the recorded request carries only `{ code }`, never a
  user id or an address.
- **doorsturen** — an owner-only account on `/internal` ends on
  `/mijn-restaurant` (no more "Nog niets te openen"); an `internal` account that
  uses the owner sign-in ends on `/internal/login` with its token still `aal1`.

Screenshots stay in `ops/browser/evidence/be-47/` (in git), the record in
`ops/browser/evidence/be47-browser-evidence.json` (a filtered run writes
`*.filtered.json`, git-ignored). Limits: fixture evidence. No real Supabase
project, mailbox or sms, no production data or credentials, and no acceptance of
the real sign-in. Release prerequisite: the **Magic Link** e-mail template in the
Supabase project must contain `{{ .Token }}` (the same requirement BE-48 already
has for the claim), because sign-in and the delete confirmation both ask for that
code. The contract's `reauthenticate()` step is *not* used for deletion: its
nonce can only be redeemed by `updateUser({ nonce })` and no server route can
verify it, so deletion asks a fresh sign-in code that the route verifies itself
(see src/lib/ownerAccountDeletion.js). The "Reauthentication" template is
therefore not needed for this flow.

## BE-54 (#133) — "Claim je restaurant": zoeken en direct naar de claim

`npm run test:browser:be54` (of `node ops/browser/run-be54-browser-check.js`).
Eén scenario, dus geen `--alleen`/`--lijst`; de poort is 3186 (uit 3180-3189) en
via `BE54_PORT` te wijzigen. De check start zijn eigen `next dev` en een lokale
Edge/Chrome via CDP; er is geen productie, geen account en geen externe host bij
betrokken.

Wat hij meet:

- **de link** — "Claim je restaurant" op `/mijn-restaurant/inloggen` wijst naar
  `/mijn-restaurant/claimen` (het houderoverzicht wordt alleen met een bronregressie
  bewezen: daarvoor is een ingelogde houder nodig);
- **zoeken tijdens het typen** — "Wolfslaar" geeft precies één regel met naam,
  adres en buurt, de knop "Dit is mijn restaurant" naar `/claim/1`, en
  `role="status"` met "1 restaurant gevonden.", op 1280, 390 en 320 px in licht
  en donker, met een tikdoel van minimaal 44 px en zonder horizontale overloop;
- **de knop zelf** — die opent de bestaande claimpagina `/claim/1` en verandert
  daar niets;
- **niets gevonden** — "zzzzzz" geeft de lege stand met de tip en, omdat
  `NEXT_PUBLIC_CONTACT_EMAIL` hier niet gezet is, géén `mailto:`-link;
- **toetsenbord** — een tabwandeling met een zichtbare focusring op elke stap,
  inclusief het zoekveld en de resultaatknop;
- **a11y** — de bestaande audit (`lib/a11y-audit.js`) voor deze ene pagina in
  licht en donker: contrast, toegankelijke namen, tikdoelen, koppen, landmarks en
  taal.

Bewijs: `ops/browser/evidence/be-54/` (zeven schermafdrukken, in git) en
`ops/browser/evidence/be54-browser-evidence.json`. De laatste volledige run gaf
71 checks en 0 fouten. Grenzen: dit is lokale ontwikkelaarsbewijs, geen
onafhankelijke review en geen acceptatie; de visuele vergelijking met de
goedgekeurde mockup blijft mensenwerk (de schermafdrukken staan er daarom in).
De pagina zoekt in dezelfde gegevens als `/alle-restaurants`
(`GET /api/restaurants`, dezelfde paginering) met de geteste regel uit
`src/lib/claimSearch.js`; er is geen nieuwe API, database of dependency.

## BE-57 (#139, deel 2) — de cijfers op "Mijn restaurant"

`npm run test:browser:be57` (of `node ops/browser/run-be57-browser-check.js`).
Eén run, drie standen; de poort is 3187 (uit 3180-3189) en via
`BE57_FIXTURE_PORT` te wijzigen. De check bouwt één keer vers (`next build`) en
serveert die opbouw met `next start`, plus een lokale Edge/Chrome via CDP, met de
fictieve Supabase uit `lib/be48-auth-stub.js`. `next start` heeft geen HMR: een
`next dev` deed na de eerste keer laden nog een volledige herlaadbeurt, waardoor
de gestubde sessie wegviel en de pagina tussen het overzicht en de inlogpagina
wisselde. Nieuw is de `ownerStats`-map in die stub: per pad een
fictief antwoord voor `GET /api/mijn-restaurant/<id>/cijfers` (alleen GET, alleen
met een sessie). Er is geen productie, geen echt account en geen externe host
bij betrokken.

Wat hij meet, per stand ("het overzicht", "Net geclaimd" en "nog geen cijfers"):

- **de vier cijfers** van "Deze week" in vaste volgorde, met de verandering ten
  opzichte van vorige week ("32 meer", "4 minder", "gelijk aan vorige week");
- **de drempel** — elk getal onder 5 heet in de browser "minder dan 5", ook in de
  top en in het maandcijfer, en de verandering valt dan terug op "te weinig
  gegevens om te vergelijken";
- **de top 4** met de naam uit de statische index en balkjes die echt smaller
  worden (100% → 50% → 27% → 9%);
- **de privacyregel** "Alleen totalen, nooit wie.";
- **"Je menukaart"** met "Laatst bijgewerkt op 25 maart 2026." en een link naar
  `/menu/1-lunch` van minimaal 44 px;
- **"Net geclaimd"** met de welkomstmelding, vier maandcijfers en precies drie
  dingen om mee te beginnen, zonder één link in dat blok;
- **niets uit een volgend ticket**: geen "Bevestigd", geen "Menukaart
  bijwerken", geen QR;
- **licht en donker op 1280, 390 en 320 px**, met het cijferblok in beeld, zonder
  horizontale overloop en met het thema echt toegepast;
- **toetsenbord** — een tabwandeling met een zichtbare focusring op elke stap,
  inclusief de link naar de menukaart;
- **a11y** — de bestaande audit (`lib/a11y-audit.js`) voor deze pagina in licht
  en donker, per stand: contrast, namen, tikdoelen, koppen, landmarks en taal.

Bewijs: `ops/browser/evidence/be-57/` (achttien schermafdrukken, in git) en
`ops/browser/evidence/be57-browser-evidence.json`. Grenzen: dit is lokale
ontwikkelaarsbewijs met een gestubde API, geen onafhankelijke review en geen
echte acceptatie; de visuele vergelijking met de goedgekeurde mockup blijft
mensenwerk (daarom staan de schermafdrukken erin).

## BE-61 (#152, variant A) — het deelblad "Delen via" in een echte browser

`npm run test:browser:be61` (of `node ops/browser/run-be61-browser-check.js`).
Drie scenario's op poort 3188 (uit 3180-3189, via `BE61_PORT` te wijzigen), met
een verse productieopbouw (`next build` + `next start`, de BE-57-opzet, zodat er
geen HMR-herlaadbeurt in een meting valt) en een lokale Edge/Chrome via CDP. De
pagina is `/mijn-lijstje`: die heeft de kop, de themaknop en de vaste tabbalk
zonder restaurantgegevens. Draai deze check alleen.

Wat hij meet:

- **het paneel in licht en donker op 1280, 390 en 320 px** — een echt
  dialoogvenster met naam en hint, een greepje van 36 × 4 px, een ronde
  sluitknop van 44 × 44 px met `aria-label="Sluiten"`, twee echte radios in één
  fieldset met een visueel verborgen legend, vijf regels van minstens 56 px met
  een icoon van 36 px, "0 van 3 gekozen", "Opslaan" van 52 px en "Wissen" zonder
  "Annuleren";
- **"Opslaan" is te raken** — de knop staat volledig in beeld en
  `elementFromPoint` in zijn midden geeft de knop zelf; geen horizontale
  overloop;
- **op 390 en 320 px ligt het paneel boven de tabbalk** — op drie punten over de
  balk is het bovenste element het paneel;
- **de volgorde van kiezen** — eerst Sms, dan WhatsApp, dan E-mail geeft de
  merkjes 2-1-3, "3 van 3 gekozen", de hint over 3 favorieten en de twee andere
  regels uit; het telefoonmenu schakelt de lijst uit en dimt hem;
- **sluiten en opslaan** — het kruisje, Esc en een tik naast het paneel sluiten
  het; "Opslaan" bewaart de keuze in `localStorage` onder `deelvoorkeur`;
- **het thema is aangetoond, niet aangenomen**, net als bij BE-60: een klik op
  de themaknop van de app zelf, en per opname `themeProof` met `data-theme`, de
  actieve knop en de helderheid van `--bg`.

Bewijs: `ops/browser/evidence/be-61/` (acht schermafdrukken als volledige
viewport, in git) en `ops/browser/evidence/be61-browser-evidence.json` (111
controles). De a11y-check is gefilterd gedraaid op de pagina met het paneel open:
`node ops/browser/run-a11y-public-check.js --alleen=instellingen --poort=3189`
(64 controles, 0 fouten). Grenzen: dit is ontwikkelaarsbewijs, geen
onafhankelijke review en geen echte acceptatie; de opslag en de keuze van het
gedrag staan in `src/lib/sharePreference.test.js` en de bedrading in
`src/lib/sharePreferenceSurface.test.js`.


## BE-63 (#155, ronde 4) — de kop en /inloggen in een echte browser

`npm run test:browser:be63` (of `node ops/browser/run-be63-browser-check.js`).
Vijf scenario's op poort 3189 (uit 3180-3189, via `BE63_PORT` te wijzigen), met
een verse productieopbouw (`next build` + `next start` in een eigen bouwmap, de
BE-57-opzet) en een lokale Edge/Chrome via CDP. De kop, het instellingenpaneel en
het mobiele menu worden gemeten op `/inloggen` (statisch, met dezelfde gedeelde
kop als de andere publieke pagina's en zonder API-aanroepen bij het laden); dat
is ook de nieuwe pagina uit dit ticket. Draai deze check alleen. Met
`--alleen=<scenario>` draai je één scenario; dat schrijft naar
`be63-browser-evidence.filtered.json` en niet naar het bewijs van de levering.

Wat hij meet:

- **de kop als gast op 1280, 390 en 320 px** — op 1280 "Voor restaurants",
  Inloggen en de instellingenknop; op 390 en 320 alleen Inloggen en de
  menuknop; geen horizontale overloop; de knoppen staan op één regel en de
  hoogte van de kop staat per breedte in het bewijs;
- **de kop als ingelogd** — dezelfde sessie-stub als de BE-59-check zet een
  fictieve sessie in `localStorage`; daarna staat het bestaande accountmenu in de
  kop en is Inloggen weg;
- **het instellingenpaneel op desktop** — het thema wisselt via de themakeuze in
  het paneel zelf (Licht, Donker en Automatisch) en "Delen via" opent het
  BE-61-venster;
- **het mobiele menu op 390 en 320 px** — het blok "Heb je een restaurant?" met
  Inloggen en Claim je zaak, de zin voor bezoekers, de weergave, Delen via en
  Mijn lijstje staan in beeld; het menu ligt boven de tabbalk
  (`elementFromPoint` in het midden van de laatste regel); Esc sluit het menu en
  de focus keert terug naar de menuknop;
- **`/inloggen`** — het accentlabel, de h1 "Inloggen bij je restaurant", de
  intro, het e-mailveld en de knop "Stuur mij een inlogcode" van 52 px (de knop
  in `--button-primary-bg`, vergeleken met de tokenswaarde), de uitleg over het
  geclaimde adres, het claimblok met drie stappen en de knop naar
  `/mijn-restaurant/claimen`, de bezoekerszin en de teamlink naar
  `/internal/login`; daarna scrolt de check naar het claimblok en de teamlink om
  te meten dat ze volledig in beeld passen;
- **het thema is aangetoond, niet aangenomen**: per opname legt `themeProof`
  `data-theme`, de actieve knop en de helderheid van `--bg` vast.

Bewijs: `ops/browser/evidence/be-63/` (volledige viewport-opnames, in git) en
`ops/browser/evidence/be63-browser-evidence.json`. Grenzen: dit is
ontwikkelaarsbewijs, geen onafhankelijke review en geen echte acceptatie; de
inlog zelf is niet uitgevoerd (geen Supabase-project) en de teksten en paden
staan in `src/lib/loginEntry.test.js` en `src/lib/ownerLoginSurface.test.js`.


`npm run test:browser:be60` (of `node ops/browser/run-be60-browser-check.js`).
Eén scenario, poort 3186 (uit 3180-3189, via `BE60_PORT` te wijzigen), `next dev`,
een lokale Edge/Chrome via CDP en één in de pagina gestubde `/api/search`
(`lib/be60-zoek-stub.js`): geen Supabase-project, geen productiesleutel, geen
productiedata.

Wat hij meet, per thema en breedte (1280, 390 en 320 px):

- **de nieuwe prijs** (€ 18,50) van een goedgekeurde wijziging staat er;
- **het label** "Tijdelijk niet beschikbaar" staat er precies één keer en het
  gerecht blijft in de resultaten staan, met zijn prijs;
- **de volgorde** blijft gelijk (twee gerechten);
- **in beeld** — label en prijs passen bij de opname in de viewport, en er is
  geen horizontale overloop;
- **het thema is aangetoond, niet aangenomen**. Het thema gaat via een klik op
  "Licht" of "Donker" in `ThemeToggle` (zoals BE-46 deel 2 en BE-57), en vóór
  elke opname legt `themeProof` drie dingen vast: `data-theme`, de knop die de
  app zelf actief noemt en de helderheid van `--bg` (licht > 200, donker < 80).
  Die keuring zit in `lib/theme-proof.js` en is getest in
  `lib/theme-proof.test.js`; `be60ThemeProof.test.js` bewaakt de bedrading. Een
  opname zonder kloppend bewijs telt niet — de eerste levering van BE-60 noemde
  een donkere pagina "light" en is daarop afgekeurd.

Bewijs: `ops/browser/evidence/be-60/` (zes schermafdrukken, in git) en
`ops/browser/evidence/be60-browser-evidence.json`, met per opname zijn
`themeProof`. Grenzen: dit is ontwikkelaarsbewijs met een gestubde zoek-API, geen
onafhankelijke review en geen echte acceptatie; de serverregels (overlay, filter,
volgorde) staan in `src/lib/zoekOverlay.test.js` en
`src/services/dishSearch.test.js`.


## BE-59 deel 3 (#146) - het accountmenu in een echte browser

`run-be59-browser-check.js` (ook `npm run test:browser:be59`) start zijn eigen
`next dev` op poort 3192 en een echte browser via CDP, met een gestubde sessie
en API (`lib/be59-stub-page.js`): de sessiesleutel `sb-127-auth-token` staat
vóór het laden in `localStorage`, `GET /api/internal/v1/me` geeft de rollen,
`/workqueue-counts` de open-werk-tellingen en `/api/claims/mine` geen claims.
Vier scenarios (`--lijst`, `--alleen=<naam>`):

- **gast** - geen sessiesleutel: geen accountknop, geen sessie- of rolopvraag,
  wel de footerlink "Voor restaurants - Inloggen" naar `/inloggen`;
- **inloggen** - beide keuzes met hun bestemming
  (`/mijn-restaurant/inloggen`, `/internal/login`) en de claimlink naar
  `/mijn-restaurant/claimen`;
- **beheerder** - `internal` + `editor` met zeven openstaande taken: knop met
  stip, "Beheer - 7 open", de rol in gewone woorden, toetsenbord (openen,
  pijltoetsen, Escape, focus terug), op 390 en 320 px het paneel van onderen met
  de sluitknop en de stapelvolgorde boven de vaste tabbalk, en op
  `/internal/tellers` "Bekijk de site";
- **houder** - `owner` zonder openstaand werk: geen stip, wel Mijn restaurant, en
  op `/mijn-restaurant` de kop "Mijn restaurant - [naam]".

Alles in licht en donker op 1280, 390 en 320 px, elk onderdeel volledig op de
opname, geen horizontale overloop, plus de a11y-audit van de publieke pagina's
op de home, `/inloggen` en het geopende menu. Bewijs:
`ops/browser/evidence/be59-browser-evidence.json` en `evidence/be-59/*.png`
**Het paneel van onderen boven de vaste tabbalk (herstel na Lead-review
#6537034100).** In `be59-beheerder-home-390-light-menu.png` lag de vaste
`MobileTabBar` ("Zoeken / Restaurants") over het paneel, waardoor "Uitloggen"
niet te zien en niet aan te tikken was. Sindsdien meet de browsercheck met het
paneel open op 390 en 320 px in licht en donker dat:

- het laatste item ("Uitloggen") volledig in beeld staat;
- `elementFromPoint` in het midden van dat item het item zelf geeft;
- op drie punten over de tabbalk (links, midden, rechts) de balk zelf nooit het
  bovenste element is: het paneel dekt hem, anders de overlay, dus er valt niet
  door het paneel heen te klikken;
- een echte klik op de overlay het paneel sluit zonder te navigeren.

De opname van het mobiele paneel is daarvoor de volledige viewport en geen
uitsnede, zodat de tabbalk en het paneel samen te zien zijn; de opname-eis
controleert ook dat beide binnen het venster vallen. De stapelvolgorde zelf is
een bronvergelijking in `src/components/AccountMenu.test.js`: de overlay staat
boven de tabbalk en het paneel weer boven de overlay, met de echte z-indexwaarden
uit `app/globals.css` en `src/components/account-menu.css`.

Bewijs: `ops/browser/evidence/be59-browser-evidence.json` en
`evidence/be-59/*.png` (49 opnamen). De laatste volledige run gaf 271 checks en
0 fouten.
`run-be59-load-size-check.js` meet de eerste laadgrootte van `/`, `/search`,
`/restaurant/[id]` en `/menu/[id]` op twee lokale productiebuilds (basis
`2b0e8b1` uit een losse worktree) en schrijft
`ops/browser/evidence/be59-load-size-evidence.json`. Lokale
twikkelaarsbewijs, geen productie en geen onafhankelijke review.
