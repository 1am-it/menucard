# Menu-extractie - acceptatie en testbewijs

Status: acceptatievoorwaarden voor GitHub #59, herzien 2026-10-18. Afgesplitst
uit MENU-EXTRACTION.md v0.1. Dit document scheidt vereiste tests van het
daadwerkelijk uitgevoerde bewijs. Read-only bronproeven zijn uitgevoerd; echte
provideractivering en volledige productacceptatie zijn dat niet.

[Extractie-instructie](../../MENU-EXTRACTION.md) |
[Implementatieafspraken](menu-extraction-implementation.md) |
[Representatieve set en drempels](menu-extraction-representative-set.md)

## 13. Acceptatie: bewijs voordat werking wordt geclaimd

- Blossem: beoordeel de daadwerkelijke uitklapstructuur, behoud lunch/diner en
  alle onderbouwde rubrieken. Toets tegen de actuele bron, niet een hardcoded
  aantal van 28/10. Een onzekere koppeling krijgt een uitvoerbare groepsreview.
- Smelt Breda: volg de gevonden PDF, controleer leesbaarheid, pagina's en
  naam-prijsrelaties. PDF gevonden plus nul gerechten is geen geslaagde import.
- Bestaande kaarten van Wolfslaar, Bardot, Zuyd en T-Huis: vergelijk de nieuwe
  extractie met gecontroleerde bronkopieen en verwachte uitkomsten; de 367
  historische items zijn geen bewijs van de huidige aantallen of juistheid.
- Gebruik de bestaande BE-21-benchmark en zijn geplande representatieve set;
  verzamel echte bronbestanden alleen binnen toegestane toegang/gebruiksrechten.
  Houd synthetische fixtures, echte bronnen en niet-geteste bronnen gescheiden.
- Dek HTML, uitklappers/tabbladen, tabellen, kolommen, tekst-PDF, scans,
  meertaligheid, ketenvestigingen, menu-arrangementen en prijsvarianten af.
  Ontbreekt een hulpmiddel, toets ook de eerlijke begrenzing en vervolgroute.
- Stel gecontroleerde referenties en vrijgavedrempels vast voor implementatie-
  acceptatie. Meet gemiste/verzonnen items, prijsfouten, structuurverlies,
  bewijsdekking, correctiewerk, tijd en kosten per brontype; niet alleen gemiddeld.
- Gebruik een aparte ongeziene testset. Geen sitespecifieke uitzonderingen of
  antwoorden uit fixtures inbouwen om bekende voorbeelden te laten slagen.
- Test de hele keten: URL -> lezen -> extractie -> correctie -> conceptopslag ->
  bestaande publicatiecontroles, inclusief time-out, foute modeluitvoer,
  provideruitval, budgetgrens, herhaalimport, promptinjectie en verkeerde vestiging.
- Onafhankelijke review rapporteert resultaat, exacte versie, bewijs en hiaten.
  Technisch groen betekent niet volledige kaart, actuele prijs of productacceptatie.

Geen algemene claim dat alle restaurantwebsites werken op basis van enkele
voorbeelden. Rapporteer aantoonbare ondersteuning en concrete beperkingen.

## Uitgevoerd bewijs — 2026-10-17

Branch `feat/menu-extraction-59`; protocol `MENU-EXTRACTION.md` v0.2
(SHA-256 `15510b4c0b74fee722ac2c51a3f40aa21b03e0161ccffdcb2008f3d27350b762`).
Dit is bewijs van de bouw- en testronde, niet van actuele bronacceptatie.

| Controle | Resultaat |
| --- | --- |
| `npm test` | 1903 pass, 0 fail (na herstel) |
| `npm run test:menu-structure` | 6 pass, 0 fail |
| `npm run benchmark:menu-structure` | 23 gevallen: 22 pass, 0 fail, 1 unclassified (JSON-LD-hiërarchie) |
| `npm run build` | exit 0 |
| `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts gecontroleerd |
| Smelt-achtige synthetische PDF | herkende sectie → canonieke menucontext → receipt → savebaar concept; test in `restaurantSourceAnalysis.test.js` |
| Blossem-achtige synthetische HTML | bestaande end-to-end hiërarchietest; gedeelde rubriekonzekerheid heeft een groepshandeling |
| Providerneutrale adapter | offline fake provider: geldig, ongeldig schema, timeout, budget, verboden trustvelden |
| Worker | begrensde claim/lease-loop; geen schedule, geen browserafhankelijkheid in de service-entry |

Niet uitgevoerd en daarom geen groene claim:

- de echte Smelt-PDF en Blossem-pagina zijn read-only opgehaald (zie hieronder),
  maar niet als volledige item-voor-item-productacceptatie beoordeeld;
- geen echte browser-/schrijfacceptatie of geïsoleerde testomgeving;
- geen echte providercall, kostenmeting of DPA/EU-retentietest;
- geen server-side scheduler die de worker automatisch start;
- geen volledige BE-21-set van 50-100 bronnen of aparte ongeziene set.

Deze gaten zijn blokkades/acceptatievoorwaarden, geen verborgen successen.

Aanvullend: controleer dat samenvatting, detail en conceptopslag hetzelfde
extractieresultaat gebruiken. Noteer bij ieder resultaat bronversie/hash,
testdatum en gebruikte protocol-, schema-, model- en codeversie.

## Herstelronde reviewpunten — 2026-10-17

Vier P1-bevindingen zijn inhoudelijk hersteld en met regressies vastgelegd:

| Punt | Herstel | Regressie |
| --- | --- | --- |
| Groepsacceptatie hief duplicaten op | `acceptCategory` en `acceptDuplicate` zijn gescheiden in browser, server-side `sanitizeEdits`/`buildMenuConcept` en opgeslagen concept; oude `accept` geldt alleen als categorie-alias | `menuConcept.test.js` (rubriek accepteren laat duplicate staan; duplicaat accepteren laat rubriek staan) en `batchAnalysisHandlers.test.js` (409 bij server-side opslag) |
| PDF `Chardonnay 6.50 / 25.00` werd `Chardonnay` + `/` | één item met `priceStatus: multiple_undecomposed`, `priceVariants` en `priceText`; concept geeft blokkade `multiple_prices` en kiest geen prijs | `pdfMenuStructuring.test.js` en `restaurantSourceAnalysis.test.js` (PDF → receipt → concept) |
| Uitvoerschema was niet afdwingbaar | exact versiegebonden `menu-extraction-output/v1` in `menuExtractionSchema.js`: verplichte/onbekende velden, types, lengtes, aantallen, prijsregels, coverage, bronverwijzingen en bewijsquote; verboden trustvelden | `menuExtractionAdapter.test.js`: ongeldige coverage, onbekend genest veld, ontbrekende quote en te lange naam falen |
| Budget/limieten waren zacht | configuratievalidatie, input-/pagina-/outputgrenzen vóór/na call, verplichte budgetreservering, `AbortController` en `adapter.cancel()` bij time-out | `menuExtractionAdapter.test.js`: negatieve/zero-config, input/page/output, time-outannulering en ontbrekende budgetguard |

Aanvullend is de providerneutrale runtime injecteerbaar gemaakt via
`menuExtractionRuntime.js`; de echte routes gebruiken expliciet
`disabledMenuExtractionRuntime()` zolang provider, budget en gegevensvoorwaarden
niet zijn goedgekeurd. `menuExtractionRuntime.test.js` bewijst dat protocolhash,
brontekst, schema en gevalideerd resultaat door de analyseketen naar
receipt/concept lopen. `docs/guides/menu-extraction-representative-set.md` legt
de referentieset, ongeziene set en drempels vast.

### Echte read-only bronproeven

| Bron | Bronversie/observatie | Uitkomst | Status |
| --- | --- | --- | --- |
| Smelt Breda | `restaurantsmelt.nl/wp-content/uploads/2026/05/smelt_menu_breda_nederlands.pdf`, 2 pagina's, 894 woorden, bronhash `24f23cbd80a3e37d097b88e4e28165ad1235ba7babfbef7beb87fcdfaae8a845` | huidige parser: 50 items in 6 rubrieken; aantoonbare kolom-/baselinevermenging (`Hollands Zwitsers`, `Smelt's Cheese Burger Burrata salade`), dus niet bronvast | **niet geaccepteerd** |
| Blossem Breda | `restaurantblossem.nl/nl` → `/nl/restaurant`, HTML; homepagehash `034e1736e8d79dd301e0f1386f1db5bc8a8b857857cdb5db44aaa2ed6f0d7f65`, menupagina `da5c632f85fda1a7c4df827db011ccdd46c5a160dbb6f6adc04ace35d5ed0c38` | 23 items in 8 rubrieken; titel `PROEF HET BESTE VAN HET SEIZOEN`; item-voor-itemvergelijking nog open | gedeeltelijk; niet volledig geaccepteerd |
| Smelt homepage | `restaurantsmelt.nl/` → `restaurantsmelt.nl/` | geen menulink; Breda-pagina bevat de PDF-link | alleen bereikbaarheid, geen extractiebewijs |

De Smelt-uitkomst is een open productbevinding, geen groene acceptatie. De
huidige kolom-/baselineparser is verbeterd (integerprijzen, kolommen,
baselines, bekende sectiekoppen), maar de echte PDF bevat nog samengevoegde
namen en verkeerde rubriektoewijzing. Een volledige BE-21-set, een separate
ongeziene set, browser-/schrijfacceptatie, een echte providercall en
DPA/EU-retentietest blijven open.

### Verenigbaarheid met #53/#56

Een read-only `git merge-tree --write-tree` tegen PR #56-head
`00f415112a29c16d2d0b2b814b6a00308a8f3747` meldt conflict in:

- `app/internal/source-triage/batch/page.js`;
- `src/lib/menuSnapshotProposals.test.js`.

Er is geen merge uitgevoerd en #56 is niet in deze branch overgenomen. De
conflicten moeten bij het samenbrengen van de twee contracten handmatig worden
beoordeeld; een groene test op deze losse branch bewijst die combinatie niet.

**Plan voor het samenbrengen (nog niet uitgevoerd, geen merge-besluit):**

1. `app/internal/source-triage/batch/page.js`: #56 wijzigt de navigatie/review-
   surface; deze branch voegt kwaliteitsmarkering en bronbewijs toe aan dezelfde
   pagina. Behoud beide: eerst #56's goedgekeurde v3-navigatie en klikpaden
   overnemen, daarna de `attentionGroups`/`uncertain`-weergave en
   `replacesDeterministic`-markering opnieuw aansluiten. Geen knop of
   accepteer-allesactie toevoegen; de bestaande expliciete reviewstappen blijven.
2. `src/lib/menuSnapshotProposals.test.js`: beide branches voegen tests toe aan
   hetzelfde bestand. Beide testblokken behouden, gedeelde fixtures
   dedupliceren zonder assertions te verwijderen, en daarna
   `menuSnapshotProposals`, `menuConcept` en de batch-surface-tests opnieuw
   draaien.
3. Na het samenbrengen: volledige suite, structuurcorpus en de browseracceptatie
   van #56 opnieuw uitvoeren. Tot die tijd geldt: de combinatie is ongetest en
   mag niet als groen worden gerapporteerd.

## Uitgevoerde checks na herstel

| Controle | Resultaat |
| --- | --- |
| `npm test` | 1903 pass, 0 fail, 0 skipped |
| `npm run test:menu-structure` | 6 pass, 0 fail |
| `npm run benchmark:menu-structure` | 23 cases: 22 pass, 1 unclassified |
| `npm run build` | exit 0 |
| `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts gecontroleerd |

Deze tellingen zijn van de herstelronde; de definitieve commit/CI-status wordt
in PR #60 en issue #59 vastgelegd.


## Herstelronde na review #6244808974 — 2026-10-18

Branch `feat/menu-extraction-59`. Deze ronde herstelt de vijf open reviewpunten
en herhaalt de bronproeven. Er is **geen provider geactiveerd**, geen betaalde
call gedaan, geen browseracceptatie uitgevoerd en geen onafhankelijke review
geclaimd. De LLM-tests gebruiken uitsluitend offline fakes.

### Herstelde punten

| Reviewpunt | Herstel | Bewijs |
| --- | --- | --- |
| P1 kolomstatus per rij-index | Kolommen worden één keer per pagina verankerd op X-posities; een lege kolom verschuift niets meer. Een tweede, identiek overlappende PDF-tekstlaag (echte Smelt-bron: hele linkerkolom 40 eenheden hoger) wordt als overlay genegeerd. | `pdfMenuStructuring.test.js`: reviewrepro LINKS/RECHTS, overlay-regressie, legitieme herhaalde lijst blijft behouden |
| P1 betaalde foutpaden als nul | Elk pad dat de provider daadwerkelijk aanriep boekt de bekende kosten; onbekende kosten houden de reservering volledig bezet (`settle(null)`) zodat budget niet hergebruikt wordt. Asynchrone reserve/settle-contracten worden expliciet geweigerd. | `menuExtractionAdapter.test.js`: schema/timeout/exception boeken 40; onbekend → reservering op 0 resterend; tweede call `budget_exceeded`; async guard geweigerd vóór de call |
| P1 AI kan defecte PDF-uitkomst niet herstellen | Voorafgaande kwaliteits-/dekkingstoets. Een voldoende deterministisch resultaat geeft géén modelcall; een bron met supplementen (die het concept niet kan opslaan) geeft géén betaalde call; anders mag een gevalideerd modelresultaat alleen de gemarkeerde bron vervangen, met dekkingseis (≥80%), bewijsplicht en `Controle nodig`. | `menuExtractionQuality.test.js`, `restaurantSourceAnalysis.test.js`: skip bij voldoende, weigeren bij supplementen, bron-scoped vervanging, te kleine dekking wordt geweigerd |
| P1 PDF-inhoud ontbreekt voor AI | `readPdfMenuSource` levert begrensde, pagina-/kolombewuste tekst (inclusief paginamarkering) via dezelfde keten voor zowel een gevonden PDF als een directe PDF-url. De tekst staat alleen in het geheugen, nooit op context/receipt. | `sourceAnalysisPipeline.test.js` (directe PDF), `restaurantSourceAnalysis.test.js` (gevonden PDF), beide met lekcontrole op `Pagina 1` |
| P2 mapping verliest varianten/bewijs | `menu.variant`/`menu.order` blijven behouden tot in de receipt-samenvatting; `structure` wordt `uncertain` zodra een rubriek onzeker is; `evidence.sourceId`/`quote` overleven mapping → receipt → concept. | `menuExtractionMapping.test.js`, `urlIntakes.test.js`, `menuExtractionRuntime.test.js` |

Aanvullend: de kwaliteitscontrole markeert hetzelfde gerecht in twee rubrieken
als mogelijke samengevoegde menuvarianten (`duplicate_item_across_categories`),
zodat Blossem-achtige panelen een uitvoerbare review krijgen in plaats van een
stilzwijgend platgeslagen menu.

### Echte read-only bronvergelijking

| Bron | Bronversie | Uitkomst na herstel | Status |
| --- | --- | --- | --- |
| Smelt Breda | `restaurantsmelt.nl/wp-content/uploads/2026/05/smelt_menu_breda_nederlands.pdf`; 550.738 bytes, 2 pagina's, 894 woorden; teksthash `24f23cbd…8a845` (ongewijzigd t.o.v. eerdere ronde), bytehash `4445a101…27f8` | **37 gerechten in 7 rubrieken** (was 50 in 6 met samengevoegde namen): KAASFONDUE 7 (Hollands 27; Zwitsers 29,50; Truffel 28; Italiaans 29,50; Frans 29,50; Bossche Bierfondue 27; Spaans 27), Vooraf 5, Hoofd 3, Desserts 4, BORREL 10, LUNCH 5, Overig 3. 88 regels van de dubbele tekstlaag genegeerd; 7 supplementregels niet als gerecht opgenomen; 1 regel met een prijs midden in de tekst als beschrijving behandeld; 3 mogelijke niet-herkende rubriekkoppen gemeld. | **verbeterd, niet volledig geaccepteerd**: supplementen en de niet-herkende subkoppen (BIJGERECHTEN/Eieren/Broodjes) blijven een expliciete beperking |
| Blossem Breda | `restaurantblossem.nl/nl/restaurant`; HTML 40.615 bytes, bytehash `da5c632f…0c38` (ongewijzigd) | 23 gerechten in 8 rubrieken, prijzen aanwezig (bijv. Gamba 19,50). De bron bevat twee accordionpanelen (DINNER: VOOR/TUSSEN/HOOFD/BIJGERECHTEN/DESSERT; LUNCH: KOUD/WARM/BIJGERECHTEN/BROOD/DESSERT). De paneeltitels zijn `span role=button` en worden niet als kop herkend, waardoor varianten plat slaan en gelijknamige rubrieken samenvoegen. Vier rubrieken (VOOR, TUSSEN, KOUD, WARM) zijn nu als `Controle nodig` gemarkeerd met vier attention-groups. | **gedeeltelijk**: item-/prijsinhoud klopt voor de herkende rubrieken; variantrelatie en arrangementen (BITES/BITTERBAL, BLOSSEM MENU, WIJNARRANGEMENT) zijn nog niet verliesvrij |

Beide bronnen zijn uitsluitend read-only opgehaald; er is niets opgeslagen,
bevestigd of gepubliceerd.

### Checks in deze ronde

| Controle | Resultaat |
| --- | --- |
| `npm test` | 1934 tests: 1931 pass, 1 fail, 2 skipped |
| `npm run test:menu-structure` | 6 pass, 0 fail |
| `npm run benchmark:menu-structure` | 23 cases: 22 pass, 1 unclassified (JSON-LD-hiërarchie) |
| Gerichte regressies | pdf 63 pass; adapter 13 pass; quality 7 pass; analyse + directe PDF 30 pass; route 28 pass; mapping/receipt/concept 46 pass |
| `npm run build` | **niet uitvoerbaar in deze sandbox**: `EPERM` bij `mkdir .next/.../[id]`; handmatige `mkdir` met `[id]` faalt hier eveneens. Geen buildresultaat geclaimd |
| `node ops/scripts/verify-pdfjs-server-trace.js` | **niet uitgevoerd**: vereist `.next` en is daarom door dezelfde sandboxbeperking geblokkeerd |

De ene falende test is `ops/scripts/capture-market-boundary.test.js` (EPERM bij
`renameSync` in de sandbox-temp). Die faalt ook op de onveranderde basis
`8c6a4caf692525d39a80c5c8430daebd1287ddd6` in een aparte worktree en is dus
geen regressie van deze branch.

### Resterende gaten

- Echte provideractivering, kostenplafond en retentie blijven een
  Product Owner-beslispunt; zonder die keuze blijft de runtime disabled.
- Browseracceptatie (klikpaden, toetsenbord, 320/390 px, licht/donker) is niet
  uitgevoerd in deze ronde.
- Blossem accordion-/menuvariantrelaties en arrangementen zijn nog niet
  verliesvrij; de review ziet nu wel de onzekerheid per rubriek.
- Smelt supplementen en niet-herkende subkoppen blijven expliciet beperkt.
- De combinatie met #56/#53 is nog niet getest; het conflictplan staat hierboven.
- Onafhankelijke herreview door de Delivery Lead staat open.

## Uitgevoerd bewijs — 2026-10-18 (review 6246984520)

Branch `feat/menu-extraction-59`. Deze ronde repareert de bronoverschrijdende
kwaliteitspoort, rondt de Blossem-varianten/arrangementen en de Smelt-
structuurvergelijking af, en voegt een bronvaste vergelijkingsprobe toe.
Provideractivering, productieacties en #56 zijn niet uitgevoerd.

### Reparaties in deze ronde

- Productgat in één bron blokkeert niet langer een andere bron: de poort is
  per bron, met behoud van blokkade, provenance en "Controle nodig" voor de
  geblokkeerde bron. Twee-bronnenregressies toegevoegd.
- Blossem: paneelkoppen (`role=button` + `aria-expanded` + bestaand doel)
  worden menuvarianten; `DINNER › VOOR` en `LUNCH › KOUD` blijven gescheiden.
  Het BITES-paneel met lijsten wordt niet meer als één gerecht gelezen.
  Eén-decimaalprijzen in een prijselement (`<strong>4.5</strong>`) worden
  gelezen. Arrangementen (`BLOSSEM MENU`, `WIJNARRANGEMENT`) worden expliciet
  als uitgesloten sectie met pad gemeld, niet als gerecht.
- Smelt: PDF-subrubrieken (`LUNCH › Eieren/Broodjes/Overig`,
  `DINER › Vooraf/Hoofd/Desserts`) blijven in het pad behouden en zijn als
  afgeleide nesting `uncertain`; de arrangementintro "Kaasfondue naar keuze"
  wordt niet meer aan de Rillette-beschrijving geplakt en wordt als
  arrangementregel gemeld.
- `src/lib/menuSourceComparison.js` + `ops/scripts/probe-menu-extraction-sources.js`
  rapporteren gemist/extra/prijs/koppeling/duplicaat per bron met byte- en
  contenthash. Geen kwaliteitsscore, geen automatische acceptatie.
- Promptinjectie-regressie in `menuExtractionAdapter.test.js`: brontekst met
  "ignore previous instructions" blijft data; tools blijven leeg, schema en
  instructie komen van de backend, en een `confidence`-veld wordt geweigerd.

### Echte read-only bronvergelijking

| Bron | Bronversie | Uitkomst | Status |
| --- | --- | --- | --- |
| Smelt Breda | PDF 550.738 bytes; bytehash `4445a101…27f8`; teksthash `24f23cbd…8a845` | **37/37 items exact**, 8 secties (`KAASFONDUE`, `DINER › Vooraf/Hoofd/Desserts`, `BORREL`, `LUNCH › Eieren/Broodjes/Overig`); 0 gemist, 0 extra, 0 prijsfout, 0 verkeerde koppeling, 0 duplicaat. Expliciet uitgesloten: 7 supplementregels, 1 arrangementregel; 1 prijsachtige regel midden in een beschrijving gemeld. | **item- en prijsniveau gecontroleerd**; supplementen/arrangementen blijven productbeperking |
| Blossem Breda | HTML 40.615 bytes; bytehash `da5c632f…0c38` | **43/43 items exact**, 13 secties; varianten `BITES`, `DINNER`, `LUNCH` en subrubrieken behouden; 0 gemist, 0 extra, 0 prijsfout, 0 verkeerde koppeling, 0 duplicaat. `BLOSSEM MENU` en `WIJNARRANGEMENT` expliciet als uitgesloten alternatieve-prijssectie gemeld. | **item- en structuurniveau gecontroleerd**; arrangementopslag ontbreekt nog |

De referentie (`ops/benchmark/source-references.json`) is een gecontroleerde
capture van de genoemde bronversie, geen waarheidsclaim voor een latere versie.
De probe faalt bij een hash- of itemverschil. Beide bronnen zijn uitsluitend
read-only opgehaald; niets is opgeslagen, bevestigd of gepubliceerd.

Smelt en Blossem krijgen door hun supplementen/arrangementen een expliciete
productgatstatus per bron (`pdf_supplements_skipped`,
`pdf_arrangements_skipped`, `html_arrangements_skipped`). Een andere, herstelbare
bron in dezelfde analyse blijft daardoor wel in aanmerking komen voor
modelherstel; de geblokkeerde bron houdt zijn eigen resultaat en bewijs.

### Checks in deze ronde

| Controle | Resultaat |
| --- | --- |
| `npm test` | 1947 tests: 1947 pass, 0 fail, 0 skipped |
| `npm run test:menu-structure` | 6 pass, 0 fail |
| `npm run benchmark:menu-structure` | 23 gevallen: 22 pass, 0 fail, 1 unclassified (JSON-LD-hiërarchie) |
| Gerichte regressies | 106 pass: `node --test "src/lib/menuExtraction*.test.js" src/lib/restaurantSourceAnalysis.test.js src/lib/pdfMenuStructuring.test.js src/lib/pdfMenuContext.test.js src/lib/htmlMenuVariants.test.js src/lib/menuSourceComparison.test.js`; 57 pass: `node --test src/lib/htmlMenuFormattedBlocks.test.js src/lib/htmlMenuProseHeadings.test.js src/lib/htmlMenuVariants.test.js src/lib/menuHierarchy.test.js src/lib/menuTextEntities.test.js src/lib/menuJsonLdExtraction.test.js ops/benchmark/structureCorpus.test.js` |
| `node ops/scripts/probe-menu-extraction-sources.js --source=all` | exit 0; Smelt 37/37 en Blossem 43/43; byte-/contenthash gelijk |
| `npm run build` | geslaagd: compiled successfully, 41/41 statische pagina's, build-id aanwezig |
| `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts gecontroleerd, native `pdf.mjs`/`pdf.worker.mjs` getraceerd, geen gebundelde PDF.js-runtime |

### Resterende gaten (deze ronde)

- Echte provideractivering, kostenplafond en retentie blijven een Product
  Owner-beslispunt. De runtime blijft disabled; deze ronde heeft geen
  provider aangeroepen.
- Browseracceptatie (klikpaden, toetsenbord, 320/390 px, licht/donker) is
  **niet uitgevoerd**: deze geïsoleerde clone heeft geen browserautomatisering
  in `package.json`/`node_modules` en geen `.env.local`/dev-serverconfiguratie.
  De extractieketen is server-side getest; de bestaande UI is niet gewijzigd.
- Arrangementen, supplementen, allergenen en prijsvarianten kunnen nog niet
  verliesvrij worden opgeslagen; ze worden gemeld of geblokkeerd, niet verzonnen.
- JSON-LD met geneste secties blijft het ene unclassified benchmarkgeval.
- #56 is alleen read-only vergeleken; de in-memory merge geeft conflicten in
  `app/internal/source-triage/batch/page.js` en
  `src/lib/menuSnapshotProposals.test.js`. Geen merge of overname uitgevoerd.

## Aanvullende verificatie — 2026-10-18 (review 6247230719)

Deze ronde is een expliciet geautoriseerde lokale developer-continuatie in een
geïsoleerde clone. Geen provider, productieactie, merge, publicatie of
workflowwijziging is uitgevoerd. Code-HEAD vóór de documentatiecommit van deze
ronde: `5ebc96442f222d0947391f147046203d38141ca4`.

De drie vervolgpunten zijn als volgt afgehandeld:

1. Bronoverschrijdende kwaliteitspoort: per bron, met twee-bronnenregressies in
   `menuExtractionQuality.test.js` en `restaurantSourceAnalysis.test.js`
   (s1 geblokkeerd en behouden met eigen provenance, s2 hersteld, een s1-
   modelmenu geweigerd met `source_blocked_by_product_gap`).
2. Blossem-varianten/arrangementen en de bronvaste Smelt-vergelijking: paneel-
   varianten en subrubrieken behouden, arrangementen expliciet uitgesloten, en
   een item-voor-itemvergelijking zonder kwaliteitsscore
   (`menuSourceComparison.js` + probe).
3. Rest van het contract: volledige suite, build en PDF.js-trace opnieuw op deze
   HEAD gedraaid; browseracceptatie is opnieuw **niet** mogelijk in deze clone.

### Checks op deze HEAD

| Controle | Commando | Resultaat |
| --- | --- | --- |
| Volledige suite | `npm test` | 1950 tests: 1950 pass, 0 fail, 0 skipped |
| Structuurcorpus | `npm run test:menu-structure` | 6 pass, 0 fail |
| Benchmark | `npm run benchmark:menu-structure` | 23 gevallen: 22 pass, 0 fail, 1 unclassified (JSON-LD-hiërarchie) |
| Build | `npm run build` | compiled successfully, 41/41 statische pagina's, `BUILD_ID` aanwezig |
| PDF.js-trace | `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts, native `pdf.mjs`/`pdf.worker.mjs`, geen gebundelde PDF.js-runtime |
| Echte bronproef | `node ops/scripts/probe-menu-extraction-sources.js --source=all` | exit 0; Smelt 37/37 en Blossem 43/43; byte- en contenthash gelijk; 0 gemist, 0 extra, 0 prijsfout, 0 verkeerde koppeling, 0 duplicaat |
| #56-compatibiliteit | `git merge-tree --write-tree HEAD origin/feat/compact-source-flow-53` | 2 inhoudelijke conflicten (`app/internal/source-triage/batch/page.js`, `src/lib/menuSnapshotProposals.test.js`); geen merge uitgevoerd |

De probe is read-only tegen precies de twee benoemde publieke URL's uitgevoerd;
de referentie is dezelfde gecontroleerde capture als hierboven. De volledige
suite, het structuurcorpus, de benchmark, de build, de PDF.js-trace en de
bronprobe zijn na de documentatiecommit herhaald op HEAD
`b86a8c198e93ce234a3fbdc005b7b8e0b76b8c68` met dezelfde resultaten (1950 pass,
6 pass, 22 pass + 1 unclassified, build met 41/41 pagina's, trace OK, probe exit
0). De nieuwe
`ops/benchmark/sourceReferences.test.js` bewaakt dat een referentie gepinde
hashes houdt, dat elk item een naam, prijs en pad heeft, dat de referentie zelf
geen duplicaat bevat, dat de bronlijst gesloten blijft en dat de probe geen
schrijf-, provider- of geheimpad krijgt. Die test telt bewust geen items als
kwaliteit.

Eerlijke beperkingen per bron uit dezelfde probe:

- Smelt: 7 supplementregels, 1 arrangementregel en 1 prijsregel midden in een
  beschrijving zijn niet als gerecht opgenomen; 88 dubbele tekstregels zijn
  genegeerd. `duplicate_item_across_categories` blijft gemeld.
- Blossem: `PROEF HET BESTE VAN HET SEIZOEN › DINNER › BLOSSEM MENU` en
  `› DINNER › WIJNARRANGEMENT` zijn als alternatieve-prijssectie uitgesloten en
  gemeld; `duplicate_item_across_categories` blijft gemeld omdat hetzelfde
  gerecht in lunch en diner staat.

### Niet uitgevoerd — geen claim

- **Browseracceptatie** (klikpaden, toetsenbord, 320/390 px, licht/donker):
  deze geïsoleerde clone heeft geen browserautomatisering in `package.json` of
  `node_modules` (geen Playwright/Puppeteer) en geen `.env.local`/dev-server-
  configuratie. De bestaande UI is in deze ronde niet gewijzigd; de
  extractieketen is server-side getest.
- **Echte provideractivering**, kostenmeting en retentie: blijven een Product
  Owner-beslispunt. De runtime blijft disabled; er is geen provider aangeroepen.
- **BE-21's 50-100-bronnenbenchmark en de aparte ongeziene set**: niet
  uitgevoerd. Twee bronnen zijn geen benchmarkafsluiting.
- **Server-side scheduler**: de worker is begrensd getest, maar start niet
  automatisch.
- **Onafhankelijke herreview** door de Delivery Lead staat open. Deze sectie is
  developer-bewijs, geen acceptatie.

## Aanvullende verificatie — 2026-10-18 (review 6247746317)

Deze ronde is een expliciet geautoriseerde lokale developer-continuatie in een
geïsoleerde clone, binnen #59/PR #60 op `feat/menu-extraction-59`. Er is geen
provider geactiveerd, geen productieactie, merge, publicatie of
workflowwijziging uitgevoerd en #56 is niet overgenomen of gewijzigd. Er zijn
geen productiegegevens of secrets gebruikt; de bronproef is read-only tegen
dezelfde twee publieke URL's.

### P1-reparatie: bronvergelijking gaf vals groen bij een extra gerecht

`compareMenuSource` filterde elke resterende werkelijke rij weg zodra ergens in
de referentie dezelfde naam+prijs bestond, zonder rubriek of multipliciteit
mee te nemen. Een correcte rij plus hetzelfde gerecht in een extra rubriek gaf
daardoor `actualItems=2`, `expectedItems=1`, `matched=1` en tegelijk lege
`missing`/`extra`/prijs/koppeling/duplicaat: de probe zou groen blijven.

Herstel in `src/lib/menuSourceComparison.js`:

- alle na het matchen resterende werkelijke rijen zijn surplus in `extra`,
  ongeacht of dezelfde naam+prijs elders in de referentie voorkomt;
- matchen blijft rij-voor-rij, dus een herhaling die de referentie zelf
  verwacht levert meerdere matches en geen verschil (multiset);
- `duplicates` meldt alleen herhalingen boven de verwachte multipliciteit, met
  `count` en `expectedCount`, en is daarmee consistent met `extra`;
- `accounting` verklaart per zijde elke rij precies één keer (expected:
  match/gemist/prijs/koppeling; actual: match/surplus/prijs/koppeling) en
  rapporteert `balanced`.

`ops/benchmark/probeVerdict.js` is nu de enige pass/fail-regel van de probe en
faalt op een hashverschil, mislukte analyse, ontbrekende verschillenlijst,
niet-sluitende boekhouding of één enkele rij in een verschillenlijst. De probe
drukt de boekhouding per bron af en kan niet meer groen eindigen bij een
onverklaarde rij.

Nieuwe regressies:

- `menuSourceComparison.test.js`: extra identiek gerecht in een andere rubriek;
  extra identieke rij in dezelfde rubriek; verwachte herhaling (2/2 match) en
  gedeeltelijke levering (1 van 2 = gemist). De bestaande duplicaatverwachting
  is aangescherpt: die rij is óók surplus en wordt niet meer weggelaten. Elke
  bestaande assertie is aangevuld met de boekhoudingsinvariant; geen bestaande
  verwachting is afgezwakt.
- `probeVerdict.test.js`: elke verschillenlijst is fataal, een ontbrekende
  lijst is fataal, een niet-sluitende boekhouding is fataal, een
  hash-/analysefout is fataal en het exacte reviewrepro (zelfde gerecht in
  rubriek B) faalt de verdict.
- `sourceReferences.test.js`: de probe moet de geteste verdictmodule gebruiken
  en mag geen eigen lossere `hasDifference` hebben.

### Checks op deze ronde

Uitgevoerd op de werkboom die als codecommit
`7426ee3f88a5ed377bf18897c800def3a8678975` is vastgelegd; deze run bevatte nog
geen documentatiewijziging.

| Controle | Commando | Resultaat |
| --- | --- | --- |
| Gerichte regressies | `node --test src/lib/menuSourceComparison.test.js ops/benchmark/probeVerdict.test.js ops/benchmark/sourceReferences.test.js` | 16 pass, 0 fail |
| Volledige suite | `npm test` | 1959 tests: 1959 pass, 0 fail, 0 skipped |
| Structuurcorpus | `npm run test:menu-structure` | 6 pass, 0 fail |
| Benchmark | `npm run benchmark:menu-structure` | 23 gevallen: 22 pass, 0 fail, 1 unclassified (STRUCT-018, JSON-LD-hiërarchie) |
| Build | `npm run build` | compiled successfully, 41/41 statische pagina's, `BUILD_ID` aanwezig |
| PDF.js-trace | `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts, native `pdf.mjs`/`pdf.worker.mjs`, geen gebundelde PDF.js-runtime |
| Echte bronproef | `node ops/scripts/probe-menu-extraction-sources.js --source=all` | exit 0; Smelt 37/37 en Blossem 43/43, byte- en contenthash gelijk, 0 gemist/extra/prijs/koppeling/duplicaat, boekhouding 37/37 en 43/43 |

De bronproef gebruikt de aangescherpte vergelijking: elke bronrij is exact
eenmaal verklaard en de som van de verschillenlijsten is nul. Dat is
itembewijs voor deze twee bronversies, geen productacceptatie en geen
benchmarkafsluiting.

### Resterende gaten (deze ronde)

- De bredere representatieve set, de aparte ongeziene set en BE-21's
  50-100-bronnenbenchmark zijn niet uitgevoerd; twee bronnen sluiten die niet
  af.
- Browseracceptatie (klikpaden, toetsenbord, 320/390 px, licht/donker) is in
  deze clone niet uitgevoerd; de bestaande UI is niet gewijzigd.
- Echte provideractivering, kostenplafond en retentie blijven een Product
  Owner-beslispunt; de runtime blijft disabled.
- Arrangementen, supplementen, allergenen en prijsvarianten zijn nog niet
  verliesvrij op te slaan; ze worden gemeld of geblokkeerd, niet verzonnen.
- Server-side scheduler en #56-compatibiliteit zijn niet opnieuw getest in
  deze ronde; de eerdere read-only conflicteanalyse blijft staan.
- Onafhankelijke herreview door de Delivery Lead staat open. Deze sectie is
  ontwikkelaarsbewijs, geen acceptatie en geen release.

### Bevestiging op de documentatie-HEAD

Na de documentatiecommit zijn dezelfde controles herhaald op HEAD
`6d3956784fadba0ebe09150f70ea26f7b709bac3` (docs-only verschil met codecommit
`7426ee3`): gerichte regressies 16 pass, volledige suite 1959 pass / 0 fail /
0 skipped, structuurcorpus 6 pass, benchmark 22 pass + 1 unclassified
(STRUCT-018), bronproef exit 0 met Smelt 37/37 en Blossem 43/43 en boekhouding
37/37 en 43/43, build compiled successfully met 41/41 statische pagina's en
`BUILD_ID` `iJZ2x6mzfiuqoXLDDWp26`, PDF.js-trace OK met 164 gecontroleerde
server scripts. De eerste trace-aanroep tijdens het wegschrijven van de
buildtracering faalde op een ontbrekend traceringsbestand; na afronding van
dezelfde build slaagde de trace zonder codewijziging. Dat verschil is als
build-race gedocumenteerd, niet als productresultaat.

Deze bevestigingscommit is zelf docs-only; de genoemde HEAD is de laatste
commit waarop de controles zijn uitgevoerd. Browseracceptatie,
provideractivering, de 50-100-bronnenbenchmark en onafhankelijke review blijven
open.
