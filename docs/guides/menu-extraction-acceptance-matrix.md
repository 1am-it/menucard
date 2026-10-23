# Menu-extractie — afrondingsmatrix #59

Status: **ontwikkelaarsbewijs, geen onafhankelijke review en geen release.**
Datum: 2026-10-22 (nieuwste ronde: Lead-review 6351417692, criterium 5/8:
extractieherstel Bardot (prijs op dezelfde gedrukte regel, rubriekkoppen) en
Wolfslaar (menutitel uit de linklabels van de site, prijsvarianten, gesplitste
naam letterlijk); Bardot blijft op 0 matches door de letter-gespatieerde
rubriekkoppen in de tekstlaag, Wolfslaar gaat van 0/30 naar 29/30. De
rondehistorie hieronder blijft ongewijzigd).
Issue #59, branch `feat/menu-extraction-59`, PR #60 (draft).
De nieuwste ronde staat in “Ronde 2026-10-22 — criterium 5/8: extractieherstel
Bardot en Wolfslaar (review 6351417692)”; de ronde daarvoor in “Ronde 2026-10-22
— criterium 5: Wolfslaar en T-Huis vastgelegd, vier kaarten in één meting (review
6349832755)”, daarvoor “Ronde 2026-10-22 — criterium 5: Bardot naast Zuyd,
Wolfslaar/T-Huis geprobeerd (review 6347355753)” en daarvoor “Ronde 2026-10-22 —
afrondingsronde (review 6344039571)”.
Deze ronde wijzigt de extractie zelf (generiek, met fictieve fixtures), niet de
referenties, telregels, captures of meetcode: dezelfde scripts en dezelfde
referenties zijn opnieuw gedraaid en oud/nieuw staat hieronder naast elkaar.
De afrondingsronde wijzigt **uitsluitend** twee referentieregels op uitdrukkelijk
Lead-besluit (`Ui` + oude kaas, `Wagyu A5` + Miyazaki); telregels, captures,
meetcode en brongerichte code zijn niet gewijzigd. De oudere
kandidaat-codehead `26839eb4b9dfb5fb0a04fbc977ae3a7561f7000a` en
bewijscommit `0f6fce86c0cc75cbcaab05574b7ae83975e3a16c` horen bij de
browserfixture-ronde en gelden niet als head; de exacte checkpoint-HEAD van
deze ronde staat in de PR #60-checkpoint.
Vorige heads:
`abe42c5400c74d4a5c3e759e18055b5910506204` (geaccepteerd door de Lead,
review 6344039571),
`b621582223515ee7b9f2b81dada56b8a4d044955` (reviewdocumentatie),
`6728897c814bce80aa2b9a44d53d8322b3adc72a` (herstel van review 6283658271),
`ab89d14c0a2dfb19c559126a0a8ca0bb62746d16` (documentatie),
`0f9ea9dd59c36b13b270cb140030466db11d6d8d` (read-only aansluiting) en
`6fb54cad76dd4f2b7996667777d82c0db5789b04` (volledig-lexeem prijsbewijs).
Protocol:
`MENU-EXTRACTION.md` v0.3, SHA-256
`a352effee402d8ccdbb8260aa21baabcfd2e8f8c160b36a1b21df36a430c2648`.
De runtime blijft zonder provider; alle bronproeven zijn read-only. De v2-laag
is nu read-only aangesloten op de bestaande interne controle en review; er is
geen v2-schrijver, provider, DDL of publieke werking.

Deze matrix vervangt de status in oudere PR-teksten en eerdere matrixversies.
De volledige rondehistorie blijft in Git en in
[menu-extraction-acceptance.md](menu-extraction-acceptance.md); oude aantallen
gelden niet meer als actuele status.

## Conclusie in één alinea

Met bewijs werkt: de versiegebonden protocol-/schemalading, de bestaande
analyseketen met begrensde veilige fetch, de review-/conceptfixture, de
rol- en netwerkgrenzen, de read-only extractie van de toegestane
Smelt- en Blossem-bronversies (37/37 en 43/43 exact tegen de gecontroleerde
capture), en de **read-only v2-aansluiting**: bestaande
receipt-, review-, concept-, batch-, workqueue- en exportlezers herkennen een
versioned envelope, tonen varianten/glas/fles/supplementen en bewijs via één
gesaneerde view, en weigeren v2 vóór hash, claim, insert, update, RPC of
GitHub. De bestaande conceptlijst en detailpagina zijn met
echte klikken in de fixture gedekt: geldige v1 blijft bruikbaar, v2 blijft
read-only met glas/fles/supplement/allergenen/provenance/dekking, en onbekende
of exact lege `menus: []`-rijen blijven zichtbaar geblokkeerd. De Botanist is
meetbaar gedeeltelijk (124/141 referentierijen,
11 gemist, 4 extra, 0 prijsverschil) en de Mr Moos/Colonia-aantallen zijn
live observaties zonder referentie-uitkomst. Sinds de afrondingsronde staat de
gecontroleerde meting op **167/185 match, 15 gemist, 0 verzonnen, 0
prijsfouten, 3 rubriekfouten (precisie 98,24%, recall 90,27%)**: Pellens gaat
van 24 naar **26 van 36** en verliest zijn laatste twee verzonnen rijen, omdat
de Lead de twee `naam`+`span`-referentieregels op de bronstructuur heeft
rechtgezet. Bewust geblokkeerd of niet
ondersteund blijven: scans/OCR, v2-**schrijvers**/activering, echte
provideractivering, echte bronbevestiging/conceptopslag/export/publicatie,
bronverificatie zonder geregistreerde brontekst/hashcontext, Gauchos Breda
(onbereikbaar), een nieuwe ongeziene holdout, prijsvarianten in het
productconcept (schema-ontwerp nodig) en BE-21's
50–100-bronnenbenchmark. De pure v2 schema-/mappinglaag en de read-only
integratie zijn met fictieve fixtures getest; er is geen DDL, writeflag of
publieke werking. De vier gemeten kaartvormklassen
(K1–K4: naam/omschrijving in één cel, kaarttitel en tabbladen, verborgen
tweede weergave, arrangement met per-gangprijzen) zijn generiek hersteld met
per klasse een fictieve regressie; de tien resterende gemiste Pellens-regels
zijn alle tien prijsvarianten (`Klein`/`Hoofd`) en staan als begrensd in de
matrix. Volledige productacceptatie vereist nog een Product
Owner-besluit over provider/model/budget/DPA, een nieuwe holdout, live
preview-/schrijftoegang en onafhankelijke review door de Delivery Lead.

## Ronde 2026-10-22 — criterium 5/8: extractieherstel Bardot en Wolfslaar (review 6351417692)

Basis `1ebef30`. Uitvoering van K1–K5 van de Lead-opdracht. Bewijscategorie: **R+T** (echte read-only bronproef + tests). Dit is ontwikkelaarsbewijs, geen onafhankelijke review en geen productieacceptatie. Referenties, telregels (`0f09b74f…`), captures en meetcode zijn **niet** gewijzigd; de extractie is generiek hersteld en met dezelfde scripts en dezelfde referenties opnieuw gemeten.

| K | Naam | Stand | Bewijs |
| --- | --- | --- | --- |
| K1 | Bardot-PDF: prijs op dezelfde regel | **gedaan, met begrensde rubricering** | Een kaart die zijn bedragen in een eigen kolom drukt, koppelt een bedrag nu aan de naam op **dezelfde gedrukte regel** (3 eenheden baseline-tolerantie). De pagina bewijst die relatie zelf: de naamkolom draagt minstens drie keer minder bedragen dan de vervolgkolom, anders wordt er niets verplaatst. De tekst tussen naam en bedrag wordt de omschrijving en nooit een gerecht; de gedrukte komma scheidt naam en omschrijving. Een prijsloze regel in kapitalen of in letter-gespatieerde stukken wordt een rubriek met de letterlijke gedrukte tekst en nooit een gerecht; een omslagpagina die zijn titel als losse letters drukt, levert de menutitel (`DINERKAART`). Fictieve PDF-fixture: `menuExtractionPriceColumnRepairs.test.js` (3 tests) |
| K2 | Wolfslaar-structuur | **gedaan** | Een menupagina zonder eigen kaartkop houdt zijn rubriekpaden ongewijzigd en krijgt de naam die de site zelf voor die pagina gebruikt (`Menukaart diner` / `Menukaart lunch`), alleen als dat label een niet-generiek woord met het adres van de pagina deelt; een call-to-action (`Ontdek ons menu`) wordt nooit een titel. Prijsvarianten (`65/98`, `44/54`, `glas/fles`) worden één gerecht met elk bedrag als variant en het gedrukte label; een gesplitste naam (`C onference Peer`) blijft letterlijk staan. Regressies: `menuExtractionVariantShapeRepairs.test.js` (4) en twee K2-tests in `restaurantSourceAnalysis.test.js` |
| K3 | Meting oud/nieuw | **gedaan** | `card-reference-measurement.json` SHA-256 `b1b06641…` (was `111afa90…`) en `reference-measurement.json` `5eda188a…`; beide tweemaal identiek op dezelfde bytes. Zie de tabellen hieronder. **Geen enkele bron verloor matches**: Zuyd 34, Andalous 81, Chocolat 26 en Pellens 36 (was 26) blijven gelijk of gaan vooruit; Smelt 37/37 en Blossem 43/43 blijven gelijk (probe exit 0) |
| K4 | Begrenzing waar nodig | **gedaan** | zie “Wat begrensd blijft” hieronder en de twee bijgewerkte rijen in “Actuele acceptatiematrix” (criterium 5 en 8) |
| K5 | Voortgang met naam | **gedaan** | `ops/benchmark/output/criteria-progress.json`, ronde `6351417692`, per K één regel met `name` (gitignored per BE-21); dezelfde regels staan hier en in de checkpoint |

### Oud en nieuw naast elkaar (zelfde referenties, zelfde telregels)

Bestaande kaarten (`card-reference-measurement.json`, oud `111afa90…` → nieuw `b1b06641…`):

| Kaart | Referentie | Extractie oud → nieuw | Match oud → nieuw | Gemist | Verzonnen | Prijsfouten | Rubriekfouten |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Brasserie Bardot | 112 | 74 → **86** | 0 → 0 | 76 → **61** | 38 → **35** | 0 → 0 | 36 → 51 |
| Restaurant Zuyd | 36 | 34 → 34 | 34 → 34 | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 |
| Restaurant Wolfslaar | 30 | 29 → **30** | 0 → **29** | 5 → **1** | 4 → **1** | 0 → 0 | 25 → **0** |
| T-Huis | 0 | geblokkeerd → geblokkeerd | n.v.t. | n.v.t. | n.v.t. | n.v.t. | n.v.t. |
| **Totaal (drie gemeten)** | 178 | 137 → **150** | 34 → **63** | 83 → **64** | 42 → **36** | 0 → 0 | 61 → **51** |

Precisie 24,82% → **42,00%**, recall 19,10% → **35,39%**. De totalen zijn nooit één succescijfer: elke kaart staat hierboven apart.

Referentieset (`reference-measurement.json`, oud `79a8b133…` → nieuw `5eda188a…`):

| Bron | Referentie | Match oud → nieuw | Gemist | Verzonnen | Prijsfouten | Rubriekfouten |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Restaurant Zuyd | 36 | 34 → 34 | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 |
| Andalous Restaurant Breda | 87 | 81 → 81 | 3 → 3 | 0 → 0 | 0 → 0 | 3 → 3 |
| Restaurant Pellens | 36 | 26 → **36** | 10 → **0** | 0 → 0 | 0 → 0 | 0 → 0 |
| Restaurant Chocolat | 26 | 26 → 26 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| **Totaal (vier gemeten)** | 185 | 167 → **177** | 15 → **5** | 0 → 0 | 0 → 0 | 3 → 3 |

Precisie 98,24% → **98,33%**, recall 90,27% → **95,68%**. De tien gewonnen Pellens-rijen zijn de `Klein`/`Hoofd`-prijsvarianten die nu als variant bewaard blijven in plaats van weggegooid.

### Wat generiek is opgelost

- Een bedrag in een eigen prijskolom hoort bij de naam op dezelfde gedrukte regel; de tekst ertussen is de omschrijving (`Pata Negra (70 gr.)` + `Spaanse Ibericoham` + `21.95`, `Paté en croute` + `gefrituurde kappertjes, uienconfit` + `16.95`).
- Een gedrukte rubriekkop in kapitalen of in letter-gespatieerde stukken wordt een rubriek (`FICTIEVE BORRELHAPPEN`, `Ex TRA BI j GERECHTEN :`) en nooit een gerecht; de letterlijke gedrukte tekst blijft bewaard.
- De omslagtitel in losse letters levert de menutitel (`DINERKAART`), zonder pad te vervormen of een bestandsnaam te gebruiken.
- Een menu zonder eigen kaartkop krijgt de naam die de site zelf voor die pagina gebruikt, bewezen doordat een niet-generiek woord met het adres van de pagina wordt gedeeld.
- Meerdere gedrukte bedragen op één gerechtregel worden één gerecht met varianten (label + bedrag), nooit één gekozen bedrag en nooit een weggevallen bedrag; twee naam+prijs-paren op één regel blijven geweigerd.
- Een gesplitste naam blijft letterlijk (`C onference Peer`), en een prijsloze vetgedrukte vervolgregel wordt nooit een eigen gerecht.

### Wat begrensd blijft (criterium 8)

- **Bardot-rubrieken: 0 matches is een tekstlaagbeperking, geen extractiefout.** De kaart drukt zijn rubriekkoppen met letter-spatiëring (`KL ASSIEKE BORRELHAPPEN`, `VOORGEREC HTEN`, `Ex TRA BI j GERECHTEN`) die de tekstlaag als losse stukken levert. De referentie leest die koppen zoals ze *gerenderd* zijn. Zonder woordenboek of gok is dat niet te reconstrueren; de extractie bewaart daarom de letterlijke gedrukte tekst. 51 Bardot-rijen hebben de juiste naam en het juiste bedrag onder zo'n letterlijke rubriekkop en worden als **rubriekverschil** gerapporteerd, niet als match. Elke rij houdt zijn citaat, locator en bedrag, dus dit is een expliciete grens en geen stil verlies.
- **Bardot-dranken/-dessertpagina's:** koppen en gerechten staan daar in verschoven, letter-gespatieerde tekstregels; een deel van die rijen komt met een gefragmenteerd label in het rapport (zichtbaar als verzonnen rij met citaat). Niet stil opgelost en niet als match geteld.
- **Wolfslaar `C onference Peer`:** de bron splitst de naam over twee markup-runs; de referentie schrijft hem aaneen. De extractie houdt de bron letterlijk aan (K2: geen gok), dus 1 gemiste + 1 verzonnen rij blijft als bewezen verschil staan.
- **Zuyd 2 gemiste rijen** blijven onveranderd; die horen bij de bestaande begrenzing van de referentieset, niet bij deze ronde.
- **T-Huis:** afbeeldingsmenu, niet ondersteund. Valt onder **eigenaarsbesluit 3a (afbeeldingsmenu niet ondersteund)**; de kaart blijft `blocked` met reden en wordt nooit als lege of geslaagde extractie geteld. Er is geen OCR bijgebouwd.
- Geen nieuwe bron, geen OCR, geen provider, geen publicatie, geen merge.

Regressies van deze ronde: `menuExtractionVariantShapeRepairs.test.js` (4), `menuExtractionPriceColumnRepairs.test.js` (3), twee K2-tests in `restaurantSourceAnalysis.test.js`, de bijgewerkte fixture-verwachting in `htmlMenuFormattedBlocks.test.js` en `structureCorpus.js` (STRUCT-012: twee gedrukte bedragen zijn nu varianten, twee naam+prijs-paren blijven geweigerd). Volledige suite **2443/2443** groen; `npm run test:menu-structure` 6/6; bronproef Smelt 37/37 + Blossem 43/43 (exit 0).

## Ronde 2026-10-22 — criterium 5: Bardot naast Zuyd, Wolfslaar/T-Huis geprobeerd (review 6347355753)

Basis `8430773`. Deze ronde voert K1–K5 uit en raakt **geen** extractiecode, telregels, meetcode, bestaande referentie, provider of workflow aan. Bewijscategorie: **R+T** (echte read-only bronproef + tests); dit is ontwikkelaarsbewijs, geen onafhankelijke review en geen productieacceptatie.

| K | Naam | Stand | Bewijs |
| --- | --- | --- | --- |
| K1 | Bardot-referentie | **gedaan** | `card-reference-captures.json` (`06c00c16…`): de dinerkaart-PDF is byte-identiek aan de pin (`487ba29f…`); de twee HTML-pagina's zijn bron gewijzigd (`9c642296…`, `45e96b35…`) en leveren geen referentie. `reference-references/bardot.json` (`63d39733…`): 112 items, 29 rubriekpaden, 7 supplementen, 8 twijfelgevallen, 0 arrangementen, 143 prijsbewijzen; alle citaten en prijsbewijzen machinematig tegen de vastgezette bytes gecontroleerd |
| K2 | Meting Bardot naast Zuyd | **gedaan** | `card-reference-measurement.json` (`b68f9760…`) en `.md` (`85cd33bb…`), tweemaal identiek op dezelfde bytes: Bardot 112/74/0 match, 76 gemist, 38 verzonnen, 0 prijsfouten, 36 rubriekfouten; Zuyd 36/34/34, 2 gemist, 100% / 94,44%; totaal 148/108/34, precisie 31,48%, recall 22,97% |
| K3 | Wolfslaar en T-Huis, één poging | **gedaan (beide leesbaar)** | `existing-card-probe-attempts.json` (`6ea987c1…`, create-only): Wolfslaar `/`, `/nl/menu-lunch`, `/nl/menu-diner` en T-Huis `/`, `/menu/` gaven `text/html` met tijd en SHA-256; geen alternatieve URL, geen andere vestiging, geen omzeiling. Geen menu gelezen of vastgelegd |
| K4 | Matrix criterium 5 | **gedaan** | Criterium 5 staat in “Eindstand criterium 1–13” en in “Actuele acceptatiematrix” per kaart bijgewerkt met verwijzing naar het eigenaarsbesluit (issuecomment-6315226470, optie 1); de onjuiste claim “begrensd” is weg |
| K5 | Voortgang per criterium | **gedaan** | `ops/benchmark/output/criteria-progress.json` onder ronde `6347355753`, per K één regel met naam (gitignored per BE-21); dezelfde regels staan in deze tabel en in de checkpoint |

Per kaart in criterium 5:

| Kaart | Stand | Bewijs |
| --- | --- | --- |
| Brasserie Bardot | **gemeten** | referentie uit de hash-geverifieerde PDF; 0 match, 76 gemist, 38 verzonnen, 36 rubriekfouten |
| Restaurant Zuyd | **gemeten** | bestaande referentie, 34/36 match, 2 gemist, 0 prijs-/rubriekfouten |
| Restaurant Wolfslaar | **bron bereikbaar, geen referentie** | één poging leesbaar (`c202d9f8…` / `1e36ad74…` / `3e311a54…`); geen bytes bewaard, dus geen meting |
| T-Huis | **bron bereikbaar, geen referentie** | één poging leesbaar (`d074fd18…` / `c4808261…`); geen bytes bewaard, dus geen meting |

Regressies van deze ronde: `cardReferenceCaptures.test.js` (pinregels: alleen de gepinde URL's, alleen een identieke hash, bronwijziging zonder bytes), `cardReferenceIntegrity.test.js` (kolomscheiding, exacte baseline, prijsbewijs weigert verkeerd bedrag/ontbrekend bewijs), `cardReference.test.js` (referentieshape, dranken tellen, supplementen geen gerechten, Dagprijs-twijfelgevallen, citaten en prijsbewijzen tegen de bytes), `cardReferenceMeasurement.test.js` (totalen uit de rijen, hashes aan de invoer gebonden, deterministisch) en `existingCardProbeAttempts.test.js` (alleen gepinde URL's, geen menuclaim).

Openstaand binnen criterium 5: referentie en meting voor Wolfslaar en T-Huis (bron nu aantoonbaar bereikbaar), onafhankelijke controle van de Bardot-referentie door de Delivery Lead, en het oplossen van de Bardot-PDF-layoutfouten (naam-/rubriekkoppeling, beschrijvingsfragmenten) — dat is extractiewerk in een aparte opdracht.


## Ronde 2026-10-22 — criterium 5: Wolfslaar en T-Huis vastgelegd, vier kaarten in één meting (review 6349832755)

Basis `2108842`. Deze ronde voert K1–K5 uit en raakt **geen** extractiecode, bestaande referentie, telregel of vergelijkingslogica aan; de meetcode is alleen uitgebreid met de twee nieuwe kaarten. Bewijscategorie: **R+T** (echte read-only bronproef + tests). Dit is ontwikkelaarsbewijs, geen onafhankelijke review en geen productieacceptatie. Eigenaarsbesluit voor deze vier kaarten: GitHub #59 issuecomment-6315226470, optie 1 (vier bestaande kaarten plus een ongeziene set).

| K | Naam | Stand | Bewijs |
| --- | --- | --- | --- |
| K1 | Vastleggen Wolfslaar en T-Huis | **gedaan** | `ops/scripts/capture-menu-extraction-card-source-bytes.js` (create-only) en de pins `card-reference-captures.wolfslaar.json` (SHA-256 `0705abdd…`) en `card-reference-captures.thuis.json` (`49ad24e9…`). Wolfslaar: entry `14abdb9e…`, lunch `22d60179…`, diner `bc35f9ca…` en de door de entrypagina zelf genoemde menulink `/menu-1` `19abbe4a…`. T-Huis: entry `d074fd18…` en `/menu/` `c4808261…` (identiek aan de eerdere probe). Per capture staan content-type, bytes, SHA-256, rol en tijd in de pin; de bytes zelf staan gitignored in `ops/benchmark/output/card-captures/` |
| K2 | Referenties Wolfslaar en T-Huis | **gedaan** | `reference-references/wolfslaar.json`: 30 gerechten in 6 rubriekpaden (lunch- en dinerpagina), 4 arrangementen, 3 supplementen, 3 twijfelgevallen, elk met rubriekpad, locator en letterlijk citaat; alle citaten machinematig tegen de vastgezette HTML gecontroleerd. `reference-references/thuis.json`: **geen** referentieregel; de vastgezette menupagina draagt de vijf kaarten (Food, Lunch, Wijn, Drank, Dessert) alleen als SVG-afbeelding, dus T-Huis staat op `blocked` met reden en vijf benoemde panelen |
| K3 | Meting vier kaarten | **gedaan** | `card-reference-measurement.json` (SHA-256 `111afa90…`) en `.md` (`36db1907…`), tweemaal identiek op dezelfde bytes: Bardot 112/74/0 match (76 gemist, 38 verzonnen, 36 rubriekfouten), Zuyd 36/34/34, Wolfslaar 30/29/0 (5 gemist, 4 verzonnen, 25 rubriekfouten), T-Huis geblokkeerd; totaal 3/4 gemeten, 178 referentierijen, precisie 24,82%, recall 19,10% |
| K4 | Matrix criterium 5 | **gedaan** | deze sectie, de rij criterium 5 in “Actuele acceptatiematrix” en `docs/guides/menu-extraction-existing-cards.md`; per kaart de echte stand met verwijzing naar het eigenaarsbesluit |
| K5 | Voortgang met naam | **gedaan** | `ops/benchmark/output/criteria-progress.json` onder ronde `6349832755`, per K één regel met `name` (gitignored per BE-21); dezelfde regels staan hier en in de checkpoint |

Per kaart in criterium 5:

| Kaart | Stand | Bewijs en betekenis |
| --- | --- | --- |
| Brasserie Bardot | **gemeten** | Ongewijzigde referentie en meting op de hash-geverifieerde dinerkaart-PDF: 0/112 match, 76 gemist, 38 verzonnen, 36 rubriekfouten. De 36 gelezen naam+prijs-rijen staan onder de verkeerde rubriek en 38 beschrijvingsfragmenten gelden als verzonnen rij. Oplossen is extractiewerk in een aparte opdracht |
| Restaurant Zuyd | **gemeten** | Ongewijzigde referentie: 34/36 match, 2 gemist, 0 prijs-/rubriekfouten |
| Restaurant Wolfslaar | **gemeten, met drie concrete afwijkingen** | 30 referentierijen, 29 geëxtraheerde rijen, 0 exacte match. **25 rubriekfouten**: de pagina's hebben geen menutitel, dus de extractie levert `Voorgerechten` waar de referentie `Menukaart lunch › Voorgerechten` verwacht; naam en prijs zijn wél gelezen. **5 gemist + 4 verzonnen**: prijsvariantverlies (`Royal Belgian Platinum Caviar` 65/98 → alleen 98; `Mechelse Koekoek` 44/54 → alleen 54) en de in de bron gesplitste naam `C onference Peer` op de dinerpagina. Geen enkel gerecht is verzonnen zonder bronpassage |
| T-Huis | **vastgelegd, niet meetbaar** | De menupagina levert vijf SVG-kaarten zonder tekst. Zonder beeldanalyse/OCR is er geen gerecht, prijs of rubriek te bewijzen; daarom geen referentie en geen meting, en **niet** als lege of geslaagde extractie geteld. Dit is de eerlijke beperking voor de klasse “afbeeldingskaart” |

Regressies van deze ronde: `cardSourceCaptures.test.js` (11 tests: alleen gepinde of door de entrypagina genoemde URL's, één entry-seed, `not-a-menu` met reden, `blocked` zonder bytes, geen drift van de kaartcapture, alleen Wolfslaar/T-Huis) en de uitgebreide `cardReferenceMeasurement.test.js` (8 tests: vier kaarten in vaste orde, T-Huis als geblokkeerde rij met SVG-reden, hashes van pins en referenties aan de invoer gebonden, deterministisch).

Eerlijke beperkingen van deze ronde:

- De veilige ophaalroute doet SSRF-, redirect-, tijd- en bytecontroles, maar **geen** `robots.txt`-controle. De eerdere probe- en Bardot-documentatie suggereerde dat wel; deze ronde herhaalt die claim niet en past het eerdere bewijs niet stil aan.
- Eén leesronde per URL; de bytes zijn nu gepind. Een tweede capture of een andere URL is een nieuwe opdracht.
- De “4 verzonnen” Wolfslaar-rijen zijn dezelfde gerechten als de 4 variantmissers: de telregels (ongewijzigd) boeken een variantverlies als gemist **en** verzonnen, niet als prijsfout.
- De 14 dubbele gereenten in het rapport zijn dezelfde à la carte op zowel de lunch- als de dinerpagina, geen dubbele extractie binnen één pagina.

Openstaand binnen criterium 5: onafhankelijke controle van de Wolfslaar-referentie en van de T-Huis-beperking door de Delivery Lead, en het oplossen van de Bardot-PDF- en Wolfslaar-structuurfouten (menutitel, prijsvarianten, gesplitste namen) in een aparte extractieopdracht.



Aanleiding: de Lead accepteerde `1b22121..abe42c5` byte-identiek en gaf één
afrondingsopdracht (K1–K5), met de twee Pellens-referentieregels als **enige**
toegestane referentiewijziging. Basis:
`abe42c5400c74d4a5c3e759e18055b5910506204`. Telregels (`0f09b74f…`, gepind in
`reference-references/index.json`), captures en meetcode zijn niet gewijzigd; er
is geen brongerichte code, provider, OCR, app-AI, productieactie, publicatie of
merge bijgekomen. De app-side AI-activering blijft expliciet **niet**
goedgekeurd; alleen de lokale developer-prepay is gebruikt voor read-only
bronproeven.

### K1 — referentiecorrectie: oud en nieuw naast elkaar

De bron schrijft `<dt>Ui<span>oude kaas</span></dt>` en
`<dt>Wagyu A5<span>Miyazaki</span></dt>`, precies zoals
`<dt>Entrecôte<span>zwarte knoflook</span></dt>` dat al als naam+omschrijving
vastlegt. Alleen die twee regels zijn aangepast; het bestand bevat nu de
letterlijke notitie “2026-10-22, Lead-besluit #59: consistent met de
bronstructuur naam+span, zoals Entrecôte; beoordeeld op bytes 66f57e267289”
(`decisions`), en de referentieversie is 1.2.0.

| Regel | Referentie oud | Referentie nieuw | Extractie (onveranderd) |
| --- | --- | --- | --- |
| Lunch › Brioches › regel 4 | naam `Ui oude kaas` | naam `Ui`, omschrijving `oude kaas` | naam `Ui`, omschrijving `oude kaas`, €12,50 |
| Lunch › Brioches › regel 5 | naam `Wagyu A5 Miyazaki` | naam `Wagyu A5`, omschrijving `Miyazaki` | naam `Wagyu A5`, omschrijving `Miyazaki`, €47,00 |

| Meting (zelfde code, zelfde bytes, alleen deze twee referentieregels) | oud `abe42c5` | nieuw |
| --- | ---: | ---: |
| Match / referentiegerechten | 165 / 185 | **167 / 185** |
| Gemist | 17 | **15** |
| Verzonnen | 2 | **0** |
| Prijsfouten / rubriekfouten | 0 / 3 | 0 / 3 |
| Precisie / recall | 97,06% / 89,19% | **98,24% / 90,27%** |
| Pellens match / gemist / verzonnen | 24 / 12 / 2 | **26 / 10 / 0** |

Deterministisch: twee keer uitgevoerd op dezelfde vastgezette bytes met
identieke hashes — `ops/benchmark/reference-measurement.json`
`79a8b13381f550c884f88e78f1937f929ab9d5e351ad379e43a3adf4f4014035` en
`ops/benchmark/reference-measurement.md`
`c21f6193a1522493014ee33567110313b9182dbcc2237f6cf255a605f7621099`. Zuyd,
Andalous en Chocolat blijven gelijk in uitkomst; geen bron verliest een match.
De tien resterende gemiste Pellens-regels zijn alle tien prijsvarianten
(`Klein`/`Hoofd`); die klasse blijft bewust **begrensd** (zie criterium 8).


### K2 — robuustheid (criterium 10) op deze head

Alle onderdelen zijn op deze head daadwerkelijk gedraaid; per regel staat de
regressie die het onderdeel afdekt. Ontbrak een regressie, dan is er één
minimale toegevoegd (gemarkeerd **nieuw**).

| Onderdeel | Regressie | Bewijs op deze head |
| --- | --- | --- |
| Time-out | `menuExtractionAdapter.test.js`: “REGRESSION: timeout aborts the provider signal and calls the cancellation hook”; “timeout and budget limits stop the call; unknown cost is not treated as zero” | 14/14 pass |
| Provideruitval | `menuExtractionAdapter.test.js`: “REGRESSION (review P1): a known paid failure is booked, never settled as zero”; “an unknown cost keeps the whole reservation charged and cannot be reused” | 14/14 pass |
| Ongeldige uitvoer | `menuExtractionAdapter.test.js`: “REGRESSION: strict schema rejects invalid coverage, unknown nested fields, missing evidence quote and overlong values”; “forbidden confidence/reviewReady and unreferenced sources are rejected” | 14/14 pass |
| Kosten- en paginagrens | `menuExtractionAdapter.test.js`: “REGRESSION: input, page and output limits are enforced, not merely passed through”; “REGRESSION: limits reject negative/zero configuration before calling the provider”; `safeOutboundFetch.test.js`: “a response exceeding maxBytes is aborted, never buffered in full” | 14/14 + 77/77 pass |
| Herimport | `batchAnalysisHandlers.test.js`: “concept: identical content is not saved again”; “structure review: a retry with the same decisions is idempotent, a contradicting retry is refused”; `menuConceptExport.test.js`: “idempotent: a second click returns the same open pull request, never a second branch or PR”; `batchAnalysisMigration.test.js`: “0016 enqueue: serialized, idempotent per client batch id…” | 66/66 pass |
| Gelijktijdige taken | `batchAnalysisHandlers.test.js`: “confirm: a simultaneous double request still yields exactly one accepted proposal”; `batchAnalysisMigration.test.js`: “0016 a receipt binds to at most one job and one URL intake, also under concurrent calls”; “0016 claim: … one active job overall, 60 s per host, …, 3-minute lease”; `analysisWorker.test.js`: “never exceeds maxJobs even when the first batch keeps claiming” | 66/66 pass |
| Promptinjectie | `menuExtractionAdapter.test.js`: “REGRESSION: source text is data — injection text cannot add tools, trust fields or change the schema”; `htmlMenuStructure.test.js` (verborgen/gekaapte blokken) | 14/14 + 85/85 pass |
| Verkeerde vestiging | **nieuw** `restaurantSourceAnalysis.test.js`: “K2 (criterion 10, wrong establishment): a same-host page carrying another branch address never lends that address to this branch, and the menu read there keeps its own source URL”; bestaand: “contextStatus "conflict" — a demonstrably different Dutch postcode … caps the field at laag”; `restaurantHostMatch.test.js`: “multiple restaurants sharing the same hostname is reported, never guessed” | 36/36 + 77/77 pass |
| Onveilige redirects | `safeOutboundFetch.test.js`: “follows one redirect and re-validates the target the same way”; “a redirect to a literal, disallowed IP address is rejected mid-chain, with no request ever issued to it”; “exceeding maxRedirects is rejected, never followed indefinitely”; `restaurantSourceFetch.test.js`: “fetchSameSiteWithRedirects: an external host, another subdomain, a private IP, localhost, a non-HTTP(S) scheme, credentials, a fragment and a downgrade all fail closed”; “a redirect target is gated by robots.txt before it is ever requested”; “integration: a same-site www redirect whose hostname resolves to a private address is still refused by the SSRF guard” | 77/77 pass |

Begrenzing, eerlijk benoemd: alles is offline/fixture-bewijs. Een echte
provideruitval, een echte kostenmeting en echte gelijktijdige productietaken zijn
niet gemeten (geen provider, geen productietoegang). De vestigingscontrole is
host- en adresniveau; een gerecht wordt niet per vestiging geattribueerd.


### K3 — geen stil dataverlies (criterium 11)

De keten is per stap met een regressie afgedekt; de nieuwe regel bewijst de keten
in één test met fictieve PDF-bytes.

| Stap | Regressie | Wat het bewijst |
| --- | --- | --- |
| Extractie → receipt | **nieuw** `restaurantSourceAnalysis.test.js`: “K3 (criterion 11): a supplement gap and a two-price row stay named through analysis → receipt summary → concept”; bestaand: “SMELT-LIKE CHAIN: recognized PDF sections become receipt menus, one concept and a saveable reviewed result” | dezelfde bron-ID en -URL in receipt en analyse; supplementregel benoemd en geen gerecht; beide bedragen blijven letterlijk staan (`priceText` “6.50 / 25.00”, `priceVariants` 6.50 + 25.00, `priceStatus: multiple_undecomposed`); geen prijs geraden |
| Receipt → review | `menuSnapshotReviewHandlers.test.js`, `menuConceptReviewHandlers.test.js`, `sourceWorkqueueV2.test.js` (“a v2 receipt with items is ready for review even without the legacy menus key”) | review leest het opgeslagen resultaat, niet een tweede extractie; v2 blijft read-only zichtbaar |
| Review → concept | `menuConcept.test.js` (blokkers, correcties, expliciete keuzes), `menuScope.test.js`: “no dish disappears silently: a dish missing from one variant needs a per-variant keep/remove decision”; **nieuw** K3-regel: blokkers `multiple_prices` + `unclear_category` met de gerechtnamen, gerechten blijven in het concept staan | onopgeloste prijs en onzekere rubriek worden blokkades, geen stil verlies en geen gok |
| Concept → export | `menuConceptExport.test.js`: “refused: stale version, not approved, rejected, blockers, rejected-before content”; “preview of a version with blockers shows no partial menu”; `menuConceptExportV2.test.js`: “a v2 concept is refused before the export claim, branch, commit, pull request or GitHub call” | een geblokkeerd of niet-ondersteund concept bereikt export nooit half |
| Onbekende/nieuwe velden | `menuProductIntegrationV2.test.js`, `menuProductGuardsV2.test.js`, `menuProductV2Surface.test.js`, `menuConceptV2ReviewHandlers.test.js`, `sourceWorkqueueV2.test.js` | v2-velden (glas/fles, supplementen, allergenen, bewijs, dekking) worden getoond of vóór elk effect geweigerd — nooit stil afgeplat |

### K4 — eindmatrix per criterium

De eindstand per criterium 1–13 staat in “Actuele acceptatiematrix” hieronder,
met per criterium de eindstatus (gehaald / begrensd / verschoven naar BE-21 /
open), het bewijs met commit en de bewijscategorie (T/R/B/I). Prijsvarianten
staan daar expliciet als **begrensd** met de reden: het deterministische concept
ondersteunt één prijs per gerecht; de varianten worden wél bewaard
(`priceVariants`, `priceText`) en als blokkade gemeld, maar niet als losse
prijzen opgeslagen. Uitbreiding vergt een beoordeeld versiegebonden
schema-ontwerp (Product Owner) — geen stille afplatting.

### K5 — voortgang per criterium

`ops/benchmark/output/criteria-progress.json` bevat per criterium (K1–K5) een
regel met status en bewijs. Dat pad staat volgens de BE-21-afspraak in
`.gitignore` (gegenereerde benchmarkoutput) en wordt daarom niet gecommit; de
inhoud staat hierboven en in de checkpoint op PR #60.

## Ronde 2026-10-22 — Pellens-kaartvormen generiek hersteld (review 6334231310)

Aanleiding: de Lead stelde vast dat de referentie van Pellens consequent de
bronvorm volgt (naam als losse tekst, omschrijving in een `span`) en dat de 0
matches uit vier extractiefouten kwamen. Deze ronde herstelt die vier klassen
**generiek** — zonder domein, restaurantnaam, gerechtnaam of vast aantal — en
begrenst wat aantoonbaar niet kan. Referenties, telregels, captures en meetcode
zijn **niet** gewijzigd; er is geen slaande test verwijderd.

### Uitkomst naast elkaar (zelfde referenties, zelfde telregels)

| Bron | Ref | Match oud → nieuw | Gemist oud → nieuw | Verzonnen oud → nieuw | Prijsfouten oud → nieuw | Rubriekfouten oud → nieuw |
| --- | ---: | --- | --- | --- | --- | --- |
| Zuyd | 36 | 34 → 34 | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 |
| Andalous | 87 | 81 → 81 | 3 → 3 | 0 → 0 | 0 → 0 | 3 → 3 |
| Pellens | 36 | 0 → **24** | 32 → **12** | 23 → **2** | 0 → 0 | 4 → **0** |
| Chocolat | 26 | 26 → 26 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| **Totaal (4 gemeten)** | **185** | **141 → 165** | **37 → 17** | **23 → 2** | **0 → 0** | **7 → 3** |
| Precisie / recall | | 82,46% → **97,06%** | | | | 76,22% → **89,19%** |

Geen bron verliest een match; Zuyd, Andalous en Chocolat blijven gelijk in
uitkomst. De meting is deterministisch: tweemaal uitgevoerd op dezelfde
vastgezette bytes met identieke SHA-256 (`reference-measurement.json`
`cf38be89d7591487e4dfdd96d7cd5131f072c6c70839792621bfedcaadab0864`,
`reference-measurement.md`
`ab333f1774274e5a7fab210fc47a63f9e6e0c18aa41c0fac0fb6581d7a9edc02`).

### Per foutklasse: criterium 8

| # | Klasse (review 6334231310) | Generieke regel in de code | Bewijs (fictieve fixture) | Status |
| --- | --- | --- | --- | --- |
| K1 | Naam en omschrijving samengevoegd: `Hamachidruif, prei`, `Uioude kaas`, en daardoor ook `2 gangenvoor- en hoofdgerecht` | `splitInlineHead`: een rij-/termcel waarvan de eerste tekstnode de naam is en één inline kind (`span`, `em`, …) de omschrijving, houdt beide apart; geldt voor `th`, `dt` en `li`. Een prijs in één van beide helften, een tweede inline element of tekst ná de omschrijving splitsen niet (fail closed). Een `dl` met twee of meer `dt`-paren is een lijst gerechten, geen enkel gerecht | `menuExtractionCardShapeRepairs.test.js` K1 (5 tests) | **opgelost**, met één begrenzing: twee inline kinderen blijven samengevoegd |
| K2 | Paginatitel `Welkom bij …` werd menutitel en de tablaag Lunch/Diner viel weg | Een kop die exact de `aria-label` is van het omringende element (`<section aria-label="Onze kaart"><h2>Onze kaart</h2>`) vervangt de paginatitel alleen wanneer er niets anders dan die paginatitel boven staat; een gelabeld tabblad (`role="tab"` + `aria-controls`) wordt een padniveau en de route wordt na het paneel exact hersteld | `menuExtractionCardShapeRepairs.test.js` K2 (3 tests) | **opgelost** |
| K3 | De verborgen tweede weergave (vijf keer "Brioche") werd als extra gerechten geteld | Verborgen = `hidden`, `aria-hidden="true"`, inline `display:none` of een onvoorwaardelijke `display:none`-regel in de eigen stylesheet (id/klasse/attribuut, `>`, `:not()`, `:has()`); nooit een `@media`-blok. Een verborgen sectie telt één keer **alleen** wanneer de zichtbare kant aantoonbaar dezelfde bedragen draagt; anders blijft ze staan en verschijnt een beperking. Een tabpaneel is een variant, nooit een duplicaat | `menuExtractionCardShapeRepairs.test.js` K3 (6 tests) | **opgelost**, fail-closed begrensd |
| K4 | De gangen van de Formule du Jour werden losse gerechten (`2 gangen` €45,00) | Een regel met een arrangement-/gang-eenheid in een benoemde sectie wordt als arrangement geweigerd; de sectie verschijnt met reden `service_unit` en een eigen beperkingstekst in plaats van losse gerechten | `menuExtractionCardShapeRepairs.test.js` K4 (1 test) | **opgelost** |

### Wat bewust begrensd blijft (met bewijs)

- **Tien van de twaalf resterende gemiste Pellens-regels zijn prijsvarianten**
  (`Klein`/`Hoofd` per gerecht). Het schema ondersteunt één prijs per gerecht;
  dit blijft de bestaande, expliciete beperking met eigen tekst
  (“10 gerecht(en)/regel(s) met meerdere prijzen …”) en vraagt een
  schema-ontwerp, geen gok. De Lead accepteerde deze klasse eerder als begrensd.
- **Twee referentieregels wijken af van de nieuwe, strikte scheiding.** De bron
  schrijft `<dt>Ui<span>oude kaas</span></dt>` en
  `<dt>Wagyu A5<span>Miyazaki</span></dt>`; K1 leest daar "Ui" + "oude kaas" en
  "Wagyu A5" + "Miyazaki", terwijl de referentie "Ui oude kaas" en
  "Wagyu A5 Miyazaki" als naam vastlegt. Dat is **niet** met brongerichte code
  of een referentiewijziging opgelost: het staat als 1 gemist + 1 verzonnen per
  regel in de meting en is een expliciet beslispunt voor de Delivery Lead.
- **Het verborgen duplicaat is geen stille weglating.** De analyse meldt
  “een verborgen tweede weergave van dezelfde kaart is één keer geteld; 10
  gerecht(en) zijn niet dubbel opgenomen”. Verborgen inhoud zónder zichtbare
  tegenhanger blijft opgenomen en wordt als controlebehoeftig gemeld.
- **Zijbevinding, gevonden door de goedgekeurde bronproef opnieuw te draaien:**
  de portie-regel uit `1b22121` kapte een bronnaam af. Blossem noteert
  `<li>Pata negra | 80 gram <strong>17.0</strong></li>`; de extractie maakte
  daar "Pata negra" van (1 gemist, 1 verzonnen) terwijl de referentie
  "Pata negra | 80 gram" telt en de vorige 43/43-meting van vóór `1b22121`
  stamde. Generiek hersteld: een portie achter een expliciet scheidingsteken
  (`|`, `/`, `-`, `:`, `·`) hoort bij de bronnaam en blijft staan; een portie
  die direct aan de naam vast zit ("… 90 gram") blijft een portiegrootte.
  Nieuwe meting: **Smelt 37/37 en Blossem 43/43**, regressie
  `menuExtractionCardShapeRepairs.test.js` (“a portion behind an explicit
  separator stays part of the source name”).
- **Uijttewaal en de overige representatieve bronnen zijn niet opnieuw
  gemeten**: de opdracht betrof de vijf vastgezette referenties en de
  goedgekeurde Smelt/Blossem-proef. De vorige, eerlijke stand (Uijttewaal
  10 → 6 op een gewijzigde bronversie) blijft van kracht en is niet mooier
  gemaakt.

### Overig bewijs in deze ronde

- `npm test`: **2322/2322** groen (inclusief de 16 nieuwe regressies K1–K4 en
  het naambehoud).
- `npm run test:menu-structure`: **6/6** groen; `npm run build`: **exit 0**,
  41/41 pagina's; `node ops/scripts/verify-pdfjs-server-trace.js`: **OK**
  (166 server scripts, `pdf.mjs` + `pdf.worker.mjs` getraceerd, geen gebundelde
  PDF.js-runtime). De goedgekeurde read-only bronproef
  (`probe-menu-extraction-sources.js --source=all`) geeft **Smelt 37/37** en
  **Blossem 43/43** op dezelfde bytes (`bytesSha256Matches: true`).
- De CSS-hidinglezer is lineair: de corpus-test met een 2 MB `<style>`-payload
  blijft binnen de werkbudgetgrens (`ops/benchmark/htmlMenuStructure.test.js`).
- Status: **ontwikkelaarsbewijs**. Geen onafhankelijke review, geen provider,
  geen productie, geen publicatie en geen merge.

## Ronde 2026-10-21 — generiek extractieherstel (review 6323277596)

Aanleiding: de gecontroleerde meting (pin `d4413783…` op basis `861b07d`) liet
bekende foutklassen zien. Deze ronde **herstelt elke klasse generiek** waar dat
zonder brongerichte code kan en **begrenst de rest zichtbaar**, met de reden.
Er is geen voorwaarde op domein, restaurant, gerechtnaam of vast aantal
toegevoegd; de referenties, telregels en meetcode zijn **niet** gewijzigd en er
is geen fixture of slaande test verwijderd.

### Uitkomst naast elkaar (zelfde referenties, zelfde telregels)

| Bron | Ref | Match oud → nieuw | Gemist oud → nieuw | Verzonnen oud → nieuw | Prijsfouten oud → nieuw | Rubriekfouten oud → nieuw |
| --- | ---: | --- | --- | --- | --- | --- |
| Zuyd | 36 | 23 → **34** | 11 → **2** | 0 → 0 | 2 → **0** | 0 → 0 |
| Andalous | 87 | 77 → **81** | 8 → **3** | 2 → **0** | 0 → 0 | 2 → 3 |
| Pellens | 36 | 0 → 0 | 32 → 32 | 23 → 23 | 0 → 0 | 4 → 4 |
| Chocolat | 26 | 20 → **26** | 2 → **0** | 0 → 0 | 0 → 0 | 4 → **0** |
| **Totaal (4 gemeten)** | **185** | **120 → 141** | **53 → 37** | **25 → 23** | **2 → 0** | **10 → 7** |
| Precisie / recall | | 76,43% → **82,46%** | | | | 64,86% → **76,22%** |

Eerlijk benoemd, ook waar het cijfer niet beter wordt:

- **Andalous rubriekfouten 2 → 3.** `Gamba croquettes` was eerst *gemist* en is
  nu wél geëxtraheerd met de juiste prijs, maar blijft onder de bron-`h4`
  hangen (`Warme voorgerechten > Visgerechten`) terwijl de referentie
  `Visgerechten` als kopniveau telt. Dat is dezelfde rubric-oorzaak als bij
  `Pil Pil` en blijft begrensd (zie klasse 7).
- **Pellens blijft 0 match** (zie klasse 8). Er is geen stille verbetering
  gesuggereerd: de klasse is begrensd en de reden staat hieronder.
- De meting is deterministisch: tweemaal uitgevoerd op dezelfde vastgezette
  bytes, met identieke SHA-256 (`reference-measurement.json`
  `3b9cad2673968aca6cde6188e747e18bdb25187f1a3012caf7204138bddde6d4`,
  `reference-measurement.md`
  `74df676a4677b3228ace45cd859d5ce924648b11fb66c77a33755b052c6bbbc4`).

### Per foutklasse: oorzaak, herstel of begrenzing, bewijs

| # | Klasse (meting) | Werkelijke oorzaak in de code | Herstel of begrenzing | Bewijs (fictieve fixture) | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Titel die eindigt op een `<br>` binnen het bold-element: Zuyd `Ossenhaas`, `Eendenlever`, `Lobster roll`, `Sandwich Zuyd`; Andalous linkerkolommen (`Pasta zalm/funghi/bolognese`, `Gamba croquettes`, `Kip loempia's`) | `inlineLines`/`splitLines` platten een inline element met een `br` tot losse tekst; daardoor verdween de bold-ankerstatus en besliste alleen een kapitalisatiegok of iets een titel was. Een titel met een kleine letter in de tweede woord ging verloren en de volgende regels werden bij het vorige gerecht getrokken (Zuyd `Zeetongfilet` kreeg 28,00 in plaats van 39,00) | `inlineLineHead` houdt de elementidentiteit (tag/attrs) voor de tekst vóór de regelbreuk; de blokgrens blijft dezelfde | `menuExtractionRepair.test.js` A1 en A2 | **opgelost** |
| 2 | Supplementclausule midden in de regel/alinea: Zuyd `Kaasgerecht ‘3 x Epoisses’` (17), Chocolat `STEAK TARTARE` en `SANDWICH CHOCOLAT`, Andalous `Geraspte kaas` (meerprijs) | Alleen een clausule aan het allerlaatste eind werd herkend en `supp.`/`meerprijs` waren geen marker; het supplementbedrag werd daardoor de hoofdprijs of het blok werd volledig geweigerd | `splitSupplementClause` splitst elke regel bij de eerste marker (`supplement`, `suppl.`, `supp`, `toeslag`, `meerprijs`); het bedrag **vóór** de clausule is de hoofdprijs, erna nooit; een blok dat zichzelf als `meerprijs` aanduidt is geen gerecht. De brontekst blijft in het citaat en `supplementText` in het bewijs | `menuExtractionRepair.test.js` B1 en B2 | **opgelost** |
| 3 | Legenda na een inline prijs: Zuyd `Oesterproeverij Deluxe` | Bulletregels (`○ …`) na de prijs verhinderden "prijs aan het eind" | Bullet-/legenderegels aan het eind van een blok worden vóór de prijsbeslissing gestript en blijven buiten de omschrijving | `menuExtractionRepair.test.js` C | **opgelost** |
| 4 | Latere `h1` voor één sectie: Chocolat 4 rubriekfouten (`NAGERECHTEN`) | Elke `h1` popte de vorige `h1`, waardoor de menutitel uit het pad verdween | De eerste `h1` is de menutitel; een latere `h1` wordt een sectie eronder | `menuExtractionRepair.test.js` D | **opgelost** |

| 5 | Meerdere prijzen per gerecht: Zuyd `Kaasassortiment` (13 / 19,50), Andalous `Mixed Grill Andalous` (27,50 / 48,50), Pellens klein/hoofd | De deterministische context slaat één prijs per gerecht op; varianten werden soms stil afgeplat of stil weggegooid | Nooit afgeplat: variantregels worden geweigerd **en geteld**; de analyse meldt expliciet "… met meerdere prijzen (prijsvarianten …) zijn niet als losse prijs opgeslagen; de deterministische context ondersteunt één prijs per gerecht en er is geen prijs geraden." Zichtbaar in de beperkingen van Zuyd (1), Andalous (1) en Pellens (5) | `menuExtractionRepair.test.js` E1 en E2 | **begrensd** (zichtbaar); uitbreiding vergt een beoordeeld versiegebonden schema-ontwerp |
| 6 | Eén gerecht in een eigen container: Andalous `Loaded Fries Scampi`, kindermenu-`Grillburger Andalous` | De blokrun accepteert bewust pas vanaf twee prijsblokken in dezelfde container (faal-gesloten) | Bewust niet verruimd: één los blok blijft geweigerd, zodat proza geen gerecht wordt. Blijft als gemist gemeten | bestaande faal-gesloten tests (`htmlMenuFormattedBlocks.test.js`) blijven groen | **begrensd** (niet ondersteund zonder beoordeelde ontwerpwijziging) |
| 7 | Geneste `h4` onder `h3`: Andalous `Visgerechten` (3 rubriekfouten) | De markuphiërarchie (`h4` onder `h3`) is leidend; de bron toont de kolom visueel op kopniveau | Niet afgeplat of geraden; blijft een rubriekfout | `menuExtractionRepair.test.js` D toont dat het titelniveau wél klopt; deze klasse niet | **begrensd** (bronhiërarchie is niet eenduidig) |
| 8 | Pellens: paginatitel, Lunch/Diner-tabs, `<dt><span>`-namen en een verborgen tweede weergave | De referentie splitst dezelfde `<dt><span>`-vorm niet consistent (`Hamachi` zonder subtitel, maar `Ui oude kaas` en `Wagyu A5 Miyazaki` mét), en de pagina zet `Welkom bij Pellens` boven `Onze kaart` terwijl de referentie `Onze kaart` als menutitel gebruikt. Een generieke regel zou hier de bron moeten gokken | **Niet** gegokt en de referentie niet aangepast; de klasse blijft zichtbaar teleurgesteld (0 match, 23 verzonnen). Dit vraagt een referentie-/productbeslissing van de Lead, geen stille codefix | meting `reference-measurement.md` §Pellens | **begrensd**; expliciet beslispunt voor de Delivery Lead |
| 9 | PDF-prijs zonder naam: Andalous `€` 39,50 | Een prijsregel zonder bruikbare naam werd als gerecht opgeslagen | Een naam met minder dan twee letters is geen gerecht; de regel telt als ongekoppelde prijsregel en blijft zichtbaar in de beperking | `menuExtractionRepair.test.js` F | **opgelost** |

### Holdout-2 en representatieve hermeting (eerlijk vergeleken)

De eenmalige holdout-2-evaluatie (`82eba8f`, SHA-256 `45098d76…`) is
`used_for_tuning` en **create-only**: de eigen state machine weigert een tweede
"holdout"-evaluatie en de bytes zijn niet lokaal vastgezet. Opnieuw draaien
"als holdout" zou daarom oneerlijk zijn en is niet gedaan. In plaats daarvan is
de **representatieve hermeting** op dezelfde 19 bronnen gedraaid met dezelfde
tooling (`measure-menu-extraction-representative.js`), met de bronversie per
bron:

| Uitkomst | Voor (`82eba8f`) | Na |
| --- | --- | --- |
| HTML-groep: bronnen / items / secties | 5 / 296 / 45 | 8 / 418 / 65 |
| Bewijs: sourceId / locator / support | 100% / **41%** / 41% | 100% / **100%** / 100% |
| Geblokkeerd (eerlijk, geen lege kaart) | 4 | 7 |
| Geen menu gevonden | 10 | 4 |

Per bron (items voor → na): Chocolat 0 → 12, Andalous 0 → 84, Dolce e Salato
31 → 41, Klein Java 0 → 20, Pellens 27 → 27, Trattoria Perron 156 → 156 (locator
0% → 100%), Zenza 72 → 72, **Uijttewaal 10 → 6**, de overige bronnen blijven 0
(geblokkeerd of geen menu). Uijttewaal is een **echte verslechtering op een
gewijzigde bronversie** (`sourceVersionMatches: false`): de telstand toont 4
ongekoppelde prijsregels extra naast 4 items minder. De enige PDF-wijziging in
deze ronde is de regel dat een naam zonder letters geen gerecht is, dus de
verklaring is dat de verdwenen "items" prijsfragmenten zonder naam waren; exact
bewijs ontbreekt omdat noch de oude noch de nieuwe bytes lokaal vastgezet zijn.
Dit is als beperking gemeld, niet weggepoetst.

### Overig bewijs in deze ronde

- `npm test`: **2306/2306** groen (inclusief de 9 nieuwe regressies per klasse).
- Eén bestaande verwachting is bewust aangescherpt: de N5-fixture
  "Fictieve kaas - 17 - … supplement 8,50" is nu **wel** een gerecht met 17
  (review 6323277596). Het supplement blijft bewijs en wordt nooit een prijs;
  de negatieve assertie dat 8,50 geen gerechtprijs is blijft staan. Er is geen
  fixture of slaande test verwijderd.
- Status: **ontwikkelaarsbewijs**. Geen onafhankelijke review, geen provider,
  geen productie, geen publicatie en geen merge.

## Ronde 2026-10-21 — vijf gecontroleerde referenties (review 6318225879)

Deze ronde voegt **gecontroleerde referenties voor vijf bronnen** toe en meet de
huidige code op **exact de vastgezette bytes**. De referenties zijn uit de
brontekst opgesteld, niet uit de parseruitvoer; iedere referentieregel heeft een
rubriekpad, een citaat of locator en (voor een gerecht) een prijs of
prijsvarianten. De telregels zijn vooraf gepind in
[menu-extraction-reference-counting-rules.md](menu-extraction-reference-counting-rules.md)
(SHA-256 `0f09b74f…f09c`).

### Vastgezette bronversies

| Bron | Status | Vastgelegd | SHA-256 (verkort) |
| --- | --- | --- | --- |
| Zuyd | gelezen | home, lunch, diner, kerstmenu, Zuyd voor Thuys, nieuws | `f4f685da725f`, `389470158b72`, `128cae10ca14`, `2bfaf63e7814`, `644810dfc971`, `c9c130c079b7` |
| Andalous | gelezen | home, menukaart, ramadan-menu (incl. redirect), thuisbezorgd, werken, Ramadan-PDF, /fr/ramadan-menu | `8c2fb5e31c5f`, `93b11284b922`, `69b1011c0777`, `1faa547bd4b3`, `a22fb64af8d9`, `a469bf6ab62b`, `9a32541b2a5a`, `521e389ce669` |
| Pellens | gelezen | één pagina met lunch/diner-tabs en verborgen tweede weergave | `66f57e267289` |
| Chocolat | gelezen | home, menu, lunch, diner, cadeaubon, arrangementen | `186958b4753f`, `0754bdd2f6ca`, `4ac64c425f1c`, `7122b5d1c92b`, `3acbf4874eed`, `a35ee43d2d68` |
| Senang Makan | **geblokkeerd** | robots.txt gaf HTTP 503; niets opgehaald | geen bytes; reden vastgelegd |

De bytes staan lokaal en gitignored onder
`ops/benchmark/output/reference-captures/`; in Git staan alleen URL,
content-type, tijd, bytegrootte en SHA-256
(`ops/benchmark/reference-captures.json`). Senang Makan is **geen lege of
geslaagde extractie**: de veilige route kon de publieke bron niet lezen en er is
geen alternatieve URL of omzeiling gebruikt.

### Meetresultaat (huidige code op de vastgezette bytes)

| Bron | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Zuyd | 36 | 25 | 23 | 11 | 0 | 2 | 0 | 92,00% | 63,89% |
| Andalous | 86 | 81 | 77 | 7 | 2 | 0 | 2 | 95,06% | 89,53% |
| Pellens | 23 | 27 | 0 | 19 | 23 | 0 | 4 | 0,00% | 0,00% |
| Chocolat | 26 | 24 | 20 | 2 | 0 | 0 | 4 | 83,33% | 76,92% |
| **Totaal (4 gemeten)** | **171** | **157** | **120** | **39** | **25** | **2** | **10** | **76,43%** | **70,18%** |

Senang Makan is geblokkeerd en telt niet mee in de totalen. De vier foutsoorten
staan afzonderlijk in `reference-measurement.json` en
`reference-measurement.md`, met per afwijking het item, het rubriekpad en het
broncitaat; bij een verzonnen rij staat de passage of locator die de extractor
zelf gaf, of expliciet “geen bronpassage”. De meting is deterministisch en
herhaalbaar op dezelfde bytes
(`node ops/scripts/measure-menu-extraction-references.js`); er is geen netwerk-,
provider- of database-oproep in de meetroute.

Belangrijkste bevindingen, zonder ze weg te poetsen:

- **Zuyd** mist beide sandwiches en vier à-la-cartegerechten per menuvariant;
  `Zeetongfilet` krijgt 28,00 in plaats van 39,00. De parser leest de
  arrangementen niet als gerecht (goed), maar mist ook losse gerechten.
- **Andalous** mist zeven gerechten (o.a. drie pasta's, de Mixed Grill met twee
  varianten, de kindergrillburger en de kip-loempia's), voegt `Geraspte kaas` als
  gerecht toe (het is een meerprijs) en zet de visgerechten onder
  `Warme voorgerechten > Visgerechten` in plaats van `Visgerechten`.
- **Pellens** is de zwaarste uitkomst: de parser plakt namen en beschrijvingen
  aan elkaar (`Entrecôtezwarte knoflook`), leest de verborgen tweede weergave
  als extra gerechten en laat het lunch/diner-onderscheid weg. Dat levert 0
  exacte matches, 19 gemiste en 23 verzonnen rijen. Dit is een echte
  structuur-/naamfout, geen referentiefout.
- **Chocolat** mist `STEAK TARTARE` en `SANDWICH CHOCOLAT`; de vier
  diner-nagerechten krijgen geen `DINERKAART CHOCOLAT`-pad.
- **Senang Makan** is niet gemeten; HTTP 503 op robots.txt is een bronblokkade,
  geen nul-gerechten-succes.


### Bewijs op deze ronde

- **Codehead `346acb0c361c2f919d6b095d7e4c4a11643a9854`** (afbeeldingsroute en
  documentatie); de referentietooling staat in `c093d1d`.
- **`npm test`:** 2288/2288 geslaagd.
- **`npm run test:menu-structure`:** 6/6 geslaagd.
- **`npm run build`:** geslaagd, 41/41 statische pagina's.
- **PDF.js serverpackagingcheck:** OK (166 server scripts; `pdf.mjs` en
  `pdf.worker.mjs` getraceerd).
- **Browserfixture:** 293/293 op een schone worktree op `346acb0`; 41
  screenshots, inclusief de afbeeldingsroute op 390 px licht en 320 px donker en
  de klik naar Bronnen beoordelen. Evidence:
  `ops/browser/evidence/menu-review-browser-evidence.json`.
- **Meetroute:** deterministisch; hetzelfde script op dezelfde bytes gaf
  tweemaal een byte-identiek rapport.

De vastgezette bytes staan in deze clone onder
`ops/benchmark/output/reference-captures/` (gitignored). De Delivery Lead kan die
map naar dezelfde relatieve locatie in de acceptatie-checkout kopiëren om iedere
hash, quote en meting onafhankelijk te herhalen; zonder die bytes is alleen de
metadata controleerbaar, niet de referentietekst.

### Afbeeldingsmenu: expliciete status en menselijke route

Een menu dat alleen als afbeelding of scan bestaat, krijgt in de batch de
expliciete status **“Menu alleen als afbeelding: niet ondersteund”**. Er is geen
succesmelding, geen bevestigknop en geen stille uitval. De vervolgstap
**“Bronnen beoordelen”** opent de bestaande brontriage met het restaurant en de
reden in de URL; daar kan een medewerker een andere tekst- of pdf-bron voorstellen
of de bron als onbruikbaar markeren. De reden blijft op die pagina zichtbaar.
Dit is met regressies en een browserfixture bewezen (390 px licht en 320 px
donker). **Geen van de vijf vastgezette bronnen bleek een afbeeldingsmenu**: de
route is daarom met een fictieve fixture bewezen, niet met een echte
afbeeldingsbron. Senang Makan is geblokkeerd, niet afbeeldings-only.

### Herstelronde 2026-10-21 — Lead-review 6319894232 (R1–R5)

Basis: `ec4b20cceac9a514e50bd7bb4abd41baac16efda`. De vijf bevindingen zijn
hersteld **zonder** de telregels, de meetcode of de extractie te wijzigen en
**zonder nieuwe fetch**: alle referentiewijzigingen komen uit dezelfde
vastgezette bytes (dezelfde SHA-256 per capture).

| Bevinding | Herstel | Bewijs uit de vastgezette bytes |
| --- | --- | --- |
| **R1 Pellens** | 13 à-la-cartegerechten van het dinerpaneel toegevoegd: `À la carte › Pellens` (6), `Groenten` (6) en `Dessert` (1), met dezelfde prijsvarianten (o.a. Langoustine 23,00/38,00 en Wilde eend 24,00/39,00). De onjuiste beperking "de diner-tab bevat alleen arrangementen" is vervangen. | Regressie eist dat elke dinerquote **binnen** `id="kaart-diner"` staat en dat de lunchrijen ernaast blijven bestaan (telregel 5: twee rubrieken = twee items). |
| **R2 Andalous** | `Loaded Fries Scampi` (€17,00) toegevoegd onder `Hoofdgerechten*`; de locator noemt de h4-subrubriek `Visgerechten` die de bron daar toont. | Regressie bewijst dat het gerecht tussen de koppen `Hoofdgerechten*` en `Pasta's` staat, dus in dat blok en niet in het eerdere `Visgerechten`. |
| **R3 Zuyd** | De wijnarrangement- en ½-glasprijzen van de verrassingsmenu's toegevoegd als arrangementprijzen: 32/22, 40/27,50, 48/33 en 56/38,50. | Regressie controleert elk bedrag in de diner-capture en dat er geen gerecht van wordt gemaakt. |
| **R4 detail** | De batchreden staat nu in het detail van precies het restaurant dat de link noemt: reden, betekenis en een passende vervolgstap. De generieke route blijft als secundaire regel zichtbaar; de banner is alleen nog de terugvalroute zonder precies restaurant. | Browserfixture: reden en vervolgstap in `.stg-followup`, geen banner ernaast, klikpad `image-only result -> Bronnen beoordelen` geslaagd. |
| **R5 reden** | Bij "Bron markeren als onbruikbaar" wordt de bestaande reden `other` voorgeselecteerd, met een vaste, zichtbare en verplichte toelichting. **Geen nieuwe DB-waarde, geen migratie en geen versoepeling.** | Fixture leest `reason=other`, `aria-required="true"`, de ingevulde toelichting en een `aria-describedby` naar de uitleg. |

Meting na herstel (zelfde code, dezelfde bytes, alleen de referenties hersteld):

| Bron | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Zuyd | 36 | 25 | 23 | 11 | 0 | 2 | 0 | 92,00% | 63,89% |
| Andalous | 87 | 81 | 77 | 8 | 2 | 0 | 2 | 95,06% | 88,51% |
| Pellens | 36 | 27 | 0 | 32 | 23 | 0 | 4 | 0,00% | 0,00% |
| Chocolat | 26 | 24 | 20 | 2 | 0 | 0 | 4 | 83,33% | 76,92% |
| **Totaal (4 gemeten)** | **185** | **157** | **120** | **53** | **25** | **2** | **10** | **76,43%** | **64,86%** |

Verschil met de vorige meting: Zuyd 36/23/11/0/2/0 → ongewijzigd (de
arrangementprijzen tellen niet als gerecht), Andalous 86→87 referenties en
7→8 gemist, Pellens 23→36 referenties en 19→32 gemist, totaal 171→185
referenties en 39→53 gemist. **De uitkomst werd slechter; dat is niet
bijgestuurd.** Er zijn geen extractieverbeteringen gedaan om de score te
herstellen — dat is een aparte opdracht na deze herstelronde.

### Bewijs op deze herstelronde

- **Codeheads:** referenties en meting `175f253`; UI-herstel R4/R5 `6f7bedf`;
  fixture-screenshots `cac67ab`. De meting blijft deterministisch: tweemaal
  hetzelfde rapport (`reference-measurement.json` SHA-256 `d4413783…4d70f`,
  `.md` `e6744877…fe22`).
- **`npm test`:** 2297/2297 geslaagd op `cac67ab`. Een eerste volledige run had
  één niet-gerelateerde flake (`ops/scripts/capture-market-boundary.test.js`,
  Docker/omgeving); dat bestand slaagt op dezelfde head afzonderlijk met 25/25
  en de herhaalde volledige run is groen. Dat is een omgevingsflake, geen
  groenverklaring achteraf.
- **`npm run test:menu-structure`:** 6/6 geslaagd.
- **`npm run build`:** geslaagd, 41/41 statische pagina's.
- **PDF.js serverpackagingcheck:** OK (166 server scripts; `pdf.mjs` en
  `pdf.worker.mjs` getraceerd).
- **Browserfixture:** 303/303 op een schone worktree op `cac67ab`, 42
  screenshots en 4 klikpaden; de nieuwe checks dekken de reden en de
  vervolgstap in het detail, de voorgeselecteerde reden, de verplichte
  toelichting en dat de keuze zelf niets opslaat. Evidence:
  `ops/browser/evidence/menu-review-browser-evidence.json`.

### Status per #59-acceptatiecriterium in deze ronde

“Verschoven” betekent hier: expliciet naar BE-21 of een latere beslissing, niet
stil geschrapt.

| # | Criterium (verkort) | Status | Bewijs / reden |
| ---: | --- | --- | --- |
| 1 | Protocol en schema versiegebonden; ontbrekende configuratie stopt concreet | **gehaald** | `MENU-EXTRACTION.md` v0.3 met SHA-256; `menuExtractionProtocol`-regressies blijven groen. Sinds review 6375125413 is de citatenregel in paragraaf 4 letterlijk en aaneengesloten voorgeschreven (Q3); de validator is niet versoepeld |
| 2 | URL → lezen → extractie → menselijke correctie → conceptopslag met broncontext | **gedeeltelijk** | Bestaande keten en fixture bewijzen de vorm; geen echte Supabase-sessie of conceptopslag in deze ronde |
| 3 | Smelt: echte PDF-inhoud, 0 items is geen succes, gerechten/prijzen/dekking vergeleken | **gehaald in eerdere ronde** | 37/37 referentierijen op de gepinde PDF; deze ronde meet Smelt niet opnieuw |
| 4 | Blossem: lunch/diner, rubrieken en items volgens de bron; onzekerheid reviewbaar | **gehaald in eerdere ronde** | 43/43 op de gepinde HTML; deze ronde meet Blossem niet opnieuw |
| 5 | Bestaande kaarten (Wolfslaar, Bardot, Zuyd, T-Huis) tegen gecontroleerde bronnen | **gedeeltelijk** | Zuyd heeft nu een gecontroleerde referentie en meting (23/36 match, 11 gemist, 2 prijsfouten); de andere drie blijven historische vormregressie zonder nieuwe referentie. *Stand van die ronde; de actuele stand per kaart staat in de ronde 6347355753 hierboven en in "Actuele acceptatiematrix".* |
| 6 | Representatieve set plus een aparte ongeziene set; eerlijke beperking per klasse | **gedeeltelijk / verschoven** | Vijf gecontroleerde bronnen toegevoegd; een nieuwe ongeziene holdout bestaat niet en gaat naar BE-21 |
| 7 | Dataset, referentie-uitkomsten en meetbare drempels vóór implementatieacceptatie | **gedeeltelijk** | Referenties, telregels en een deterministische meting bestaan; de brede 50–100-bronnenbenchmark en vrijgavedrempels blijven BE-21 |
| 8 | Gemiste/verzonnen items, prijsfouten, structuurverlies, bewijsdekking, correctiewerk, tijd en kosten per brontype | **gedeeltelijk** | Vier foutsoorten per bron en totaal zijn gemeten; menselijke correctietijd en kosten zijn onbekend (geen provider); scan-/afbeeldingsklasse alleen als fixture |
| 9 | Browseracceptatie met klikpaden, rollen, leeg/fout/partieel, toetsenbord, licht/donker, 320/390 px | **gedeeltelijk** | Nieuwe afbeeldingsroute is in de fixture op 390 px licht en 320 px donker getest; na het herstel ook het detail met reden en vervolgstap en de voorgeselecteerde reden (samen 303/303). De bestaande suite dekt de overige paden. Geen echte authenticated browseracceptatie |
| 10 | Time-out, provideruitval, ongeldige uitvoer, limieten, herimport, gelijktijdige taken, promptinjectie, verkeerde vestiging, onveilige redirects | **gedeeltelijk** | Eerder bewezen met regressies; deze ronde herhaalt die set niet en voegt geen provider toe |
| 11 | Geen stil dataverlies tussen extractie, receipt, review, concept en export | **gedeeltelijk** | De afbeeldingsstatus is expliciet en blokkeert een schijnsucces; de v2-read-onlygrens blijft ongewijzigd; geen echte schrijfketen getest |
| 12 | Geen regressie in rollen, bronbevestiging, audit, publicatiegates, beveiliging of geheimenbeheer | **gehaald (ontwikkelaarsbewijs)** | `npm test` 2288/2288 en build 41/41 op codehead `346acb0`; geen productiecredentials gebruikt |
| 13 | Onafhankelijke review met exacte commit, checks, versies, resultaten en beperkingen | **verschoven** | De Delivery Lead moet deze ronde nog onafhankelijk beoordelen; groene tests zijn geen productacceptatie |


- Geen extractieverbeteringen om de referentiescore te verhogen; dat is een
  aparte opdracht na de review van de Delivery Lead.
- Geen OCR, geen provider, geen app-AI, geen productie, geen publicatie en geen
  merge.
- Geen nieuwe bronnen buiten de vijf en geen #56-werk.
- De vijf referentiebronnen zijn **geen ongeziene holdout**: ze zijn juist
  bedoeld om op bij te sturen.

### Verschuivingen naar BE-21 (concreet, niets stil geschrapt)

De volgende eisen gaan expliciet naar
`planning/specs/tickets/be-21-restaurant-source-extraction-vendor-benchmark.md`
en worden daar als openstaand vastgelegd:

1. De brede, onafhankelijke benchmark over 50–100 bronnen, inclusief de zes
   verplichte bronnen.
2. Een nieuwe, nog ongeziene holdoutset; de vijf referentiebronnen tellen daar
   niet voor.
3. De OCR-/browser-rendering-vendorvergelijking met DPA, EU-verwerking,
   retentie/no-training en een kostenplafond.
4. Kosten, latency en menselijke correctietijd per brontype over die bredere set.
5. De echte scan-/afbeeldingsklasse op schaal; deze ronde levert alleen de
   route en een fixture, geen echte afbeeldingsbron.
6. Keten-/vestigingsvariatie, meertaligheid en arrangementen op schaal buiten
   deze vijf bronnen.

Deze ronde **sluit BE-21 niet** en doet geen uitspraak over de beste vendor of
over alle websites.

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

### Eindstand criterium 1–13 (afrondingsronde review 6344039571)

Basis `abe42c5`, developerhead met bewijs `b1e4abc` (referentiecorrectie +
meeting) en de daaropvolgende documentatiecommit. Status: **gehaald** =
uitgevoerd en geslaagd op deze head; **gehaald, begrensd** = geslaagd binnen een
expliciet genoemd bereik; **begrensd** = bewust niet verder gebouwd; **verschoven
naar BE-21**; **open** = nog niet uitgevoerd of niet aantoonbaar.

| # | Criterium | Eindstatus | Bewijs met commit en categorie |
| --- | --- | --- | --- |
| 1 | Exact protocol en schema versiegebonden; ontbrekende configuratie stopt concreet | **gehaald** | `menuExtractionProtocol.test.js`, `menuExtractionAdapter.test.js` (14/14 op `b1e4abc`); loader levert v0.2 met vaste hash (inmiddels v0.3, zie de pin bovenaan); ontbrekende provider is een concrete weigering (`provider_not_configured`), nooit een lege “geslaagde” extractie — **T** |
| 2 | URL → lezen → extractie → menselijke correctie → conceptopslag met traceerbare broncontext | **gehaald, begrensd** | “SMELT-LIKE CHAIN” + de nieuwe K3-ketenregel (`restaurantSourceAnalysis.test.js`, 36/36 op `b1e4abc`); browserfixture 241/241 op `26839eb` (lijst → detail → terug, correctie, geblokkeerde opslag). Echte conceptopslag, bronbevestiging en een authenticated sessie zijn niet uitgevoerd — **T+B** |
| 3 | Smelt Breda: echte PDF-inhoud; gevonden PDF + 0 items is geen succes | **gehaald, begrensd** | Goedgekeurde read-only bronproef op deze head: PDF 2 pagina's, bytes `4445a101…27f8`, content `24f23cbd…8a845`, 37/37 referentierijen, 0 gemist/extra/prijs/koppeling/duplicaat, boekhouding 37/37; 7 supplementregels en 1 arrangement worden benoemd. Geen item-voor-item menselijke hercontrole — **R+T** |
| 4 | Blossem: lunch/diner, rubrieken en items volgens de echte bronrelaties; geen vast aantal | **gehaald, begrensd** | Bronproef: bytes `da5c632f…0c38`, 43/43 in 13 secties, 0 verschillen, DINNER/LUNCH gescheiden, 12 secties als onzeker gemarkeerd; 2 arrangement-/wijnarrangement-secties benoemd en niet opgeslagen — **R+T+B** |
| 5 | Bestaande kaarten Wolfslaar, Bardot, Zuyd, T-Huis; historische aantallen zijn geen waarheid | **gedeeltelijk, per kaart** | Bardot: gecontroleerde referentie uit de hash-geverifieerde dinerkaart-PDF (112 items, 29 rubriekpaden, 143 prijsbewijzen) en meting naast Zuyd (0/112 match, 76 gemist, 38 verzonnen, 36 rubriekfouten); Zuyd 34/36; Wolfslaar en T-Huis zijn bij de nieuwe poging **leesbaar** maar hebben nog geen referentie. Zie `docs/guides/menu-extraction-existing-cards.md` en `ops/benchmark/card-reference-measurement.json` (`b68f9760…`) — **R+T** |
| 6 | Vooraf vastgelegde representatieve set en aparte ongeziene holdout | **verschoven naar BE-21** | `acceptanceSet.test.js`, `acceptanceSetGuard.test.js`, `holdoutReferences.test.js`: 22 representatieve entries, 13 dekkingsklassen; De Botanist/Mr Moos/Colonia zijn `representative` + `usedForTuning`; Gauchos Breda is de enige holdout (404). Een nieuwe ongeziene set valt buiten deze afrondingsronde — **T+R** |
| 7 | Dataset, referentie-uitkomsten en meetbare drempels vóór acceptatie; BE-21's 50–100 niet met enkele URL's afgesloten | **gehaald, begrensd** | `manifest.json` `releaseThresholds` ongewijzigd (0 verzonnen, 100% bewijs, 0 onverklaarde dekking, 0 structuur-/prijsfouten); BE-21 blijft expliciet buiten #59 — **T** |
| 8 | Gemiste/verzonnen items, prijsfouten, structuurverlies, bewijsdekking, correctiewerk, tijd en kosten per brontype | **gehaald, begrensd** | Meting op `b1e4abc`: **167/185 match, 15 gemist, 0 verzonnen, 0 prijsfouten, 3 rubriekfouten, precisie 98,24% / recall 90,27%** (json `79a8b133…`, md `c21f6193…`, tweemaal identiek). **Prijsvarianten zijn begrensd**: 10 van de 15 missers zijn Pellens `Klein`/`Hoofd`; het deterministische concept ondersteunt één prijs per gerecht, de varianten worden bewaard (`priceVariants`, `priceText`) en als blokkade gemeld, nooit afgeplat of geraden — uitbreiding vergt een beoordeeld schema-ontwerp. Correctietijd en modelkosten blijven onbekend (€0, geen provider) — **R+T** |
| 9 | Browseracceptatie met klikpaden, rolgrenzen, leeg/fout/partieel, toetsenbord, licht/donker, 320/390 px | **begrensd** | `npm run test:browser:menu-review`: 241/241 checks, 33 screenshots, 2 clickpathinventories op codehead `26839eb` (SHA-256-bewijs `F5B2CD71…C583`). In deze ronde niet opnieuw gedraaid omdat er geen UI is gewijzigd; het blijft fixture-bewijs zonder live/staging-sessie — **B** |
| 10 | Time-out, provideruitval, ongeldige uitvoer, kosten-/paginagrens, herimport, gelijktijdige taken, promptinjectie, verkeerde vestiging, onveilige redirects | **gehaald, begrensd** | K2-tabel hierboven: adapter 14/14, fetch/host 77/77, batch/export 66/66, analyse 36/36, structuurcorpus 85/85 op deze head; één nieuwe regressie voor “verkeerde vestiging”. Alles offline/fixture — **T** |
| 11 | Geen stil dataverlies tussen extractie, receipt, review, concept en export; niet-ondersteunde velden geblokkeerd/gemeld | **gehaald, begrensd** | K3-tabel: nieuwe ketenregel bewijst benoemde supplementregel, bewaarde bedragen (`priceText`/`priceVariants`), blokkades `multiple_prices` + `unclear_category` en behoud van beide gerechten; export weigert geblokkeerde en v2-concepten vóór elk effect. Geen echte v2-rij in Supabase, geen live bronbevestiging — **T+B** |
| 12 | Geen regressie in rollen, bronbevestiging, audit, publicatiegates, beveiliging of geheimenbeheer | **gehaald, begrensd** | Op deze head: volledige suite **2324/2324**, `test:menu-structure` **6/6**, `npm run build` exit 0 met 41/41 pagina's, PDF.js-packagingcheck **OK** (166 server scripts), bronproef Smelt 37/37 + Blossem 43/43. Geen productiecredentials, productieauth of echte database gebruikt — **T+B** |
| 13 | Onafhankelijke review met exacte commit, checks, bron-/protocolversies, resultaten, beperkingen en volgende stap | **open** | Deze matrix en de checkpoint op PR #60 zijn ontwikkelaarsbewijs; de onafhankelijke beoordeling van deze head door de Delivery Lead staat nog open — **I** |

De tabel hieronder is de gedetailleerde bewijstabel van de vorige ronde en blijft
als historie staan; bij verschil geldt de eindstand hierboven. Let op: in die
historische tabel staat bij criterium 8 nog het open beslispunt over de twee
Pellens-referentieregels (`Ui oude kaas`, `Wagyu A5 Miyazaki`). Dat punt is in
deze afrondingsronde door de Lead beslist en verwerkt (zie K1); de bijbehorende
regels in de oude tabel zijn niet herschreven, zodat de rondehistorie klopt.

| # | Criterium | Bewijs op deze kandidaat | Type | Status | Resterend / impact | Volgende eigenaar |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Exact protocol en schema versiegebonden; ontbrekende configuratie stopt concreet | `menuExtractionProtocol.test.js`, `menuExtractionAdapter.test.js`, `acceptanceSet.test.js`; loader geeft v0.2 + vaste LF-hash (inmiddels v0.3, zie de pin bovenaan); ontbrekende/onversioned root en ontbrekende provider geven een concrete weigering | T | **bewezen** | Geen provider geconfigureerd, dus alleen offline bewezen | Developer |
| 2 | URL → lezen → extractie → menselijke correctie → conceptopslag met traceerbare broncontext | `restaurantSourceAnalysis.test.js` (SMELT-LIKE CHAIN), `menuConcept.test.js`, `batchAnalysisHandlers.test.js`; browserfixture toont resultaat, review, correctie en geblokkeerde conceptopslag | T+B | **bewezen met beperking** | Echte conceptopslag, bronbevestiging en een live sessie zijn niet uitgevoerd; de fixture bewijst geen Supabase-schrijfsessie | Product Owner/ops voor live toegang; developer voor de resterende keten |
| 3 | Smelt Breda: echte PDF-inhoud getest; gevonden PDF + 0 items is geen succes; gerechten, prijzen en dekking vergeleken | `probe-menu-extraction-sources.js --source=all`: PDF 2 pagina's, bytes `4445a101…27f8`, content `24f23cbd…8a845`; 37/37 referentierijen, 8 secties, 0 gemist/extra/prijs/koppeling/duplicaat, boekhouding 37/37 | R+T | **bewezen met beperking** | 7 supplementregels en 1 arrangementregel worden gemeld, niet opgeslagen; geen item-voor-item menselijke hercontrole in deze ronde; vestiging alleen via URL/bestandsnaam, niet uit de PDF-tekst | Developer voor itemcontrole; Product Owner voor schema-uitbreiding |
| 4 | Blossem: lunch/diner, rubrieken en items volgen de echte bronrelaties; onzekerheid uitvoerbaar; geen vast aantal | `probe-menu-extraction-sources.js --source=all`: HTML bytes `da5c632f…0c38`; 43/43 in 13 secties, 0 verschillen, boekhouding 43/43; DINNER/LUNCH blijven gescheiden; 12 secties gemarkeerd als onzeker | R+T+B | **bewezen met beperking** | 2 arrangement-/wijnarrangement-secties worden gemeld en niet opgeslagen; de fixture toont groepshandeling zonder accepteer-alles; geen live sessie | Developer voor itemcontrole; Product Owner voor schema-uitbreiding |
| 5 | Bestaande kaarten Wolfslaar, Bardot, Zuyd, T-Huis getoetst tegen gecontroleerde bronnen (eigenaarsbesluit issuecomment-6315226470, optie 1); historische aantallen zijn geen waarheid | **Nieuwste ronde (review 6351417692):** Bardot 0/112 match maar 86 rijen geëxtraheerd (was 74), 61 gemist (was 76), 35 verzonnen (was 38), 0 prijsfouten; de 51 rijen met de juiste naam en het juiste bedrag staan onder een letterlijke, letter-gespatieerde rubriekkop en tellen als rubriekverschil (begrensd). Zuyd 34/36 onveranderd. Wolfslaar **29/30** match (was 0), 1 gemist + 1 verzonnen (de letterlijk gesplitste naam `C onference Peer`), 0 prijs- en 0 rubriekfouten. T-Huis `blocked` (afbeeldingsmenu, eigenaarsbesluit 3a). Meting `card-reference-measurement.json` (`b1b06641…`, tweemaal identiek) | R+T | **gedeeltelijk: drie kaarten gemeten, één eerlijk niet-meetbaar; Bardot-rubrieken begrensd** | Bardot: 61 gemiste en 35 verzonnen rijen blijven, vooral op de dranken-/dessertpagina's waar koppen en gerechten in verschoven letter-gespatieerde tekstregels staan; de rubriekkoppen zijn zonder woordenboek of gok niet te reconstrueren. Wolfslaar: 1 rij blijft een bewezen verschil. T-Huis vraagt OCR/beeldanalyse, wat niet in #59 zit. De Delivery Lead moet de referenties onafhankelijk controleren | Developer voor de resterende Bardot-fragmentatie; Delivery Lead voor onafhankelijke referentiecontrole; Product Owner voor een afbeeldings-/OCR-besluit |
| 6 | Vooraf vastgelegde representatieve set en aparte holdout dekken HTML, tabs, tabellen, tekst-PDF, scans, taal/vestiging, arrangement en prijsvariant | `acceptanceSet.test.js`, `acceptanceSetGuard.test.js`, `holdoutReferences.test.js`, `botanistReference.test.js`; 22 representatieve entries en 13 dekkingsklassen; De Botanist/Mr Moos/Colonia zijn `representative` + `usedForTuning`; Gauchos Breda is de enige holdout (`evaluated_once`, 404) | T+R | **open** | Er is geen nieuwe, nog ongeziene holdout; scans/OCR blijft `niet ondersteund`; Gauchos levert geen inhoud. Een releaseclaim kan hier niet op rusten | Product Owner voor nieuwe bron-/toegangsbeslissing; Delivery Lead voor de acceptatieclaim |
| 7 | Dataset, referentie-uitkomsten en meetbare drempels vóór acceptatie vastgelegd; BE-21's 50–100 niet met enkele URL's afgesloten | `manifest.json` `releaseThresholds`: 0 verzonnen gerechten/prijzen, 100% bewijs, 0 onverklaarde dekking, 0 structuur-/prijsfouten; `sourceReferences.test.js`; 23 structuurgevallen | T | **bewezen met beperking** | Drempels zijn vast en niet verlaagd; BE-21 is expliciet buiten #59 en niet afgesloten met twee bronnen | BE-21-eigenaar; Delivery Lead voor scopebewaking |

| 8 | Gemiste/verzonnen items, prijsfouten, structuurverlies, bewijsdekking, correctiewerk, tijd en kosten per brontype gerapporteerd | **Nieuwste ronde (review 6351417692):** gecontroleerde meting **177/185 match** (was 167), 5 gemist (was 15), 0 verzonnen, 0 prijsfouten, 3 rubriekfouten; precisie 98,33% / recall 95,68% (`reference-measurement.json` `5eda188a…`). Kaarten: Bardot 0/112 match, 61 gemist, 35 verzonnen, 0 prijsfouten, 51 rubriekfouten; Zuyd 34/36; Wolfslaar 29/30 (`card-reference-measurement.json` `b1b06641…`). De generieke herstelklassen van deze ronde: zelfde-regel prijskoppeling in een aparte prijskolom, rubriekkoppen in kapitalen/letter-spatiëring, omslagtitel, menutitel uit de linklabels van de site, prijsvarianten als varianten (met fictieve fixtures per klasse). Oudere ronde: Smelt/Blossem 0 verschillen | R+T | **bewezen met beperking** | De 61 gemiste en 35 verzonnen Bardot-rijen zijn zichtbaar begrensd: de rubriekkoppen staan letter-gespatieerd in de tekstlaag en zijn zonder woordenboek of gok niet te reconstrueren, en de dranken-/dessertpagina's leveren verschoven tekstregels. Eén Wolfslaar-rij blijft een bewezen verschil (letterlijk gesplitste naam). T-Huis blijft `blocked` (eigenaarsbesluit 3a). Correctietijd en modelkosten blijven onbekend (€0, geen provider) | Developer voor de Bardot-fragmentatie; Delivery Lead voor onafhankelijke referentiecontrole; Product Owner voor een afbeeldings-/OCR-besluit |
| 9 | Browseracceptatie met klikpaden, rolgrenzen, leeg/fout/partieel, toetsenbord, licht/donker, 320/390 px | `npm run test:browser:menu-review`: **241/241 checks** op codehead `26839eb`, evidence met schone werkboom en SHA-256 `F5B2CD715FCC8B7CF2F382988C7F316D8D22CB6615AEFFC95EB4F2D05970C583`; 33 screenshots, 2 clickpathinventories. Bestaande batchchecks blijven groen. Nieuw: echte klikken lijst→exact detail→terug voor vier fictieve lineage-ids (geldige v1, v2, onbekende versie, exact `menus: []`), product-read-only met glas/fles/supplement/onbekende allergenen/provenance/dekking, afwezige save/approve/reject/export, 403/404/leeg/fout, keyboard/focus, licht/donker en 320/390/1024 px, 0 app-fase netwerkviolations; geforceerde approve-klik en script-POSTs worden geweigerd en als bewuste probe vastgelegd | B | **bewezen met beperking** | Alleen fixture: geen live/staging browserbewijs en geen echte authenticated sessie. Alleen `GET /api/internal/v1/menu-concepts` en `GET /api/internal/v1/menu-concepts/<id>` zijn fictief beantwoord; alle concept-POST's (`versions`, `decision`, `export`, lijst/detail) en onbekende API-routes zijn geweigerd. De UI-blokkade bewijst de server niet; `menuConceptReviewHandlers.test.js` blijft daarvoor leidend | Product Owner/ops voor previewtoegang; Delivery Lead voor live acceptatie |
| 10 | Time-out, provideruitval, ongeldige uitvoer, kosten-/paginagrens, herimport, gelijktijdige taken, promptinjectie, verkeerde vestiging, onveilige redirects getest | `menuExtractionAdapter.test.js`, `safeOutboundFetch.test.js`, `restaurantSourceAnalysis.test.js`, `batchAnalysisHandlers.test.js`, `menuConcept.test.js`; offline fake provider en `.invalid`-fixtures; geen dubbele call/claim | T | **bewezen met beperking** | Alleen offline; een echte provideruitval, echte kostenmeting en echte gelijktijdige productietaken zijn niet gemeten | Product Owner voor provider/budget; developer voor een latere live meting |
| 11 | Geen stil dataverlies tussen extractie, receipt, review, concept en export; niet-ondersteunde publicatievelden geblokkeerd/gemeld | `menuProductIntegrationV2.test.js`, `menuProductGuardsV2.test.js`, `menuConceptV2ReviewHandlers.test.js`, `menuConceptExportV2.test.js`, `sourceWorkqueueV2.test.js`, `menuProductV2Surface.test.js`; de bestaande review toont glas/fles, supplementen, bewijs en dekking via één gesaneerde view; save/approve/reject/export/confirm weigeren v2 vóór hun effect | T+B | **bewezen met beperking** | Alleen fictieve in-memory/browserfixtures; geen echte v2-rij in Supabase en geen live bronbevestiging. Een v2-writeflag/exportcontract blijft niet gebouwd | Developer voor live preview; Delivery Lead voor review |
| 12 | Geen regressie in rollen, bronbevestiging, audit, publicatiegates, beveiliging of geheimenbeheer | **Nieuwste ronde:** volledige suite **2322/2322** groen (inclusief 16 nieuwe regressies K1–K4 en het naambehoud), plus `npm run test:menu-structure` 6/6, `npm run build` exit 0 met 41/41 pagina's, de PDF.js-packagingcheck OK en de goedgekeurde bronproef Smelt 37/37 + Blossem 43/43. Oudere ronde: 2306/2306 op `1b22121`, 2160/2160 op `6728897`; v1-gedrag en bestaande rechten blijven groen; netwerkguard blokkeert externe fetch, protocol-relative URL, onbekende API-write, XHR, WebSocket en CDP-subresources | T+B | **bewezen met beperking** | Geen productiecredentials, productieauth of echte database gebruikt; dat is bewust niet getest. De browserfixture is in deze ronde niet opnieuw gedraaid (geen UI-wijziging) | Product Owner/ops voor productieacceptatie |
| 13 | Onafhankelijke review met exacte commit, checks, bron-/protocolversies, resultaten, beperkingen en volgende stap; groene unit-tests zijn geen productacceptatie | Deze matrix + checkpoint op PR #60 | I | **geblokkeerd** | De Delivery Lead heeft deze afrondingsronde nog niet onafhankelijk beoordeeld; deze matrix is ontwikkelaarsbewijs | Delivery Lead |
| 14 | Een v2-envelope wordt in de bestaande interne controle/beoordeling versiegetrouw herkenbaar: varianten, glas/fles, supplementen, bewijs en dekking; niets afgeplat | `menuProductIntegrationV2.test.js`, `menuProductGuardsV2.test.js`, `menuConceptV2ReviewHandlers.test.js`, `menuConceptExportV2.test.js`, `sourceWorkqueueV2.test.js`, `batchAnalysisHandlers.test.js` (v2-cases), `menuProductV2Surface.test.js`; browserfixture `v2` op 1024/390 px | T+B | **bewezen met beperking** | Alleen fictieve in-memory/browserfixtures; geen echte v2-rij in Supabase, geen live bron en geen authenticated preview | Developer voor live preview; Product Owner/ops voor toegang |
| 15 | Onbekende/ongeldige/onvoldoende onderbouwde v2 wordt vóór alle zijeffecten geweigerd; v1 blijft ongewijzigd | `menuProductV2Surface.test.js`, `menuSnapshotReviewHandlers.test.js`, `menuSnapshotProposals.test.js`, `menuConceptV2ReviewHandlers.test.js`, `menuConceptExportV2.test.js`; save/approve/export/reviews/url-intake guards vóór hash, claim, insert, update, RPC of GitHub; de generieke editorreview leest nu ook de oorsprongsreceipt (`menuOriginReceiptGuard`), detail classificeert vóór de exportrefresh en een onversioned v2-vorm is een concrete blokkade; bestaande v1-suite groen | T | **bewezen met beperking** | Geen echte database-/GitHub-side-effectmeting; de tests bewijzen de volgorde met fakes. Bronverificatie blijft bewust onbekend | Delivery Lead voor onafhankelijke review |

### Browserbewijs conceptlijst/detail (review 6295223157)

De browserfixture dekt nu ook de bestaande pagina's
`/internal/menu-concepts` en `/internal/menu-concepts/[id]`, met de echte
`ConceptList`, `ConceptReview` en `ProductReview`-componenten. De fixture bouwt
de payloads met dezelfde productreaders als de server
(`readConceptProduct`, `buildProductReviewView`, `storedConceptInput`,
`buildMenuConcept`); er is geen nagebouwde HTML.

- **Wel fictief beantwoord (GET):** alleen
  `GET /api/internal/v1/menu-concepts` en
  `GET /api/internal/v1/menu-concepts/<id>` met precies één padsegment.
- **Geweigerd vóór een handler of native fetch:** `POST` op lijst en detail,
  `POST .../versions`, `.../decision`, `.../export`, geneste GET zoals
  `.../versions`, alle onbekende `/api/...`-routes, externe URL's,
  protocol-relatieve URL's en een externe WebSocket/providerfetch.
- **Echte klikpaden:** lijst → v1/v2/onbekend/`menus: []`-detail → terug, met
  per stap het exacte pad en de unieke restaurantnaam; de geselecteerde id
  springt niet naar een andere rij. Een tweede inventory legt de
  toetsenbordroute lijst → detail → lijst vast.
- **Read-only v2:** glas/fles blijven gescheiden, het supplement en zijn
  onopgeloste doel blijven zichtbaar, allergenen blijven onbekend, bronbewijs
  en dekkingsbeperking blijven staan; save/approve/reject/export zijn afwezig.
- **Geblokkeerde staten:** onbekende/onversioned versie en exact `menus: []`
  blijven zichtbaar geblokkeerd; lege lijst, 500, 403, detailfout en 404 tonen
  een eerlijke melding en geen verzonnen concept.
- **Geforceerde actie:** een echte klik op "Concept goedkeuren" en script-POSTs
  naar `versions`/`decision`/`export` worden door de netwerkguard geweigerd en
  als bewuste `negative-probe` vastgelegd. Dat bewijst alleen de guard, niet de
  server; de serverhandlerregressies blijven leidend.
- **Bereik:** 241/241 checks, 33 screenshots, 2 clickpathinventories,
  0 app-fase-violations en 2 CDP-negatieve probes (afbeelding/iframe), op
  codehead `26839eb` met schone werkboom. `fixtureOnly: true`; de harness
  start alleen zijn eigen loopback-`next dev` en eigen Edge via CDP. Dit is
  geen echte authenticated acceptatie.


## Pure v2 schema-/mappinglaag (ronde 2026-10-19)

Status: **gebouwd en getest; sinds `0f9ea9d` read-only aangesloten op de
bestaande lezers, nog steeds geen v2-writeflag, DDL, migratie of publicatie.**
Codehead prijsbewijsreparatie:
`2b994cd0e5743ecbd2096381680fadf12ac31e13` (review 6274281958); de read-only
integratie staat op `0f9ea9dd59c36b13b270cb140030466db11d6d8d` en is op
`6728897c814bce80aa2b9a44d53d8322b3adc72a` hersteld na review 6283658271.

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

## Read-only v2-aansluiting (ronde 2026-10-19, codehead `0f9ea9d`; herstel op `6728897` na review 6283658271 op 2026-10-20)

Status: **gebouwd, getest met fictieve clients en lokaal in de browserfixture;
geen v2-schrijver, DDL, migratie, provider of publieke wijziging.**

| Bestaande ingang | Aansluiting | Bewijs |
| --- | --- | --- |
| Receipt lezen | `batchAnalysisHandlers.RECEIPT_COLUMNS`, `sourceTriageHandlers.RECEIPT_COLUMNS`, `menuOriginReceiptGuard.loadOriginReceipt` (gedeeld door `menuConceptReviewHandlers` en `menuSnapshotReviewHandlers`) en `menuConceptExport` selecteren `candidate_summary.menuExtractionV2` expliciet naast `menus`; `readReceiptProjection` maakt v2 gezaghebbend | `menuProductIntegrationV2.test.js`, `batchAnalysisHandlers.test.js`, `sourceWorkqueueV2.test.js` |
| Batchcontrole | `batchAnalysis.deriveItemView` geeft een gesaneerde `product`-view en v2-tellingen; `MenuReview.MenuControl` toont glas/fles, supplementen, bewijs en dekking via `ProductReview`; de v1-sectielijst draait niet op v2 | `menuProductV2Surface.test.js`, browserfixture `v2` |
| Concept/beoordeling | `storedConceptInput` gooit fail-closed; `readConceptProduct` gebruikt dezelfde legacy-predicate, zodat een onversioned v2-vorm een concrete blokkade oplevert in lijst, detail en elke write-ingang (geen ongehandelde 500 en geen v1-succes); `conceptSummary`/`detail` leveren een read-only `product`-view, `captured: null`, een concrete `blocked.reason` en een geblokkeerd publicatievoorbeeld; `MenuConceptsView.ProductConceptReview` toont geen opslaan/goedkeuren | `menuConceptV2ReviewHandlers.test.js`, browserfixture `v2` |
| Save/approve/reject | `saveVersion` en `decide` weigeren v2/onbekend/ongeldig vóór lineage, hash, insert en `record_menu_snapshot_decision`; ook een v1-concept met een v2-oorsprongsreceipt wordt geweigerd | `menuConceptV2ReviewHandlers.test.js`, `menuProductV2Surface.test.js` |
| Generieke snapshots | `validateSnapshotProposalInput` weigert versioned/v2-vormige `captured_content` vóór `computeCanonicalContentHash` en insert; de editorroute `menuSnapshotReviewHandlers.record` weigert v2 vóór de reviewinsert | `menuSnapshotReviewHandlers.test.js`, `menuSnapshotProposals.test.js`; een v1-projectie met een v2/onbekende/ongeldige oorsprongsreceipt wordt ook hier geweigerd, een receipt-lookupfout fail-closed |
| Oorsprongsreceipt bij elke ingang | `menuOriginReceiptGuard.loadOriginReceipt` leest één begrensde projectie (`menus` + `menuExtractionV2`) via `origin_receipt_id`; `originReceiptBlock` weigert v2/onbekend/ongeldig vóór insert, RPC, claim of GitHub. De generieke editorreview gebruikt dezelfde guard als de interne review- en exportroute | `menuSnapshotReviewHandlers.test.js` (approved_internal, rejected, needs_review, deferred, v2/onbekend/ongeldig, lookupfout, ongewijzigd v1 en geen receipt), `menuConceptV2ReviewHandlers.test.js`, `menuConceptExportV2.test.js` |
| Export | `exportToReviewPr` weigert v2 en een v2-oorsprongsreceipt vóór `menu_snapshot_exports`, branch, commit, PR of GitHub-call; `exportMenuEntry` geeft geen entry | `menuConceptExportV2.test.js` |
| Exportrefresh bij een geblokkeerde kaart | `detail` classificeert concept én oorsprongsreceipt vóór de exportrefresh; een geblokkeerde kaart gebruikt `storedExportForSnapshot` en toont alleen opgeslagen metadata: geen `pullRequestState`, geen statusupdate naar merged/closed en geen claim. Een v1-kaart houdt het bestaande refreshgedrag | `menuConceptV2ReviewHandlers.test.js`, `menuProductV2Surface.test.js` |
| Receipt → url_intake | de routes `url-intakes` en `profile-drafts` weigeren een v2-receipt vóór `create_url_intake_from_receipt`; de bestaande RPC/SQL is ongewijzigd | `menuProductV2Surface.test.js` |
| Bronverificatie | iedere v2-view draagt `sourceVerification: "unverified"` en een `source_not_verified`-blokkade; er is geen bronbevestiging uit een quote of modelveld | `menuProductIntegrationV2.test.js`, browserfixture `v2` |

Browserbewijs: `npm run test:browser:menu-review` gaf **127/127** checks op de
werkboom die als `0f9ea9d` is gecommit, met 13 screenshots (waaronder
`menu-review-v2-1024-light.png` en `menu-review-v2-390-dark.png`), Edge
155.0.4283.45, 1024/390 px, licht/donker en de bestaande fail-closed
netwerkguard. Dit is fixturebewijs, geen echte authenticated preview.

Nog niet gedaan en dus geen acceptatieclaim: een echte v2-rij in Supabase, een
echte bron → v2-receipt → conceptopslag, een live preview/authenticated
browser, een v2-writeflag, een additief exportcontract, een versiebewuste
`url_intakes`-RPC en een nieuwe ongeziene holdout.

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
| Gerichte read-only v2-tests (deze ronde) | `node --test` op `menuProductIntegrationV2.test.js`, `menuProductGuardsV2.test.js`, `menuConceptV2ReviewHandlers.test.js`, `menuConceptExportV2.test.js`, `menuSnapshotReviewHandlers.test.js`, `sourceWorkqueueV2.test.js`, `menuProductV2Surface.test.js` | **46 pass, 0 fail, 0 skipped** (codehead `6728897`) |
| Onafhankelijke repro review 6283658271 | losse fixture gelijk aan de review (editorreview, exportrefresh, onversioned lijst) | **P1a 409 `receipt_product_v2_authoritative` met 0 reviewinserts; P1b 200 read-only met 0 GitHub-calls en 0 exportupdates terwijl de opgeslagen status `opened` blijft; P2 `invalid` + lijst 200 met één concrete blokkade naast een v1-rij** (codehead `6728897`) |
| Volledige suite | `npm test` | **2105 tests: 2105 pass, 0 fail, 0 skipped** (head `5e3e3a5`; TAP, 102,1 s) |
| Volledige suite (review 6274281958) | `npm test` | **2112 tests: 2112 pass, 0 fail, 0 skipped** (head `2b994cd`; TAP, 51,0 s) |
| Volledige suite (read-only v2-aansluiting) | `npm test` | **2151 tests: 2151 pass, 0 fail, 0 skipped** (codehead `0f9ea9d`; TAP, 23,6 s) |
| Volledige suite (herstel review 6283658271) | `npm test` | **2160 tests: 2160 pass, 0 fail, 0 skipped** (codehead `6728897`; TAP, 26,9 s) |
| Structuurcorpus | `npm run test:menu-structure` | **6 pass, 0 fail** (head `5e3e3a5`) |
| Benchmark | `npm run benchmark:menu-structure` | 23 gevallen: **22 pass, 0 fail, 1 unclassified** (`STRUCT-018`, bestaande JSON-LD-hiërarchiekeuze; head `5e3e3a5`) |
| Build | `npm run build` | **compiled successfully in 30,5 s; 41/41 statische pagina's; exit 0** (head `5e3e3a5`) |
| Build (review 6274281958) | `npm run build` | **compiled successfully in 51 s; 41/41 statische pagina's** (head `2b994cd`) |
| Build (read-only v2-aansluiting) | `npm run build` | **compiled successfully in 18,7 s; 41/41 statische pagina's; exit 0** (codehead `0f9ea9d`) |
| Build (herstel review 6283658271) | `npm run build` | **compiled successfully in 15,8 s; 41/41 statische pagina's; exit 0** (codehead `6728897`) |
| PDF.js-serverpad | `node ops/scripts/verify-pdfjs-server-trace.js` | **OK**; 164 server scripts, native `pdf.mjs`/`pdf.worker.mjs`, geen gebundelde PDF.js-runtime (head `5e3e3a5`) |
| Volledige suite (conceptlijst/detail) | `npm test` | **2163 tests: 2163 pass, 0 fail, 0 skipped** (codehead `26839eb`; TAP, 41,4 s) |
| Structuurcorpus (deze ronde) | `npm run test:menu-structure` | **6 pass, 0 fail** (codehead `26839eb`) |
| Build (conceptlijst/detail) | `npm run build` | **compiled successfully in 14,5 s; 41/41 statische pagina's; exit 0** (codehead `26839eb`) |
| Browserfixture (conceptlijst/detail) | `npm run test:browser:menu-review` | **241/241 checks**, 33 screenshots, 2 clickpathinventories, Edge 155.0.4283.45, gegenereerd op codehead `26839eb` met schone werkboom; evidence `passed: true`, SHA-256 `F5B2CD715FCC8B7CF2F382988C7F316D8D22CB6615AEFFC95EB4F2D05970C583`; 0 app-fase-violations, 2 CDP-negatieve probes |
| Browserfixture (read-only v2-aansluiting) | `npm run test:browser:menu-review` | **127/127 checks**, 13 screenshots (incl. `v2-1024-light` en `v2-390-dark`), Edge 155.0.4283.45, gegenereerd op head `0f9ea9d` (dirty worktree door deze documentatie), evidence `passed: true` |
| Echte bronproef | `node ops/scripts/probe-menu-extraction-sources.js --source=all` | **exit 0**; Smelt 37/37 (8 secties), Blossem 43/43 (13 secties); beide byte-/contenthash identiek; 0 gemist/extra/prijs/koppeling/duplicaat; boekhouding 37/37 en 43/43 |
| Botanist-vergelijking | `node ops/benchmark/runBotanistComparison.js --pdf=…/botanist-menu.pdf` (v1 en v3-voorstel) | **exact reproductie** van de vastgelegde v1 (124/11/4/0; 215 items; 87 niet-gekoppeld; 9 `categoryUnknown`) en v3-voorstel (127/6/1/0; 5 beperkt; 8 `categoryUnknown`); PDF-hash gelijk |
| #56-compatibiliteit | `git merge-tree --write-tree --name-only HEAD origin/feat/compact-source-flow-53` | **op `5a7f99a`: exit 1**; 3 inhoudelijke conflicten; 10 overlappende bestanden; niet herhaald op `5e3e3a5`, geen merge uitgevoerd |
| Whitespace | `git diff --check` | schoon |

De probe-uitvoer bevat de bestaande PDF.js-waarschuwing over
`standardFontDataUrl`; die verandert de tekstlaag niet en de vergelijking
eindigde met exit 0. Dat is een observatie, geen productacceptatie.

De read-only v2-aansluiting is op codehead `0f9ea9d` met 37 gerichte tests, de
volledige suite (2151/2151), de build en de browserfixture (127/127) uitgevoerd.
Het herstel na review 6283658271 staat op codehead `6728897`: 46 gerichte tests,
de volledige suite (2160/2160) en de build (41/41 pagina's, exit 0). Daarbij zijn
de drie gemelde paden met een losse fixture opnieuw uitgevoerd: de generieke
editorreview weigert een v1-projectie met v2-oorsprongsreceipt vóór de insert,
detail doet voor een geblokkeerde kaart geen GitHub-call en geen exportupdate,
en een onversioned v2-vorm levert een concrete blokkade in de lijst naast een
geldige v1-rij. De browserfixture is niet opnieuw gedraaid: `6728897` wijzigt
geen UI-bestand, dus het browsergedrag is gelijk aan de fixture op `0f9ea9d`.
De fixture is op codehead `0f9ea9d` gegenereerd (dirty worktree door deze documentatie); de evidence noemt head `0f9ea9d` + dirty worktree. De bronproef en de
Botanist-vergelijking zijn niet herhaald: `0f9ea9d` wijzigt geen fetch-,
parser-, PDF- of extractorruntime. Hun bewijs blijft aan de eerdere codeheads
gekoppeld. Er is geen echte database-, GitHub- of providerwrite uitgevoerd.

De conceptlijst/detailronde staat op codehead `26839eb`: `npm test` 2163/2163,
`npm run test:menu-structure` 6/6, `npm run build` 41/41 pagina's met exit 0 en
de browserfixture 241/241 op een schone werkboom. De evidence staat in commit
`0f6fce8` en noemt head `26839eb`. Alleen de twee concept-GET's zijn fictief
beantwoord; alle concept-POST's en onbekende routes zijn geweigerd. De
geforceerde approve-klik en script-POST's bewijzen de netwerkguard, niet de
server; de serverhandlerregressies blijven daarvoor leidend. Er is geen echte
authenticated browser-, database-, GitHub- of providerwrite uitgevoerd.

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
  uitgevoerd; alleen de lokale fixture op Edge 155, inclusief de conceptlijst en
  detailpagina met fictieve GET's. De fixture bewijst geen echte Supabase-sessie,
  geen echte conceptrij en geen serverweigering; die laatste blijft via de
  serverhandlerregressies bewezen.
- **BE-21's 50–100-bronnen/OCR-/vendorbenchmark**: buiten #59; niet afgesloten.
- **Scans/OCR**: expliciet niet ondersteund; de uitkomst is een eerlijke fout.
- **Echte v2-rij of v2-writeflag**: niet aangemaakt of geactiveerd; alle
  v2-tests gebruiken fictieve in-memory databases en de browserfixture.
- **Echte bron → v2-receipt → conceptopslag → authenticated browser**: niet
  uitgevoerd; de fixture bewijst alleen de bestaande componenten met fictieve
  data.
- **Versiebewuste `url_intakes`-RPC, additief exportcontract, migratie/DDL**:
  niet uitgevoerd; de bestaande RPC blijft ongewijzigd en een v2-receipt wordt
  ervoor geweigerd.
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
| 4 | Read-only v2-aansluiting is op `0f9ea9d` gebouwd en op `6728897` hersteld na review 6283658271; nog te besluiten: opt-in v2-writer, additief exportcontract, versiebewuste `url_intakes`-RPC en eventuele migratie | De read-only dual-read/guards zijn getest met fakes; er is geen writer, DDL of publieke werking. Het exportcontract en een eventuele migratie zijn nog niet besloten | Delivery Lead/architect; Product Owner voor writer-/export-/migratiebesluit |
| 4b | Echte preview-/schrijfacceptatie van een v2-rij: bron → receipt → concept → authenticated browser | De fixture bewijst alleen fictieve data; er is geen echte v2-rij, live bron of Supabase-sessie gebruikt | Product Owner/ops; Developer voert na toegang uit |
| 5 | Onafhankelijke review van codehead `26839eb`, evidence `0f6fce8` en deze documentatie | Criterium 13; groene tests en een fixture-browserrun zijn geen productacceptatie | Delivery Lead |
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
#59.** De afrondingsronde (review 6344039571) eindigt op `b1e4abc`
(referentiecorrectie + opnieuw gemeten, deterministische referentiemeting:
**167/185**, `79a8b133…`) en de documentatiecommit met de eindmatrix. Bewijs op
die head: volledige suite **2324/2324**, het structuurcorpus 6/6, de build
exit 0 met 41/41 pagina's, de PDF.js-packagingcheck OK (166 server scripts) en de
goedgekeurde read-only bronproef Smelt 37/37 + Blossem 43/43 op dezelfde
vastgezette bytes. Het exacte checkpoint-HEAD staat in de PR #60-checkpoint. De
browserfixture (241/241 op `26839eb`) is in deze ronde niet opnieuw gedraaid
omdat er geen UI is gewijzigd; dat blijft ontwikkelaarsbewijs op een oudere
head en is geen browseracceptatie. De oudere codehead `26839eb`, evidencecommit
`0f6fce8` en browserdekking van de conceptlijst/detailpagina blijven als
historisch bewijs staan. De lokale browserfixture is hoe dan ook geen
echte bron → database → authenticated browseracceptatie. Volledige
productacceptatie blijft afhankelijk van de beslissingen hierboven: een echte
preview-/schrijfronde, een eventuele v2-writer/exportcontract/migratie,
provider/budget/DPA en een nieuwe holdout. Het enige inhoudelijke beslispunt dat
nog in deze code ligt is het **schema-ontwerp voor prijsvarianten** (Product
Owner); de tien resterende gemiste Pellens-regels zijn precies die klasse en
staan als begrensd, niet als fout. De twee referentieregels zijn beslist en
verwerkt. De eerstvolgende veilige stap is
onafhankelijke review van deze head door de Delivery Lead; daarna kan de Product
Owner de resterende besluiten nemen. Er is niets gemerged, naar een andere
branch gepusht, gedeployed of gepubliceerd.

## Ronde 2026-10-23 - route B: Anthropic-call, budgetlog, beslisfunctie en proefharnas (review 6370840673)

**Status: ontwikkelaarsbewijs en fixturebewijs.** Geen betaalde of echte
API-aanroep, geen sleutel aangemaakt of gebruikt, geen app-route gekoppeld, geen
migratie, geen wijziging aan referenties, telregels of meetcode, geen merge of
publicatie. Budget en gegevensverwerking blijven **NEEDS_APPROVAL**.

| Criterium | Stand | Bewijs |
| --- | --- | --- |
| K1 Claude-aanroep | **gedaan, zonder netwerk** | `src/lib/menuExtractionAnthropicCall.js`: `@anthropic-ai/sdk` exact `0.133.0` (lockfile, minstens twee weken oud), model `claude-haiku-5-5`, protocol als `system`, tekst- en base64-`document`-blokken, `output_config.format` (`json_schema`) op het bestaande contract, `signal` doorgegeven, geen SDK-retry (`maxRetries: 0`). SDK-vorm gecontroleerd tegen de geïnstalleerde types (`OutputConfig`, `JSONOutputFormat`, `Base64PDFSource`, `StopReason`, `Usage`) en de officiële structured-outputs-documentatie. Zonder `ANTHROPIC_API_KEY` is de adapter uit (`provider_not_configured`). |
| K2 Kosten uit usage | **gedaan** | Vaste, gedateerde prijstabel (`ANTHROPIC_PRICING`, Anthropic Pricing 2026-10-22): $0,10/$0,50 per miljoen tokens tot 100.000 prompttokens, daarboven $0,50/$2,50; USD 1:1 naar eurocent, naar boven afgerond; cachetokens op het volle prompttarief. Ontbreekt `usage`, dan blijft de kost `null` en meldt de adapter `cost_unknown`. |
| K3 Duurzame budgetlog | **gedaan** | `src/lib/menuExtractionBudgetLedger.js`: synchroon, atomisch (tijdelijk bestand + fsync + rename), slot per mutatie, 900 cent cumulatief, 30 per call, 40 calls, 1 tegelijk. Een persistente ledger houdt zijn eigen plafonds; een niet-afgerekende reservering blijft belast. |
| K4 Proefharnas | **gedaan (dry-run)** | `ops/scripts/run-menu-extraction-ai-probe.js` op de acht gepinde captures; hashcontrole per capture; `--live` vereist een sleutel en een expliciet gitignored budgetbestand; meting via de ongewijzigde `compareControlledReference`; twee runs per bron voor stabiliteit. |
| K5 Alleen waar nodig | **gedaan** | `src/lib/menuExtractionRouteBDecision.js`: route B alleen bij nul items, dekking onder 80% tegen een bekende referentie, `html_arrangements_skipped` of een PDF-layoutflag. Niet gekoppeld aan een route; de app-runtime blijft `disabledMenuExtractionRuntime`. |
| K6 Regressies | **gedaan** | 12 tests in `src/lib/menuExtractionAnthropicCall.test.js` (geldig antwoord, schemafout, time-out met abort, refusal, `max_tokens`, ontbrekende `usage`, geen sleutel, promptinjectie, documentblok, prijstabellen, SDK-pin) en de bestaande adapterregressies blijven groen; 10 in `src/lib/menuExtractionBudgetLedger.test.js` (per-call- en cumulatief plafond, callplafond, onbekende kost, herstart, corrupt bestand, gewijzigde plafonds, levend en dood slot, schrijffout), 5 in `src/lib/menuExtractionRouteBDecision.test.js`, 6 + 4 + 5 in de proefmodules. Alles met een nagebootste transportlaag: geen netwerk. |
| K7 Documentatie | **gedaan** | `docs/guides/menu-extraction-ai-probe.md` (werkruimte met $10-limiet en automatisch bijvullen uit, sleutel lokaal, dry-run- en livecommando, grenzen), deze matrix en BE-21. |

### Dry-run op de gepinde captures (2026-10-23)

Bron: `ops/benchmark/output/ai-probe-report.json` (gitignored). Raming met het
outputplafond van 32.000 tokens per call (N2 van review 6374528099); prompttokens
uit de echte tekst (characters / 4) plus protocol en schemaframing. **Geen
netwerk, geen sleutel.**

| Bron | Captures | Calls (2 runs) | Prompttokens/call (max) | Raming kosten plafond (cent) |
| --- | ---: | ---: | ---: | ---: |
| Zuyd | 6 | 4 | 4.990 | 8 |
| Andalous | 8 | 4 | 8.890 | 8 |
| Pellens | 1 | 2 | 4.041 | 4 |
| Chocolat | 6 | 4 | 5.944 | 8 |
| Smelt | 1 | 2 | 3.150 | 4 |
| Blossem | 1 | 2 | 3.702 | 4 |
| Bardot | 1 | 2 | 3.660 | 4 |
| Wolfslaar | 4 | 2 | 16.153 | 4 |
| **Totaal** | **28** | **22** | - | **44** |

De typische raming blijft 22 cent: die rekent met een realistisch aantal
uitvoertokens, niet met het plafond. Alle acht bronnen zijn hash-geverifieerd en
leesbaar; geen bron is geblokkeerd.
De raming past binnen 40 calls en 900 cent. Zuyd, Andalous en Chocolat hebben
meer captures dan de documentlimiet van 5 en worden daarom per run in twee calls
verstuurd; de uitvoer van die calls wordt voor de vergelijking samengevoegd.

### Wat deze ronde niet bewijst

- Geen echte modeluitvoer: gemist/verzonnen/prijs/rubriek/bewijsdekking en
  werkelijke kosten per bron zijn nog niet gemeten. Die cijfers komen pas uit
  een goedgekeurde live run.
- Geen browseracceptatie (geen UI gewijzigd), geen onafhankelijke review en
  geen productieactivering.
- Smelt en Blossem hebben referenties zonder citaat per regel; hun
  bewijsdekking wordt tegen de brontekst gemeten, niet tegen een referentiecijfer.
- De 50-100-bronnenbenchmark van BE-21 blijft open; dit zijn acht bronnen.

De eerstvolgende veilige stap is onafhankelijke review van deze head door de
Delivery Lead, daarna het eigenaarsbesluit over budget en gegevensverwerking en
pas dan een live proef met een door de eigenaar aangemaakte sleutel.
