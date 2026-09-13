# MARKET-04B — Controlled Breda CSV/JSONL Intake Script

## Status

Proposed, **not started**. Documentation/planning only — no code,
migration, script, route, or Supabase change exists yet for anything
described here.

## Depends on

`MARKET-03` (source registry — a **new** source registration is a hard
precondition, see Phase 0; this ticket registers no source itself).
`MARKET-04`/its `MARKET-04A` amendment (the `ImportRun`/
`ImportExtractionRecord` contract and the six live tables it already
established — reused **unchanged**, no new column, table, or grant
proposed here; see "Open datamodelvragen" for the two gaps this ticket
found but does not resolve). The concrete, proven precedent
`ops/scripts/import-breda-osm.js`/`import-breda-osm.config.js` and the
primitives it already reuses from `capture-market-boundary.js`
(`HaltError`, `generateUuidV7`, `sha256File`/`sha256String`,
`canonicalJsonStringify`, `assertLiveConfirmation`). `src/lib/candidateNormalization.js`
(`normalizeAddressNL`/`normalizePhoneNL`/`normalizeWebsite`) and
`src/lib/importInbox.js`'s `computePossibleDuplicateIds`, both reused
**exactly as they exist today**, no change. `docs/api/import-inbox-api.md`'s
existing `GET /api/internal/v1/import-inbox/runs` for observability.
**Not** dependent on `MARKET-05B` (cross-source canonical dedup — still a
blocked placeholder, unrelated to this ticket) or `MARKET-11` (review-side
scaling — a separate concern, only a Phase 2 trigger below, never a
Phase 1 prerequisite).

## Relationship to `PLATFORM-08B` and `MARKET-02B`

Three separate, non-competing tracks, each with its own contract and
moderation path — restated briefly here, not redecided:

- **`MARKET-04B`** (this ticket) is the bulk/partner/internal intake for
  controlled `basic_info` candidates from a single, newly-registered
  source.
- **`PLATFORM-08B`** is the separate track for individual community
  signals — a missing-restaurant report, a single targeted correction, or
  an official menu-link submission.
- **`MARKET-02B`** is the separate track for moderatable, source-bound,
  structured menu proposals and their canonical publication.

None of these tracks replaces or automatically feeds another. Any
eventual transfer between them remains an explicit, separately-moderated
step, never an automatic pipeline.

## Problem

The only existing mechanism for getting restaurant data into
`import_extraction_records` is `ops/scripts/import-breda-osm.js` —
hardcoded to OpenStreetMap/Geofabrik via GDAL, gated by `MARKET-04`'s own
hard gate 3B for anything beyond internal review. There is no
source-agnostic, controlled way to bring in a **newly, separately
registered** CSV or JSONL source (e.g. a Gemeente Breda open-data export,
a manually compiled list, a licensed dataset) while keeping the exact same
discipline the OSM pipeline already proved live: preflight verification,
allowlist minimisation, artifact-hash-aware idempotency, a hard record
cap, structured per-record error handling, and an explicit human
confirmation before any write. `/internal/import-inbox` itself is,
deliberately, a review environment only — it has no bulk-upload or
source-connector interface, and this ticket does not give it one (see
Non-goals and "Mockup boundary").

## Objective

A second, controlled CLI intake script — a structural mirror of
`import-breda-osm.js`, not a new platform — that turns one CSV or JSONL
file from one **newly source-registered** origin into real
`ImportRun`/`ImportExtractionRecord` rows, reusing `MARKET-04`'s existing
contract and every already-tested primitive it offers, so a small,
controlled first Breda batch (and, later, larger ones) can enter the
existing review pipeline safely, auditably, and idempotently.

## User story

As whoever needs to bring a newly-approved Breda data source into the
review queue, I want a CLI script that validates, reports, and only then
writes — with the same dry-run/live split, hash-based idempotency, and
hard cap `import-breda-osm.js` already proved — so a CSV/JSONL import is
exactly as safe and auditable as the existing OSM pipeline, without a
second, differently-behaved import mechanism to reason about.

## Non-goals (explicitly out of scope for this ticket)

- **No upload UI in this phase.** Phase 1 is deliberately a CLI script
  with a textual dry-run/validation report — see "Mockup boundary" for
  exactly what a future Phase-3 upload/batch-management page would
  require before it may even be designed.
- **No bronconnectorplatform, external ETL tool, or workflow
  orchestrator.** See "Why a source-registered CLI, not a web upload page
  or connector platform" below for the reasoning.
- **No automatische of geplande import.** Every run is a single, explicit,
  human-triggered CLI invocation — `triggered_by: 'manual'`, matching
  `import-breda-osm.js`'s own only-used value today. Scheduling is a
  `docs/api/import-run-schema.md`-documented open question
  (`triggered_by: 'scheduled'` exists in the enum) that this ticket does
  not activate.
- **No new deduplicatielogica.** `computePossibleDuplicateIds`
  (`src/lib/importInbox.js`) is reused completely unchanged — a read-only,
  non-authoritative, within-batch reviewer hint, never `MARKET-05B`'s
  eventual real cross-source matching/merging.
- **No `MARKET-05B`-vervanging or -preview.** Cross-source canonical
  deduplication stays exactly the blocked placeholder it already is.
- **No directe schrijfactie** naar `field_provenance`,
  `restaurant_profile_drafts`, enige canonieke of publieke
  restaurantdata, of `data/restaurants.json`/`data/menus.json`. This
  script writes **only** to `import_extraction_records`, via a real
  `ImportRun`, exactly like `import-breda-osm.js` does today.
- **No nieuw autorisatie- of rolmechanisme.** The script itself is a
  locally/CI-run CLI tool authenticating to Supabase as `service_role`,
  exactly like `import-breda-osm.js` and `capture-market-boundary.js`
  already do — no new `staff_roles` value, no relaxed grant, no new
  internal API route in this phase (existing `GET .../runs` already
  covers observability).
- **No nieuwe dependency** in this ticket's phase.
- **No migratie wordt hier geschreven.** Where this ticket's own schema
  research finds `ImportRun` may not fully cover a manifest need (see
  "Open datamodelvragen"), that is recorded as an open decision for a
  later, separately-approved step — never a schema change proposed or
  implied here.

## Why a source-registered CLI now, not a web upload page or connector platform

- **A CLI script reuses, almost verbatim, code already written, tested,
  and twice live-verified.** `import-breda-osm.js`'s preflight,
  idempotency, cap-enforcement, dry-run/live split, and temp-file cleanup
  are not OSM-specific in shape — only the extraction step (GDAL vs.
  CSV/JSONL parsing) differs. A web upload page would still need this
  exact core logic behind it, plus a second, new layer on top (file
  storage, upload validation, size/type limits, a new authenticated
  route surface) — for no benefit at the batch sizes this ticket targets
  (25–500 records, see Phased delivery).
- **A web upload UI is real, avoidable complexity at this scale.** It
  introduces a new `internal`-only route that must be independently
  re-verified against `authenticateInternalRequest`/`isInternalOnly`, a
  new file-handling surface, and a new place a mistake could expose more
  than intended — for a task a trusted internal operator can already do
  locally with a script that behaves exactly like the one they may
  already know from the OSM pipeline.
- **A connector platform's real value doesn't apply here.** This
  project has registered exactly three sources in its entire history
  (Kadaster/PDOK, OpenStreetMap, Geofabrik — `docs/api/source-registry-schema.md`).
  Generic ETL/connector tools earn their keep with many heterogeneous,
  continuously-synced sources and typically default to replicating a
  source's full schema — the opposite of this project's allowlist-first,
  `basic_info`-only minimisation discipline. Introducing one now would add
  a second system to operate without removing any of the custom
  provenance/audit code this project's own contracts require regardless.
- **Matches this project's own established pattern exactly**: every
  write-capable action that has ever touched real data in this codebase
  (`capture-market-boundary.js`, `import-breda-osm.js`) is an explicit,
  scoped, human-confirmed CLI invocation — never an automated or
  self-service surface.

## Intake contract

- **Ondersteunde formaten**: CSV (met header-rij, RFC 4180-achtige
  quoting) en JSONL (één JSON-object per regel) — bewust niet meer dan
  deze twee, om de scope beperkt te houden.
- **Encoding**: UTF-8 verplicht. Een bestand met een andere/onherkenbare
  encoding wordt vóór enige parsing geweigerd (fail closed) — nooit
  stilzwijgend geraden of getranscodeerd.
- **Expliciete schema-/mappingversie**: elk intakebestand wordt verwerkt
  onder een benoemde, versienummerde mapping-configuratie (welke
  CSV-kolom/JSONL-sleutel naar welk `basic_info`-veld mapt). Deze versie
  wordt onderdeel van de idempotency-inputs (zie hieronder) — een
  gewijzigde mapping produceert altijd een nieuwe `idempotency_key`, nooit
  een stilzwijgende hergebruik van een oudere run se sleutel.
- **Bronrecord-id/rijnummer**: elke `record_locator` combineert de
  bronbestand-identiteit met een stabiel rij-anker — het rijnummer voor
  CSV, het regelnummer of een expliciet id-veld voor JSONL — hetzelfde
  contract `record_locator` al vervult voor `osm:node:<id>`
  (`docs/api/import-run-schema.md`).
- **Minimale allowlist**: exact de bestaande, al goedgekeurde
  `basic_info`-set (`docs/api/source-registry-schema.md`'s "Data
  categories" sectie) — naam, bezoekadres, algemeen bedrijfstelefoon-
  nummer, algemeen bedrijfscontactadres, website-URL, reserveringslink,
  en een bron-structurele categorie/typeaanduiding. Nooit
  eigenaars-/personeelsnamen, persoonlijke contactgegevens, vermoedelijke
  privéadressen, of enig ander veld dat een natuurlijk persoon
  identificeerbaar maakt — fysiek niet gelezen, niet achteraf gefilterd,
  hetzelfde principe als `minimizeOsmNodeProperties`.
- **Validatiefouten**: een rij die een verplicht veld mist, een ongeldige
  waarde bevat, of buiten de allowlist valt, wordt geclassificeerd als
  `skipped` of `errored` — dezelfde drieledige classificatie
  (`stored`/`skipped`/`errored`) als `classifyAndExtractFeature` vandaag
  al toepast. Nooit een gegokte of gedeeltelijk ingevulde waarde.
- **Veilige onbekende kolommen**: elke kolom/sleutel buiten de
  gedeclareerde mapping wordt genegeerd, nooit automatisch meegenomen —
  mirroring `osmconf.ini`'s `other_tags=no` en
  `minimizeOsmNodeProperties`'s expliciete allowlist-only lezen.

## Immutable batch manifest

Elke run legt exact dezelfde velden vast als `ImportRun` vandaag al biedt
(`docs/api/import-run-schema.md`):

- `data_origin_source_id` + `data_origin_source_authorization_version_id`
  — de nieuw geregistreerde bron, nooit een bestaande OSM/Kadaster-rij
  hergebruikt voor andere data.
- `source_artifact_hash`(`_algorithm`) — sha256 van het volledige
  ingediende bestand, exact zoals `import-breda-osm.js` dat al doet voor
  de Geofabrik-extract.
- `started_at`/`completed_at` — het importmoment.
- `record_counts` `{fetched, stored, skipped, errored}` en `error_log[]`
  — aantallen en foutoverzicht, bestaand contract.
- `status` inclusief `partial` — een deels geslaagde run is een verwachte
  toestand, geen te verbergen fout.
- `idempotency_key` — zie "Idempotency, retries, checkpoints" hieronder.

**Twee velden die de gebruiker als vereist noemt, bestaan nog niet expliciet
op `ImportRun`** — vastgelegd hieronder onder "Open datamodelvragen",
niet stilzwijgend aangenomen of opgelost.

## Dry-run

Spiegelbeeld van `import-breda-osm.js`'s `--dry-run`: echte preflight tegen
de echte, nieuw geregistreerde bron/autorisatieversie, echte parsing en
classificatie van het hele bestand, een echt `{fetched, stored, skipped,
errored}` + `error_log[]`-rapport — en **nul schrijfacties**. `mutate:
false` maakt de insert-paden structureel onbereikbaar, ongeacht welke
`dbClient` wordt meegegeven, exact zoals `runImport`'s bestaande
`mutate`-parameter dat vandaag al garandeert.

## Expliciete live-gate

Alleen bereikbaar na menselijke beoordeling van het dry-run-rapport, via
dezelfde expliciete `--live --confirm-market=<slug>`-bevestiging
`import-breda-osm.js`/`capture-market-boundary.js` al vereisen, **plus**
een verplichte `--max-records-to-store=<n>`, drievoudig afgedwongen
(bij validatie vooraf, bij het opbouwen van de records, en nogmaals
onmiddellijk vóór de databaseschrijfactie) — exact het bestaande
`processGdalFeatureCollection`/`runImport`-patroon.

## Idempotency, retries, checkpoints

`idempotency_key` wordt gecomputeerd op dezelfde inputs als
`computeIdempotencyKey` al gebruikt — `data_origin_source_id`,
autorisatieversie, `market_id`, `source_locator` (bestandsidentiteit),
`source_artifact_hash` (het hele bestand) — **uitgebreid met** een
vingerafdruk van de gebruikte mapping-/parserversie (zie "Intake
contract"), zodat een gewijzigde mapping nooit als dezelfde import wordt
behandeld. `retried_from_run_id` wordt ongewijzigd hergebruikt: een
retry is altijd een nieuwe, expliciete `ImportRun`-rij, nooit een mutatie
van de vorige.

**Checkpointgebruik is in Fase 1 niet verplicht.** Bij ≤500 records uit
één lokaal bestand, volledig in het geheugen geparsed, is een volledige
herverwerking bij een retry goedkoop en veilig — de `idempotency_key` op
`ImportRun`-niveau voorkomt dubbeltelling sowieso, exact zoals
`import-breda-osm.js`'s eigen enkelvoudige `runImport`-doorloop vandaag
ook geen paginering nodig heeft. `checkpoint` blijft `null`, ongebruikt,
in Fase 1 — en wordt pas een harde eis zodra Fase 4 (5.000+ records,
echte paginering) wordt bereikt.

## Recordclassificatie, foutartefacten, veilige retries

Dezelfde drieledige classificatie (`stored`/`skipped`/`errored`) als
`classifyAndExtractFeature`, dezelfde gestructureerde `error_log[]`,
dezelfde `partial`-status zodra minstens één rij foutief is maar niet
alles — en dezelfde drievoudige `maxRecordsToStore`-afdwinging als
hierboven, zodat een run nooit meer records schrijft dan expliciet
gevraagd, door constructie, niet door conventie.

## Open datamodelvragen (na onderzoek van `docs/api/import-run-schema.md`)

**Bevestigd: het bestaande `ImportRun`-contract draagt vrijwel het hele
manifest zonder enige schemawijziging** — bronreferenties, markt-/
grensreferentie, `access_method_used`, `source_locator`, `source_version`,
`source_artifact_hash`(`_algorithm`), `started_at`/`completed_at`,
`status`, `record_counts`, `error_log`, `checkpoint`, `idempotency_key`,
`triggered_by`, `retried_from_run_id` bestaan allemaal al, live, ongewijzigd
bruikbaar.

**Twee gaten gevonden, hier expliciet niet opgelost:**

1. **Geen operator-/actorveld op `ImportRun`.** `triggered_by` is een
   enum (`manual`/`scheduled`/`retry`), geen foreign key naar
   `auth.users(id)` — in tegenstelling tot `promoted_by`/`reviewer_id`/
   `decided_by` elders in dit project se eigen schema-familie. Of
   `ImportRun` een `triggered_by_user_id`-achtige kolom nodig heeft, is
   een open beslissing voor wie ooit de migratie schrijft — dit ticket
   stelt er geen voor.
2. **Geen apart, leesbaar veld voor de gebruikte mapping-/parserversie.**
   Alleen impliciet meegenomen in `idempotency_key`'s eigen hash-
   vingerafdruk ("a fingerprint of the relevant execution configuration"),
   nooit als los, doorzoekbaar veld. Of een zichtbare
   `mapping_version`/`parser_config_fingerprint`-kolom de moeite waard is,
   blijft hier expliciet open.

**Beide gaten zijn niet uniek voor CSV/JSONL** — `import-breda-osm.js`
heeft exact hetzelfde gat vandaag (geen operatorkolom, extractie-
configuratie alleen binnen de idempotency-hash) en draait daar sinds
2026-09-05 zonder probleem mee. Geen van beide gaten blokkeert Fase 1.

## Observability

Hergebruikt `GET /api/internal/v1/import-inbox/runs` ongewijzigd — een
CSV-/JSONL-run verschijnt in deze bestaande lijst exact zoals een
OSM-run, met `data_origin_source_name` opgelost naar de nieuw
geregistreerde bron. Geen nieuwe route, geen nieuwe UI nodig om het
resultaat te zien.

## Mockup boundary

**Voor `MARKET-04B` zelf is geen UI-mockup nodig.** Fase 1 is bewust een
CLI-script met een tekstueel dry-run- en validatierapport — geen
gebruikersinterface bestaat om te ontwerpen.

**Een eventuele Fase-3 interne upload- of batchbeheerpagina mag pas
ontworpen en gebouwd worden na:**

- een afzonderlijk ontwerpbesluit;
- een nieuwe of bijgewerkte ticket-scope (dit ticket autoriseert geen
  UI-implementatie);
- een foto-vrije light- en dark-mode mockup voor desktop én mobiel,
  volgens `docs/mockups/README.md`'s bestaande conventie;
- expliciete validatie dat die UI dezelfde server-side intake-,
  autorisatie- en auditgrenzen gebruikt als de CLI (geen tweede, lossere
  route).

Zo'n latere mockup moet minimaal tonen: bron, bestand, dry-run-uitkomst,
aantallen, fouten, de harde cap, expliciete bevestiging, en runstatus.
**Geen nepknoppen en geen automatische publicatiepaden.**

## Gefaseerde levering — met expliciete go/no-go per fase

Elke fase maakt expliciet onderscheid tussen **technische
importcapaciteit** (wat het script veilig kan verwerken) en
**menselijke reviewcapaciteit** (wat een klein intern team daadwerkelijk
kan beoordelen) — de twee zijn nooit hetzelfde getal.

### Fase 0 — Bronregistratie en contractbesluit

Registreer de daadwerkelijke CSV/JSONL-bron onder `MARKET-03`:
`Source`/`SourceAuthorizationVersion`, `basic_info`-scope,
`raw_import`+`internal_quality_review`+`moderation_preparation`
toegestaan, licentie-/toestemmingsbewijs, reviewer, datum, reden.

**Go/no-go**: geen bronregistratie betekent geen implementatie en geen
live import — hard, zonder uitzondering, exact zoals `MARKET-04`'s eigen
hard gate 2 vandaag al voor OSM/Geofabrik/Kadaster geldt.

### Fase 1 — Het intakescript

Bouw het CSV/JSONL-intakescript als structureel spiegelbeeld van
`import-breda-osm.js` — preflight, parse→classificeer→minimaliseer→hash,
dry-run-rapport, verplichte `maxRecordsToStore`-cap, expliciete
live-bevestiging — met dezelfde soort lokale, wegwerpbare
fixture-/unit-testdekking als `import-breda-osm.test.js` al toont
(inclusief een bron met meer matches dan de cap, die maximaal de cap
daadwerkelijk wegschrijft).

**Go/no-go vóór de eerste echte productie-import**:
(a) dry-run-rapport door een mens beoordeeld, zonder onverwachte
foutpercentages of ongeautoriseerde velden; (b) volledige testsuite +
lokale wegwerp-Postgres-validatie, zoals elke eerdere migratie/script in
dit project; (c) `npm run build` groen; (d) bevestigd dat er geen
schrijfpad bestaat voorbij `import_extraction_records`; (e) de
**technische cap staat op maximaal 500**, maar de **eerste operationele
live-batch wordt aanbevolen op 25–50 records** — bewust kleiner dan de
technische cap, zodat een eerste fout klein en makkelijk terug te draaien
blijft.

### Fase 2 — Reviewschaal (trigger-gebaseerd, niet automatisch)

Pas wanneer het reviewvolume dat aantoonbaar vereist — niet preventief —
`MARKET-11` Fase 1 (server-side filtering, exacte tellingen,
cursor-paginering) oppakken.

**Go/no-go**: alleen starten zodra een échte batch de huidige
`RECORD_LIMIT`(2000)/`REVIEW_LIMIT`(4000)-plafonds materieel nadert of
overschrijdt, of zodra de menselijke reviewcapaciteit zichtbaar achterloopt
op de technische importcapaciteit.

### Fase 3 — Interne uploadroute (alleen bij een tweede/terugkerende bron)

Heroverweeg een dunne interne uploadroute die dezelfde kernlogica
omwikkelt — **nooit** vóór een apart ontwerpbesluit, een bijgewerkte
ticket-scope, en de foto-vrije mockup uit "Mockup boundary" hierboven.

**Go/no-go**: alleen wanneer dezelfde bron herhaaldelijk opnieuw
geïmporteerd moet worden, of meerdere niet-technische interne operators
zonder CLI-toegang moeten kunnen triggeren.

### Fase 4 — Grootschalige inname (5.000+ records)

Ruimtelijke/cross-source deduplicatie-herziening,
`computePossibleDuplicateIds`'s O(n²)-grens aanpakken, echte
paginering/`checkpoint`-gebruik, en verdere `MARKET-11`-fasen worden
harde voorwaarden, geen optionele polish meer.

**Go/no-go**: niet starten vóórdat Fase 2's reviewschaalwerk daadwerkelijk
is opgeleverd en live bewezen — grootschalige import zonder
reviewcapaciteit produceert alleen een onbeheersbare wachtrij.

## Risks

- **Bronregistratie overslaan "omdat het maar een CSV is"** — precies het
  gevaar dat `MARKET-04`'s hard gates bestaan om te voorkomen; gemitigeerd
  door Fase 0 als absolute, niet-onderhandelbare eerste stap te
  positioneren.
- **Sluipende scope-uitbreiding richting automatische publicatie** — elke
  sectie hierboven herhaalt expliciet dat dit script uitsluitend naar
  `import_extraction_records` schrijft; geen enkel pad naar canonieke/
  publieke data bestaat in deze ticketfase.
- **CSV-rijen zonder lat/lon worden door `computePossibleDuplicateIds`
  stilzwijgend overgeslagen** (de functie vergelijkt alleen kandidaten
  met zowel naam als locatie — "candidates missing a name or a location
  are never considered"). Dit is bestaand, gedocumenteerd gedrag, geen
  nieuw gat — maar betekent dat CSV-bronnen zonder coördinaten geen
  dedup-hint krijgen. Of geocoding ooit nodig is, blijft een open vraag
  (zie Open questions), niet hier beslist.
- **De twee ontbrekende `ImportRun`-velden (operator, mapping-versie)**
  worden pas een echt operationeel risico bij een tweede, andere operator
  of een tweede, wijzigende mapping — bij één klein eerste batch (Fase 1)
  is dit verwaarloosbaar, zoals `import-breda-osm.js`'s eigen ervaring
  al aantoont.
- **O(n²)-dedupheuristiek** blijft acceptabel tot enkele honderden
  records per run — expliciet niet geschikt vanaf de 5.000-schaal zonder
  Fase 4's herziening.

## Open questions (expliciet niet hier beslist)

- Of `ImportRun` een `triggered_by_user_id`-achtige operatorkolom nodig
  heeft (zie "Open datamodelvragen").
- Of een zichtbare `mapping_version`/`parser_config_fingerprint`-kolom de
  moeite waard is naast de bestaande impliciete hash-vingerafdruk.
- Of geocoding (lat/lon toevoegen aan CSV-rijen zonder coördinaten) ooit
  nodig is om `computePossibleDuplicateIds`'s bestaande hint bruikbaar te
  maken voor een niet-geo-getagde bron — niet beslist, niet aanbevolen
  hier.
- Exacte CSV-kolomnamen/JSONL-sleutelnamen voor de mapping-configuratie
  van de eerste echte bron — afhankelijk van welke bron in Fase 0
  daadwerkelijk wordt geregistreerd, dus niet vooruit te bepalen.
- Retry-/backoff-drempels — hetzelfde al-bestaande open punt uit
  `docs/api/import-run-schema.md`'s eigen "Open questions", ongewijzigd
  hier overgenomen, niet opnieuw beslist.

## Acceptance criteria

- [ ] Een nieuwe bron is onder `MARKET-03` geregistreerd (`basic_info`,
      `raw_import`+`internal_quality_review`+`moderation_preparation`)
      vóórdat enige implementatie of live import plaatsvindt.
- [ ] Het intakescript volgt exact het bestaande preflight →
      idempotency-check → extractie/minimalisatie → (alleen bij `--live`)
      schrijf-volgorde van `import-breda-osm.js`.
- [ ] Dry-run voert echte preflight en classificatie uit tegen de echte,
      geregistreerde bron, zonder enige schrijfactie.
- [ ] Live-modus vereist een expliciete bevestiging plus een verplichte,
      drievoudig afgedwongen `maxRecordsToStore`-cap.
- [ ] Elke run produceert een `ImportRun`-rij met `idempotency_key`
      (inclusief mapping-/parserversie-vingerafdruk) en
      `import_extraction_records`-rijen, uitsluitend via de bestaande
      allowlist-minimalisatie.
- [ ] Geen enkel schrijfpad bestaat naar `field_provenance`,
      `restaurant_profile_drafts`, canonieke/publieke data, of de
      statische JSON-bestanden.
- [ ] `computePossibleDuplicateIds` en de bestaande review-/enrichment-/
      Restaurant Profile Drafts-flow zijn volledig ongewijzigd.
- [ ] De eerste echte productie-batch blijft ≤50 records; de technische
      cap staat op maximaal 500.
- [ ] Geen upload-UI, bronconnector, geplande import, of nieuwe
      dependency is gebouwd in deze ticketfase.
- [ ] De twee gevonden `ImportRun`-schemagaten (operator, mapping-versie)
      zijn vastgelegd als open beslissing, zonder voorgestelde migratie.

## Suggested order

Volgt direct op `MARKET-04`/`04A` in Wave 2 ("Import & sourcing
infrastructure") van `planning/architecture/market-data-foundation-plan.md`
— een gecontroleerde uitbreiding van dezelfde infrastructuur, geen nieuwe
golf. Onafhankelijk van `MARKET-05B` (geblokkeerd) en `MARKET-11`
(reviewkant-schaling, alleen een latere trigger hierboven) — blokkeert
geen van beide en wordt door geen van beide geblokkeerd. Niet gepland;
oppakbaar zodra een concrete, te registreren CSV/JSONL-bron zich aandient.
