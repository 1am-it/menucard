# Menu-extractie - acceptatie en testbewijs

Status: CONCEPT, 2026-10-17. Afgesplitst uit MENU-EXTRACTION.md v0.1.
Dit document beschrijft vereiste tests, geen reeds uitgevoerde acceptatie.

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

Aanvullend: controleer dat samenvatting, detail en conceptopslag hetzelfde
extractieresultaat gebruiken. Noteer bij ieder resultaat bronversie/hash,
testdatum en gebruikte protocol-, schema-, model- en codeversie.
