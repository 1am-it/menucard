# Menu-extractie — bestaande kaarten live vergeleken

Status: ontwikkelaarsbewijs voor #59, vastgelegd 2026-10-21 op opdracht van de
Delivery Lead (review 6315269210, besluit Product Owner in
issuecomment-6315226470). Dit is **geen** onafhankelijke review, geen
browseracceptatie en geen productievrijgave. De historische export
`data/menus.json` is een gedateerde observatie, nooit actuele waarheid.

Werkwijze:

```powershell
node ops/scripts/capture-menu-extraction-card-references.js   # eenmalig, create-only
node ops/scripts/compare-menu-extraction-existing-cards.js    # read-only, herhaalbaar
```

De capture legt per bron de entry-URL plus de menu-subpagina's/PDF's vast die de
historische export zelf noemt: bytes, SHA-256, content-type en tijd. De
vergelijking leest diezelfde URL's opnieuw via de bestaande veilige fetch- en
bronroute, controleert de bronhash en vergelijkt per historische menukaart
zowel de strikte rubriekvergelijking als een rubriekonafhankelijke
naam+prijsvergelijking. Ontbrekende, extra en gewijzigde rijen worden nooit
weggepoetst door een gelijk aantal.

Artefacten:

- [`ops/benchmark/existing-card-sources.json`](../../ops/benchmark/existing-card-sources.json)
  — gepinde vier bronnen en hun historische menukaarten.
- [`ops/benchmark/existing-card-references.json`](../../ops/benchmark/existing-card-references.json)
  — create-only capture met bytes/hash/tijd.
- [`ops/benchmark/existing-card-comparison.json`](../../ops/benchmark/existing-card-comparison.json)
  — laatste live vergelijking (regenerable; elke run vervangt dit rapport,
  terwijl de capture-pin onveranderlijk blijft).

## Uitkomst per bron

### Restaurant Wolfslaar

| | |
| --- | --- |
| Capture | **mislukt** voor entry, `/nl/menu-lunch` en `/nl/menu-diner` (`request-error`) |
| Live | 0 items; geen bron gelezen |
| Historisch | 25 items (lunch 3, diner 22) in 5 rubrieken |

De host is vanuit deze omgeving niet leesbaar: TLS-handshake faalt en een
plain-HTTP-verzoek krijgt een leeg antwoord. Dat is een externe beperking, geen
lege menukaart. Er is geen alternatieve URL of andere vestiging gebruikt en er
is niets uit de historische kaart als live bevestigd.

### Brasserie Bardot

| | |
| --- | --- |
| Capture | **geslaagd**: homepage, `/brasserie-bardot/` en de historische dinerkaart-PDF (2025-11) |
| Eerste live meting | 4 PDF-menu's: lunch-, diner- en Engelse kaart (2026-06) plus de historische dinerkaart; 370 items in 16 secties |
| Historisch | 111 items over vier kaarten (diner 29, lunch 36, borrel 43, specialiteiten 3) |
| Latere metingen | HTTP **503** op alle drie de gepinde URL's; geen verse vergelijking meer |

De live site gebruikt inmiddels **nieuwere PDF-versies (2026-06)** dan de
historische export (2025-11); dat is een bronversiewijziging, geen extractiefout.
De HTML-lunchpagina levert geen HTML-menu meer op. De PDF-extractie zelf is
zwak: namen komen als beschrijvingsfragmenten terug (`Per stuk`, `10 gram`,
`gefrituurde kappertjes, uienconfit`, `(2 st.) met citroenmayonaise`) en
secties vallen samen tot `Menukaart`/`DESSERT`. Dit is een inhoudelijke
PDF-layoutbeperking (vergelijkbaar met de Smelt-kolomparser), geen volledige
menukaart. De 503 is als beperking vastgelegd; er is niet opnieuw gepind en er
is geen andere bron gebruikt.

### Restaurant Zuyd

| | |
| --- | --- |
| Capture | **geslaagd**: homepage, `/lunch`, `/diner` (bytes/hash/tijd gepind) |
| Live | 29 items in 5 secties: lunch 16 (Bites 7, Sandwiches 2, À la carte 7), diner 13 (Bites 6, À la carte 7) |
| Historisch | 42 items (lunch 22, diner 20) |
| Bewijsdekking | 29/29 items met bron-ID, locator en quote (100%) |
| Prijzen | alle 29 live items met een expliciete prijs; geen supplement als hoofdprijs |

Wat de live bron werkelijk toont en wat afwijkt:

- **Prijswijzigingen sinds maart**: Brioche met paling 8,50 → 9,50; Steak
  tartaar 26,00 → 27,50; Ossenhaas 32,50 → 35,00; Eendenlever 27,00 → 28,00.
  Ook `Kreeft` heet nu zonder `(½)` en kost 29,50 in plaats van 29,00;
  `Catch of the day` is nu 26,00 (historisch zonder prijs).
- **Nieuwe live gerechten** die niet in de historische kaart staan: Coquille
  29,00, Zeetongfilet 39,00, Duivels eitje met kimchi 8,50.
- **Naamspelling**: `Crumpet met huisgerookte zalm` (live 9,50) tegen
  `Crumpet met huis gerookte zalm` (historisch 8,50). Dat is een bronwijziging,
  geen automatische gelijkstelling.
- **Ontbrekend in de live extractie**, met reden:
  - de arrangements/keuzemenu's (2-/3-/4-/5-gangen lunch 50/60/70/80 en
    4-/5-/6-/7-gangen diner 70/80/90/100) worden als `service_unit` geweigerd;
    het concept ondersteunt arrangementen nog niet;
  - `Kaasgerecht 17,00` en `Kaasassortiment 13,00/19,50` hebben prijzen in een
    doorlopende prozatekst met supplement; die vorm wordt als
    `ambiguous_structure` geweigerd in plaats van geraden;
  - `Dessert 16,50` staat in dezelfde alinea achter een `<br>` binnen een
    `<em>`-element, waardoor de titelregel niet als nieuwe dish-block wordt
    herkend. Dat is een bewezen markupbeperking, geen ontbrekende bron.
- **Historische rubrieknamen** (`Bites`, `À la carte`) zijn genormaliseerd;
  live heten ze `BITES - voor bij het aperitief` en `A LA CARTE`. De strikte
  rubriekvergelijking telt daarom alle rijen als rubriekverschil; de
  naam+prijsvergelijking is daarnaast apart gerapporteerd.

De eerder foutief toegekende prijs is hersteld: **Ossenhaas kreeg 9,00 (het
supplement) en krijgt nu 35,00** met bewijs `… jus Stroganoff 35 -` en
`supplementText: supplement eendenlever 9`. Regressie:
`ops/benchmark/htmlMenuStructure.test.js` (N5).

De byteshash van de live HTML wijkt bij Zuyd telkens enkele bytes af van de
capture (vermoedelijk dynamische pagina-opmaak). De pin blijft de vastgelegde
bronversie van de capture; de vergelijking meldt `sourceVersionMatches: false`
in plaats van te doen alsof het dezelfde bytes zijn. De inhoudelijke
menuvergelijking is daarom als observatie gelabeld, niet als versie-identiek.

### T-Huis

| | |
| --- | --- |
| Capture | **mislukt**: `too-many-redirects` (301) op `/` en `/menu/` |
| Live | 0 items; geen bron gelezen |
| Historisch | 189 items over lunch, diner en borrel |

De site stuurt in een lus tussen `https://t-huis.online/maintenance.html` en
`http://t-huis.online/maintenance.html`. De veilige fetch stopt na de
redirectgrens; er is geen omzeiling, alternatieve URL of andere vestiging
gebruikt. De onderhoudspagina is geen menukaart en levert dus geen successtatus.

## Herstel in deze ronde

| Bevinding | Herstel | Regressie |
| --- | --- | --- |
| Een expliciet supplement werd de hoofdprijs (Zuyd Ossenhaas 9,00) | Een afsluitende `supplement …`-clausule wordt vóór de prijsbepaling afgesplitst; de hoofdprijs blijft 35,00 en het supplement staat als bewijs ernaast. Een regel met alleen een supplementbedrag wordt geweigerd (`supplement_price`) | `htmlMenuStructure.test.js` N5 (drie gevallen) |
| HTML-itembewijs verdween vóór receipt/review (alleen rubrieklocator bleef) | `menuFromHtmlStructure` geeft `evidence.locator`, `pattern` en `quote` per item door; het aggregaat meet daarmee 100% dekking op Zuyd | `restaurantSourceAnalysis.test.js` (locator/pattern/quote) en `menuPageDiscoveryRegression.test.js` |
| Een losse prijsregel gevolgd door een bulletlegenda werd niet als gerecht gelezen | Een prijs-only regel gevolgd door uitsluitend `○`/`•`-legenda's geldt als dishprijs; de legenda wordt geen beschrijving | `htmlMenuStructure.test.js` N5 (legenda) |

## Resterende beperkingen (niet opgelost, expliciet)

- Bardot-PDF's: twee-koloms-/beschrijvingslayout geeft gefragmenteerde namen en
  samengevallen secties. Niet als volledige menukaart geaccepteerd.
- Arrangementen en keuzegroepen hebben nog geen productvorm; ze worden
  geweigerd en gemeld, niet als gerecht verzonnen.
- HTML-items met meerdere prijzen (zoals `Kaasassortiment 13,00/19,50`) worden
  nog niet als `multiple_undecomposed` opgeslagen; ze verdwijnen nu met een
  `ambiguous_structure`-reden.
- Geneste inline-markup (`<em><br>`) kan een titelregel aan de vorige
  dish-block koppelen; daardoor ontbreekt het live Dessert-item.
- Wolfslaar (TLS/leeg antwoord), T-Huis (redirect-lus) en de latere Bardot-503
  zijn externe blokkades; zonder nieuwe bronmeting is er geen live vergelijking.
- Geen browseracceptatie, geen onafhankelijke review, geen productie- of
  publicatieactie.
