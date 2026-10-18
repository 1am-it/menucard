# Menu-extractie - acceptatie en testbewijs

Status: acceptatievoorwaarden voor GitHub #59, herzien 2026-10-18. Afgesplitst
uit MENU-EXTRACTION.md v0.1. Dit document scheidt vereiste tests van het
daadwerkelijk uitgevoerde bewijs. Read-only bronproeven zijn uitgevoerd; echte
provideractivering en volledige productacceptatie zijn dat niet.

[Extractie-instructie](../../MENU-EXTRACTION.md) |
[Implementatieafspraken](menu-extraction-implementation.md) |
[Representatieve set en drempels](menu-extraction-representative-set.md) |
[Acceptatiematrix #59](menu-extraction-acceptance-matrix.md)

> **Statuscorrectie 2026-10-18 (review #6248014804).** De documenten zijn in
> `3e49f89` gepusht. De read-only proeven op de twee expliciet toegestane
> openbare bronnen (Smelt, Blossem) zijn uitgevoerd. De geïsoleerde
> browserfixture is uitgevoerd; live/staging browseracceptatie niet.
> Representatieve set en holdout zijn gepind in
> `ops/benchmark/menu-extraction-acceptance-set.json`. De actuele matrix staat
> in [menu-extraction-acceptance-matrix.md](menu-extraction-acceptance-matrix.md);
> oudere secties hieronder blijven als historie staan.

> **Herstelronde 2026-10-18 (review #6248407225).** De fixture-isolatie is
> fail-closed gemaakt (fetch, XHR, WebSocket, EventSource, sendBeacon,
> CDP-subresources/navigatie en DNS-lockdown) met negatieve VM-regressies. De
> holdout-guard onderscheidt nu `unused`, `evaluated_once` en
> `used_for_tuning`; een eerste evaluatie is vastlegbaar zonder tuning. De vier
> door de Product Owner goedgekeurde openbare bronnen zijn vóór de meting
> capture-only gepind en daarna elk één keer read-only geëvalueerd: De Botanist
> 151 items/59 secties, Mr Moos 0, Colonia 0, Gauchos Breda HTTP 404. Het
> v2-ontwerp eist nu bewijs per prijsbedrag en een zichtbare rollback. De
> app-side AI-provider is niet geactiveerd; niets is gemerged of gepubliceerd.

> **Praktijkronde 2026-10-18 (review #6248740792).** De eerste vier
> holdoutuitkomsten blijven ongewijzigd als baseline. De Botanist, Mr Moos en
> Colonia zijn daarna voor reparatie gebruikt en staan nu als representatief
> met `usedForTuning: true`; alleen Gauchos Breda blijft holdout (HTTP 404).
> Hersteld zijn een class-gebaseerd HTML-prijselement (Colonia 84 items), één
> begrensd menuhubniveau (Mr Moos 247 items) en vier PDF-tekstlaagfouten. De
> Botanist heeft een gecontroleerde layoutreferentie van 141 rijen: 95 matched,
> 46 missing, 5 extra, 0 prijsverschil en 96 niet-gekoppelde items. Wijn- en
> cocktailblokken blijven expliciet niet ondersteund. Zie
> [menu-extraction-botanist-reference.md](menu-extraction-botanist-reference.md).


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

### Herstelronde review 6249303096 — 2026-10-18

Twee reproduceerbare P1-fouten in `pdfMenuStructuring.js` zijn hersteld met
generieke regressies; er is geen bron- of providerspecifieke uitzondering
toegevoegd.

| Punt | Herstel | Regressie |
| --- | --- | --- |
| Paginabrede prijsankers verwijderden een geldig gerecht in een andere kolom | Prijsbewijs is per PDF-tekstblok/kolom: een prijsrun of expliciete variantreeks is een prijs; een getal in een naamdragend blok niet zolang er rechts een echt prijsblok staat. De dunne linkerkolom (`Soep 8.5`) blijft behouden en de wijnregels houden beide bedragen als `multiple_undecomposed`. | `pdfMenuStructuring.test.js`: exacte reviewfixture, twee kolommen, twee varianten op de volgende baseline, naamgetallen (`Monkey 47`, `0.0`, `6 st.`) en een geplakt slotbedrag |
| Een volgende baseline werd zonder afstandsbewijs een bekende prijs | Naam+prijs op twee baselines alleen binnen 24 PDF-eenheden; een losse voettekst/verre regel wordt niet gekoppeld en als `unlinkedPriceLines` gemeld | `pdfMenuStructuring.test.js`: korte echte afstand, 60-eenheden witruimte, 550-eenheden voettekst, twee kolommen, twee varianten |
| Prijsregels verdwenen stilzwijgend | `layout.unlinkedPriceLines`, `pdf_unlinked_price_lines` en een plain-language limitation; een PDF met zulke regels is niet `sufficient` | `menuExtractionQuality.test.js`, `restaurantSourceAnalysis.test.js` |
| Supplementregels konden als gewone gerechten verschijnen | `Supplement`/`Supplementen` plus lowercase wrapped continuation worden geteld in `supplementLines` en niet opgeslagen; quality flagt het prefix | `pdfMenuStructuring.test.js`, `menuExtractionQuality.test.js` |

Uitgevoerd op deze working tree boven `7c0fb3a` (commit volgt in het
checkpoint):

| Controle | Resultaat |
| --- | --- |
| `npm test` | 2030 tests: 2030 pass, 0 fail, 0 skipped |
| Gerichte PDF/quality/analysis-tests | 82 pass, 0 fail (`pdfMenuStructuring`, `pdfMenuStructuringLiveRegressions`, `menuExtractionQuality`, `restaurantSourceAnalysis`) |
| `npm run test:menu-structure` | 6 pass, 0 fail |
| `npm run benchmark:menu-structure` | 23 gevallen: 22 pass, 0 fail, 1 unclassified (`STRUCT-018`, bestaande JSON-LD-keuze) |
| `npm run build` | compiled successfully in 31.2 s |
| `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts, native `pdf.mjs`/`pdf.worker.mjs` |
| Smelt/Blossem read-only probe | exit 0; Smelt 37/37, Blossem 43/43, byte-/contenthash gelijk, alle verschilcategorieën 0 |
| Botanist read-only heranalyse | 196 items/54 secties; gecommitte vergelijking ongewijzigd 95 matched / 46 missing / 5 extra / 0 prijsverschil / 96 niet-gekoppeld; limitations: 12 supplementregels, 18 midden-in-de-regel-prijzen, 24 niet-gekoppelde prijsregels |

De Botanist-referentie blijft een door de developer opgestelde, gecontroleerde
partiële layoutcapture — geen onafhankelijk vastgestelde bronwaarheid. De
Smelt/Blossem-uitkomsten zijn read-only bronproeven, geen item-voor-item
productacceptatie. Een echte providercall, app-side AI-activering,
browser-/schrijfacceptatie, een nieuwe holdout en #56-compatibiliteit zijn in
deze ronde niet uitgevoerd en blijven afzonderlijke gaten.

### Herstelronde review 6249657793 — 2026-10-18

De Delivery Lead reproduceerde één resterende P1: een volledig numeriek
pdfjs-tekstitem gold onvoorwaardelijk als prijs. Daardoor werd een gesplitst
naam- of portiegetal (`Monkey` + `47` + `10.00`; `Oesters` + `6` + `st.` +
`24.00`) als bekende prijs 47/6 gelezen, verdween het echte bedrag en ontstond
een nepitem `st.`. De reparatie gebruikt nu de hele lokale regel/kolom.

| Punt | Herstel | Regressie |
| --- | --- | --- |
| Gesplitst naam-/portiegetal werd een bekende prijs | `classifyNumericEvidence` in `pdfMenuStructuring.js`: een getal direct vóór een eenheid (`st.`, `pers.`, `glas`, `cl`, …) is een hoeveelheid; een getal na een naamrun met alleen de echte bedragkolom erna is naamtekst; een leidend `0.0` opent de naam; een expliciete variantreeks blijft een variant. Een decimaalgetal op die naampositie zonder scheidingsteken is niet bewijsbaar en wordt als `ambiguousPriceLines` gemeld in plaats van als bekende prijs of stille naam. Een prijsrun uit een naburige, samengevoegde kolom wordt nooit aan de volgende naam geplakt. | `pdfMenuStructuring.test.js`: geplakte en gesplitste `Monkey 47`, `Oesters 6 st.`, gesplitste `0.0 Regrets`, hoeveelheid zonder `st.`, echte integerprijs, twee gerechten op één regel, twee kolommen, glas/fles-varianten, supplementen en de echte Botanist-vorm (`5.5` + `Pink Grapefruit Soda`); `restaurantSourceAnalysis.test.js`: parser → qualitygate → limitation |
| Waarschuwing verdween onderweg | Dezelfde layoutteller bereikt `pdf_ambiguous_price_lines` en de plain-language limitation; een PDF met zo'n regel is niet `sufficient` | ketentest vanaf een echte PDF-fixture: twee geldige items blijven, de ambigue regel levert geen item/prijs, `assessment.sufficient === false`, code en limitation aanwezig |

Uitgevoerd op deze working tree (commit volgt in het checkpoint):

| Controle | Resultaat |
| --- | --- |
| `npm test` | 2036 tests: 2036 pass, 0 fail, 0 skipped |
| Gerichte PDF/quality/analysis-tests | 88 pass, 0 fail (`pdfMenuStructuring`, live-regressies, quality, analysis) |
| `npm run test:menu-structure` | 6 pass, 0 fail |
| `npm run benchmark:menu-structure` | 23 gevallen: 22 pass, 0 fail, 1 unclassified (`STRUCT-018`, bestaande JSON-LD-keuze) |
| `npm run build` | compiled successfully in 32.6 s |
| `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts, native `pdf.mjs`/`pdf.worker.mjs` |
| Smelt/Blossem read-only probe | Smelt 37/37, Blossem 43/43; byte- en contenthash gelijk; alle verschilcategorieën 0 en boekhouding gebalanceerd |
| Botanist read-only heranalyse | dezelfde gepinde PDF (551498 bytes, `50fef0b6…7f85`, content `eb9da86e…3ade7f`): 196 items/54 secties; layout 18 ambigu, 24 niet-gekoppeld, 12 supplement, 2 onbekende kop; itemlijst en tellers regel voor regel gelijk aan HEAD (0 gewijzigde rijen) |

De Botanist-vergelijking blijft ongewijzigd open: 46 ontbrekende en 96
niet-gekoppelde items zijn niet hersteld of geclaimd. Er is geen nieuwe holdout
geëvalueerd, geen referentie aangepast, geen provider of app-side AI
geactiveerd, geen concept opgeslagen en geen browseracceptatie uitgevoerd. De
Smelt/Blossem-proef is read-only bronbewijs, geen item-voor-item
productacceptatie.

### Herstelronde review 6249915021 — 2026-10-18

De Delivery Lead reproduceerde één resterende P1: alleen een decimaal
tussengetal werd ambigu, terwijl hetzelfde bronbewijs met hele bedragen
(`Wijn` + `6` + `25`) stil als naam `Wijn 6` en bekende prijs `25` werd
opgeslagen. De ambiguïteitsbeslissing hing dus af van de schrijfwijze van het
bedrag.

| Punt | Herstel | Regressie |
| --- | --- | --- |
| Hele bedragen werden stil naamtekst | `classifyNumericEvidence` gebruikt geen integer-/decimaalnotatie meer als tie-breaker. Elk prijsvormig getal tussen een naamrun en een volgend bedrag is ambigu, tenzij een expliciete eenheid (`6 st.`), een leidend `0.0` of een expliciete variantreeks (`6.5 / 25.0`) het getal resolveert. Ook de pdfjs-tekstgroepering is geen bewijs: pdfjs voegt een naam en een dichtbij gelegen bedrag samen, dus een geplakt naamgetal krijgt dezelfde veilige behandeling. | `pdfMenuStructuring.test.js`: metamorfe matrix `Wijn 6 25` / `6.0 25.0` / `6,00 25,00` voor gesplitste items, dicht bij de naam, twee verre bedragkolommen, geplakt naamgetal en een geplakte hele regel; eenheid, scheidingsteken, echte integerprijs en meerdere gerechten/kolommen blijven werken |
| Onzekere regel bereikte de gate niet | Dezelfde `ambiguousPriceLines` bereikt `pdf_ambiguous_price_lines` en de limitation; geen item, geen bekende prijs en nooit `sufficient` | `restaurantSourceAnalysis.test.js`: dezelfde PDF-geometrie in integer-, decimaal- en kommavorm, elk parser → qualitygate → limitation |

Uitgevoerd op deze working tree (commit volgt in het checkpoint):

| Controle | Resultaat |
| --- | --- |
| `npm test` | 2038 tests: 2038 pass, 0 fail, 0 skipped |
| Gerichte PDF/quality/analysis-tests | 90 pass, 0 fail (`pdfMenuStructuring`, live-regressies, quality, analysis) |
| `npm run test:menu-structure` | 6 pass, 0 fail |
| `npm run benchmark:menu-structure` | 23 gevallen: 22 pass, 0 fail, 1 unclassified (`STRUCT-018`, bestaande JSON-LD-keuze) |
| `npm run build` | compiled successfully in 18.7 s |
| `node ops/scripts/verify-pdfjs-server-trace.js` | OK; 164 server scripts, native `pdf.mjs`/`pdf.worker.mjs` |
| Botanist read-only heranalyse | dezelfde gepinde PDF: 195 items/54 secties; layout 19 ambigu, 24 niet-gekoppeld, 12 supplement, 2 onbekende kop; referentiesecties exact gelijk (95 matched / 46 missing / 5 extra / 0 prijsverschil); niet-gekoppeld 96 → 95; `Monkey 47` is nu de ene eerlijk gemelde ambigue regel |
| Smelt/Blossem | deze ronde niet opnieuw opgehaald; de review vroeg geen nieuwe live bronproef. De eerdere read-only 37/37 en 43/43 blijven historie, geen nieuwe claim |

De Botanist-referentie is niet aangepast om de parser groen te maken: alleen de
gemeten vergelijking is bijgewerkt. `Monkey 47` (geplakt, zonder eenheid) is
structureel gelijk aan een glas/fles-regel zonder scheidingsteken en wordt
daarom niet meer geraden. De 46 ontbrekende referentieregels blijven open.
Geen provider, betaalde call, app-side AI, browseracceptatie, conceptopslag,
nieuwe holdout, merge of publicatie is uitgevoerd.

### Echte read-only bronproeven (2026-10-17)

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

> **Statuscorrectie 2026-10-18:** de actuele read-only merge-tree op #59-HEAD
> `aa6c84a` meldt **drie** inhoudelijke conflicten: `page.js`,
> `src/lib/htmlMenuStructure.js` en `menuSnapshotProposals.test.js`. De derde is
> ontstaan door latere Blossem-/parserwijzigingen op deze branch; de eerdere
> twee-conflictennotitie is daarmee achterhaald. Er is niets gemerged of
> gewijzigd aan #56.

**Plan voor het samenbrengen (nog niet uitgevoerd, geen merge-besluit):**

1. `app/internal/source-triage/batch/page.js`: #56 wijzigt de navigatie/review-
   surface; deze branch voegt kwaliteitsmarkering en bronbewijs toe aan dezelfde
   pagina. Behoud beide: eerst #56's goedgekeurde v3-navigatie en klikpaden
   overnemen, daarna de `attentionGroups`/`uncertain`-weergave en
   `replacesDeterministic`-markering opnieuw aansluiten. Geen knop of
   accepteer-allesactie toevoegen; de bestaande expliciete reviewstappen blijven.
2. `src/lib/htmlMenuStructure.js`: zowel #56 als deze branch wijzigen de
   parser/panelbehandeling. Behoud #56's reviewgedrag en de
   variant-/paneelregels van deze branch; daarna het volledige structuurcorpus
   draaien. Geen patroon of assertie verwijderen om het conflict op te lossen.
3. `src/lib/menuSnapshotProposals.test.js`: beide branches voegen tests toe aan
   hetzelfde bestand. Beide testblokken behouden, gedeelde fixtures
   dedupliceren zonder assertions te verwijderen, en daarna
   `menuSnapshotProposals`, `menuConcept` en de batch-surface-tests opnieuw
   draaien.
4. Na het samenbrengen: volledige suite, structuurcorpus en de browseracceptatie
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
