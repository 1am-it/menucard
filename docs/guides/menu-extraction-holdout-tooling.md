# Menu-extractie — holdouttooling met een expliciet manifest

Status: ontwikkelaarsdocumentatie voor #59, toegevoegd 2026-10-21 na de
Delivery Lead-opdracht in review 6315269210. Dit document beschrijft alleen de
tooling; het is geen acceptatie en geen bewijs dat een bron volledig is
uitgelezen.

## Waarom een manifest

Een holdout is alleen bruikbaar als de bronversie vóór de eerste meting is
vastgelegd en daarna precies één keer is geëvalueerd. Holdout-1 (vier bronnen)
legt die toestand vast in `ops/benchmark/menu-extraction-acceptance-set.json`.
Holdout-2 (19 bronnen, gepind in `ops/benchmark/holdout-2-sources.json`) draagt
de toestand per bron in het manifest zelf:

```json
{ "evaluationState": "unused", "evaluationCount": 0, "usedForTuning": false }
```

Toegestane toestanden: `unused`, `evaluated_once`, `used_for_tuning`. Een bron
met `used_for_tuning` is geen holdout meer en wordt door de tooling geweigerd;
die hoort naar de representatieve set en vraagt een nieuwe, vooraf gepinde
holdout.

## Capture-first, create-only

```powershell
node ops/scripts/capture-menu-extraction-holdout-references.js `
  --manifest ops/benchmark/holdout-2-sources.json
```

- Leest uitsluitend de entry-URL's uit het manifest, via `safeOutboundFetch`,
  en controleert elke URL én elke redirect op de gepinde `allowedHosts`.
- Schrijft bytes, SHA-256, content-type, tijd en (bij falen) de HTTP-status of
  foutreden. Geen parseruitkomst, geen itemaantal en geen `groundTruth`.
- De uitvoer wordt met `flag: 'wx'` geschreven. Een tweede capture van dezelfde
  manifestnaam wordt geweigerd; de gepinde bronversie is onveranderlijk.

Zonder `--manifest` gebruikt het script de oorspronkelijke holdout-1-manifest en
dezelfde bestandsnamen. De bestaande holdout-1-bestanden blijven daardoor
byte-gelijk.

## Precies één evaluatie

```powershell
node ops/scripts/probe-menu-extraction-holdout.js `
  --manifest ops/benchmark/holdout-2-sources.json
```

- Weigert wanneer de evaluatie-uitvoer al bestaat, wanneer een bron niet
  `unused` is, wanneer `evaluationCount` niet 0 is of wanneer de capture
  ontbreekt. Er is dus geen tweede evaluatie per gepinde versie.
- Weigert een capture waarvan de URL niet gelijk is aan de manifest-URL en
  controleert de entry-host opnieuw vóór de fetch.
- Leest de bron opnieuw, vergelijkt de byteshash met de pin
  (`sourceVersionMatches`) en gebruikt de echte analyseketen. Een andere
  bronversie wordt eerlijk vastgelegd, niet stilzwijgend opnieuw gepind.
- Schrijft per bron: status, items, secties, menucontexten, prijsstatus,
  dekkingsenvelope, per-item bewijsdekking, beperkingen, fouten en bij een
  blokkade de concrete reden. Bij een geblokkeerde of onleesbare bron staat
  `itemCount: 0` en nooit een successtatus.
- Schrijft daarnaast een aggregaat per uitkomsttype (`html`, `pdf`, `blocked`,
  `no_menu`, `unsupported`).

Beide scripts zijn nooit onderdeel van een `npm`-script en hebben geen
provider, database of publicatiepad.

## Aggregaat en drempels

Het aggregaat gebruikt de drempels uit
[menu-extraction-representative-set.md](menu-extraction-representative-set.md):
0 verzonnen gerechten, 0 verzonnen prijzen, 100% bron-ID, 100% locator en 100%
ondersteunend bewijs, en een reden voor ontbrekende onderdelen.

- De bewijspercentages komen uit de per-item `evidence.locator` en het
  extractorpatroon, de contenthash of de quote. Een modelconfidence telt nooit.
- **Verzonnen items en prijzen zijn niet meetbaar zonder gecontroleerde
  referentie per bron.** Het rapport meldt die drempel daarom als
  `not_measurable_without_controlled_reference` in plaats van 0.
- Ontbrekende onderdelen zijn eveneens pas aantoonbaar tegen een gecontroleerde
  referentie. Het rapport registreert per bron alle gemelde beperkingen en de
  blokkadereden, maar claimt geen volledigheid.
- Een bron zonder items krijgt het type `no_menu`; dat is een eerlijke
  uitkomst, geen geslaagde menukaart.

## Harde holdoutregel voor ontwikkelaars

De 19 URL's in `holdout-2-sources.json` worden niet door de ontwikkelaar
opgehaald, geïnspecteerd of gebruikt om op te tunen. Alleen de Delivery Lead
voert de capture en de ene evaluatie uit. Regressies voor deze tooling gebruiken
uitsluitend fixtures en `.invalid`-hosts.

## Regressies

- `ops/benchmark/holdoutManifest.test.js`: manifestvalidatie, staten,
  approved-hostregel, paden en CLI-argumenten.
- `ops/benchmark/holdoutReport.test.js`: prijs-/bewijsdekking, groepering per
  type, blokkadereden en de expliciet niet-meetbare drempels.
- `ops/benchmark/holdoutTooling.test.js`: weigering van een tweede evaluatie,
  tweede capture, ontbrekende capture, niet-gepinde host en getunede bron.
- `ops/benchmark/holdoutReferences.test.js`: de bestaande holdout-1-pin blijft
  capture-only en byte-gelijk.
