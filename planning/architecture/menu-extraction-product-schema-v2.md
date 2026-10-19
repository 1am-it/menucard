# Menu-extractie — productschema v2 (ontwerp ter beoordeling)

Status: **ontwerp + pure schema-/mappinglaag geïmplementeerd; read-only
integratie aangesloten. Geen route voor v2-writes, geen migratie en
geen publicatie.** Datum: 2026-10-18,
aangevuld na Delivery Lead-review 6248407225 (prijsbewijs per bedrag en zichtbare
rollback), na de goedgekeurde bouwronde van 2026-10-19 (interne
varianten/supplementen) en na de read-only aansluiting op de bestaande
receipt/review/concept/batch/exportpaden (codehead `0f9ea9d`). Hoort bij
GitHub #59 / PR #60. Dit document beschrijft een versiegebonden, verliesvrije
uitbreiding voor menuconstructies die het huidige productcontract niet kan
opslaan. Het activeert geen provider, migratie, export of publicatie en wijzigt
#56 niet. De read-only integratie en de resterende schrijfstappen staan in
[menu-extraction-v2-integration.md](../../docs/guides/menu-extraction-v2-integration.md).

## Waarom dit ontwerp nodig is

De deterministische en modelgestuurde extractie leveren al menuvarianten,
geneste rubrieken, prijzen, bronbewijs en dekkingsinformatie. Het bestaande
productcontract bewaart echter per regel één prijs en geen expliciete
supplement-, keuze-, arrangement- of allergenenrelatie:

| Construct | Huidige receipt/concept | Huidige export (`data/menus.json`) | Status |
| --- | --- | --- | --- |
| Menutitel/variant | `title`, `contextSlug`, pad | `subtitle`, `title`, `path` | grotendeels |
| Geneste rubriek | `path`/`sourcePath` + `uncertain` | `path` bij nesting | ondersteund |
| Eén prijs | `price`, `priceStatus`, `priceText` | `price`, `priceValue` + vlaggen | ondersteund |
| Glas/fles, vanaf, meerdere prijzen | één `price` of `multiple_undecomposed` | één `price`; vlaggen `priceIsFrom`/`priceIsMultiple` | **niet verliesvrij** |
| Supplement | niet in concept; wordt gemeld/geblokkeerd | `priceIsSupplement`, `sup` alleen als bestaande verrijking | **niet verliesvrij** |
| Keuzegroep/arrangement | niet in concept; wordt gemeld/geblokkeerd | geen veld | **niet verliesvrij** |
| Allergenen expliciet/onbekend | niet in extractieconcept; `[]` in export is dubbelzinnig | `allergens: []` | **niet verliesvrij** |
| Bronbewijs/dekking | `evidence`, `coverage`, `limitations` | niet in export | ondersteund in receipt/review |

Het benchmarkcontract (`menu-extraction-output/v1`) is niet automatisch het
productcontract. Dit ontwerp is de voorgestelde brug; het is geen goedkeuring.

## Ontwerpprincipes

1. **Additief en versiegebonden.** Nieuwe objecten dragen expliciet
   `schemaVersion: "menu-extraction-product/v2"`. Oude lezers blijven v1 lezen.
2. **Nooit stil afplatten.** Een construct dat niet in een projectie past, wordt
   geweigerd met een concrete reden of als beperking gemeld. Het verdwijnt niet.
3. **Onbekend is geen nul en geen lege lijst.** `unknown`/`on_request` blijven
   expliciet; een ontbrekende allergenenvermelding is `unknown`, niet
   allergeenvrij.
4. **Eén primaire prijs, varianten apart.** Een supplement of glasprijs wordt
   nooit de hoofdprijs. Meerdere prijzen krijgen een expliciete status en
   varianten; de backend kiest niet zelf de laagste.
5. **Bewijs is verplicht voor een geëxtraheerd veld, en per prijsbedrag.** Ieder item en iedere prijsvariant verwijst naar source-ID, locator en een korte passage. Een prijsvariant is pas onderbouwd als de eigen `evidence.quote` het bijbehorende bedrag (of het bronlabel plus bedrag) aantoonbaar bevat. Een itemquote die alleen de gerechtnaam of alleen een ander bedrag ondersteunt, is geen prijsbewijs. De validator weigert zo'n variant; hij vult het bedrag niet aan en kiest geen alternatief.
6. **Geen trustvelden.** `confidence`, `reviewReady`, `approved` en
   `publicationReady` blijven verboden; review en publicatie zijn aparte

## Voorgesteld schema

```json
{
  "schemaVersion": "menu-extraction-product/v2",
  "menus": [
    {
      "id": "menu-1",
      "title": "Fictief Diner",
      "sourceId": "src-1",
      "variant": { "id": "variant-1", "label": "Diner", "sourceLabel": "DINNER", "locale": "nl", "location": "Breda", "order": 1 },
      "categories": [
        {
          "id": "cat-1",
          "name": "Voorgerechten",
          "path": ["Diner", "Voorgerechten"],
          "sourcePath": ["DINNER", "VOOR"],
          "kind": "section",
          "uncertain": false,
          "items": [
            {
              "id": "item-1",
              "kind": "dish",
              "name": "Fictieve burrata",
              "description": "Fictieve omschrijving",
              "price": { "status": "known", "amountMinorUnits": 1300, "currency": "EUR", "text": "13,00", "isFrom": false, "evidence": { "sourceId": "src-1", "locator": "DINNER > VOOR > regel 1", "quote": "Fictieve burrata 13,00" } },
              "priceVariants": [],
              "primaryPriceRef": null,
              "supplementOf": null,
              "choiceGroupRef": null,
              "allergens": { "status": "unknown", "codes": [], "sourceText": null },
              "dietaryLabels": [],
              "availability": null,
              "evidence": { "sourceId": "src-1", "locator": "DINNER > VOOR > regel 1", "quote": "Fictieve burrata 13,00", "contentHash": "hex" }
            },
            {
              "id": "item-2",
              "kind": "beverage",
              "name": "Fictieve wijn",
              "description": null,
              "price": { "status": "multiple_undecomposed", "amountMinorUnits": null, "currency": "EUR", "text": "6,50 / 25,00", "isFrom": false, "evidence": { "sourceId": "src-1", "locator": "regel 2", "quote": "Fictieve wijn 6,50 / 25,00" } },
              "priceVariants": [
                { "id": "pv-1", "label": "Glas", "kind": "glass", "amountMinorUnits": 650, "currency": "EUR", "text": "6,50", "isSupplement": false, "perPerson": false, "evidence": { "sourceId": "src-1", "locator": "regel 2", "quote": "Glas 6,50" } },
                { "id": "pv-2", "label": "Fles", "kind": "bottle", "amountMinorUnits": 2500, "currency": "EUR", "text": "25,00", "isSupplement": false, "perPerson": false, "evidence": { "sourceId": "src-1", "locator": "regel 2", "quote": "Fles 25,00" } }
              ],
              "primaryPriceRef": "pv-1",
              "supplementOf": null,
              "choiceGroupRef": null,
              "allergens": { "status": "explicit", "codes": ["sulfiet"], "sourceText": "Bevat sulfiet" },
              "dietaryLabels": [],
              "availability": null,
              "evidence": { "sourceId": "src-1", "locator": "regel 2", "quote": "Fictieve wijn 6,50 / 25,00" }
            }
          ]
        }
      ]
    }
  ],
  "coverage": { "status": "partial", "sourcesRead": 1, "pagesRead": 1, "itemsExtracted": 2, "unreadSources": [], "limitations": ["Arrangementen zijn nog niet opgeslagen."] }
}
```

### Prijsbewijs per bedrag (aanvullingen review 6248407225, 6273510672 en 6274281958)

Een itemquote is niet genoeg voor een prijs. Voor iedere `price` met status
`known`/`from` en voor iedere `priceVariants[]` geldt:

1. `evidence.sourceId`, `evidence.locator` en `evidence.quote` zijn verplicht;
2. de quote bevat het gezaghebbende bedrag als één volledig monetair token,
   bijvoorbeeld `13`, `13,00`, `€ 1.250,00`, `13,00 euro` of `Glas 6,50`;
3. het integerdeel van een ander bedrag is nooit bewijs. `13,00` wordt niet
   bewezen door `13,50`, `13.50`, `13,5`, `13,50,00`, `113` of `113,00`;
4. de volledige monetaire lexeme telt, inclusief een voorloopdecimaal. `.50`,
   `,50`, `EUR .50` en `EUR ,50` zijn ambigu en bewijzen nooit 50 euro. Er wordt
   geen bronnotatie stil als 50 cent gelezen en niets afgerond;
5. een expliciet teken vóór het bedrag maakt het token ondertekend of
   toeslagachtig. Een minteken (ook `−`, `–`, `—`) of plus, met of zonder
   valutamarker tussen teken en cijfers (`- EUR 13,50`, `-€ 13,50`,
   `€ -13,50`, `+ € 2,50`), bewijst in dit niet-negatieve schema nooit een
   positieve `known`-prijs. Een bedrag zonder teken blijft geldig;
6. decimale komma en punt zijn beide geldig. Een punt met groepen van drie
   cijfers is Nederlandse duizendnotatie (`1.250,00`, `1.250`); gemengde
   notaties zijn alleen eenduidig wanneer de rechter scheiding decimaal is
   (`1.250,00`, `1,250.00`). Een enkele komma met drie cijfers (`13,000`) is
   ambigu en wordt geweigerd. Er wordt niets afgerond;
7. een getal is alleen prijsbewijs in prijscontext: een valutateken of
   prijssuffix ernaast (`€`, `EUR`, `euro`, `p.p.`, `per persoon`), of een
   zelfstandig bedrag. Een kaal jaartal 1900-2099 zonder valutateken,
   hoeveelheden met een eenheid (`4 personen`, `13 gangen`, `13 gram`) en
   labels (`nr. 13`, `pagina 13`) zijn geen prijsbewijs;
8. een quote die alleen de gerechtnaam, alleen een beschrijving of alleen een
   ander bedrag bevat, levert `price_evidence_missing` op. Bij ambiguïteit
   weigert de validator dus in plaats van een ander bedrag te kiezen;
9. de validator past geen `amountMinorUnits` aan op basis van een andere quote
   en kiest nooit de laagste of eerste prijs als vervanging;
10. een variant zonder eigen bewijs blijft zichtbaar als onzeker en blokkeert
    export, maar verdwijnt niet stil.

Een koppelteken dat als redactioneel streepje tussen twee bedragen staat, is in
de bron niet te onderscheiden van een teken. De tweede helft van zo'n reeks
wordt daarom conservatief geweigerd; dat is een expliciete beperking, geen
nieuwe prijsinterpretatie. Deze regels zijn geïmplementeerd in de pure laag en met fictieve fixtures
getest. Er is geen validator, DDL of exportpad aan een route gekoppeld.

### Gesloten veldregels

- `categories[].kind`: `section`, `choice_group`, `arrangement`, `beverage`.
  Alleen `choice_group` heeft `choice: { min, max }` (gehele getallen, `min <= max`).
- `items[].kind`: `dish`, `choice`, `supplement`, `arrangement`, `beverage`,
  `unknown`. Een `supplement` heeft `supplementOf`; een `choice` heeft
  `choiceGroupRef`.
- `price.status`: `known`, `from`, `multiple_undecomposed`, `on_request`,
  `unknown`. `amountMinorUnits` is alleen gevuld bij één ondubbelzinnige prijs.
- `priceVariants[].kind`: `glass`, `bottle`, `portion`, `person`, `other`.
  `isSupplement` en `perPerson` zijn expliciete booleans.
- `primaryPriceRef` verwijst naar een bestaande variant of is `null`. Een
  supplementvariant mag nooit de primaire prijs zijn.
- `allergens.status`: `explicit` of `unknown`. `explicit` vereist een niet-lege
  `sourceText`; `unknown` heeft `codes: []` en betekent niet "vrij van".
- `evidence` is verplicht per item en per prijsbedrag. Iedere `priceVariants[]`
  heeft een eigen `evidence` met source-ID, locator en een quote die het
  variantbedrag of het expliciete bronlabel plus bedrag bevat. De primaire
  `price` heeft, wanneer `status` `known` of `from` is, eveneens een eigen
  bewijsquote met dat bedrag. Een quote die alleen het gerecht ondersteunt of
  alleen een ander bedrag noemt, is ongeldig (`price_evidence_missing`), ook als
  het item zelf wel bewijs heeft. `contentHash` is optioneel maar moet, wanneer
  aanwezig, de bronpassage dekken.
- IDs zijn resultaatlokaal en stabiel binnen één analyse; ze zijn geen
  database-IDs en geven geen gebruikersrechten.
- Geen veld voor modelconfidence, goedkeuring of publicatiestatus.


## Implementatie-aanvullingen (ronde 2026-10-19)

De pure laag in `src/lib/menuProductSchemaV2.js` en
`src/lib/menuProductMappingV2.js` maakt de regels hierboven uitvoerbaar. Vijf
punten die in het eerste voorbeeld nog impliciet waren, zijn nu contractueel
expliciet:

1. **Herkomst per veld.** Ieder item heeft `origins: { name, description,
   price, allergens, supplementOf, availability, kind }` met de gesloten waarden
   `extracted`, `manual` of `unknown`. Een prijsvariant heeft `origin`. Zo zijn
   handmatige en geëxtraheerde waarden gescheiden zonder nieuwe UI of
   schrijfroute.
2. **Allergenenbron.** `allergens` heeft naast `status`, `codes` en `sourceText`
   ook `sourceTextStatus`: `recorded` (de passage is geïsoleerd en moet in de
   bron voorkomen), `not_isolated` (de bron vermeldt waarden, maar v1 bewaarde
   geen aparte passage) of `unknown`. `explicit` vereist minstens één code;
   `unknown` heeft geen codes en geen brontekst.
3. **Supplementrelatie.** `supplementOf` is `null`, of
   `{ status: "resolved", itemId }`, of
   `{ status: "unresolved", label, context: { menuId, categoryId }, limitation }`.
   Een opgelost doel moet in dezelfde menu bestaan, mag niet het supplement
   zelf zijn en mag geen supplement zijn (zodat een keten/cyclus onmogelijk is).
   Een onopgelost doel vereist de bewezen menu-/rubriekcontext en een expliciete
   beperking; er wordt geen basisgerecht verzonnen.
4. **Bronpad.** `sourcePath` is `null` wanneer de v1-invoer geen apart
   bronpad had. De mapper verzint geen tweede pad; `path` blijft de
   gereconstrueerde sectieroute.
5. **Itemsoort.** v1 kent geen `kind`; gewone regels worden `kind: "unknown"`,
   een v1-supplement wordt `kind: "supplement"`. Dat is een expliciete
   onbekende, geen stille toewijzing als `dish`.

Daarnaast:

- **Prijsbewijs.** De validator controleert per bedrag dat de eigen quote het
  bedrag in de brontaal bevat (met begrenzingen, zodat `13,00` niet in `113,00`
  past). De mapper leidt een variantbewijs alleen af uit de itemquote als die
  quote het variantbedrag bevat; anders weigert de hele mapping met
  `price_evidence_missing`. Er wordt niets aangevuld of gekozen.
- **Projectie.** `projectProductV2ToV1` slaagt alleen als naam, omschrijving,
  prijs, pad, volgorde, relatie, allergenenwaarde en bewijsregel behouden
  blijven. `primaryPriceRef`, keuzegroepen, arrangementen, opgeloste
  supplementen, afwijkende variantmetadata, een geïsoleerde allergenenpassage
  en een afwijkende veldherkomst weigeren met `unsupported_v1_projection`.
- **Export.** `checkProductV2ExportSuitability` produceert geen bestand en
  weigert in deze ronde ieder v2-item: `data/menus.json` kan expliciet, onbekend
  en "geen allergenen" niet onderscheiden en heeft één prijs. Dat is de
  goedgekeurde geblokkeerde toestand, geen stille terugval.
- **Rollback.** `readProductRecord` leest een v2-rij alleen als v2, een
  onbekende versie als `unsupported_schema_version` met bewaarde ruwe rij en
  geblokkeerde acties, en een v1-rij als legacy. De bestaande v1-lezer
  (`mapStructuredOutputToMenuContexts`) gooit een concrete fout op een
  v2-envelop in plaats van hem als v1 te interpreteren.

De laag is **niet aangesloten** op een receipt-, review-, concept-, export- of
publieke route; er is geen DDL, migratie, backfill of writeflag. De exacte
aansluitpunten en de latere SQL-wijzigingen staan in
[menu-extraction-v2-integration.md](../../docs/guides/menu-extraction-v2-integration.md).

## Mapping van v1 naar v2

| v1 (`menu-extraction-output/v1`) | v2 | Regel |
| --- | --- | --- |
| `menu.title`, `variant`, `order` | `menu.title`, `variant.label/sourceLabel/order` | titel en variant blijven gescheiden |
| `category.name`, `path`, `uncertain` | `category.name`, `path`, `uncertain`, `kind:"section"` | geen standaardrubriek verzinnen |
| `item.priceStatus:"known"` + `amountMinorUnits` | `price.status:"known"` + bedrag | enige eenduidige prijs |
| `priceStatus:"multiple_undecomposed"` | `price.status` + `price.text` + varianten of lege varianten | nooit laagste kiezen |
| `isFrom:true` | `price.status:"from"` + `isFrom:true` | vanaf-prijs blijft vanaf |
| `priceVariants[]` | `priceVariants[]` met `kind:"other"` tenzij bronlabel glas/fles/portie kent | label blijft bronlabel |
| `supplementOf` | `item.kind:"supplement"` + `supplementOf` | nooit als gewoon gerecht |
| `allergens` | `allergens.status` + codes + `sourceText` | onbekend blijft onbekend |
| `availability` | `availability` | vrije brontekst, geen interpretatie |
| `evidence` | `evidence` | source-ID, locator, quote |
| `coverage`/`limitations` | idem | dekkingsclaim blijft expliciet onvolledig |

Een v2-item zonder verliesvrije v1-projectie wordt niet naar v1 teruggeplatt.
De projector moet dan `unsupported_v1_projection` retourneren; de aanroeper
beslist of dat een blokkade of een gemelde beperking is.

## Opslag, migratie en compatibiliteit

### Gekozen richting voor beoordeling: additieve JSONB-envelope

Geen nieuwe genormaliseerde tabellen in de eerste stap. De bestaande
JSONB-contracten kunnen een versiegebonden envelope dragen; dat houdt de
migratie-impact nul en laat oude rijen ongemoeid.

| Artefact | Huidige opslag | Voorgestelde v2-opslag | DDL/migratie |
| --- | --- | --- | --- |
| Receipt | `url_intake_analysis_receipts.candidate_summary` (JSONB), hash in `analysis_result_hash` | `candidate_summary.menuExtractionV2` naast het bestaande `menus`; hash opnieuw berekend over de canonieke vorm | **geen**; oude rijen blijven v1 |
| Review | receipt `menus` + `src/lib/menuConcept.js` regels | leest v2 indien aanwezig, anders v1; dezelfde regel-ID's en attention-groepen | **geen**; pure adapter |
| Concept | `menu_snapshot_proposals.captured_content` (JSONB) + `content_hash` | `captured_content.schemaVersion:"menu-extraction-product/v2"`; `content_hash` dekt de versie en inhoud | **geen** kolomwijziging; bestaande `version`/`content_hash` blijven leidend |
| Export-preview/PR | `src/lib/menuConceptExport.js` + `menuExport.js` | v2-concept wordt alleen geëxporteerd als ieder item een verliesvrije `data/menus.json`-projectie heeft; anders `unsupported_export_construct` | **geen**; blokkade tot exportcontract is goedgekeurd |
| Publieke kaart/search | `data/menus.json` → `app/menu`, `app/restaurant`, `app/nvwa`, `src/services/dishSearch` | ongewijzigd zolang geen additieve velden zijn goedgekeurd | **geen** |

### Waarom geen genormaliseerde tabellen nu

Een tabel per variant/prijsvariant/supplement zou een grotere migratie,
backfill, RLS- en querysurface vragen zonder dat de review-UI die al nodig
heeft. De JSONB-envelope is kleiner, omkeerbaar en houdt één canoniek
resultaat. Een latere normalisatie blijft mogelijk als apart, beoordeeld
ontwerp (bijvoorbeeld migratie `0020_*`) met backfill en rollback.

### Migratie-impact en rollback

- **Geen DDL in deze fase.** Oude rijen hebben geen `menuExtractionV2`; lezers
  vallen terug op v1. Nieuwe rijen zijn voor oude code onbekende JSON-velden.
- **Geen backfill.** Een v1-concept blijft geldig en wordt niet stilzwijgend
  naar v2 herschreven. Alleen een expliciete heropname kan een v2-resultaat
  maken.
- **Hash/versie.** `analysis_result_hash` en `content_hash` moeten de canonieke
  vorm inclusief `schemaVersion` dekken. Een ontbrekende of onbekende versie is
  een harde validatiefout, geen stille default.
- **Rollback en oudere lezers.** De v2-leesflag uitzetten is toegestaan, maar
  een oudere lezer mag een v2-rij niet stil negeren of als v1 herinterpreteren.
  De lezer detecteert `schemaVersion` en toont `unsupported_schema_version` in
  de review/dekking, met behoud van de onbewerkte rij en het bron-ID. Het concept
  blijft zichtbaar als niet-ondersteund; opslaan, bevestigen, exporteren en
  publiceren zijn geblokkeerd tot een compatibele lezer of een expliciete
  heropname. Er is geen destructieve datamigratie.
- **Export.** Geen exportpad wordt geactiveerd. Tot een goedgekeurd
  `data/menus.json`-contract blokkeert de export ieder item met
  prijsvarianten, supplementen, keuzegroepen, arrangementen of een expliciete
  allergenenstatus die het bestand niet kan dragen.

### Compatibiliteitsmatrix

| Construct | Receipt | Review | Concept | Export-preview/PR | Publieke kaart/search |
| --- | --- | --- | --- | --- | --- |
| Menuvariant | v2 `variant` | variant + pad | `schemaVersion` + variant | bestaande `subtitle`/`path` | bestaand |
| Geneste rubriek | `path`/`sourcePath` | zelfde pad | `path` | bestaand `path` | bestaand |
| Eén prijs | `price` | ongewijzigd | één prijs | bestaand | bestaand |
| Meerdere/vanaf | `price.status` + varianten | aparte attention | varianten bewaard | **blokkeren** zonder exportveld | niet publiceren |
| Glas/fles | varianten | aparte attention | varianten bewaard | **blokkeren** zonder exportveld | niet publiceren |
| Supplement | `supplementOf` | aparte groep | relatie bewaard | **blokkeren** zonder exportveld | niet publiceren |
| Keuzegroep | `choice` | keuzegroep | relatie bewaard | **blokkeren** | niet publiceren |
| Arrangement | `kind:"arrangement"` | aparte sectie | bewaard | **blokkeren** | niet publiceren |
| Allergenen | `status` + bron | attention/unknown | bewaard | **`allergenStatus` nodig of blokkeren** | niet als leeg publiceren |
| Bewijs | `evidence` | broncontext | bewaard | niet geëxporteerd | n.v.t. |
| Onbekende/oudere lezer | `unsupported_schema_version` | zichtbaar niet-ondersteund | onbewerkt bewaard | geblokkeerd | niet publiceren |
| Dekking | `coverage` | aandacht/beperking | bewaard | niet geëxporteerd | n.v.t. |

De exportkolom is opzettelijk streng: `data/menus.json` kent één `price` en
`allergens: []` zonder onderscheid tussen "geen" en "onbekend". Stil
terugvallen op de laagste prijs of een lege allergenenlijst is niet toegestaan.


## Invarianten en verplichte regressies (na goedkeuring)

1. **Round-trip zonder verlies.** Iedere v1-uitvoer die het schema ondersteunt,
   is naar v2 en terug naar de reviewprojectie te brengen zonder een naam,
   prijs, pad, volgorde of bewijsregel te verliezen.
2. **Fail-closed export.** Een v2-item dat niet in `data/menus.json` past,
   levert `unsupported_export_construct` op. Het item verdwijnt niet en de
   laagste prijs wordt niet gekozen.
3. **Primaire prijs.** `primaryPriceRef` is nooit een supplement; een
   glas/fles-paar houdt beide varianten en kiest geen hoofdprijs zonder
   expliciete bron.
4. **Onbekend blijft onbekend.** Ontbrekende allergenen zijn `unknown`, geen
   lege "allergeenvrij"-lijst; ontbrekende prijs is `unknown`, geen `0`.
5. **Bewijs per bedrag.** Ieder geëxtraheerd item heeft source-ID, locator en
   quote; iedere prijs en prijsvariant heeft een eigen quote die het
   gezaghebbende bedrag bevat. Een item zonder bewijs of een prijs zonder
   bedragbewijs komt niet in het concept (`price_evidence_missing`).
6. **Versie.** Een onbekende `schemaVersion` stopt met een concrete fout; er is
   geen stille v1-default.
7. **Geen trustvelden.** De bestaande verboden-sleutel-test blijft gelden.
8. **Rollback is zichtbaar.** Een oudere lezer mag een v2-rij niet stil
   negeren of als v1 herinterpreteren. `unsupported_schema_version` is zichtbaar
   in review en dekking, de onbewerkte rij en het bron-ID blijven bewaard, en
   opslaan/bevestigen/exporteren/publiceren zijn geblokkeerd.

Voorgestelde regressies bij implementatie: een pure `menuExtractionProductV2`
mapper, een fail-closed exportprojector, receipt/concept read/write rondgang,
STRUCT-017-achtige concept/export-gelijkheid, een fixture met glas/fles,
supplement, keuzegroep, arrangement en expliciete/onbekende allergenen, een
negatieve prijsbewijstest (quote zonder het juiste bedrag), en een
rollbacktest waarin een oudere lezer een v2-rij zichtbaar als niet-ondersteund
bewaart in plaats van hem te negeren.

## Uitrolvolgorde (alleen na goedkeuring)

1. **Ontwerp goedkeuren** (dit document) en de open beslissingen hieronder
   nemen. Geen code.
2. **Pure schema- en mappinglaag** toevoegen met v1→v2 en fail-closed
   projecties; nog geen databasewrite of UI-wijziging.
3. **Receipt/concept-JSONB** dual-readen; oude rijen blijven v1. Geen backfill.
4. **Bestaande review** uitbreiden binnen de bestaande surface; onzekerheid per
   groep, geen accepteer-alles. Materieel nieuwe interactie vraagt eerst een
   ontwerp.
5. **Export** pas na een apart goedgekeurd `data/menus.json`-contract; tot die
   tijd blokkeren en melden.
6. **Geen provideractivering, migratie, merge of publicatie** als onderdeel van
   deze ontwerpstap.

## Open beslissingen (Product Owner / Delivery Lead)

1. **Schema goedkeuren:** akkoord op `menu-extraction-product/v2` en de gesloten
   enums/velden?
2. **Opslag:** additieve JSONB-envelope (aanbevolen) of genormaliseerde tabellen?
3. **Exportcontract:** blijft `data/menus.json` één prijs houden (dan blokkeren),
   of wordt een additief `priceVariants`/`allergenStatus`-contract goedgekeurd?
4. **Migratie/backfill:** uitdrukkelijk geen backfill in fase 1; akkoord?
5. **Oude v1-rijen:** mogen die read-only v1 blijven, of is een expliciete
   heropname vereist voordat ze in de nieuwe review verschijnen?
6. **Allergenen:** is `unknown` in de publieke kaart een expliciete status of
   een blokkade voor publicatie? Dit is een product-/juridische keuze, niet
   iets wat de extractie zelf mag beslissen. Deze keuze staat los van de
   extractie- en opslagvorm in dit document.
7. **Publieke allergenenstatus en export:** een additief
   `allergenStatus`/`priceVariants`-exportcontract is niet goedgekeurd. Tot die
   aparte beslissing blijft export blokkeren en melden; dit ontwerp activeert
   geen publieke kaartwijziging.
8. **App-provider, model, budget en retentie:** de bronproeftoestemming en de
   developer-prepaidtoestemming activeren geen app-side AI-provider. Modelkeuze,
   maximaal kostenbudget, DPA/EU-retentie en eventuele betaalde fallback blijven
   een aparte Product Owner-beslissing.

## Wat dit document niet doet

- Het implementeert of migreert geen route: de actieve productcode blijft op
  `menu-extraction-output/v1` en `menu-extraction-result/v1`.
- De pure prijsbewijsvalidator, schema-lezer, v1→v2-mapper en fail-closed
  projecties bestaan wel (zie de implementatie-aanvullingen), maar zijn op geen
  enkele receipt-, review-, concept-, export- of publieke route aangesloten.
- Het wijzigt `data/menus.json`, de receipt- of concepttabellen niet.
- Het voegt geen nieuw OCR-, browser- of providerplatform toe.
- Het wijzigt #56 niet en lost de drie bekende integratieconflicten niet op.
- Het is geen bewijs dat een restaurantkaart compleet of actueel is.
