# Menu-extractie — afrondingsmatrix #59

Status: **ontwikkelaarsbewijs, geen onafhankelijke review en geen release.**
Datum: 2026-10-19. Issue #59, branch `feat/menu-extraction-59`, PR #60.
Kandidaat-codehead: `2b994cd0e5743ecbd2096381680fadf12ac31e13` (pure v2
prijsbewijsreparatie na review 6274281958; deze documentatie volgt als aparte
commit). Vorige codehead: `5e3e3a54ddce4b004f9a26b12037bf99561a463b`
(review 6273510672). Protocol:
`MENU-EXTRACTION.md` v0.2, SHA-256
`15510b4c0b74fee722ac2c51a3f40aa21b03e0161ccffdcb2008f3d27350b762`.
De runtime blijft zonder provider; alle bronproeven zijn read-only. De pure
v2-laag is gebouwd en getest, maar is op geen route aangesloten.

Deze matrix vervangt de status in oudere PR-teksten en eerdere matrixversies.
De volledige rondehistorie blijft in Git en in
[menu-extraction-acceptance.md](menu-extraction-acceptance.md); oude aantallen
gelden niet meer als actuele status.

## Conclusie in één alinea

Met bewijs werkt: de versiegebonden protocol-/schemalading, de bestaande
analyseketen met begrensde veilige fetch, de review-/conceptfixture, de
rol- en netwerkgrenzen, en de read-only extractie van de toegestane
Smelt- en Blossem-bronversies (37/37 en 43/43 exact tegen de gecontroleerde
capture). De Botanist is meetbaar gedeeltelijk (124/141 referentierijen,
11 gemist, 4 extra, 0 prijsverschil) en de Mr Moos/Colonia-aantallen zijn
live observaties zonder referentie-uitkomst. Bewust geblokkeerd of niet
ondersteund blijven: scans/OCR, de aansluiting van product-schema v2 op
receipt/review/concept/export/publicatie, echte provideractivering, echte
bronbevestiging/conceptopslag/export/publicatie, Gauchos Breda (onbereikbaar),
een nieuwe ongeziene holdout en BE-21's 50–100-bronnenbenchmark. De pure v2
schema-/mappinglaag is wel gebouwd en met fictieve round-trip- en
weigeringsfixtures getest; zij heeft geen route, DDL, writeflag of publieke
werking. Volledige productacceptatie vereist nog een Product Owner-besluit over
provider/model/budget/DPA, een nieuwe holdout, live preview-/schrijftoegang en
onafhankelijke review door de Delivery Lead.

## Bewijstype en status

| Code | Betekenis |
| --- | --- |
| **T** | geautomatiseerde test of offline fixture (ontwikkelaarsbewijs) |
| **R** | echte openbare bron, read-only, binnen de bestaande fetchregels |
| **B** | lokale browserfixture met fictieve data en fail-closed netwerkguard; geen live sessie |
| **I** | onafhankelijke review; die is in deze ronde niet uitgevoerd |

Status: **bewezen** = op deze kandidaat uitgevoerd en geslaagd;
**bewezen met beperking** = geslaagd binnen een expliciet genoemd bereik;
**open** = nog niet uitgevoerd of niet aantoonbaar; **niet ondersteund** =
bewust geweigerd of technisch niet gedekt; **geblokkeerd** = wacht op een
ander besluit of eigenaar.

## Actuele acceptatiematrix

| # | Criterium | Bewijs op deze kandidaat | Type | Status | Resterend / impact | Volgende eigenaar |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Exact protocol en schema versiegebonden; ontbrekende configuratie stopt concreet | `menuExtractionProtocol.test.js`, `menuExtractionAdapter.test.js`, `acceptanceSet.test.js`; loader geeft v0.2 + vaste LF-hash; ontbrekende/onversioned root en ontbrekende provider geven een concrete weigering | T | **bewezen** | Geen provider geconfigureerd, dus alleen offline bewezen | Developer |
| 2 | URL → lezen → extractie → menselijke correctie → conceptopslag met traceerbare broncontext | `restaurantSourceAnalysis.test.js` (SMELT-LIKE CHAIN), `menuConcept.test.js`, `batchAnalysisHandlers.test.js`; browserfixture toont resultaat, review, correctie en geblokkeerde conceptopslag | T+B | **bewezen met beperking** | Echte conceptopslag, bronbevestiging en een live sessie zijn niet uitgevoerd; de fixture bewijst geen Supabase-schrijfsessie | Product Owner/ops voor live toegang; developer voor de resterende keten |
| 3 | Smelt Breda: echte PDF-inhoud getest; gevonden PDF + 0 items is geen succes; gerechten, prijzen en dekking vergeleken | `probe-menu-extraction-sources.js --source=all`: PDF 2 pagina's, bytes `4445a101…27f8`, content `24f23cbd…8a845`; 37/37 referentierijen, 8 secties, 0 gemist/extra/prijs/koppeling/duplicaat, boekhouding 37/37 | R+T | **bewezen met beperking** | 7 supplementregels en 1 arrangementregel worden gemeld, niet opgeslagen; geen item-voor-item menselijke hercontrole in deze ronde; vestiging alleen via URL/bestandsnaam, niet uit de PDF-tekst | Developer voor itemcontrole; Product Owner voor schema-uitbreiding |
| 4 | Blossem: lunch/diner, rubrieken en items volgen de echte bronrelaties; onzekerheid uitvoerbaar; geen vast aantal | `probe-menu-extraction-sources.js --source=all`: HTML bytes `da5c632f…0c38`; 43/43 in 13 secties, 0 verschillen, boekhouding 43/43; DINNER/LUNCH blijven gescheiden; 12 secties gemarkeerd als onzeker | R+T+B | **bewezen met beperking** | 2 arrangement-/wijnarrangement-secties worden gemeld en niet opgeslagen; de fixture toont groepshandeling zonder accepteer-alles; geen live sessie | Developer voor itemcontrole; Product Owner voor schema-uitbreiding |
| 5 | Bestaande kaarten Wolfslaar, Bardot, Zuyd, T-Huis getoetst; historische aantallen zijn geen waarheid | `historicalMenus.test.js`: 367 historische regels (25/111/42/189) volledig door de vormketen; onbekende prijs blijft null | T | **bewezen met beperking** | Alleen vormbehoud op de historische snapshot; de live sites zijn niet opnieuw opgehaald en de aantallen zijn geen actuele waarheid | Developer voor een latere live-vergelijking |
| 6 | Vooraf vastgelegde representatieve set en aparte holdout dekken HTML, tabs, tabellen, tekst-PDF, scans, taal/vestiging, arrangement en prijsvariant | `acceptanceSet.test.js`, `acceptanceSetGuard.test.js`, `holdoutReferences.test.js`, `botanistReference.test.js`; 22 representatieve entries en 13 dekkingsklassen; De Botanist/Mr Moos/Colonia zijn `representative` + `usedForTuning`; Gauchos Breda is de enige holdout (`evaluated_once`, 404) | T+R | **open** | Er is geen nieuwe, nog ongeziene holdout; scans/OCR blijft `niet ondersteund`; Gauchos levert geen inhoud. Een releaseclaim kan hier niet op rusten | Product Owner voor nieuwe bron-/toegangsbeslissing; Delivery Lead voor de acceptatieclaim |
| 7 | Dataset, referentie-uitkomsten en meetbare drempels vóór acceptatie vastgelegd; BE-21's 50–100 niet met enkele URL's afgesloten | `manifest.json` `releaseThresholds`: 0 verzonnen gerechten/prijzen, 100% bewijs, 0 onverklaarde dekking, 0 structuur-/prijsfouten; `sourceReferences.test.js`; 23 structuurgevallen | T | **bewezen met beperking** | Drempels zijn vast en niet verlaagd; BE-21 is expliciet buiten #59 en niet afgesloten met twee bronnen | BE-21-eigenaar; Delivery Lead voor scopebewaking |

| 8 | Gemiste/verzonnen items, prijsfouten, structuurverlies, bewijsdekking, correctiewerk, tijd en kosten per brontype gerapporteerd | Per-brontabel hieronder; Smelt/Blossem 0 verschillen; Botanist v1 124/11/4/0, 87 niet-gekoppeld; Mr Moos/Colonia zonder referentie; deterministische analysetijd per bron gemeten | R+T | **bewezen met beperking** | Correctietijd is onbekend; productiekosten zijn onbekend; de gemeten analysetijd is geen menselijke correctietijd. Modelkosten in deze run zijn €0 omdat geen provider is aangeroepen | Developer voor een correctietijdmeting; Product Owner voor kostenbesluit |
| 9 | Browseracceptatie met klikpaden, rolgrenzen, leeg/fout/partieel, toetsenbord, licht/donker, 320/390 px | `npm run test:browser:menu-review`: 99/99 checks op head `5a7f99a` (historisch; niet herhaald op `5e3e3a5`), 11 screenshots, Edge 155.0.4283.45, 1024/390/320 px, licht/donker, keyboard Enter, read-only collega, empty/partial/error, fail-closed netwerkguard | B | **bewezen met beperking** | Alleen fixture; geen live/staging browserbewijs en geen echte authenticated sessie. De fixture is geen productieacceptatie | Product Owner/ops voor previewtoegang; Delivery Lead voor live acceptatie |
| 10 | Time-out, provideruitval, ongeldige uitvoer, kosten-/paginagrens, herimport, gelijktijdige taken, promptinjectie, verkeerde vestiging, onveilige redirects getest | `menuExtractionAdapter.test.js`, `safeOutboundFetch.test.js`, `restaurantSourceAnalysis.test.js`, `batchAnalysisHandlers.test.js`, `menuConcept.test.js`; offline fake provider en `.invalid`-fixtures; geen dubbele call/claim | T | **bewezen met beperking** | Alleen offline; een echte provideruitval, echte kostenmeting en echte gelijktijdige productietaken zijn niet gemeten | Product Owner voor provider/budget; developer voor een latere live meting |
| 11 | Geen stil dataverlies tussen extractie, receipt, review, concept en export; niet-ondersteunde publicatievelden geblokkeerd/gemeld | `menuProductSchemaV2.test.js`, `menuProductMappingV2.test.js`, `schemaDesign.test.js`, `menuExtractionRuntime.test.js`, `menuExtractionAdapter.test.js`, `menuExtractionQuality.test.js`, `menuConceptExport.test.js`, `STRUCT-017`; de pure v2-laag mapt glas/fles, vanafprijzen, meerdere menu's en supplementen en weigert verliesgevende projecties | T | **bewezen met beperking** | De laag is niet aangesloten op receipt/review/concept/export; geen echte bron→conceptopslag. De bestaande v1-routes blijven geblokkeerd voor deze constructies | Developer voor aansluiting na besluit; Delivery Lead voor review |
| 12 | Geen regressie in rollen, bronbevestiging, audit, publicatiegates, beveiliging of geheimenbeheer | Volledige suite 2112/2112 op head `2b994cd` (2105/2105 op `5e3e3a5`); browserfixture read-only zonder save/bevestig; netwerkguard blokkeert externe fetch, protocol-relative URL, onbekende API-write, XHR, WebSocket en CDP-subresources | T+B | **bewezen met beperking** | Geen productiecredentials, productieauth of echte database gebruikt; dat is bewust niet getest | Product Owner/ops voor productieacceptatie |
| 13 | Onafhankelijke review met exacte commit, checks, bron-/protocolversies, resultaten, beperkingen en volgende stap; groene unit-tests zijn geen productacceptatie | Deze matrix + checkpoint op PR #60 | I | **geblokkeerd** | De Delivery Lead heeft deze afrondingsronde nog niet onafhankelijk beoordeeld; deze matrix is ontwikkelaarsbewijs | Delivery Lead |

## Pure v2 schema-/mappinglaag (ronde 2026-10-19)

Status: **gebouwd en getest, niet aangesloten; geen DDL, migratie, writeflag of
publicatie.** Codehead prijsbewijsreparatie:
`2b994cd0e5743ecbd2096381680fadf12ac31e13` (review 6274281958); vorige
codehead `5e3e3a54ddce4b004f9a26b12037bf99561a463b` (review 6273510672).

| Onderdeel | Bewijs | Uitkomst |
| --- | --- | --- |
| Versiegebonden schema en validator | `menuProductSchemaV2.test.js`: 27 tests | `menu-extraction-product/v2`; onbekende/ontbrekende versie faalt concreet; verboden trustvelden op elke diepte; unieke menu-/rubriek-/item-/variant-ID's |
| Prijsbewijs per bedrag | `menuProductSchemaV2.test.js` (helper + validator), `menuProductMappingV2.test.js` (v1→v2 primair én glas/fles) | Een `known`/`from`-prijs en iedere variant hebben een eigen quote met het volledige bedrag. Het integerdeel telt niet: `13,00` wordt niet bewezen door `13,50`, `13.50`, `13,5` of `113,00`. Een voorloopdecimaal (`.50`, `,50`, `EUR .50`) bewijst nooit 50 euro, en een expliciet teken (`- 13,50`, `- EUR 13,50`, `-€ 13,50`, `+ € 2,50`) nooit een positieve `known`-prijs. `price_evidence_missing` bij een ander, ambigu of ondertekend bedrag. Integerbedragen, decimale komma/punt, euro-/spatienotatie en Nederlandse duizendnotatie zonder teken blijven geldig; jaartallen, hoeveelheden en labels zijn geen prijsbewijs |
| Supplementen en keuzes | `menuProductSchemaV2.test.js`: unresolved/resolved/self/chain/choice | Onopgelost doel vereist bewezen menu-/rubriekcontext en limitation; resolved doel moet bestaan, niet zichzelf en geen supplement zijn; keuzegroep moet een `choice_group` met geldige min/max zijn |
| Allergenen | `menuProductSchemaV2.test.js` | `explicit` vereist codes en `recorded`/`not_isolated`; `unknown` heeft geen codes en betekent niet "vrij van"; een geïsoleerde passage moet in de bron staan |
| v1 → v2-mapping | `menuProductMappingV2.test.js` | Fictief: 2 menu's, 7 items, glas/fles, vanafprijs, meerdere prijzen, supplement, expliciete/onbekende allergenen; inhoud en dekking blijven gelijk |
| Verliesvrije terugprojectie | `menuProductMappingV2.test.js` | Round-trip zonder verlies van naam, omschrijving, prijs, pad, volgorde, variant, allergenenwaarde of bewijs; weigert bij primary price, keuzegroep, arrangement, opgelost supplement, afwijkende variantmetadata, geïsoleerde allergenenpassage, afwijkende veldherkomst en een apart sourcePath |
| Exportguard | `menuProductMappingV2.test.js` | Produceert geen bestand; blokkeert ieder v2-item omdat `data/menus.json` één prijs en geen ondubbelzinnige allergenenstatus kan dragen; een leeg menu is `empty_menu`, geen succes |
| Fail-closed lezer | `menuProductSchemaV2.test.js` | v1 blijft v1; v2 wordt alleen als v2 gelezen; onbekende versie → `unsupported_schema_version` met bewaarde ruwe rij en geblokkeerde `save`/`confirm`/`export`/`publish`; een v1-rij met trustveld wordt geweigerd |
| Oude lezer | `menuProductMappingV2.test.js` | `mapStructuredOutputToMenuContexts` gooit een concrete fout op een v2-envelop in plaats van hem als v1 te lezen |
| Grensbewaking | `ops/benchmark/schemaDesign.test.js` | Geen `app/`-route importeert de nieuwe modules; de pure laag heeft geen fetch/database/env/filesystem; v1-contractversies blijven gelijk; geen migratie na `0019` |

### Reparatie review 6273510672

De review op `dd00066` liet zien dat `13,00` werd bewezen door `13,50`, doordat
de oude helper het integerdeel als los token opnam. `quoteContainsAmount` leest
nu ieder numeriek token als geheel met eenduidige decimal-/duizendtalsemantiek;
een ander, ambigu of contextloos getal levert `price_evidence_missing` op.
Regressies staan op de helper, de directe v2-validator en de v1→v2-mapping voor
de primaire prijs én glas/fles-varianten. Er is geen route, DB, RPC, DDL,
provider of UI aangesloten om dit te repareren.

### Reparatie review 6274281958

De herreview op `5e3e3a5` liet twee resterende tokenranden zien, beide met één
fictief gerecht, volledige dekking en de exacte quote in `source.text`:

- `Fictief gerecht EUR .50` met claim `5000` werd geaccepteerd, doordat de
  scanner bij `50` begon en de leidende punt negeerde;
- `Fictief gerecht - EUR 13,50` en `Fictief gerecht -€ 13,50` met claim `1350`
  werden als positieve `known`-prijs geaccepteerd, doordat alleen het teken
  direct vóór het cijfer werd bekeken.

`quoteContainsAmount` leest nu de volledige monetaire prefix: witruimte,
valutamarker(s), een optioneel teken en een eventuele voorloopseparator. Een
voorloopdecimaal is ambigu en levert `price_evidence_missing` op; er wordt geen
50 cent of ander bedrag geraden. Een expliciet teken (min, unicode-min,
en/em-dash of plus), ook met valuta tussen teken en cijfers, bewijst nooit een
positieve `known`-prijs. Onondertekende bedragen en de bestaande decimale-,
duizend- en integergevallen blijven ongewijzigd.

Regressies staan op de pure helper, de directe v2-validator en de v1→v2-mapping
voor de primaire prijs én glas/fles-varianten. Bewust geaccepteerde beperking:
een koppelteken tussen twee bedragen (`13,50 - 25,00`) is niet te
onderscheiden van een teken, dus de tweede helft wordt conservatief geweigerd.
Er is geen route, DB, RPC, DDL, provider, writeflag of UI aangesloten.


Receipt-write/read, de RPC-projectie `candidate_summary -> 'menus'`,
conceptopslag/-read, review, export-PR en de publieke kaart gebruiken nog
uitsluitend v1. De exacte latere aansluitpunten, de benodigde SQL-wijziging en
de rollbackvolgorde staan in
[menu-extraction-v2-integration.md](menu-extraction-v2-integration.md). Deze
ronde activeert geen dual-read, writeflag of publieke werking.

De bronproef, Botanist-vergelijking en browserfixture zijn in deze
prijsbewijsreparatie **niet opnieuw** uitgevoerd: er is geen fetch-, parser-,
runtime- of UI-code gewijzigd. Hun eerdere bewijs blijft aan de eerdere head
gekoppeld en wordt niet op deze commit geclaimd.



Alle onderstaande bronnen zijn de al toegestane openbare entry-URL's en hun
relevante menulinks. Er is geen login, CAPTCHA-bypass, andere vestiging,
willekeurige crawl of betaalde dienst gebruikt. Een bereikbare pagina is geen
volledig uitgelezen menu; de kolom “uitkomst” zegt per bron precies wat is
gemeten.

| Bron | Bereikbaarheid / vestiging | Bronversie | Uitkomst | Provenance / dekking | Bekende afwijking |
| --- | --- | --- | --- | --- | --- |
| **Smelt Breda** (PDF) | HTTP 200; 2 pagina's; Breda staat alleen in de toegestane URL/bestandsnaam, niet in de PDF-tekstlaag | bytes `4445a101…27f8`, content `24f23cbd…8a845`; op 2026-10-19 identiek aan de pin van 2026-10-18 | 37 gerechten in 8 secties; 37/37 referentierijen exact; 0 gemist/extra/prijs/koppeling/duplicaat; boekhouding 37/37 | Gecontroleerde capture uit de PDF-layout; iedere vergeleken rij heeft een referentie; geen item-voor-item menselijke hercontrole in deze ronde | 7 supplementregels en 1 arrangement-/keuzeregel gemeld en niet opgeslagen; 88 dubbele tekstregels uit een tweede laag genegeerd; 2 secties “Controle nodig”; analysetijd 995 ms; modelkosten €0 (geen provider) |
| **Blossem Breda** (HTML) | HTTP 200; één restaurantsite; alleen een openbaar zakelijk telefoonnummer als veldevidence, geen vestigingsadres uit de pagina | bytes `da5c632f…0c38`; op 2026-10-19 identiek aan de pin van 2026-10-18 | 43 gerechten in 13 secties; 43/43 exact; 0 verschillen; DINNER/LUNCH en subrubrieken blijven gescheiden; 12 secties als onzeker gemarkeerd | Gecontroleerde capture van de HTML; 43/43 referentierijen; de fixture toont dezelfde onzekerheid per groep, zonder accepteer-alles | 2 arrangement-/wijnarrangement-secties gemeld en niet opgeslagen; `duplicate_item_across_categories`; analysetijd 228 ms; modelkosten €0 |
| **De Botanist Breda** (HTML + PDF) | HTTP 200 voor entry en PDF; 16 PDF-pagina's; veldevidence naam “De Botanist Breda” is reviewReady | entry-bytes zijn gewijzigd (`b65ec9e9…5f30` vs pin `77c950de…b5b0`), maar de gekoppelde PDF is byte-identiek (`50fef0b6…7f85`, content `eb9da86e…ade7f`); de menukaartversie is dus pin-gelijk; PDF-bestandsnaam noemt “voorjaar 20-03-2026” | 215 items in 50 secties; v1-referentie 124/141 matched, 11 missing, 4 extra, 0 prijsverschil, 6 productgap, 87 niet-gekoppeld, 9 `categoryUnknown`; v3-voorstel 127/139, 6 missing, 1 extra, 5 beperkt leesbaar, 87 niet-gekoppeld, 8 `categoryUnknown` (v3 is **voorstel**, niet geaccepteerd) | Gecontroleerde partiële layoutreferentie van 141 rijen; alle referentierijen hebben bewijs; wijn/cocktail zijn expliciet niet ondersteund; 6 supplementrijen zijn `unsupported_product_field` | 18 dubbelzinnige prijsregels, 2 niet-gekoppelde prijsregels, 4 geërfde kolommen, 2 porties, ongerubriceerde Soof-regels; 26 secties “Controle nodig”; analysetijd 2178 ms; modelkosten €0 |

| **Mr Moos Breda** (HTML) | HTTP 200; 6 bronnen, 5 gelezen, 1 geblokkeerd; veldevidence openbaar zakelijk adres in Breda is reviewReady; menuhub `/menukaart` gevolgd naar `/dranken`, `/lunch`, `/diner` | entry/hub/menu-bytes verschillen van de pin van 2026-10-18 (steeds +1020 bytes; oorzaak niet bewezen, dus geen contentgelijkheidsclaim); dit is een live observatie op 2026-10-19 | 247 items in 3 menu's: dranken 160/20, lunch 34/4, diner 53/8; coverage `items_extracted` maar `complete:false`, `reviewRequired:true`; 1 attention group | Geen gecontroleerde referentie-uitkomst; itemcorrectheid is niet gemeten; de bron is representative/usedForTuning, geen holdout | `/groepsmenu` geblokkeerd (robots/onveilig); `duplicate_item_across_categories`; analysetijd 446 ms; modelkosten €0 |
| **Colonia Breda** (HTML) | HTTP 200; 5 bronnen gelezen; Breda via subdomein `breda.colonie.nl`; alleen een openbaar zakelijk telefoonnummer als veldevidence, geen adres/naam | entry- en menupagina-bytes verschillen licht van de pin van 2026-10-18 (o.a. 1 byte; dynamische pagina-churn vermoedelijk, niet bewezen); live observatie op 2026-10-19 | 84 items in 16 secties; coverage `items_extracted` maar `complete:false`, `reviewRequired:true`; 16 attention groups | Geen gecontroleerde referentie-uitkomst; itemcorrectheid is niet gemeten; representative/usedForTuning | 5 secties niet als gerechten opgenomen (Over ons, Witte wijnen, Rode wijnen, Brunch, High Tea) wegens geen losse prijs/arrangement; `duplicate_item_across_categories` en `html_arrangements_skipped`; analysetijd 2582 ms; modelkosten €0 |
| **Gauchos Grill Breda** (HTML) | Entry `/breda`: baseline 2026-10-18 HTTP 404; op 2026-10-19 om 16:41Z opnieuw 404 en om 16:40Z eenmaal transient 502; geen inhoud; Breda alleen in de URL | geen bytes/content; baseline blijft `HOLD-REAL-02`, `evaluated_once`, 404 | 0 items, 0 secties; geen successtatus | Geen bronbewijs; geen alternatieve URL of andere vestiging opgezocht | **niet ondersteund / ontoegankelijk**; de bestaande holdoutbaseline is niet overschreven; analysetijd n/a |

> De bronproef voor Smelt/Blossem gebruikt de aangescherpte vergelijking: elke
> referentierij is exact eenmaal verklaard en de som van de verschillenlijsten
> is nul. Dat is itembewijs voor deze twee bronversies, geen productacceptatie
> en geen algemene volledigheidsclaim. Voor Mr Moos en Colonia ontbreekt een
> gecontroleerde referentie; hun aantallen zijn daarom alleen een live
> observatie, geen nauwkeurigheidsbewijs.

### Hashregister

| Bron | Veld | Vastgepind 2026-10-18 | Huidige read 2026-10-19 | Gelijk |
| --- | --- | --- | --- | --- |
| Smelt | bytes / content | `4445a101f200de7d72e3d7d8f2053f0b69798796f15ebd3f92173cbdad6c27f8` / `24f23cbd80a3e37d097b88e4e28165ad1235ba7babfbef7beb87fcdfaae8a845` | identiek | ja |
| Blossem | bytes / content | `da5c632f85fda1a7c4df827db011ccdd46c5a160dbb6f6adc04ace35d5ed0c38` | identiek | ja |
| Botanist | entry bytes | `77c950de558afa1d43cd48320fc0776069a643f25fe6b8d8ce83f08ee41eb5b0` | `b65ec9e9c37e1eaf25233f6dbf34b65ccbbcc804ee9dfa8201a8a78fdb765f30` | nee |
| Botanist | PDF bytes / content | `50fef0b6e8d14fbc151273c492f27c0fe70ab1ff909fdc445750cc7bb32a7f85` / `eb9da86e950463b90f09634f05236ec44925968120923506337678e56e3ade7f` | identiek | ja |
| Mr Moos | entry bytes | `20c0d9fa646719c78810e636f3abb3f59948e52972891b2d77a4d16d7fa39580` | `ae6fb40962cc6b55e2bc64b5d1cb1e07267e28adaf33484f466e4204d7fa1d5c` | nee |
| Mr Moos | menukaart / lunch / diner / dranken | `1f1c0980…3775` / `1653ef0c…877a` / `adbf8f42…23e8` / `0006b26a…10d5` | `0fcacecf…a875` / `789621c0…dc9f` / `dc8cec96…e85b` / `a2d74ffe…b214` | nee |
| Colonia | entry bytes | `29ed55827a4141647531e473f55410358962e63f5179c7e7a73e715d070ccbdf` | `05eafe840eee15428e688de9d1b66d76a251ea0cc0ec8476f2b3361578ab7b47` | nee |
| Colonia | menupagina bytes | `09c4935bf9360a38316fb4496caad78eb2f99ee9e750cd6e8848b8ca01942333` | `12779643d0723ad3719411eb4060a8deb2f0d4a1ab4e3ca34ace73c5d41eaf3e` | nee |
| Gauchos | entry | geen (404) | geen (404; eenmaal 502) | n/a |

Volledige Mr Moos-hashes (vastgepind → huidige read):

- entry: `20c0d9fa646719c78810e636f3abb3f59948e52972891b2d77a4d16d7fa39580` → `ae6fb40962cc6b55e2bc64b5d1cb1e07267e28adaf33484f466e4204d7fa1d5c`
- menukaart: `1f1c09800eef8cfa6094cfadd6014449cdeb776cb6e82f09c978edebc5433775` → `0fcacecfd4158df34cf8de4cd5c8ff5f958af5a0a511b850a895adddfaaad875`
- lunch: `1653ef0c32b346ee2eed1e76876ab4abaf6cbaabfa88e33e45f2f8bda381877a` → `789621c006f9f129fae1bee017f825f9ad11d59d0a54dadf1a011bb69c62dc9f`
- diner: `adbf8f42072d1b49ee8c688c2c163fbb3f0cdcaaa3c8d8faa1ee1ee9e29923e8` → `dc8cec9671a6d9c77728c1a35a793d06aa030b9cdff911cf7f7cdde34e1fe85b`
- dranken: `0006b26a54c00860597f3fbed76d31b8a4b20930d657fe5158d386fb737210d5` → `a2d74ffeedf5dc0cfe747eac066107aa45eff86a1ebf6201fca929831188b214`

De volledige Mr Moos-hashes staan in `ops/benchmark/output/source-version-check.json`
van de lokale run; dat bestand is gitignored en niet meegecommit. De
gecontroleerde referentiebestanden (`holdout-references.json`,
`source-references.json`, `botanist-reference.json`,
`menu-extraction-acceptance-set.json`) bevatten de volledige vastgepinde waarden.

## #56-compatibiliteit (read-only, geen integratie)

Gecontroleerd op 2026-10-19 met `git ls-remote` en `git merge-tree
--write-tree`, zonder branchwissel, merge of cherry-pick. De remote
`refs/heads/feat/compact-source-flow-53` en `refs/pull/56/head` staan beide op
`00f415112a29c16d2d0b2b814b6a00308a8f3747`; de merge-base met #59 is
`fc12bbc6fcf1469fc0119152cbd6149aee44bf55`.

- **Tien overlappende bestanden** tussen #59 en #56:
  `app/internal/source-triage/batch/BatchAnalysisView.js`,
  `app/internal/source-triage/batch/MenuReview.js`,
  `app/internal/source-triage/batch/page.js`,
  `src/lib/batchAnalysis.js`, `src/lib/batchAnalysis.test.js`,
  `src/lib/batchAnalysisHandlers.js`, `src/lib/batchAnalysisSurface.test.js`,
  `src/lib/htmlMenuStructure.js`, `src/lib/menuConceptReviewHandlers.test.js`,
  `src/lib/menuSnapshotProposals.test.js`.
- **Drie inhoudelijke conflicten** in `git merge-tree` (exit 1):
  `app/internal/source-triage/batch/page.js`,
  `src/lib/htmlMenuStructure.js`,
  `src/lib/menuSnapshotProposals.test.js`.
- Zeven van de tien overlappende bestanden worden door Git automatisch
  samengevoegd; dat is geen bewijs dat de gecombineerde gebruikersstroom werkt.
- **Benodigde integratiestap:** laat #56 eerst zijn eigen review/merge afronden,
  rebase #59 daarna op de dan vaste #56-head, los de drie conflicten op met
  behoud van #56's goedgekeurde v3-referentie en #59's bron-/parserbewijs, en
  herhaal de volledige suite, structuurcorpus, benchmark en browserfixture.
- **Niet uitgevoerd en niet geautoriseerd:** merge, cherry-pick, branchwissel,
  overnemen van #56-code of een gecombineerde release.

## Contractgrenzen: zichtbaar beperkt, niet stil afgeplat

De nieuwe regressie in `src/lib/menuExtractionRuntime.test.js` (commit
`5a7f99a`) bewijst dat een geldige modeluitvoer met **glas/fles-prijsvarianten,
een supplementrelatie en allergenen** door de runtime wordt geweigerd met
`unsupported_product_fields`; er ontstaat geen menucontext, geen samenvatting
en dus geen savebaar concept. `menuExtractionAdapter.test.js` dekt daarnaast
`isFrom` en meerdere prijsvarianten. `menuExtractionQuality.test.js` bewijst dat
supplement-, arrangement- en portiegaten een betaalde modelcall blokkeren en de
bron als “Controle nodig” laten staan. De bronproeven melden dezelfde gaten:
7 supplementregels + 1 arrangement bij Smelt, 2 arrangement-/wijnsecties bij
Blossem, 6 supplementrijen + wijn/cocktail bij De Botanist, 5 secties bij
Colonia en een geblokkeerd groepsmenu bij Mr Moos.

De bestaande concept-/exportgates zijn niet verzwakt: `menuConcept.js` blijft
prijs-, duplicaat- en rubriekblokkades opleggen en `menuConceptExport.js`
blijft een niet-opgeslagen of geblokkeerd concept weigeren. Het product-schema
v2 is niet meer alleen ontwerp: de pure schema-/mappinglaag staat in
`src/lib/menuProductSchemaV2.js` en `src/lib/menuProductMappingV2.js` en is met
fictieve fixtures getest. Er is niets gemigreerd, geen route aangesloten, geen
nieuw publiek veld toegevoegd en geen publicatieveld verzonnen.

## Uitgevoerde checks op deze kandidaat

| Controle | Commando | Resultaat |
| --- | --- | --- |
| Gerichte v2-tests | `node --test` op `menuProductSchemaV2.test.js`, `menuProductMappingV2.test.js`, `schemaDesign.test.js` | **47 pass, 0 fail, 0 skipped** (head `5e3e3a5`) |
| Gerichte prijsbewijs-/v2-tests (review 6274281958) | `node --test` op `menuProductSchemaV2.test.js` (27), `menuProductMappingV2.test.js` (21), `schemaDesign.test.js` (6), `menuExtractionRuntime.test.js` (3), `menuExtractionAdapter.test.js` (14), `claudeStructuringAdapter.test.js` (5) | **76 pass, 0 fail, 0 skipped** (head `2b994cd`) |
| Gerichte #59-tests | `node --test` op acceptanceSet, acceptanceSetGuard, holdoutReferences, botanistReference, htmlMenuPriceElement, menuHubDiscoveryRegression, pdfMenuStructuringLiveRegressions, sameHostDiscovery, menuExtractionAdapter, menuExtractionRuntime | **88 pass, 0 fail, 0 skipped** (eerdere head) |
| Volledige suite | `npm test` | **2105 tests: 2105 pass, 0 fail, 0 skipped** (head `5e3e3a5`; TAP, 102,1 s) |
| Volledige suite (review 6274281958) | `npm test` | **2112 tests: 2112 pass, 0 fail, 0 skipped** (head `2b994cd`; TAP, 51,0 s) |
| Structuurcorpus | `npm run test:menu-structure` | **6 pass, 0 fail** (head `5e3e3a5`) |
| Benchmark | `npm run benchmark:menu-structure` | 23 gevallen: **22 pass, 0 fail, 1 unclassified** (`STRUCT-018`, bestaande JSON-LD-hiërarchiekeuze; head `5e3e3a5`) |
| Build | `npm run build` | **compiled successfully in 30,5 s; 41/41 statische pagina's; exit 0** (head `5e3e3a5`) |
| Build (review 6274281958) | `npm run build` | **compiled successfully in 51 s; 41/41 statische pagina's** (head `2b994cd`) |
| PDF.js-serverpad | `node ops/scripts/verify-pdfjs-server-trace.js` | **OK**; 164 server scripts, native `pdf.mjs`/`pdf.worker.mjs`, geen gebundelde PDF.js-runtime (head `5e3e3a5`) |
| Browserfixture | `npm run test:browser:menu-review` | **99/99 checks**, 11 screenshots, head `5a7f99a` (historisch; niet herhaald op `5e3e3a5`), `worktreeDirty:false`, Edge 155.0.4283.45, gegenereerd 2026-10-19T16:49:19Z |
| Echte bronproef | `node ops/scripts/probe-menu-extraction-sources.js --source=all` | **exit 0**; Smelt 37/37 (8 secties), Blossem 43/43 (13 secties); beide byte-/contenthash identiek; 0 gemist/extra/prijs/koppeling/duplicaat; boekhouding 37/37 en 43/43 |
| Botanist-vergelijking | `node ops/benchmark/runBotanistComparison.js --pdf=…/botanist-menu.pdf` (v1 en v3-voorstel) | **exact reproductie** van de vastgelegde v1 (124/11/4/0; 215 items; 87 niet-gekoppeld; 9 `categoryUnknown`) en v3-voorstel (127/6/1/0; 5 beperkt; 8 `categoryUnknown`); PDF-hash gelijk |
| #56-compatibiliteit | `git merge-tree --write-tree --name-only HEAD origin/feat/compact-source-flow-53` | **op `5a7f99a`: exit 1**; 3 inhoudelijke conflicten; 10 overlappende bestanden; niet herhaald op `5e3e3a5`, geen merge uitgevoerd |
| Whitespace | `git diff --check` | schoon |

De probe-uitvoer bevat de bestaande PDF.js-waarschuwing over
`standardFontDataUrl`; die verandert de tekstlaag niet en de vergelijking
eindigde met exit 0. Dat is een observatie, geen productacceptatie.

De bronproef en de Botanist-vergelijking zijn uitgevoerd op code `4519e93`;
commit `5a7f99a` wijzigt uitsluitend twee testbestanden en geen
extractie-/runtimecode. De volledige suite en build zijn op `5e3e3a5` opnieuw
uitgevoerd (2105/2105; build exit 0). De prijsbewijsreparatie van review
6274281958 is op `2b994cd` opnieuw met 76 gerichte tests, de volledige suite
(2112/2112) en de build gecontroleerd; de browserfixture, bronproef en
Botanist-vergelijking zijn daar niet op herhaald. `2b994cd` wijzigt alleen de
pure prijsbewijshulp en tests, geen UI-, fetch- of parsercode. Hun bewijs blijft
aan `5a7f99a` respectievelijk `4519e93` gekoppeld.

## Wat expliciet niet is uitgevoerd of geclaimd

- **Item-voor-item menselijke hercontrole** van Smelt/Blossem: niet uitgevoerd;
  de vergelijking is geautomatiseerd tegen een gecontroleerde capture.
- **Nieuwe ongeziene holdout**: niet gepind. De Botanist, Mr Moos en Colonia zijn
  na reparatie `representative` + `usedForTuning`; Gauchos Breda is de enige
  overgebleven holdout en is ontoegankelijk (404).
- **Live provideractivering, kostenmeting, DPA/EU-retentie**: niet uitgevoerd;
  geen provider aangeroepen. De modelkosten van deze run zijn daarom €0, niet
  een schatting van productiekosten.
- **Echte bronbevestiging, conceptopslag, export, publicatie, merge of release**:
  niet uitgevoerd en niet geautoriseerd.
- **Live/staging browseracceptatie en echte authenticated sessie**: niet
  uitgevoerd; alleen de lokale fixture op Edge 155.
- **BE-21's 50–100-bronnen/OCR-/vendorbenchmark**: buiten #59; niet afgesloten.
- **Scans/OCR**: expliciet niet ondersteund; de uitkomst is een eerlijke fout.
- **Aansluiting van product-schema v2 op receipt/review/concept/export/
  publicatie**: niet uitgevoerd. De pure schema-/mappinglaag bestaat en is met
  fictieve fixtures getest, maar er is geen route, DDL, writeflag, migratie of
  publieke werking.
- **Correctietijd en productiekosten per brontype**: onbekend, niet als nul
  gerapporteerd. Alleen de deterministische analysetijd is gemeten.
- **#56-integratie**: niet uitgevoerd; alleen de read-only conflictaanalyse.

## Exacte resterende beslissingen en eigenaren

| # | Beslissing of toestemming | Waarom nodig | Eigenaar |
| --- | --- | --- | --- |
| 1 | Provider/model, maximaal kostenbudget, DPA/EU-retentie en app-side AI-activering | De runtime staat bewust uit. De bronproeftoestemming en de developer-prepaidtoestemming dekken dit niet | Product Owner |
| 2 | Een nieuwe, nog ongeziene holdout en de toegangsbeslissing daarvoor | Zonder nieuwe holdout is er geen releaseclaim; de gebruikte bronnen zijn representatief/getuned | Product Owner, met Delivery Lead |
| 3 | Live preview-/stagingtoegang en expliciete schrijfautorisatie voor bronbevestiging, conceptopslag en export | De fixture bewijst geen echte Supabase-sessie of schrijfactie; geen bypass toegestaan | Product Owner/ops |
| 4 | Aansluiting van de pure v2-laag op receipt/review/concept/export: dual-read, opt-in writer, exportcontract en eventuele migratie | De pure laag is gebouwd en getest, maar heeft geen route, DDL of publieke werking; het exportcontract en een eventuele migratie zijn nog niet besloten | Delivery Lead/architect; Product Owner voor export-/migratiebesluit |
| 5 | Onafhankelijke review van codehead `2b994cd` en deze documentatie | Criterium 13; groene tests zijn geen productacceptatie | Delivery Lead |
| 6 | Timing en uitvoering van de #56-integratie na afronding van #56 | Drie conflicten en tien overlappende bestanden; geen merge in deze branch | Delivery Lead beslist; developer voert na de merge uit |
| 7 | BE-21's 50–100-bronnen/OCR-/vendorbenchmark | Expliciet buiten #59; twee bronnen sluiten die niet af | BE-21-eigenaar |
| 8 | Gauchos Breda vervangen of als holdout laten vallen | De entry is 404/502 en levert geen broninhoud | Product Owner |
| 9 | Correctietijd en productiekosten per brontype meten | Criterium 8 vraagt deze cijfers; nu alleen analysetijd en €0 modelkosten gemeten | Developer, na live toegang en budgetbesluit |

## Eerdere rondes en baseline

De eerste holdoutmeting van 2026-10-18 blijft ongewijzigd bewaard in
`ops/benchmark/holdout-evaluation.json`: De Botanist 151 items/59 secties,
Mr Moos 0, Colonia 0 en Gauchos Breda HTTP 404. Daarna zijn De Botanist,
Mr Moos en Colonia voor reparatie gebruikt en als `representative` +
`usedForTuning` gemarkeerd; Gauchos Breda is de enige `evaluated_once`-holdout.
De vroege notities met 95/46/5 of 195 items horen bij een eerdere
referentievariant en zijn **niet** de actuele v1-uitkomst. De actuele v1 is
124 matched / 11 missing / 4 extra / 0 prijsverschil op 141 referentierijen bij
215 parseritems; de v3-voorstelmeting is 127/6/1/0 op 139 rijen en is niet
geaccepteerd. De volledige rondehistorie en oudere verificaties staan in Git en
in [menu-extraction-acceptance.md](menu-extraction-acceptance.md).

## Overdracht

**Aanbevolen status: READY_FOR_REVIEW voor dit afrondingsdossier, niet DONE voor
#59.** Het dossier is toetsbaar op codehead `2b994cd` (pure v2
prijsbewijsreparatie na review 6274281958) en de daarop volgende
documentatiecommit. Volledige
productacceptatie blijft afhankelijk van de beslissingen hierboven. De eerstvolgende veilige stap is onafhankelijke review
door de Delivery Lead; daarna kan de Product Owner de resterende
provider-, holdout-, toegangs- en migratiebesluiten nemen. Er is niets gemerged,
gepusht naar een andere branch, gedeployed of gepubliceerd.
