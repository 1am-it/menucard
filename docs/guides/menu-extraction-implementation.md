# Menu-extractie - implementatieafspraken

Status: bouwafspraken voor GitHub #59, 2026-10-17; herstelronde na review
#6244808974 op 2026-10-18. Afgesplitst uit MENU-EXTRACTION.md v0.1.
Implementatie is veilig begonnen op `feat/menu-extraction-59`; een echte
provideractivering en PR #56 blijven buiten scope.

[Extractie-instructie](../../MENU-EXTRACTION.md) |
[Testplan](menu-extraction-acceptance.md) |
[Acceptatiematrix](menu-extraction-acceptance-matrix.md) |
[Botanist-referentie](menu-extraction-botanist-reference.md) |
[V2-schemaontwerp (read-only geïmplementeerd)](../../planning/architecture/menu-extraction-product-schema-v2.md) |
[Handmatige AI-import, fase 1 (ter goedkeuring)](../../planning/specs/tickets/menu-extraction-manual-ai-import.md)

## V2 schema-/mappinglaag en read-only aansluiting (ronde 2026-10-19)

De goedgekeurde interne bouwronde voegt een pure, versiegebonden laag toe voor
menuvarianten, prijsvarianten en supplementen:

- `src/lib/menuProductSchemaV2.js`: canonieke
  `menu-extraction-product/v2`-validator met unieke IDs, verwijsscope,
  prijsbewijs per bedrag, expliciete `unknown`/`origins`, allergenenstatus en
  een fail-closed `readProductRecord`;
- `src/lib/menuProductMappingV2.js`: `mapV1ToProductV2`,
  `projectProductV2ToV1` (weigert met `unsupported_v1_projection`) en
  `checkProductV2ExportSuitability` (weigert, schrijft niets);
- `src/lib/menuExtractionMapping.js` weigert nu een v2/onbekende envelop in
  plaats van hem als v1 te lezen;
- `src/lib/menuProductIntegrationV2.js` is de enige read-only brug naar de
  bestaande receipt-, review-, concept-, batch-, workqueue- en exportpaden:
  één gesaneerde, begrensde view, expliciete `sourceVerification: "unverified"`
  en één concrete weigering vóór hash, claim, insert, update, RPC of GitHub.

De integratie heeft geen netwerk, databaseclient, credential, v2-writeflag of
provider. Bestaande v1-invoer en routes blijven werken; de publieke export
blijft geblokkeerd. De inventaris van receipt/concept/JSONB/RPC/hash/audit/
idempotentie/export en de latere, nog niet uitgevoerde SQL-aanpassingen staan
in [menu-extraction-v2-integration.md](menu-extraction-v2-integration.md).
Dit is geen echte bron → conceptopslag, geen browseracceptatie en niet DONE voor
#59.

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

### API-schema versus validator (review 6373786786, #59)

Sinds deze ronde zijn er twee schema's met een verschillende rol:

- `src/lib/menuExtractionSchema.js` (`menu-extraction-output/v1`) is en blijft
  **leidend**: het controleert elke waarde, elk verband en elk bewijs.
- `buildOutputJsonSchema()` in `src/lib/menuExtractionAnthropicCall.js` is
  alleen de *vorm* die het model via `output_config.format` moet aanhouden. Het
  volgt de gedocumenteerde structured-outputregels (bijna alles verplicht, alleen
  gedocumenteerde keywords) en is op waarden losser dan de validator, nooit
  strenger. Een lege waarde (`[]`, `""`, `false`, `null`) is altijd geldig, dus
  de strengere aanwezigheidsregel blokkeert nooit een eerlijke extractie.
- `--output-mode=prompt` (alleen in de proef) stuurt géén `output_config` en zet
  hetzelfde schema in de instructie; de validator beslist in beide modi.
- De providercall wapent zelf een harde deadline op `limits.callTimeoutMs` en
  registreert bij een fout `errorClass`, `errorType`, `errorMessage` (max. 300
  tekens, opgeschoond), `requestId`, `errorCause` en `deadlineHit`.

Zie [de proefgids](menu-extraction-ai-probe.md) voor de citaten, de meting en
het bewijs.

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


### 13.11 Praktijkdiagnose en gerichte reparaties (review 6248740792)

- De eerste vier holdoutuitkomsten blijven ongewijzigd in
  `holdout-evaluation.json`. De Botanist, Mr Moos en Colonia zijn daarna voor
  reparatie gebruikt en expliciet naar `representative` met
  `usedForTuning: true` verplaatst. Alleen Gauchos Breda blijft holdout
  (`evaluated_once`, HTTP 404). Een nieuwe holdout is nog niet gepind.
- **Colonia**: de menukaart gebruikt herhaalde kaarten met een eigen
  class-gebaseerd prijselement (`p.gerecht-prijs`) met hele euro's en één
  decimaal. Dat is nu structureel prijsbewijs via de bestaande strikte
  prijsregel. De cadeaukaartlink is geen menulink meer. Resultaat: 84 items in
  16 secties; wijn/brunch/high tea blijven gemeld als niet verliesvrij.
- **Mr Moos**: `/menukaart` is alleen een hub. De analyse volgt nu één
  begrensd niveau naar dezelfde-site-menulinks, binnen het bestaande
  `MAX_CANDIDATES`-fetchbudget; geen tweede hub, geen cross-host, geen extra
  budget. Resultaat: 247 items in 3 menu's; `/groepsmenu` werd in de meting
  door de robots/rate-gate geblokkeerd en is als beperking gemeld.
- **De Botanist**: de PDF-tekstlaag veroorzaakte vier concrete fouten:
  herhaalde prijzen werden als tweede tekstlaag onderdrukt, naam en prijs op
  nabije baselines werden gescheiden, ABV-percentages werden als naam/prijs
  gelezen, en twee kolommen werden als één sectie gelezen. Deze zijn hersteld
  met regressies in `pdfMenuStructuringLiveRegressions.test.js`. Een
  gecontroleerde referentie uit de PDF-layout staat in
  `botanist-reference.json` en `docs/guides/menu-extraction-botanist-reference.md`.
  De vergelijking is 95/141 matched, 46 missing, 5 extra, 0 prijsverschil en
  96 niet-gekoppelde items. Dat is een kwaliteitsbeperking, geen acceptatie.
- De PDF-fixes zijn tegen Smelt en Blossem opnieuw uitgevoerd: 37/37 en 43/43,
  byte-/contenthash gelijk en alle verschilcategorieën 0.

### 13.12 Prijsbewijs per tekstblok en lokale naam/prijsrelatie (review 6249303096)

- **Geen pagina-brede prijsankers meer.** De oude regel telde herhaalde
  numerieke X-posities over de hele pagina; twee prijsposities rechts konden
  daardoor het enige geldige bedrag in een dun bezette linkerkolom schrappen.
  Prijsbewijs gebruikt nu het tekstblok dat pdfjs zelf levert:
  `priceOnlyItem` waar een heel tekstblok uit prijzen/scheidingstekens bestaat,
  plus een expliciete variantreeks (`6.5 / 25.0`). Een getal binnen een
  naamdragend tekstblok is geen prijs zolang er rechts daarvan een echt
  prijsblok staat (`0.0 Regrets` → 7.5, `6 st.` → 65.0). Een naamgetal zonder
  eenheid is sinds review 6249915021 niet meer te onderscheiden van een
  glas-/flesbedrag en wordt als ambigu gemeld; zie 13.13.
  Als pdfjs een prijs aan de naam plakt (`Fictief Broodje 3.00`) en er staat
  geen prijsblok rechts, blijft dat slotbedrag de prijs. Zo verdwijnt geen
  geldig gerecht en ontstaat geen verzonnen prijs.
- **Verticale nabijheid.** Een naam+prijs op twee baselines wordt alleen
  gekoppeld binnen `MAX_NAME_PRICE_BASELINE_DISTANCE = 24` PDF-eenheden.
  Gemeten op de gepinde Botanist-PDF: echte paren liggen 1,2–18,5 eenheden
  uit elkaar, de mediane regelafstand is ~11,2; de losse 127,8-eenheid en de
  550-eenheid voettekst in de reviewreproductie zijn geen paren.
- **Eerlijke onzekerheid.** `layout.unlinkedPriceLines` telt prijshoudende
  regels die zonder lokaal naam/prijsbewijs niet als gerecht zijn opgenomen.
  `pdfLayoutLimitations` en `menuExtractionQuality` (`pdf_unlinked_price_lines`)
  melden dat als beperking; een PDF met zulke regels is niet `sufficient`.
- **Supplementen blijven supplementen.** Een regel die met `Supplement` /
  `Supplementen` begint, en de lowercase wrapped continuation daarvan, wordt
  geteld in `layout.supplementLines` en nooit als gewoon gerecht opgeslagen.
  De kwaliteitscontrole herkent ook `${name}` met dat prefix als
  `supplement_as_item`. Sinds review 6252891629 opent een losse kop
  `// SUPPLEMENTEN` of een herkenbare gewone kop `SUPPLEMENTEN` /
  `SUPPLEMENTEN (per stuk)` een supplementsectie voor de hele kolom tot de
  volgende aantoonbare sectiekop. Alle regels eronder worden geteld en als
  `layout.supplementSections` (kop + pagina + regelcount) gemeld; geen ervan
  wordt een gerecht of een hoofdprijs. Een losse `Supplement ...`-regel blijft
  de bestaande inlinevorm en opent geen sectie.
- **Regressies:** `pdfMenuStructuring.test.js` (sparse linkerkolom + twee
  wijnvarianten, losse voettekst, korte/grote baselineafstand, twee kolommen,
  varianten op de volgende baseline, naamgetallen, supplementblokken),
  `menuExtractionQuality.test.js` (`pdf_unlinked_price_lines`,
  supplementprefix) en `restaurantSourceAnalysis.test.js` (limitationtekst).
- **Hercontrole:** Smelt 37/37 en Blossem 43/43 blijven exact; de gecommitte
  Botanist-vergelijking is na review 6249915021 195 parseritems, 95/46/5, 0
  prijsverschil en 95 niet-gekoppeld (zie 13.13). De nieuwe analyse meldt 12
  supplementregels, 19 midden-in-de-regel-prijzen en 24 niet-gekoppelde
  prijsregels als beperking.
  Dat is nog steeds ontwikkelaarsbewijs, geen onafhankelijke bronwaarheid.

### 13.13 Eén ambiguïteitsregel voor hele en decimale bedragen (review 6249915021)

- **Geen notatie-afhankelijke beslissing meer.** `classifyNumericEvidence`
  gebruikte `/[.,]/` als tie-breaker: `6.0` werd ambigu, `6` werd naamtekst en
  het volgende getal werd een bekende prijs. Nu is elk prijsvormig getal tussen
  een naamrun en een volgend bedrag ambigu, tenzij een expliciete eenheid
  (`6 st.`), een leidend `0.0` of een expliciete variantreeks (`6.5 / 25.0`)
  het getal resolveert.
- **Tekstgroepering is geen bewijs.** pdfjs voegt een naam en een dichtbij
  gelegen bedrag samen (`Fictieve Wijn 6`), dus een geplakt naamgetal of een
  geplakte hele regel krijgt dezelfde veilige behandeling als een gesplitst
  item.
- **Zelfde uitkomst per geometrie.** `Wijn 6 25`, `Wijn 6.0 25.0` en
  `Wijn 6,00 25,00` leveren bij gelijke geometrie alle drie geen item, geen
  bekende prijs en één `ambiguousPriceLines`; de metamorfe matrix dekt
  gesplitst, dicht bij de naam, twee verre bedragkolommen, geplakt naamgetal en
  een geplakte hele regel.
- **Gate en limitation.** De teller bereikt `pdf_ambiguous_price_lines` en de
  plain-language limitation; de ketentest draait de drie notaties door parser →
  qualitygate → limitation en bewijst dat geen enkele `sufficient` wordt.
- **Eerlijke Botanist-uitkomst.** `Monkey 47 10.0` is structureel gelijk aan een
  glas/fles-regel zonder scheidingsteken en wordt nu als ambigu gemeld. De
  gecommitte vergelijking is 195 parseritems, 95/46/5, 0 prijsverschil en 95
  niet-gekoppeld; de referentiesecties zijn exact gelijk. Geen drempel of
  referentie is aangepast om dit groen te maken.
- **Regressies:** `pdfMenuStructuring.test.js` (metamorfe notatie- en
  groeperingsmatrix, eenheid, scheidingsteken, echte integerprijs, meerdere
  gerechten/kolommen), `restaurantSourceAnalysis.test.js` (drie notaties door
  de keten), `botanistReference.test.js` (gemeten vergelijking).

### 13.14 Sectie- en naamdekking op dezelfde PDF-layout (review 6250261342)

De review vroeg om de genoemde sectieblokken en afgekorte naamregels op
dezelfde gepinde Botanist-PDF te onderzoeken, een fouttaxonomie te maken en
alleen generiek aantoonbare verliezen te herstellen. De productieparser is
niet als referentie gebruikt; de referentie v1 is niet aangepast.

**Kolommen.** `pageColumnAnchors` gebruikt na een markerrij nu ook
sectiemarkers die op een **stabiele tekstkolomstart** staan, ook wanneer de
markers op verschillende regels staan. Een gecentreerde menutitel
(`// ONZE COCKTAILS`, `// SHARED DINING`) is geen kolomstart en maakt dus geen
kolom. De kolom wordt 10 eenheden naar links verbreed omdat een marker iets
inspringt ten opzichte van zijn eigen items. Hiermee blijven naam en bedrag op
pagina 3 (`PREMIUM FRISDRANKEN`, `fritz`) in dezelfde kolom.

**Doorlopende secties.** Een kolom zonder eigen kop boven zijn eerste inhoud
erft de dichtstbijzijnde kop van de naastgelegen kolom (STARTERS, DESSERTS,
LUNCH). Die koppeling is structureel bewijs, maar wordt als `uncertain`
gemarkeerd en via `inheritedSectionColumns` /
`pdf_inherited_sections` gemeld. Een marker die direct onder de bovenliggende
sectiekop opent (PREMIUM FRISDRANKEN → `// Double Dutch`) wordt een
subrubriek, geen tweede topsectie; twee markers op dezelfde visuele regel
(binnen 3 eenheden) blijven broers. Dit voorkomt dat een beschrijvingsregel
als losse rubriek wordt opgeslagen.

**Meerregelige namen versus omschrijvingen.** Een naam wordt alleen
uitgebreid bij expliciet bronbewijs:

- een connector aan het einde van de naam (`/`, `&`, `-`, `van`, `met`, `en`,
  `of`) of aan het begin van de vervolgregel (`/`, `&`, `(`);
- een losse portielabel op dezelfde regel (`8st.`) of een portie tussen
  haakjes (`(20cl)`);
- een korte `&`-variantlijst;
- een herhaald merk-/naamprefix op het volgende geprijsde item (keuzelijst).

Zonder dat bewijs blijft de regel een omschrijving. Een korte Titel-Case-regel
direct onder een geprijsd item (`England IPA`, `Hibiscus Soda`) wordt dus geen
subrubriek en ook geen geraden naam. Een losse portieregel (`8st.`, `6 st.`)
wordt geteld (`portionLines`) en nooit een gerecht of een hoofdprijs.

**Prijs en hoeveelheid.** Een los ABV-item (`5.0%`) wordt vóór de
baselinegroepering verwijderd; het is nooit naam of prijs. Een bedrag dat een
haar boven zijn eigen naam staat (ABV-microbaseline) wordt alleen gekoppeld
wanneer de prijsregel ongebruikt, prijs-only en binnen 3 eenheden is. Een
naam boven een lokale prijs-only-baseline mag nu ook drie tot zes woorden
hebben (`Blue Velvet Gnocchi`, `The Crunchy Caprese`); de koppeling blijft
begrensd door `MAX_NAME_PRICE_BASELINE_DISTANCE = 24`.

**Nieuwe tellers, limitations en flags.** `inheritedSectionColumns`,
`inheritedSubheadingColumns`, `nameContinuationLines` en `portionLines` staan
in `layout`. `pdfLayoutLimitations` meldt overgenomen rubricering en
portieregels in gewone taal; `menuExtractionQuality` voegt
`pdf_inherited_sections` (reviewflag) en `pdf_portions_skipped`
(productgap) toe. Een bron met alleen een overgenomen rubricering is dus niet
`sufficient`; een portie blokkeert een modelcall die het concept toch niet kan
opslaan.

**Historische meting (vóór review 6252891629).** 214 parseritems in 50
categorieën; referentie v1 (141 rijen) ongewijzigd: 130 matched / 11 missing /
4 extra / 0 prijsverschil / 80 niet-gekoppeld. Layout: 18 ambigu, 9
niet-gekoppelde prijsregels, 12 supplementregels, 4 overgenomen kolomsecties, 1
subrubriek, 13 naamcontinuaties en 2 portieregels. Het reproduceerbare script is
`ops/benchmark/runBotanistComparison.js` (hashcheck, geen netwerk/provider).
Na review 6252891629 zijn de zes supplementrijen als productgap geclassificeerd;
zie 13.15 voor de actuele meting.

**Voorstel, geen acceptatie.** `ops/benchmark/botanist-reference.proposed-v2.json`
bevat drie brononderbouwde correcties (Sourcy als twee familie-/portieregels,
`Ginger Beer` zonder merkprefix, lemonades buiten fritz als niet-ondersteund
Soof-blok). Dat voorstel is historisch apart gescoord (133/1/1/0) en vervangt v1
niet; die meting hoort nog bij de keten vóór de supplementreparatie. Zie 13.15
voor het v3-voorstel, dat de vijf leesbare Soof-rijen in de noemer herstelt.

**Regressies.** `pdfMenuStructuringLiveRegressions.test.js` dekt
doorlopende secties, meerdere kolommen, een merk-subkop, expliciete
naamconnectoren, porties, een beschrijving onder een geprijsd item, een
driewoordige naam boven een lokale prijsregel en een ABV-microbaseline.
`pdfMenuStructuring.test.js` behoudt de bestaande prijs-/supplementveiligheid;
`menuExtractionQuality.test.js` en `restaurantSourceAnalysis.test.js` dekken de
nieuwe reviewflag, productgap en limitations.

### 13.15 Supplementrubriek en referentiedekking (review 6252891629)

**P1 — hele supplementrubriek, niet één regel.** Een `// SUPPLEMENTEN`-marker
of een herkenbare gewone kop `SUPPLEMENTEN` / `SUPPLEMENTEN (per stuk)` zet de
kolom in supplementcontext. Elke volgende regel tot de volgende aantoonbare
sectiekop wordt geteld in `layout.supplementLines` en nooit als gerecht
opgeslagen. De context is per kolom en per pagina: de rechterkolom en de
volgende pagina erven hem niet. Een losse `Supplement ...`-regel blijft de
bestaande inlinevorm; anders zou een gewrapte supplementnaam de volgende
gewone gerechten opslokken.

`layout.supplementSections` bevat alleen de begrensde herkomst: kop, pagina's
en aantal regels. Nooit supplementnamen of bedragen. `pdfLayoutLimitations`
en `menuExtractionQuality` noemen de sectie en pagina, zodat de review het
blok kan terugvinden. `pdf_supplements_skipped` blijft een productgap-flag en
blokkeert een modelcall voor die bron.

Op de gepinde PDF: 208 parseritems, `SUPPLEMENTEN` 0 items (was 6 met
hoofdprijs), 18 supplementregels en `supplementSections` = `SUPPLEMENTEN`,
p. 2, 6 regels.

**P2 — noemer en twee scores.** Het v3-voorstel
(`botanist-reference.proposed-v3.json`) houdt de vijf leesbare Soof-lemonades
met naam en 4.8 in de meetlat als `unsupported_readability`; er is geen
itemloze `unsupportedSection` meer voor dat blok. v1 en v2 blijven ongewijzigd.

`runBotanistComparison.js` rapporteert nu:

- `coverage`: alle referentierijen, met `matched`, `missing`, `productGap`,
  `extra` en `matchedRatio`;
- `supportedSubset`: dezelfde score zonder expliciet beperkte rijen, met
  `excludedRows` (naam, prijs, support, reden);
- `accounting`: sluitende boekhouding (`matched + missing + productGap + extra`
  tegen `referenceItems + extra`).

De zes supplementrijen worden op basis van `layout.supplementSections` als
`unsupported_product_field` geclassificeerd: ze zijn leesbaar, maar mogen geen
gewoon gerecht worden. Ze gelden niet als match en niet als missing.
Gemeten op dezelfde PDF: v1 124/11/4/0 + 6 productgap (totaal 141);
v3-voorstel 127/6/1/0 + 6 productgap (totaal 139), subset 128 rijen
127/1/1/0. Het verschil 130 → 124 is de geclassificeerde productgap, geen
kwaliteitsdaling.

**Regressies.** `pdfMenuStructuring.test.js` dekt `//`- en gewone
supplementkoppen, meerdere rijen, een naburige kolom, de volgende echte sectie,
een nieuwe pagina en de bestaande inline/plus/wrapped vormen.
`restaurantSourceAnalysis.test.js` dekt parser → analyse → qualitygate →
limitation en bewijst dat geen modelcall plaatsvindt.
`botanistReference.test.js` bewaakt de v1-cijfers, de productgap-classificatie
en het v3-voorstel met beide scores en de uitgesloten rijen.

### 13.16 Lokaal afwijkend naam-/prijsraster (review 6253408889)

**Probleem.** De paginakolommen worden uit marker-/tekstankers afgeleid. Op
pagina 3 van de gepinde Botanist-PDF begint het lagere Soof-blok zijn namen op
x≈184.4 — dezelfde x als de bedragen van het bovenste linkerdeel — terwijl de
bedragen op x≈369.0 staan, de bedrag-x van de rechterkolom. Een scheiding op
alleen de linker-x van elk tekstblok zet naam en bedrag in verschillende
kolommen. Het bedrag blijft dan als niet-gekoppelde prijsregel achter en de
naam verdwijnt, terwijl de bron beide leesbaar drukt.

**Reparatie.** `pdfTextExtraction.groupItemsIntoLines` bewaart nu pdfjs'
eigen `width` per tekstblok. `pdfMenuStructuring.mergeBridgedPriceColumns`
controleert per visuele regel of een tekstblok met die width aantoonbaar over
de volgende ankerrens heen loopt. Alleen dan wordt een rechterkolom die
uitsluitend uit prijzen/variantseparatoren bestaat bij de linkerkolom gevoegd.
Extra drempels: de linkerkolom bevat zelf geen prijstoken, de linkertekst is
een plausibele gerechtsnaam (bestaande `looksLikePairableItemName`), en zonder
width wordt niets samengevoegd. Een buuritem met een eigen naam op dezelfde
regel houdt zijn eigen bedrag; de rechterkolom is dan niet prijs-only.

Gerepareerde rijen krijgen bewust geen sectie-erfenis: `categoryForBaseline`
zet ze in de bestaande ongerubriceerde/onzekere bucket (`path: []`,
`uncertain: true`). Daardoor blijven provenance (`contentHash` over de
naam-/bedragregel plus omschrijving) en de reviewblokkade
(`unclear_category`) intact. `layout.bridgedPricePairs` telt de reparatie.

**Meting op de gepinde PDF.** 215 parseritems (was 208), 7 gerepareerde rijen,
2 niet-gekoppelde prijsregels (was 9). v1 blijft 124/11/4/0 (141 rijen); v3
blijft 127/6/1/0 (139 rijen) met subset 127/1/1/0. `categoryUnknown` in
`runBotanistComparison.js` rapporteert 8 naam/prijs-overeenkomsten met een
onbekende/andere parserrubriek apart; die tellen niet als match. De vijf
Soof-rijen staan dus nog in de missing-kolom van hun referentiesectie.

**Regressies.** `pdfMenuStructuring.test.js` dekt het lagere raster onder twee
eerdere kolommen, asymmetrische kolommen, een korte naam die de grens niet
haalt, een buuritem met eigen bedrag, omliggend proza, supplementcontext,
prijsvarianten, provenance en de fail-closed situatie zonder width.
`botanistReference.test.js` bewaakt de nieuwe parser-/layoutcijfers en de
aparte `categoryUnknown`-rapportage zonder scoreverhoging.

## Dubbele bevestiging en één rubriekentelling (review 6309694854)

Twee praktijkbevindingen zijn hier gericht gerepareerd; de geaccepteerde
correctieroute en de bestaande keten zijn niet herbouwd.

- **Geen tweede bevestiging.** Een resultaat met een opgeslagen geaccepteerd
  BE-24-voorstel is definitief bevestigd. Zowel de één-klikroute als de
  menselijke structuurroute (`humanStructure` in `confirmSources`) weigert het
  nu vóór elke schrijfactie met `ok: false, reason: 'already_confirmed'`; er
  komt geen voorstel, event of `menu_structure_reviews`-rij bij. Een retry van
  dezelfde beslissingen blijft daarmee onschadelijk.
- **Idempotentiesleutel.** Het voorstel-ID van een bevestiging wordt
  deterministisch afgeleid van het opgeslagen resultaat (job, restaurant en
  gevonden URL) in `src/lib/sourceConfirmation.js` (RFC 9562-vormige UUIDv8).
  De bestaande primaire sleutel van `source_triage_proposals` is daarmee de rem
  op een gelijktijdige dubbele aanvraag: de tweede insert botst en 0015 vertaalt
  dat naar `P0030`. Geen schemawijziging en geen versoepeling. Omdat alle
  bestaande voorstel-ID's UUIDv7 zijn, kan een afgeleide v8 nooit met een
  ongerelateerd voorstel botsen. De handler vertaalt `P0030` naar
  `already_confirmed`, `proposal_rejected` (een mens wees het voorstel in
  Bronnen beoordelen af) of het bestaande `open_proposal_exists`; de
  batchpagina zegt dan dat er niets dubbel is opgeslagen.
- **Eén rubriekentelling.** Het conceptdetail telt rubrieken per volledig pad
  via `conceptSectionCount` (`content.categories`), dezelfde regel als de
  structuurkaart. `Lunch › Dessert` en `Diner › Dessert` zijn twee rubrieken;
  de kaart toont hetzelfde gebouwde concept als de teller, zodat bovenaan en
  bij Structuur nooit meer een ander getal staat.
- **Bewijs.** `sourceConfirmation.test.js`, de nieuwe regressies in
  `batchAnalysisHandlers.test.js` (twee keer bevestigen via beide routes,
  gelijktijdig dubbel, afgewezen voorstel), `menuConcept.test.js` (zelfde
  rubrieknaam onder twee ouders) en de surface-tests. Dat is
  developer-/fixturebewijs; de Delivery Lead herhaalt de echte
  praktijkcontrole.

## Menselijke controle van een onzekere rubriekindeling (review 6307703713)

Een receipt met `structure: 'uncertain'` blijft "Controle nodig": de
conservatieve zekerheidsregel in `src/lib/batchAnalysis.js` (`certaintyOf`)
wordt niet versoepeld en een onzekere structuur is nooit `high`. De praktijk
wees uit dat daardoor geen enkele representatieve bron de keten tot een concept
kon doorlopen; daarom is er één aparte, expliciet menselijke en servergevalideerde
route bijgekomen.

- **UI.** "Menukaart controleren" toont per onzekere rubriek een rij met het
  (bron)pad, de bronroute en de vindplaats, plus de keuze *Rubriek klopt zo* of
  *Rubriek corrigeren* met het volledige pad (bijvoorbeeld `Diner ›
  Voorgerechten`). De teller "x van y behandeld" en de knop "Bevestig bron"
  verschijnen pas als élke onzekere rubriek is behandeld. Een collega ziet
  dezelfde rijen alleen-lezen, zonder bevestiging. Geen accepteer-alles.
- **Server.** `POST /api/internal/v1/batch-analysis/[id]/confirm` accepteert
  naast `job_ids` een optionele `structure_reviews: [{ job_id, receipt_hash,
  sections: [{ path, action: 'keep'|'correct', corrected_path? }] }]`. De
  server leest de opgeslagen receipt opnieuw, controleert de receiptbinding
  (opnieuw berekende `analysis_result_hash`), eist exact de verzameling onzekere
  paden uit die receipt (geen ontbrekend, onbekend of dubbel pad, geen
  "correctie" naar hetzelfde pad) en weigert anders zonder enige schrijfactie.
  Daarna volgt de bestaande BE-24-bevestiging; alleen `internal` en alleen de
  starter van de batch.
- **Opslag.** `supabase/migrations/0020_be25_menu_structure_reviews.sql` voegt
  één additieve, append-only tabel toe (wie, wanneer, batch/job/receipt, oud →
  nieuw pad, unieke `(receipt_id, path_key)`; alleen `select`/`insert` voor
  `service_role`). De identiteitssequentie krijgt dezelfde expliciete
  `revoke`/`grant usage, select` als 0015/0019; zonder die grant kan een insert
  onder `service_role` falen of blijft de sequentie voor andere rollen
  bereikbaar. Een rubrieklocator wordt vóór weergave, opslag en vergelijking
  getrimd en op 160 tekens begrensd — dezelfde grens die het concept al
  gebruikt — zodat een uitzonderlijk lange bronlocator de auditinsert niet laat
  klappen. Zonder deze migratie blijft de bestaande pagina werken; de nieuwe
  route weigert dan expliciet met `structure_store_unavailable` in plaats van
  stil te bevestigen. De migratie is nog niet op een omgeving toegepast; de
  Delivery Lead past hem zelf toe op de geïsoleerde testdatabase.
- **Concept.** `src/lib/menuStructureReview.js` vertaalt de opgeslagen
  beslissingen naar de bestaande concept-edits (`handhaven` = rubriek expliciet
  accepteren, `corrigeren` = het pad van precies die regels vervangen). De
  zelfde basis gaat naar de browser (preview) en naar `saveConcept` (versie,
  concepthash en idempotentie ongewijzigd). Ontbrekende prijzen, duplicaten en
  verdwenen gerechten blijven blokkades. Twee onzekere rubrieken naar hetzelfde
  pad corrigeren is toegestaan: het oud → nieuw-spoor blijft bewaard en het
  concept toont de resulterende structuur, zonder stilzwijgend verlies.
- **Bewijs.** `menuStructureReview.test.js`, de nieuwe regressies in
  `batchAnalysis.test.js` en `batchAnalysisHandlers.test.js`,
  `menuStructureReviewMigration.test.js` en de fixture-browsercontrole
  (`fixture=structure`, sectie in `ops/browser/README.md`). Dat is
  developer-/fixturebewijs; echte bronacceptatie en onafhankelijke review
  blijven aparte stappen.
## Generieke herstellingen na de holdout-2-meting (review 6316295818)

De eerste ongeziene meting van holdout-2 liet drie generieke fouten zien. Ze zijn
zonder bron-specifieke trucs hersteld; de drempels zijn niet verlaagd.

1. **Geen menu uit niet-menu-inhoud.** Een gekaapte pagina kan verborgen of
   zichtbare casino-/spamtekst met bedragen injecteren. `src/lib/htmlMenuStructure.js`
   leest een verborgen blok niet wanneer het ≥80 tekens telt en ≥2 verschillende
   spam-/injectiesignalen bevat (`stats.injectedBlocksSkipped`); een pagina waarvan
   de *geaccepteerde* secties/items zelf ≥2 signalen dragen, wordt geweigerd met
   `content_not_menu_suspected` (0 items, geen successtatus). Dezelfde contrôle
   geldt voor een geïnjecteerde JSON-LD-menu. De vocabulaire is generiek
   (operator-/goktermen), nooit een domeinlijst.
2. **Elk geaccepteerd item heeft locator én bewijs.** `src/lib/menuItemEvidence.js`
   (`applyItemEvidenceGate`) weigert elk item zonder `evidence.locator` plus
   quote/patroon/contenthash, verwijdert een lege rubriek/menu en meldt het aantal
   per bron. De JSON-LD-route (`src/lib/menuJsonLdExtraction.js`) levert nu per
   item een echte JSON-padlocator (`script[type="application/ld+json"][n]>…`)
   en, wanneer vindbaar, een bronpassage; de HTML-route behield zijn locator al.
3. **Meer menuvormen herkend, of eerlijk benoemd.** Zonder prijsmarkup:
   `NAME 25` + omschrijvingsregel in één alinea (ook wanneer de regels in een
   `<span>` met `<br>` zitten) en een bold titel die zelf op een prijs eindigt
   (`NAME, €7,50`). Een reeks kale namen met prijzen zonder omschrijving blijft
   geweigerd. Lege CMS-spacer-alinea's onderbreken een gerechtenreeks niet meer.
   Discovery: `/gerechten`, `afhaalmenu`, `takeaway` en `spijskaart` zijn
   menutrefwoorden; blog-/nieuws-/evenementpaden zijn dat niet. Een hub zonder
   trefwoorden op de kinderen volgt één niveau zelfde-host kindpagina's, en één
   same-host PDF-menulink wordt gevolgd. Wat niet kan, staat per bron in de
   beperkingen: `alleen als afbeelding` (geen OCR), `PDF op een andere host`
   (buiten het bronbereik) of `bron meldt sluiting`.
4. **Tooling en meting.** `ops/scripts/transition-menu-extraction-holdout.js`
   legt `unused → evaluated_once → used_for_tuning` vast met de capture- en
   evaluatiehashes; `ops/scripts/measure-menu-extraction-representative.js`
   meet dezelfde 19 bronnen opnieuw met dezelfde code als de eenmalige probe en
   schrijft `holdout-2-representative-measurement.json`. Zie
   [holdouttooling](menu-extraction-holdout-tooling.md) en de bijgewerkte
   [representatieve set](menu-extraction-representative-set.md).

**Bewijs.** `src/lib/htmlMenuContentSignals.test.js`,
`src/lib/menuSourceDiscoveryLimits.test.js`, de uitgebreide
`sameHostDiscovery.test.js`/`menuTextEntities.test.js`, en de
toolingregressies in `holdoutManifest.test.js`/`holdoutTooling.test.js`. Dat is
developer-/fixturebewijs; de representatieve nameting en de onafhankelijke
review blijven aparte stappen.



## Gecontroleerde referenties op vastgezette bytes (review 6318225879)

De vijf bronnen uit de developeropdracht (Zuyd, Andalous, Pellens, Chocolat en
Senang Makan) worden één keer vastgezet met de bestaande veilige fetch:

```
node ops/scripts/capture-menu-extraction-reference-sources.js
```

De bytes blijven lokaal en gitignored onder
`ops/benchmark/output/reference-captures/`; `ops/benchmark/reference-captures.json`
bevat alleen URL, content-type, tijd, bytegrootte en SHA-256. De capture is
create-only. De referenties staan per bron in
`ops/benchmark/reference-references/` en zijn uit de vastgezette tekst opgesteld,
met een rubriekpad, citaat/locator en prijs of prijsvarianten per gerecht.
Arrangementen en supplementen staan apart.

De meting:

```
node ops/scripts/measure-menu-extraction-references.js
```

leest alleen de vastgezette bytes (offline fetcher, geen netwerk), verifieert
elke hash en elke referentiequote, en schrijft
`ops/benchmark/reference-measurement.json` en `.md`. Ze rapporteert gemiste,
verzonnen, prijs- en rubriekfouten afzonderlijk plus precisie en recall. Een
geblokkeerde bron (Senang Makan: HTTP 503 op robots.txt) blijft zichtbaar en
telt niet als lege of geslaagde extractie. De vijf referentiebronnen zijn geen
ongeziene holdout; de bredere benchmark en een nieuwe holdout blijven BE-21.


Een herstelronde mag de referentie alleen uit **dezelfde vastgezette bytes**
corrigeren; de telregels, de meetcode en de extractie blijven dan ongewijzigd en
de meting wordt opnieuw gedraaid en gerapporteerd, ook als de uitkomst slechter
wordt (Lead-review 6319894232).

## Afbeeldingsmenu: de reden hoort in het detail (review 6319894232)

Een batchresultaat "Menu alleen als afbeelding: niet ondersteund" linkt naar
`/internal/source-triage?restaurant=<id>&reason=image_only`. Die reden is
**pagina-context en nooit een opgeslagen bronstatus**:

- `readFollowUp()` leest alleen tekst uit de URL; een onbekende of misvormde
  waarde levert `null` op.
- `followUpForEntry()` koppelt de reden aan precies dat restaurant. Zonder
  (of met een ander) restaurant blijft het een paginanoot en verschijnt de
  reden nooit bij het verkeerde restaurant.
- Het detail toont reden, betekenis en een passende vervolgstap; de generieke
  route (bijv. "Bron controleren via Onboarding Restaurant") blijft als
  secundaire regel zichtbaar in plaats van als enige antwoord.
- Bij "Bron markeren als onbruikbaar" wordt de **bestaande** reden `other`
  voorgeselecteerd met een vaste, zichtbare en verplichte toelichting
  ("Menu alleen als afbeelding of scan; niet met OCR te lezen."). Geen nieuwe
  DB-waarde, geen migratie en geen versoepeling van de notitieplicht; de mens
  kiest de actie en dient het voorstel nog steeds zelf in.

Regressies: `src/lib/sourceTriageFollowUp.test.js` (parsing, koppeling,
notitieplicht, paginabedrading) en de browserfixture
`ops/browser/run-menu-review-browser-check.js` (detail, voorgeselecteerde reden,
`aria-required`, geen opslag).

## Kaartvormen: naam/omschrijving, kaarttitel, tabbladen en verborgen weergaven (review 6334231310)

De HTML-structuurlezer (`src/lib/htmlMenuStructure.js`) herkent vier vormen die
in de gecontroleerde referentiemeting ontbraken. Ze zijn generiek beschreven —
geen domein, restaurantnaam, gerechtnaam of vast aantal — en falen gesloten
waar de vorm niet bewijsbaar is:

1. **Naam en omschrijving in één cel (K1).** `splitInlineHead` splitst een
   rij-/termcel (`th`, `dt`, `li`) wanneer de eerste tekstnode de naam is en
   precies één inline kind (`span`, `em`, `i`, `small`, …) de omschrijving
   draagt. Niet gesplitst: een prijs in één van beide helften, een tweede
   inline element, of tekst ná de omschrijving (behalve een kale prijs). Een
   `dl` met twee of meer `dt`-paren is een lijst gerechten, geen enkel gerecht.
2. **Kaarttitel en tabbladen (K2).** Een kop die exact de `aria-label` is van
   het omringende element is de titel van de kaart zelf; die vervangt de
   paginatitel alleen wanneer er niets anders dan die paginatitel boven staat.
   Een gelabeld tabblad (`role="tab"` + `aria-controls`, doelpaneel bestaat)
   wordt een padniveau; na het paneel wordt de route exact hersteld, zodat een
   volgende variant op hetzelfde niveau begint.
3. **Verborgen alternatieve weergave (K3).** Verborgen betekent: `hidden`,
   `aria-hidden="true"`, inline `display:none`/`visibility:hidden`, of een
   **onvoorwaardelijke** `display:none`-regel in de eigen stylesheet (id, klasse,
   attribuut, `>`, `:not()`, `:has()`); `@media`- en andere at-rule-blokken
   worden nooit toegepast en een niet volledig begrepen selector wordt
   overgeslagen. Een verborgen sectie telt **alleen** één keer wanneer de
   zichtbare kant aantoonbaar dezelfde bedragen per gerecht draagt; anders
   blijft ze opgenomen en verschijnt de beperking "alleen in een verborgen
   weergave zonder zichtbare tegenhanger". Een tabpaneel is een variant en nooit
   een duplicaat. De stylesheetlezer is lineair (geen `[\s\S]*?` over de hele
   pagina), zodat een vijandige pagina met veel `<style>`-tags binnen het
   werkbudget blijft.
4. **Arrangement met per-gangprijzen (K4).** Een regel met een
   arrangement-/gang-eenheid in een benoemde sectie wordt geen gerecht; de
   sectie verschijnt met reden `service_unit` en een eigen beperkingstekst. De
   deterministische context slaat nog steeds één prijs per gerecht op, dus
   prijsvarianten (`Klein`/`Hoofd`, glas/fles) blijven een expliciete
   beperking met eigen tekst en vragen een schema-ontwerp.

Regressies: `src/lib/menuExtractionCardShapeRepairs.test.js` (16 tests, per
vorm minstens één fictieve fixture en de fail-closed tegenhanger).

**Naambehoud bij een portie (zijbevinding van de bronproef).** De vorige ronde
voegde een regel toe die een uitgeschreven portie aan het eind van een naam
wegliet ("… 90 gram"). Die regel kapte ook een bronnaam af wanneer de portie
achter een expliciet scheidingsteken stond (`Pata negra | 80 gram`), wat de
telregels juist verbieden. `stripTrailingPortion` laat de portie nu staan zodra
er een `|`, `/`, `-`, `–`, `—`, `:` of `·` vóór staat; zonder scheidingsteken
blijft het een portiegrootte. Regressie: “a portion behind an explicit separator
stays part of the source name”.

## Leesbaar herstel bij een afgekeurd AI-antwoord (review 6376543234)

Een echt AI-antwoord in de handmatige import gaf `422 schema_violation` en het
scherm zei alleen "Het antwoord past niet bij de afspraken". De eigenaar kon
daar niets mee. Sinds deze ronde geldt:

- **U1, gewone taal.** `src/lib/manualMenuImportProblems.js` vertaalt elke
  regel van de bestaande validator naar hooguit vijf groepen, elk met één
  Nederlandse zin, het aantal en — als het pad bekend is — het gerecht, de
  rubriek of de menukaart bij naam. Bijvoorbeeld: "Bij 2 gerechten met meerdere
  prijzen staat ook één losse hoofdprijs (bijvoorbeeld "Fictief glas wijn")." De
  hoofdtekst bevat geen JSON-pad en geen technische code; die staan in het
  inklapbare `Technische details`. Een onbekende validatorregel wordt nooit
  weggelaten maar valt terug op één algemene, eerlijke zin.
- **U2, herstelvraag.** `buildRecoveryQuestion` bouwt uit precies dezelfde
  groepen één kopieerbare vraag: "Corrigeer alleen deze punten en geef daarna
  het volledige antwoord opnieuw in precies één codeblok: 1. … 2. …". Dezelfde
  invoer geeft altijd dezelfde vraag (geen tijd, teller of toevallige volgorde).
- **U3, ingevuld voorbeeld.** `buildImportPrompt` bevat na het uitvoerschema een
  duidelijk gemarkeerd fictief blok met een fictieve brontekst, één gevuld item
  met een letterlijk citaat en prijs, en een tweede item met twee gedrukte
  prijzen volgens de v0.4-prijsvariantregel. Het voorbeeld is zelf geldig
  volgens exact dezelfde validator, maar nooit importeerbaar: het bron-ID
  `voorbeeld-bron` staat niet in de broninventaris (menu → fatale afkeuring;
  losse bewijsregel → `unknown_source` per regel) en een mens moet zo'n regel
  met een reden bevestigen of weglaten.
- **U4, ongewijzigde stroom.** Het verzegelde toestandstoken, de duurzame
  concepten, het usage-ledger en "Weglaten" zijn niet aangeraakt. Er is geen
  nieuwe opslag: de punten en de vraag leven alleen in de bestaande
  React-staat van de pagina, binnen dezelfde serverless-veilige keten.
- De validator wordt niet versoepeld en er is geen nieuwe dependency. De 422 van
  `POST /api/internal/v1/manual-menu-import/imports` krijgt naast `problems`
  (technisch, ongewijzigd) de velden `problemSummary`, `problemSummaryOmitted`
  en `recoveryQuestion`.

Regressies: `src/lib/manualMenuImportProblems.test.js` (8 tests, elke
validatorregel, groepering, grens van vijf, paden, determinisme),
`src/lib/manualMenuImport.test.js` (U1/U2 op het rapport, U3 op de prompt en
"het voorbeeld is niet importeerbaar") en
`src/lib/manualMenuImportHandlers.test.js` (de 422 van de route).
Browserbewijs: `ops/browser/run-menu-review-browser-check.js`
(`manualRejectedScenario`) met de screenshots
`manual-ai-import-problems-390-dark.png` en
`manual-ai-import-problems-320-light.png`. Dit blijft fixture- en
ontwikkelaarsbewijs, geen onafhankelijke review of browseracceptatie.

## Afgeleide telling en status in de handmatige import (review 6377050602)

In het afgekeurde-antwoords Scherm gingen twee van de vijf punten over
boekhoudvelden die een taalmodel onbetrouwbaar invult: `coverage.itemsExtracted`
en een `complete`-status met limitations. Route B leidt die al deterministisch af
(R1/R2, `src/lib/menuExtractionNormalization.js`). De handmatige import doet dat
nu met exact dezelfde functie, vóór de validator:

- **V1, hergebruik.** `buildImportReport` in
  `src/lib/manualMenuImportImport.js` roept `applyDerivableNormalizations` aan
  vóór `validateStructuredOutput`. `itemsExtracted` wordt het aantal items dat
  werkelijk in `menus[].categories[].items[]` staat; `complete` met limitations
  gaat alleen naar beneden (`partial`, of `no_items` zonder items). Er is geen
  tweede implementatie en de validator in `src/lib/menuExtractionSchema.js` is
  niet gewijzigd: dezelfde regel keurt nog steeds elk antwoord af dat zonder
  deze afleiding binnenkomt.
- **V2, zichtbaar en bewaard.** Elke toegepaste correctie krijgt een `notice` in
  gewone taal ("Aantal gerechten door het systeem geteld: 3 (de AI zei 9)." /
  "Status bijgesteld naar gedeeltelijk, omdat de AI zelf een beperking noemde.").
  `reviewView` geeft die als `notices` aan het reviewscherm (`.mai-notices`,
  `role="status"`), de lijst reist mee in het bestaande toestandstoken — ook na
  een vervolgvraag of één antwoord over alle open punten — en
  `buildImportProvenance` bewaart haar als
  `content.importProvenance.normalizations` bij het concept. Er is geen nieuwe
  opslag en geen nieuwe in-memory state.
- **V3, ongewijzigde keten.** Het statetoken, "Weglaten", de duurzame
  concepten en het usage-ledger werken onveranderd. Een ongeldig citaat blijft
  een regelblokkade `quote_not_in_source` en verschijnt als leesbaar probleem;
  een fataal probleem (onbekende bron, ontbrekende coverage) blijft een 422 met
  `problemSummary` en `recoveryQuestion`. Een afleiding is nooit een
  goedkeuring: `reviewReady`, bronbevestiging en publicatie blijven menselijk.

Regressies: `src/lib/manualMenuImport.test.js` (V1, V1/V2, V2 bij het concept,
V2 na een vervolgvraag, V3 citaat en coverage-loos antwoord),
`src/lib/manualMenuImportHandlers.test.js` (de hele keten over nieuwe
handlerinstanties, inclusief "Weglaten", opslaan en usage-ledger) en
`src/lib/menuExtractionNormalization.test.js` (de validatorregels zelf blijven
ongewijzigd). Browserbewijs:
`ops/browser/run-menu-review-browser-check.js` (`manualNormalizedScenario`) met
`manual-ai-import-normalized-390-dark.png`. Dit blijft fixture- en
ontwikkelaarsbewijs, geen onafhankelijke review of browseracceptatie.
