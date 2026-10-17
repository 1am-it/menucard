# Menu-extractie - acceptatie en testbewijs

Status: acceptatievoorwaarden voor GitHub #59, 2026-10-17. Afgesplitst uit
MENU-EXTRACTION.md v0.1. Dit document scheidt vereiste tests van het
daadwerkelijk uitgevoerde bewijs; de echte bron-/provideracceptatie is nog
niet uitgevoerd.

[Extractie-instructie](../../MENU-EXTRACTION.md) |
[Implementatieafspraken](menu-extraction-implementation.md)

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

- de echte Smelt-PDF en Blossem-pagina zijn niet opgehaald; daarvoor ontbreekt
  expliciet goedgekeurde externe bronproef/toegang in deze sessie;
- geen echte browser-/schrijfacceptatie of geïsoleerde testomgeving;
- geen echte providercall, kostenmeting of DPA/EU-retentietest;
- geen server-side scheduler die de worker automatisch start;
- geen volledige BE-21-set van 50-100 bronnen of aparte ongeziene set.

Deze gaten zijn blokkades/acceptatievoorwaarden, geen verborgen successen.

Aanvullend: controleer dat samenvatting, detail en conceptopslag hetzelfde
extractieresultaat gebruiken. Noteer bij ieder resultaat bronversie/hash,
testdatum en gebruikte protocol-, schema-, model- en codeversie.
