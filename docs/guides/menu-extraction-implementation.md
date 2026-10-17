# Menu-extractie - implementatieafspraken

Status: bouwafspraken voor GitHub #59, 2026-10-17. Afgesplitst uit
MENU-EXTRACTION.md v0.1. Implementatie is veilig begonnen op
`feat/menu-extraction-59`; een echte provideractivering en PR #56 blijven
buiten scope.

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

## 10. Backendvalidatie en controleerbare overdracht

De backend valideert onafhankelijk schema, types, bounds, bewijsverwijzingen,
prijsregels en onderlinge relaties. Geen modeluitvoer direct naar publieke data.

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
