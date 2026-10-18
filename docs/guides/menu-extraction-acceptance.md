# Menu-extractie - acceptatie en testbewijs

Status: acceptatievoorwaarden voor GitHub #59, herzien 2026-10-17. Afgesplitst
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
| `npm test` | 1890 pass, 0 fail |
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
