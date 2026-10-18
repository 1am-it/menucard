# Menu-extractie - implementatieafspraken

Status: bouwafspraken voor GitHub #59, 2026-10-17; herstelronde na review
#6244808974 op 2026-10-18. Afgesplitst uit MENU-EXTRACTION.md v0.1.
Implementatie is veilig begonnen op `feat/menu-extraction-59`; een echte
provideractivering en PR #56 blijven buiten scope.

[Extractie-instructie](../../MENU-EXTRACTION.md) |
[Testplan](menu-extraction-acceptance.md)

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
  telbare layoutmetadata (duplicaatlaag, supplementregels, onduidelijke
  prijsregels, niet-herkende koppen) wordt bewaard.

### 13.4 Mapping en provenance

- `menuExtractionMapping` behoudt `variant` en `order`, zet `structure` op
  `uncertain` zodra een rubriek onzeker is, en laat `evidence.sourceId`,
  `quote` en `locator` intact (met de menu-bron als terugval).
- `buildMenuCandidateSummary` neemt `variant`/`order` en de volledige korte
  evidence over, zodat receipt en concept dezelfde broncontext houden.
- Niet-ondersteunde constructen (supplementen, allergenen, beschikbaarheid)
  worden nog steeds expliciet gemeld of geblokkeerd, nooit stil afgeplat.
