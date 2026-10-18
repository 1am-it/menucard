# Menu-extractie - implementatieafspraken

Status: bouwafspraken voor GitHub #59, 2026-10-17; herstelronde na review
#6244808974 op 2026-10-18. Afgesplitst uit MENU-EXTRACTION.md v0.1.
Implementatie is veilig begonnen op `feat/menu-extraction-59`; een echte
provideractivering en PR #56 blijven buiten scope.

[Extractie-instructie](../../MENU-EXTRACTION.md) |
[Testplan](menu-extraction-acceptance.md) |
[Acceptatiematrix](menu-extraction-acceptance-matrix.md) |
[V2-schemaontwerp (niet geïmplementeerd)](../../planning/architecture/menu-extraction-product-schema-v2.md)

## Architectuur en contractmapping

- De backend voert veilige ophaling, modelaanroepen, tools, onafhankelijke
  validatie, achtergrondtaken en begrensde herpogingen uit. Geen aparte agent-app nodig.
- Leg eerst mapping naar bestaande code, schemagaps, tools, concrete budgetten,
  providerdoorgifte/retentie en opslagtrigger vast in een afzonderlijk bouwcontract.
- Beoordeel ook ogenschijnlijk geslaagde deterministische extractie op dekking.
  AI alleen na een parserfout voorkomt geen stilzwijgend onvolledig resultaat.
- Het bestaande benchmarkcontract src/lib/menuExtractionContract.js is
  geisoleerde tooling, niet automatisch het productcontract. Behoud verboden
  trustvelden en prijsregels; modifiers/arrangementen niet als gewone items vermommen.
- Benodigde informatie: broninventaris/leesdekking, menustructuur/items/prijsrelaties,
  bronbewijs/gegroepeerde aandachtspunten en uitgesloten onderdelen met reden.
- Maak eerst een verliesvrije mapping naar de echte productcontracten. Ontbreekt
  ondersteuning, ontwerp een versiegebonden uitbreiding ter goedkeuring.
  Geen stille afplatting, nieuwe enums of validatoromzeiling.

## Achtergrondverwerking (aanvulling #59)

De bestaande claim/lease-RPC's zijn de enige concurrency-grens. De
batchhandler heeft naast de geauthenticeerde browserroute één service-entry
(`processForWorker`) die dezelfde claim-, analyse-, receipt- en fail-stap
gebruikt. `ops/scripts/process-analysis-jobs.js` roept die begrensd aan met
`--max`; hij is expliciet géén cron of workflow en wordt niet automatisch
gestart. Zonder service-role-configuratie weigert hij. De worker schrijft geen
concept, bevestigt geen bron en publiceert niets.

### Ontwerp automatische achtergronduitvoering (niet geactiveerd)

Een automatische variant vereist een expliciet operationeel besluit; de
repository bevat daarom alleen dit ontwerp:

1. Een deployment-scheduler (bijvoorbeeld Vercel Cron) roept periodiek een
   server-only route `/api/internal/v1/analysis-worker/run` aan met een
   `CRON_SECRET` bearer. Geen browser- of gebruikerssessie is nodig.
2. De route roept `runAnalysisWorkerOnce` aan met dezelfde
   `processForWorker`-handler en `maxJobs`/deadline; de bestaande
   claim/lease-RPC voorkomt dubbele uitvoering naast een open browser.
3. De functie krijgt een korte `maxDuration` (bijvoorbeeld 60 s), een
   maximum aantal jobs per aanroep en een deadline. Een volgende run hervat
   alleen achtergebleven `pending`-jobs.
4. Logging bevat uitsluitend taak-ID, telling, duur en foutcode — geen URL's,
   broninhoud, gebruiker-ID's of secrets.
5. Rollback: scheduler uitschakelen; jobs blijven `pending` en de bestaande
   geauthenticeerde browserroute kan ze desnoods verwerken. Geen concept-,
   bronbevestigings- of publicatiestap loopt automatisch mee.
6. Vereist vóór activering: Product Owner-toestemming voor scheduler/hosting,
   een geheimbeheerafspraak, retentie-/privacybesluit en observatie. Geen
   nieuwe workflow is in deze ronde aangemaakt of gestart.

## 10. Backendvalidatie en controleerbare overdracht

De backend valideert onafhankelijk schema, types, bounds, bewijsverwijzingen,
prijsregels en onderlinge relaties. Geen modeluitvoer direct naar publieke data.
Het exacte contract staat in `src/lib/menuExtractionSchema.js`
(`menu-extraction-output/v1`): onbekende velden, ongeldige coverage, een
ontbrekende bewijsquote of een te lange waarde zijn fouten. `runStructuredExtraction`
weigert ongeldige limieten en een negatief budget, controleert invoer, pagina's
en uitvoer, reserveert budget vóór de call en annuleert de provider via
`AbortController`/`cancel()` bij een time-out. De providerneutrale
`menuExtractionRuntime.js` is de injecteerbare koppeling met de analyseketen;
de routes gebruiken bewust `disabledMenuExtractionRuntime()` totdat provider,
budget en gegevensvoorwaarden zijn goedgekeurd.

Houd deze gebeurtenissen afzonderlijk herkenbaar in de gebruikersweergave:
bron gevonden; inhoud gelezen; gegevens geextraheerd; controle nodig;
extractie onvolledig/onmogelijk; gevalideerd concept opgeslagen.
Dit zijn gewenste betekenissen, geen opdracht tot nieuwe database-enums.

Een bronbevestiging mag nooit suggereren dat gerechten zijn overgenomen.
Bij nul herkende gerechten: toon de werkelijke reden en een bruikbare vervolgstap,
niet een geslaagde menu-import. Laat handmatige controle het exacte resultaat
openen met restaurant, bron, pagina/sectie en voorgestelde inhoud intact.

Groepeer een gedeelde onzekerheid naar de onderliggende rubriek-/panelkoppeling.
Een expliciete menselijke beslissing geldt alleen voor getoonde items binnen
datzelfde bronbewijs en dezelfde bronversie. Het lost geen ontbrekende prijzen,
andere rubrieken of andere blokkerende fouten op. Geen algemene accepteer-alles.

Conceptopslag blijft versiegebonden, auditeerbaar en idempotent via de bestaande
review- en opslagroute. De exacte opslagtrigger wordt in het bouwcontract
vastgelegd: bestaande expliciete gebruikersstappen niet stilzwijgend verwijderen.
Bron bevestigen, intern goedkeuren, exporteren en publiceren blijven afzonderlijk
beveiligd. Dit extractieprotocol geeft voor geen van die acties toestemming.

## 11. Registratie en uitvoeringsgrenzen

De backend registreert taak-ID, bronhash/ophaaltijd, instructieversie en hash,
schema-/adapterversie, model/provider-ID en beschikbare versie-informatie,
gebruikte hulpmiddelen, verwerkingstijd, herpogingen en werkelijk tokengebruik/
kosten indien bekend. Een onbekende waarde blijft onbekend, niet nul.

Sleutels uitsluitend server-side. Geen credentials, gebruikersgegevens of
onnodige volledige broninhoud in logs. Geen interne review-/accountdata naar
het model sturen als die niet voor extractie nodig is. Bronbewaring en provider-
retentie volgen vooraf vastgelegde rechten-, privacy- en bewaartermijnafspraken.

Herpogingen alleen begrensd voor herstelbare fouten. Geen eindeloze modelcalls
om ontbrekende broninhoud te raden; geen betaalde fallback of OCR activeren
zonder besluit. Zonder passend budget/configuratie stopt de taak eerlijk.

## 12. Verplichte technische review voor implementatie

DeepSeek beoordeelt dit concept eerst alleen-lezen tegen:
- planning/specs/tickets/be-20-general-restaurant-source-extraction.md;
- planning/specs/tickets/be-21-restaurant-source-extraction-vendor-benchmark.md;
- src/lib/menuExtractionContract.js en bestaande productextractiecontracten;
- docs/api/canonical-restaurant-menu-schema.md;
- docs/api/data-trust-model.md;
- ops/benchmark/README.md en de bestaande adapters, scorer en structuurcorpus.

Lever mapping van protocolstap naar bestaande code, ontbrekende onderdelen,
verliespunten in het schema, benodigde hulpmiddelen, concrete kosten-/taaklimieten,
testplan en beslispunten. Dit concept autoriseert nog geen implementatie,
providerkeuze, credentials, nieuwe schema's of publicatie.


## 13. Herstelronde na review #6244808974 (2026-10-18)

Deze afspraken gelden naast de bovenstaande secties en vervangen ze niet.

### 13.1 Budgetcontract (provider-neutraal)

- `budget.reserve(maxCostEurCents)` en `budget.settle(amount)` zijn een
  **synchrone** grootboekinterface. Een thenable/promise wordt expliciet
  geweigerd (`async_budget_guard_unsupported`) vóórdat de provider wordt
  aangeroepen; een asynchroon contract wordt nooit stilzwijgend als verleend
  behandeld.
- Elk pad dat de provider daadwerkelijk aanriep boekt kosten: bekende kosten
  exact, onbekende kosten als `null`. `null` betekent "reservering volledig
  laten staan", zodat een betaalde mislukking niet als nul wordt afgeboekt en
  hetzelfde budget niet voor een tweede call hergebruikt kan worden.
- Een geslaagde provideruitvoer zonder geboekte kosten is geen succes
  (`budget_settle_failed`/`async_budget_guard_unsupported`); het resultaat wordt
  dan niet aan de analyse doorgegeven.
- Ontbrekende of gooiende guards blijven `budget_guard_required` /
  `budget_exceeded`; er is geen impliciet "onbeperkt" budget.

### 13.2 Kwaliteits- en dekkingspoort vóór een modelcall

`src/lib/menuExtractionQuality.js` beoordeelt het deterministische resultaat
vóór enige modelaanroep:

- vlaggen: ontbrekende rubriek, rubriekmarkering in een gerechtsnaam,
  duplicaat binnen een rubriek, hetzelfde gerecht in twee rubrieken (mogelijk
  platgeslagen menuvariant), verdacht lange naam, niet-eenduidige prijs,
  supplement als gerecht, en PDF-signalen (overgeslagen supplementregels,
  prijs midden in een regel, niet-herkende rubriekkoppen);
- alleen de gemarkeerde rubrieken worden `uncertain` ("Controle nodig"),
  nooit het hele menu en nooit een automatische goedkeuring;
- een voldoende deterministisch resultaat geeft **geen** modelcall
  (`deterministic_result_sufficient`);
- een bron met supplementen/relaties die het concept niet kan opslaan geeft
  **geen** modelcall (`unsupported_product_gap`), omdat
  `unsupportedProductFields` dat resultaat zou verwerpen;
- anders mag een gevalideerd modelresultaat uitsluitend de gemarkeerde bron
  vervangen: dekking ≥ 80% van het deterministische aantal, bewijsplicht per
  gerecht voor dezelfde bron, `replacesDeterministic`-metadata en alle
  rubrieken op `Controle nodig`. Geen samenvoeging, geen automatische
  goedkeuring, en een te klein resultaat wordt met reden geweigerd.

### 13.3 PDF-brontekst voor de adapter

- `readPdfMenuSource` (in `src/lib/restaurantSourceAnalysis.js`) levert naast de
  bestaande context een begrensde, pagina- en kolombewuste tekst
  (`compactPdfLayoutText`). Paginamarkeringen en een `|`-scheiding tussen
  kolommen behouden vindplaatsinformatie; de tekst is afgekapt op een vaste
  limiet en meldt dat (`extractionTextTruncated`).
- Dezelfde keten geldt voor een gevonden PDF én voor een directe PDF-url
  (`buildDirectPdfAnalysis` in `src/lib/sourceAnalysisPipeline.js`); de
  runtimehook wordt dus niet meer overgeslagen voor de directe PDF-tak.
- De tekst leeft alleen in het geheugen (`sourceTexts`) en komt nooit op
  `unknownMenuContexts`, de receipt, de notities of een logregel. Alleen
  telbare layoutmetadata (duplicaatlaag, supplementregels, arrangementregels,
  onduidelijke prijsregels, niet-herkende koppen) wordt bewaard.

### 13.4 Mapping en provenance

- `menuExtractionMapping` behoudt `variant` en `order`, zet `structure` op
  `uncertain` zodra een rubriek onzeker is, en laat `evidence.sourceId`,
  `quote` en `locator` intact (met de menu-bron als terugval).
- `buildMenuCandidateSummary` neemt `variant`/`order` en de volledige korte
  evidence over, zodat receipt en concept dezelfde broncontext houden.
- Niet-ondersteunde constructen (supplementen, allergenen, beschikbaarheid)
  worden nog steeds expliciet gemeld of geblokkeerd, nooit stil afgeplat.

### 13.5 Bronoverschrijdende kwaliteitspoort (review 6246984520)

- `assessDeterministicMenuQuality` beoordeelt elke bron afzonderlijk. Naast de
  bestaande totalen (`flags`, `codes`, `blockedByProductGap`,
  `requiresAiExtraction`) levert het `sourceStatus`, `blockedSourceIds`,
  `aiEligibleSourceIds` en `unscopedBlockedByProductGap`.
- Een productgat (supplement of arrangement) in bron s1 blokkeert alleen s1:
  s1 houdt zijn deterministische resultaat, blijft als "Controle nodig"
  gemarkeerd en houdt zijn eigen bron-ID/URL in de beperking. Een herstelbare
  fout in s2 leidt nog steeds tot de modelstap voor s2.
- Alleen niet-geblokkeerde bronnen gaan naar de adapter. Modeluitvoer voor een
  geblokkeerde bron wordt geweigerd met `source_blocked_by_product_gap`.
- `blockedByProductGap` blijft bestaan als "minstens één bron geblokkeerd" voor
  compatibiliteit; het is niet langer de schakelaar voor de hele analyse.
- Een layoutflag zonder bron-ID (`unscopedBlockedByProductGap`) blijft bewust
  globaal: zonder herkomst kan geen andere bron veilig worden toegestaan.
- Regressies: `menuExtractionQuality.test.js` (twee bronnen, reviewmarkering)
  en `restaurantSourceAnalysis.test.js` (s1 geblokkeerd, s2 hersteld, s1-
  modelmenu geweigerd, provenance behouden).

### 13.6 Blossem-achtige menuvarianten en arrangementen

- Een paneelkop met structureel bewijs (`role="button"`/`button`,
  `aria-expanded`, en een bestaand `aria-controls`/`data-target`-doel in
  dezelfde blok) wordt een menuvariantniveau. Een cookieknop zonder
  paneeldoel wordt nooit een kop.
- De variant blijft in het pad staan (`DINNER › VOOR`, `LUNCH › KOUD`), zodat
  gelijknamige rubrieken in lunch en diner niet meer samenvoegen.
- Een accordeonpaneel dat meerdere subkoppen en lijsten bevat, wordt als
  container gelezen en niet als één gerecht. Layoutklassen
  (`column`/`panel`/`section`/…) worden nooit als gerecht gelezen.
- Een prijselement aan het einde van een lijstitem (`<strong>4.5</strong>`)
  wordt via de strikte `parsePriceOnly`-regel gelezen; de algemene
  geldscanner accepteert bewust geen één-decimaalbedragen in lopende tekst.
- Een blok met meerdere alternatieve eindprijzen (`3 gangen 57 | 4 gangen 66`)
  wordt niet afgeplat tot een gerecht maar als uitgesloten sectie met pad en
  regelaantal gemeld (`excludedSections`, reden `alternative_prices`).
  `restaurantSourceAnalysis` zet dit om in een expliciete beperking en telt het
  op de bron; de kwaliteitspoort markeert die bron met
  `html_arrangements_skipped` als productgat, zodat een model de arrangementen
  niet als gewone gerechten kan terugzetten.
- Regressie: `htmlMenuVariants.test.js` (paneelvarianten, één-decimaalprijzen,
  cookieknop, arrangement-uitsluiting).

### 13.7 Smelt-achtige PDF-subrubrieken en arrangementregels

- `pdfMenuStructuring` houdt per kolom naast een rubriek ook de actieve
  menukop bij. Een kop met servicetijd (`LUNCH 12:00 – 15:00`) is het
  menuniveau; een prijsloze kop daaronder wordt een subrubriek
  (`LUNCH › Eieren`, `LUNCH › Broodjes`, `LUNCH › Overig`).
- Die nesting is uit volgorde/kolom afgeleid, niet uit typografie, en wordt
  daarom `uncertain` gemarkeerd. `pdfMenuContext` gebruikt het `path`-veld en
  behoudt zo dezelfde hiërarchie in receipt, review en concept.
- Een korte, hoofdletterige prijsloze regel direct boven een expliciet
  serveerbereik (`Voor 1, 2 of 4 personen`) geldt als arrangementintro en
  wordt niet als beschrijving aan het vorige gerecht geplakt; hij wordt geteld
  in `layout.arrangementLines` en als beperking gemeld.
- Regressie: `pdfMenuStructuring.test.js` (subrubrieken, onzekerheid,
  arrangementintro, schone Rillette-beschrijving).

### 13.8 Bronvaste vergelijking en read-only probe

- `src/lib/menuSourceComparison.js` vergelijkt een gecontroleerde referentie
  met de daadwerkelijke menucontexten en rapporteert afzonderlijk: gemist,
  extra, prijsafwijking, verkeerd gekoppelde rubriek en duplicaat. Er is geen
  samengestelde kwaliteitsscore en een gelijk aantal is geen bewijs.
  - Strikte boekhouding: elke referentierij wordt precies één keer verklaard
    (match, prijsfout, verkeerde rubriek of gemist) en elke werkelijke rij
    precies één keer (match, prijsfout, verkeerde rubriek of surplus). Een rij
    die na het matchen overblijft is altijd surplus; hij verdwijnt niet omdat
    dezelfde naam+prijs ergens anders in de referentie voorkomt (review
    6247746317). Hetzelfde gerecht in een extra rubriek of een tweede
    identieke rij in dezelfde rubriek is dus zichtbaar verschil.
  - Matchen consumeert rijen één voor één, zodat een herhaling die de
    referentie zelf verwacht als meerdere matches telt. `duplicates` meldt
    alleen herhalingen boven de verwachte multipliciteit, met `count` en
    `expectedCount`.
  - `accounting` geeft per zijde totaal, verklaringen en `balanced`. De probe
    weigert groen wanneer een zijde niet sluit.
- `ops/scripts/probe-menu-extraction-sources.js` haalt uitsluitend de twee
  benoemde publieke bronnen read-only op via `safeOutboundFetch` en de echte
  analyseketen, vergelijkt met `ops/benchmark/source-references.json` en
  controleert byte-/contenthash. Geen database, geen bevestiging, geen
  publicatie, geen provider.
- `ops/benchmark/probeVerdict.js` bevat de pass/fail-regel en is apart getest:
  een hashverschil, een mislukte analyse, een ontbrekende verschillenlijst,
  een niet-sluitende boekhouding of één enkele rij in `missing`/`extra`/
  prijs/koppeling/duplicaat laat de probe met exitcode 1 eindigen.
- De referentie is een gecontroleerde capture met bronhashes, geen
  waarheidsclaim voor een latere bronversie. Een hash- of itemverschil laat de
  probe met exitcode 1 eindigen.
- `ops/benchmark/sourceReferences.test.js` bewaakt de referentie zelf: gepinde
  byte-/contenthash, elk item met naam, prijs en pad, geen voorafgaand
  duplicaat, een gesloten bronlijst en geen schrijf-, provider- of geheimpad in
  de probe. De test telt bewust geen items als kwaliteit; alleen de probe tegen
  de echte bron beslist over een bronversie.

### 13.9 Holdoutmeting en fail-closed fixture-isolatie (review 6248407225)

- De vier door de Product Owner goedgekeurde openbare bronnen zijn eerst
  capture-only gepind in `ops/benchmark/holdout-sources.json` en
  `ops/benchmark/holdout-references.json`. `capture-menu-extraction-holdout-
  references.js` schrijft uitsluitend die referentie (create-only) en bevat geen
  parser-uitkomst, itemaantal of provider.
- `probe-menu-extraction-holdout.js` leest daarna één keer via de echte
  analyseketen en schrijft `ops/benchmark/holdout-evaluation.json`
  (create-only). De uitkomsten zijn observaties: De Botanist 151 items/59
  secties met kwaliteitsbeperkingen, Mr Moos en Colonia 0 items, Gauchos Breda
  HTTP 404. Er is geen parserregel op basis van deze uitkomsten gewijzigd.
- De holdout-guard (`acceptanceSetGuard.js`) kent `unused`, `evaluated_once` en
  `used_for_tuning`. Een tweede evaluatie en een getunede bron in de holdout
  worden geweigerd; een getunede bron moet naar representatief plus een nieuwe
  holdout.
- De browserfixture is fail-closed: `network-policy.js` is de enige policy voor
  fetch, XHR, WebSocket, EventSource, sendBeacon en de CDP-laag. Onbekende
  externe URLs, protocol-relative URLs, onbekende API-/schrijfroutes en niet-GET-
  apprequests worden geweigerd en geregistreerd. Chromium gebruikt daarnaast
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`. Negatieve
  VM-regressies bewijzen dat de native fetch/XHR niet wordt bereikt.

### 13.10 #56-compatibiliteit (alleen gelezen)

- `origin/feat/compact-source-flow-53` (PR #56, head `00f4151`) is read-only
  vergeleken vanuit dezelfde basis (`fc12bbc`). Een in-memory
  `git merge-tree --write-tree HEAD origin/feat/compact-source-flow-53` op
  #59-HEAD `aa6c84a` geeft **drie** inhoudelijke conflicten:
  `app/internal/source-triage/batch/page.js`, `src/lib/htmlMenuStructure.js` en
  `src/lib/menuSnapshotProposals.test.js`. De eerdere notitie van twee
  conflicten was van vóór de latere Blossem-/parserwijzigingen op deze branch;
  `htmlMenuStructure.js` is nu ook aan beide zijden gewijzigd. Dat is een
  combinatiegat, geen merge-besluit.
- Andere overlappende bestanden automergen in die proef
  (`BatchAnalysisView.js`, `MenuReview.js`, `batchAnalysis*.js`,
  `menuConceptReviewHandlers.test.js`). Dat is geen acceptatie en er is geen
  merge uitgevoerd; de #56-branch is niet overgenomen of gewijzigd.
