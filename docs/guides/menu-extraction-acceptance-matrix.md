# Menu-extractie — acceptatiematrix #59

Status: **ontwikkelaarsbewijs, geen onafhankelijke acceptatie en geen release.**
Datum: 2026-10-18, herstelronde na Delivery Lead-review 6248740792. Issue #59,
branch `feat/menu-extraction-59`, PR #60.
Protocol: `MENU-EXTRACTION.md` v0.2, SHA-256
`15510b4c0b74fee722ac2c51a3f40aa21b03e0161ccffdcb2008f3d27350b762`.

Deze ronde houdt de eerste vier holdoutuitkomsten ongewijzigd als baseline,
maar verplaatst De Botanist, Mr Moos en Colonia naar
`representative`/`usedForTuning` omdat ze voor reparatie zijn gebruikt. Gauchos
Breda blijft de enige `evaluated_once` holdout met de oorspronkelijke 404.
Daarnaast zijn drie aantoonbare deterministische fouten hersteld: een
class-gebaseerd HTML-prijselement, een menuhub met relevante zelfde-site-
menulinks, en PDF-baseline-/kolom-/duplicaatlaagfouten. De app-side
AI-provider blijft niet geactiveerd; alle bronproeven zijn read-only.

Deze matrix koppelt ieder bestaand acceptatiecriterium aan een test, een exacte
fixture-/bron-ID, de verwachte uitkomst, het werkelijk uitgevoerde resultaat en
de status. Criteria zijn niet weggezet of verzwakt. Waar iets niet is uitgevoerd,
staat dat als `geblokkeerd` of `niet ondersteund`, niet als groen.

## Acceptatiecriteria

| # | Criterium | Bewijs / test | Fixture of bron | Verwacht | Resultaat | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Exact protocol en schema versiegebonden; ontbrekende configuratie stopt concreet | `src/lib/menuExtractionProtocol.test.js`; `src/lib/menuExtractionAdapter.test.js`; `ops/benchmark/acceptanceSet.test.js` | `MENU-EXTRACTION.md` v0.2 hash `15510b4c…b762`; ontbrekende/onversioned temp-root; offline fake provider | versie 0.2 en vaste LF-hash; `protocol_unavailable`/`protocol_unversioned`; geen provider = `provider_not_approved`; `maxCostEurCents:null` weigert | 5 protocoltests en adaptertests slagen; CRLF en LF geven dezelfde hash; suite 2021 pass | **uitgevoerd** |
| 2 | URL → lezen → extractie → menselijke correctie → conceptopslag met traceerbare broncontext | `src/lib/restaurantSourceAnalysis.test.js` (SMELT-LIKE CHAIN, receipt→concept); `src/lib/menuConcept.test.js`; `src/lib/batchAnalysisHandlers.test.js`; browserfixture | synthetische Smelt-achtige PDF/HTML; `REP-BROWSER-001` (fictieve reviewfixture) | dezelfde gevalideerde uitkomst in samenvatting, detail en concept; correctie/blokkades; bron-ID, locator en quote blijven; geen automatische opslag | offline keten en 99/99 browserchecks slagen; de fixture is fail-closed voor externe/onbekende API-aanroepen; **geen echte conceptopslag of bronbevestiging uitgevoerd** | **uitgevoerd (offline/fixture); echte opslag niet** |
| 3 | Smelt Breda: echte PDF-inhoud getest; gevonden PDF + 0 items is geen succes; gerechten, prijzen, dekking vergeleken | `node ops/scripts/probe-menu-extraction-sources.js --source=smelt`; `src/lib/pdfMenuStructuring.test.js`; qualitygate | `REP-PDF-001` / `REP-BRANCH-002`: PDF 550738 bytes, bytes `4445a101…27f8`, content `24f23cbd…8a845`, 2 pagina's | 37 referentierijen exact; 8 secties; 0 gemist/extra/prijs/koppeling/duplicaat; supplementen/arrangement expliciet gemeld; nul items nooit succes | probe exit 0: 37/37, 8 secties, alle verschillen 0, boekhouding 37/37; 7 supplementregels, 1 arrangementregel en 1 prijsachtige beschrijvingsregel gemeld | **uitgevoerd met beperking** |
| 4 | Blossem: lunch/diner, rubrieken en items volgen echte bronrelaties; onzekerheid uitvoerbaar; geen vast aantal | `node ops/scripts/probe-menu-extraction-sources.js --source=blossem`; `src/lib/htmlMenuVariants.test.js`; `src/lib/menuExtractionQuality.test.js`; browserfixture | `REP-ACCORDION-002` / `REP-ARRANGEMENT-002`: HTML 40615 bytes, bytes `da5c632f…0c38`; fictieve reviewfixture voor de UI | DINNER/LUNCH en subrubrieken gescheiden; 43/43; onzekerheid per groep; arrangementen expliciet uitgesloten; geen hardcoded aantallen | probe exit 0: 43/43 in 13 secties, alle verschillen 0; 2 arrangement-/alternatieve prijssecties gemeld; groepshandeling en geen accepteer-alles in de fixture | **uitgevoerd met beperking** |
| 5 | Bestaande kaarten Wolfslaar, Bardot, Zuyd, T-Huis getoetst; historische aantallen zijn geen waarheid | `node --test src/lib/historicalMenus.test.js` | `REP-HISTORICAL-001`: `data/menus.json`, 11 menu's, laatste `scraped` 2026-03-28, canonieke LF-hash `46c84c0f…9766` | ieder benoemd gerecht één live regel; pad, volgorde en prijs behouden; onbekende prijs null, nooit 0; snapshot is vormregressie, geen actuele waarheid | 3/3 tests slagen voor alle vier restaurants; 25/111/42/189 historische regels (367 totaal) volledig verklaard; live sites niet opnieuw opgehaald | **uitgevoerd met beperking** |
| 6 | Vooraf vastgelegde representatieve set en aparte holdout dekken HTML, tabs, tabellen, tekst-PDF, scans, taal/vestiging, arrangement en prijsvariant | `ops/benchmark/acceptanceSet.test.js`; `ops/benchmark/acceptanceSetGuard.test.js`; `ops/benchmark/holdoutReferences.test.js`; `ops/benchmark/botanistReference.test.js`; `ops/benchmark/menu-extraction-acceptance-set.json` | 22 representatieve entries; alleen Gauchos Breda als holdout (`HOLD-REAL-02`, capture-only, 404); De Botanist/Mr Moos/Colonia zijn representative met `usedForTuning:true`; 13 dekkingsklassen | iedere klasse heeft een uitgevoerde representant en een expliciete holdout-slot; `unused`/`evaluated_once`/`used_for_tuning` zijn gescheiden; een holdout wordt hoogstens één keer geëvalueerd en blijft buiten tuning | 41 gerichte tests slagen; baseline blijft De Botanist 151/59, Mr Moos 0, Colonia 0, Gauchos 404; na reparatie: Botanist 196 items (95/141 referentiematches, 46 missing, 5 extra, 96 niet-gekoppeld), Mr Moos 247 items in 3 menu's (groepsmenu geblokkeerd), Colonia 84 items in 16 secties; geen nieuwe holdout gepind | **representatief uitgevoerd; holdout één keer uitgevoerd; nieuwe holdout nodig vóór release** |

| 7 | Dataset, referentie-uitkomsten en meetbare drempels vóór acceptatie vastgelegd; BE-21's 50–100 niet met enkele URL's afgesloten | `ops/benchmark/acceptanceSet.test.js`; `ops/benchmark/sourceReferences.test.js`; `ops/benchmark/structureCorpus.test.js` | manifest `releaseThresholds`: 0 verzonnen gerechten/prijzen, 100% bewijs, 0 onverklaarde dekking, 0 structuur-/prijsfouten; BE-21 expliciet buiten scope | drempels vast en niet verlaagd; BE-21 niet geclaimd | drempels exact gepind; 2 bronnen en 23 structuurgevallen sluiten BE-21 niet af; dat staat expliciet in `notIncluded` | **uitgevoerd** |
| 8 | Gemiste/verzonnen items, prijsfouten, structuurverlies, bewijsdekking, correctiewerk, tijd en kosten per brontype gerapporteerd | probe; `src/lib/menuSourceComparison.test.js`; `src/lib/historicalMenus.test.js`; `ops/benchmark/botanistReference.test.js`; browserfixture; manifest | Smelt/Blossem referenties; De Botanist layoutreferentie (141 rijen); 23 STRUCT-gevallen; 4 historische kaarten; 5 browserfixtures | per bron/klasse verschil lijsten; 100% bewijs; tijd en kosten alleen als gemeten | Smelt 0/0/0/0/0 en Blossem 0/0/0/0/0; Botanist 95 matched / 46 missing / 5 extra / 0 prijsverschil / 96 niet-gekoppeld; 100% van de referentierijen heeft bewijs; **correctietijd onbekend**; **kosten onbekend, niet 0** | **uitgevoerd; tijd/kosten onbekend** |
| 9 | Browseracceptatie met klikpaden, rolgrenzen, leeg/fout/partieel, toetsenbord, licht/donker, 320/390 px | `npm run test:browser:menu-review`; `ops/browser/evidence/menu-review-browser-evidence.json` | `REP-BROWSER-001`: fictieve `review`, `readonly`, `empty`, `partial`, `error`; Edge 155; 1024/390/320; licht/donker | exacte links, rubricering, duplicate-/prijsblokkades, leeg/partieel/fout, toetsenbord, thema's, geen horizontale overflow; read-only collega ziet geen save/bevestig | bestaande evidence: 99/99 checks, 11 screenshots met SHA-256; **deze ronde niet opnieuw gedraaid**; **geen live/staging browserbewijs** | **uitgevoerd als fixture (bestaande evidence); live niet** |
| 10 | Time-out, provideruitval, ongeldige uitvoer, kosten-/paginagrens, herimport, gelijktijdige taken, promptinjectie, verkeerde vestiging, onveilige redirects getest | `src/lib/menuExtractionAdapter.test.js`; `src/lib/safeOutboundFetch.test.js`; `src/lib/restaurantSourceAnalysis.test.js`; `src/lib/batchAnalysisHandlers.test.js`; `src/lib/menuConcept.test.js` | offline fake provider en `.invalid` HTTP-fixtures; veilige fetch/redirect/SSRF-tests | elk pad eindigt met een concrete fout of weigering; geen dubbele call/claim; brontekst blijft data; verkeerde vestiging en redirect worden geweigerd | alle gerichte suites slagen; geen echte provideruitval gemeten | **uitgevoerd (offline)** |
| 11 | Geen stil dataverlies tussen extractie, receipt, review, concept en export; niet-ondersteunde publicatievelden geblokkeerd/gemeld | `src/lib/menuExtractionRuntime.test.js`; `src/lib/menuExtractionMapping.test.js`; `src/lib/menuConcept.test.js`; `src/lib/menuConceptExport.test.js`; `STRUCT-017`; `planning/architecture/menu-extraction-product-schema-v2.md` | synthetische receipt/concept/export; historische kaarten; v2-ontwerp | dezelfde broncontext en hetzelfde resultaat in iedere laag; onbekend blijft onbekend; export blokkeert wat het bestand niet kan dragen | mapping/exporttests en STRUCT-017 slagen; varianten/supplementen/arrangementen/allergenen zijn expliciet gemeld of geblokkeerd; v2 is **alleen ontwerp** | **uitgevoerd met beperking; v2 niet geïmplementeerd** |
| 12 | Geen regressie in rollen, bronbevestiging, audit, publicatiegates, beveiliging of geheimenbeheer | volledige suite; `statusRoles`, `menuConceptReviewHandlers`, `importInbox`, `internalAuth`-gerelateerde tests; browser read-only | bestaande tests en fictieve rollen `internal`+`editor`; geen productiecredentials | rollen en gates ongewijzigd; geen geheimen in browser of log; read-only kan niet opslaan/bevestigen | suite 2021 pass / 0 fail / 0 skipped; browser read-only toont geen save/bevestig; geen productieauth omzeild | **uitgevoerd** |
| 13 | Onafhankelijke review met exacte commit, checks, bron-/protocolversies, resultaten, beperkingen en volgende stap; groene unit-tests zijn geen productacceptatie | Delivery Lead-review op PR #60 | deze matrix + checkpoint | onafhankelijke reviewer beoordeelt commit, checks en beperkingen | **nog niet uitgevoerd**; deze matrix is ontwikkelaarsbewijs en claimt geen onafhankelijke acceptatie | **geblokkeerd: wacht op Delivery Lead** |


## Resultaten per dekkingsklasse

| Klasse | Representant(en) | Uitkomst | Eerlijke beperking |
| --- | --- | --- | --- |
| HTML | `REP-HTML-001` (STRUCT-001/002/004/005/021/022), `REP-MRMOOS-REAL`, `REP-COLONIE-REAL` | 6/6 corpusgate, 22 classified pass; Mr Moos 247 items in 3 menu's; Colonia 84 items in 16 secties | Mr Moos groepsmenu geblokkeerd; Colonia wijn/brunch/high tea niet verliesvrij; geen universele claim |
| Uitklappers/tabs | `REP-ACCORDION-001` (synthetisch), `REP-ACCORDION-002` (Blossem) | 3/3 + 43/43 items | paneel zonder DOM-relatie blijft onzeker; arrangementen niet opslaanbaar |
| Tabellen | `REP-TABLE-001` (STRUCT-019/020) | pass | alleen tabel-/dt-dd-vormen |
| Tekst-PDF | `REP-PDF-001` (Smelt), `REP-PDF-002` (synthetisch), `REP-DEBOTANIST-REAL` | 37/37 + 63 PDF-tests; Botanist 95/141 referentiematches, 0 prijsverschil bij match | Botanist 46 missing / 5 extra / 96 niet-gekoppeld; wijn/cocktail niet verliesvrij; 196 items is geen kwaliteitsbewijs |
| Scan/niet-leesbaar | `REP-SCAN-001` | `pdf_no_text_layer`/`pdf_encrypted`, geen OCR | **klasse niet ondersteund**; eerlijke fout, geen vendor |
| Taal/vestiging | `REP-LANG-001`, `REP-BRANCH-001`, `REP-BRANCH-002` | Speisekarte gevonden; vestigingsadres behouden; Breda-PDF gelezen | één taalkeyword en één ketenprobe; geen alle-vestigingenclaim |
| Arrangement | `REP-ARRANGEMENT-001/002` | uitgesloten en gemeld | **niet verliesvrij op te slaan**; v2-ontwerp nodig |
| Prijsvariant | `REP-PRICE-001/002` | meerdere/vanaf expliciet; 0 prijsfouten op referenties | **niet verliesvrij op te slaan**; blokkade voor correctie |
| Historische kaarten | `REP-HISTORICAL-001` | 367 regels volledig gemapt | geen actuele bronvergelijking |
| Veiligheid/fouten | `REP-SAFETY-001` | offline suites pass | geen echte provideruitval |
| Contractmapping | `REP-CONTRACT-001` | mapping/export/STRUCT-017 pass | één prijs per regel; v2 alleen ontwerp |
| Reviewsurface | `REP-REVIEW-001` | groeps-/duplicaat-/prijsscheiding pass | componenttests plus fixture, geen live sessie |
| Browserfixture | `REP-BROWSER-001` | 99/99 checks in bestaande evidence | **alleen fixture**, deze ronde niet opnieuw gedraaid, geen live integratie |

## Wat expliciet niet is uitgevoerd of niet wordt geclaimd

- **Onafhankelijke item-voor-item menselijke controle** van Smelt/Blossem: niet
  uitgevoerd; de vergelijking is geautomatiseerd tegen een gecontroleerde
  capture.
- **Live provideractivering, kostenmeting en DPA/EU-retentie**: geblokkeerd door
  een Product Owner-besluit; geen provider aangeroepen.
- **BE-21's 50–100-bronnen/OCR-/vendorbenchmark**: buiten #59; niet afgesloten.
- **Live/staging browseracceptatie**: geen previewtoegang; alleen de lokale
  fixture op Edge 155.
- **Echte bronbevestiging, conceptopslag, export, merge of publicatie**: niet
  uitgevoerd en niet geautoriseerd.
- **Holdout met echte ongeziene bronnen**: De Botanist, Mr Moos en Colonia
  zijn vóór de meting op byteshash gepind en daarna elk precies één keer
  geëvalueerd (151/59, 0, 0). Die uitkomsten blijven als baseline staan, maar de
  drie bronnen zijn daarna voor reparatie gebruikt en staan nu als
  `representative` met `usedForTuning: true`. Gauchos Breda is de enige
  overgebleven holdout (`evaluated_once`, HTTP 404). Een nieuwe, nog niet
  gebruikte holdout is nodig vóór een releaseclaim; die is in deze ronde niet
  gepind omdat daarvoor een nieuwe bron-/toegangsbeslissing nodig is.
- **Scans/OCR**: expliciet niet ondersteund; de uitkomst is een eerlijke fout.
- **Arrangementen, supplementen, glas/fles, allergenen**: nog niet verliesvrij
  op te slaan; het v2-ontwerp ligt ter beoordeling, er is niets gemigreerd. Het
  ontwerp eist nu bewijs per prijsbedrag en een zichtbare
  `unsupported_schema_version`-rollback; beide zijn niet geïmplementeerd.
- **App-side AI-provider**: niet geactiveerd. De bronproeftoestemming en de
  developer-prepaidtoestemming gelden niet als provider-, budget- of
  retentiebesluit.
- **Correctietijd en kosten**: onbekend, niet als nul gerapporteerd.
- **#56-combinatie**: niet gemerged; de actuele read-only merge-tree op
  #59-HEAD geeft **drie** inhoudelijke conflicten
  (`app/internal/source-triage/batch/page.js`,
  `src/lib/htmlMenuStructure.js`,
  `src/lib/menuSnapshotProposals.test.js`) en blijft een combinatiegat. De
  eerdere twee-conflictennotitie was van vóór de latere parserwijzigingen.

## Reparaties in deze ronde

1. **Protocolhash is checkout-onafhankelijk.** De loader hasht nu canonieke LF-
   tekst; voorheen gaf een Windows-CRLF-checkout `d4b349…` in plaats van de
   gepinde `15510b4…`. Regressie: CRLF- en LF-temp-root geven dezelfde hash.
2. **Historische kaarten hebben een vormregressie.** Nieuwe test bewijst dat
   Wolfslaar, Bardot, Zuyd en T-Huis zonder verlies door `liveMenuLines` en het
   concept gaan; de snapshot is op hash en datum gepind.
3. **Isolated browserfixture voor de bestaande import/review-UI.** Echte
   componenten, fictieve sessie/API, 99 checks, 11 screenshots, read-only
   collega, 320/390 px, licht/donker en toetsenbord.
4. **Fixture-isolatie is fail-closed.** Onbekende externe URLs,
   protocol-relative URLs, onbekende API-/schrijfroutes en niet-GET-
   apprequests worden geweigerd en geregistreerd. De guard dekt fetch, XHR,
   WebSocket, EventSource, sendBeacon, CDP-subresources en frame-/document-
   navigatie; Chromium heeft daarnaast een DNS-lockdown. Negatieve regressies
   draaien in een VM zonder netwerk en bewijzen dat de native fetch/XHR nooit
   wordt bereikt.
5. **Holdout-state machine gecorrigeerd.** `unused`, `evaluated_once` en
   `used_for_tuning` zijn gescheiden. Een legitieme eerste evaluatie is
   vastlegbaar; een tweede evaluatie en een getunede bron in de holdout worden
   geweigerd. Negatieve guardtests dekken alle drie de fouten.
6. **Vier goedgekeurde bronnen read-only gepind en één keer geëvalueerd.**
   Capture-only referenties met byteshash, daarna één meting via de echte
   analyseketen; uitkomsten en beperkingen staan in
   `ops/benchmark/holdout-evaluation.json`. Geen parserregel is op basis
   van deze uitkomsten gewijzigd.
7. **Verliesvrij v2-ontwerp aangevuld.** Prijsbewijs is verplicht per
   prijsbedrag (`price_evidence_missing`), en rollback/oudere lezers moeten een
   v2-rij zichtbaar als `unsupported_schema_version` bewaren in plaats van
   negeren. Alleen ontwerp; geen migratie of implementatie.
8. **HTML-prijselement hersteld.** Een herhaalde kaart met een eigen
   class-gebaseerd prijselement leest hele euro's en één decimaal
   ("18", "15.5") via de strikte prijsregel. Regressie:
   `src/lib/htmlMenuPriceElement.test.js`. Colonia: 0 → 84 items in 16 secties.
9. **Menuhub begrensd gevolgd.** Een gevonden menupagina die alleen naar
   lunch/diner/dranken verwijst, mag diezelfde-site-menulinks één niveau dieper
   volgen binnen de bestaande `MAX_CANDIDATES`-fetchbudget. Geen tweede hub,
   geen cross-host, geen extra budget. Regressie:
   `src/lib/menuHubDiscoveryRegression.test.js`. Mr Moos: 0 → 247 items.
10. **Cadeaukaart is geen menulink.** `cadeaukaart`/`cadeaubon`/`gift card`
    wordt vóór de keywordmatch uitgesloten; een echt menu achter de link houdt
    zo zijn plek in het budget. Regressie in `sameHostDiscovery.test.js`.
11. **PDF-tekstlaagfouten hersteld.** Geen valse tweede-tekstlaag bij
    herhaalde prijzen (minimaal 30% paginadekking), naam+prijs op nabije
    baselines samen, ABV niet als naam/prijs, markerrij en frequente
    tekstkolommen als kolomgrens, enkel woord als smaakvariant en geen rubriek.
    Regressies: `src/lib/pdfMenuStructuringLiveRegressions.test.js`.
12. **Gecontroleerde Botanist-referentie en vergelijking.** 141 referentierijen
    uit de PDF-layout, 21 ondersteunde secties, expliciete
    `unsupportedSections`; vergelijking 95 matched / 46 missing / 5 extra /
    0 prijsverschil / 96 niet-gekoppeld. Zie
    `docs/guides/menu-extraction-botanist-reference.md`.


## Verificatie op de definitieve code-/evidence-HEAD

Deze ronde is uitgevoerd op de working tree boven `e41f97b`; de definitieve
commit wordt in het checkpoint genoemd. De browserfixture is deze ronde niet
opnieuw gedraaid; de bestaande evidence blijft `head: 79319b1`,
`worktreeDirty: false`, 99/99 checks. De onderstaande aantallen zijn de
werkelijk uitgevoerde run, niet een prognose.

| Controle | Commando | Resultaat |
| --- | --- | --- |
| Volledige suite | `npm test` | 2021 tests: 2021 pass, 0 fail, 0 skipped |
| Gerichte #59-tests | `node --test ops/benchmark/acceptanceSet.test.js ops/benchmark/acceptanceSetGuard.test.js ops/benchmark/holdoutReferences.test.js ops/benchmark/botanistReference.test.js src/lib/htmlMenuPriceElement.test.js src/lib/menuHubDiscoveryRegression.test.js src/lib/pdfMenuStructuringLiveRegressions.test.js src/lib/sameHostDiscovery.test.js` | 61 pass, 0 fail |
| Structuurcorpus | `npm run test:menu-structure` | 6 pass, 0 fail |
| Benchmark | `npm run benchmark:menu-structure` | 22 pass, 0 fail, 1 unclassified (`STRUCT-018`, JSON-LD-hiërarchie) |
| Build | `npm run build` | compiled successfully, 41/41 statische pagina's, `BUILD_ID` `7FwT8Bf1jMH4jehLgpzdQ` |
| PDF.js-trace | `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts, native `pdf.mjs`/`pdf.worker.mjs`, geen gebundelde PDF.js-runtime |
| Echte bronproef (representatief) | `node ops/scripts/probe-menu-extraction-sources.js --source=smelt` en `--source=blossem` | beide exit 0; Smelt 37/37 en Blossem 43/43; byte- en contenthash gelijk; 0 gemist/extra/prijs/koppeling/duplicaat; boekhouding 37/37 en 43/43 |
| Holdout eerste meting (baseline) | `ops/benchmark/holdout-evaluation.json` (niet opnieuw uitgevoerd) | De Botanist 151 items/59 secties, Mr Moos 0, Colonia 0, Gauchos 404; alle vier oorspronkelijk `evaluated_once` |
| Praktijk na reparatie | lokale read-only `run-analysis.js` op de drie verplaatste bronnen | De Botanist 196 items/55 secties (95/141 referentiematches), Mr Moos 247 items in 3 menu's (groepsmenu geblokkeerd), Colonia 84 items in 16 secties |
| Botanist-referentie | `node --test ops/benchmark/botanistReference.test.js` | 3 pass; PDF-hash en 141 referentierijen gepind; wijn/cocktail expliciet niet ondersteund |
| Browserfixture | `npm run test:browser:menu-review` | 99/99 checks; 11 screenshots; Edge 155; `head: 79319b1`; `worktreeDirty: false`; fail-closed netwerkguard; 0 onverwachte app-faseverzoeken |
| #56-compatibiliteit | `git merge-tree --write-tree HEAD origin/feat/compact-source-flow-53` op `144a648` (PR #56 head `00f4151`) | exit 1; drie inhoudelijke conflicten: `app/internal/source-triage/batch/page.js`, `src/lib/htmlMenuStructure.js`, `src/lib/menuSnapshotProposals.test.js`; geen merge uitgevoerd, #56 niet gewijzigd |

De representatieve bronproef is read-only tegen precies de twee expliciet
toegestane publieke URL's uitgevoerd. De probe-uitvoer bevat een PDF.js-
waarschuwing over `standardFontDataUrl`; die verandert de tekstlaag niet en de
vergelijking eindigde met exit 0. Dat is een observatie, geen productacceptatie.

De eerste holdoutmeting is read-only tegen precies de vier door de Product
Owner goedgekeurde URL's uitgevoerd, met vooraf vastgelegde capture-hashes. Die
uitkomsten staan ongewijzigd in `ops/benchmark/holdout-evaluation.json`. De
Gauchos-entry gaf HTTP 404; er is geen andere URL of vestiging ingevuld. De
nul-uitkomsten van Mr Moos en Colonia zijn als beperking vastgelegd, niet als
succes. De drie andere bronnen zijn daarna voor reparatie gebruikt en daarom
naar `representative`/`usedForTuning` verplaatst; ze worden niet opnieuw als
ongezien gepresenteerd. Twee niet-vastgelegde De Botanist-verkenningen vóór de
pin en één niet-geparseerde hostcheck na de Gauchos-404 zijn expliciet in de
evidence als scope-notitie vastgelegd.

## Verificatie review 6249303096 (2026-10-18)

De twee reproduceerbare P1-fouten zijn hersteld: prijsbewijs is niet meer
paginabreed (een dunne linkerkolom behoudt haar geldige bedrag en beide
wijnbedragen blijven geblokkeerde varianten), en een naam+prijs op twee
baselines wordt alleen binnen 24 PDF-eenheden gekoppeld. Onzekere
prijsregels worden als `unlinkedPriceLines` gemeld in plaats van stil
verwijderd; expliciete supplementregels blijven supplementen.

| Controle | Commando | Resultaat |
| --- | --- | --- |
| Volledige suite | `npm test` | 2030 tests: 2030 pass, 0 fail, 0 skipped |
| Gerichte #59-tests | vier bestanden (`pdfMenuStructuring`, live-regressies, quality, analysis) | 82 pass, 0 fail |
| Structuurcorpus | `npm run test:menu-structure` | 6 pass, 0 fail |
| Benchmark | `npm run benchmark:menu-structure` | 22 pass, 0 fail, 1 unclassified (`STRUCT-018`, bestaande JSON-LD-keuze) |
| Build | `npm run build` | compiled successfully in 31.2 s |
| PDF.js-trace | `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts |
| Smelt/Blossem | read-only probe | exit 0; 37/37 en 43/43; hashes gelijk; alle verschillen 0 |
| Botanist | read-only heranalyse | 196 items/54 secties; vergelijking ongewijzigd 95/46/5/0/96; limitations 12 supplement / 18 midden-in-regel / 24 niet-gekoppeld |

De eerdere verificatietabel hierboven blijft de meting van die ronde. De
eerste holdoutmeting blijft ongewijzigd 151 items/59 secties en is niet naar
de parseruitkomst herschreven. De Botanist-referentie is nog steeds een
developer-capture, geen onafhankelijke bronwaarheid. Browseracceptatie,
app-side AI-activering, een nieuwe holdout en #56-compatibiliteit zijn in
deze ronde niet uitgevoerd.

## Resterende concrete beslissingen

1. **Onafhankelijke review** door de Delivery Lead op de code- en
   evidencecommit; daarna pas READY_FOR_REVIEW/merge-besluit.
2. **Live previewtoegang** voor echte browser-/schrijfacceptatie; nu alleen
   fixturebewijs. De fixture is fail-closed en bewijst geen live Supabase- of
   schrijfsessie.
3. **App-provider/model, kostenbudget, DPA/EU-retentie** voor echte
   AI-activering; de runtime blijft disabled. De bronproeftoestemming en de
   developer-prepaidtoestemming activeren dit niet.
4. **V2-schema en exportcontract** (inclusief publieke allergenenstatus), zoals
   vastgelegd in `planning/architecture/menu-extraction-product-schema-v2.md`.
   Prijsbewijs per bedrag en zichtbare rollback zijn ontwerp, geen implementatie.
5. **Nieuwe holdout** vóór een releaseclaim. De drie gerepareerde bronnen zijn
   representative/usedForTuning; dezelfde gepinde versie mag niet opnieuw als
   holdout worden geëvalueerd. Een nieuwe bron vereist een eigen
   toegangsbeslissing en is in deze ronde niet gepind.
6. **Botanist-kwaliteit** is niet opgelost: 95/141 referentiematches, 46
   missing, 5 extra en 96 niet-gekoppelde items. Wijn/cocktail-blokken en
   glas/fles-varianten zijn expliciet niet ondersteund; dit vraagt schema- en
   parserwerk, geen succeslabel.
7. **#56 samenbrengen** met de drie gemelde conflicten; geen merge in deze
   branch.
