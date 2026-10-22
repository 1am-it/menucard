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

## Tweede nameting na de generieke herstellingen (2026-10-21, review 6316295818)

Dezelfde vier kaarten zijn opnieuw read-only vergeleken met
`compare-menu-extraction-existing-cards.js`. `existing-card-comparison.json` is
overschreven (regenerable); de capture-pin is ongewijzigd.

| Bron | Uitkomst | Bewijs |
| --- | --- | --- |
| Wolfslaar | 0 items; entry en beide menupaden falen met `request-error` (TLS) | externe blokkade, geen omzeiling |
| Bardot | 0 items; alle gepinde URL's geven `bad-status` (503) | externe blokkade |
| Zuyd | 25 items in 4 secties (lunch 13, diner 12); `sourceVersionMatches: false` | 100% bron-ID, locator en bewijs; echte prijswijzigingen t.o.v. de historische export (4 naam+prijsverschillen, 16 extra, 33 ontbrekend) |
| T-Huis | 0 items; `too-many-redirects` naar de onderhoudspagina | externe blokkade, geen omzeiling |

Zuyd-specifiek: `Dessert 16,50` wordt nu wél gelezen doordat een `<br>` binnen
een inline element als regelgrens telt; de lunchsectie `Sandwiches` komt in deze
bronversie niet meer voor (25 i.p.v. de eerdere 29 items). Dat is
bronverschil, geen stille daling: de vergelijking meldt elke ontbrekende en extra
rij en `sourceVersionMatches: false`. De historische aantallen zijn geen
waarheid en de drempels zijn niet verlaagd.


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

## Ronde 2026-10-22 — criterium 5: Bardot-referentie en meting (review 6347355753)

Deze ronde voert K1–K5 van de Lead-opdracht uit: één gecontroleerde
Bardot-referentie uit de vastgezette bytes, een meting met de bestaande
meetcode en telregels naast Zuyd, één eerlijke nieuwe poging voor Wolfslaar en
T-Huis, een bijgewerkte matrix en een voortgangsregel per K. Referenties van
andere bronnen, de telregels, de meetcode en de bestaande Zuyd-referentie zijn
**niet** gewijzigd; er is geen extractiecode, provider, publicatie of merge
aangeraakt.

### K1 — Bardot-referentie uit de vastgezette bytes

De kaartcapture (`existing-card-references.json`, SHA-256 `dcb0e92b…`) legde
alleen URL, content-type, bytegrootte en SHA-256 vast, geen bytes. Eén
verificatiepoging via de bestaande veilige route (`robots.txt` en
redirectcontrole) is daarom apart vastgelegd in
`ops/benchmark/card-reference-captures.json` (SHA-256 `06c00c16…`):

| Gepinde URL | Uitkomst | SHA-256 |
| --- | --- | --- |
| `https://www.brasseriebardot.nl` | **bron gewijzigd** (93.233 bytes, was 93.309) | `9c642296…` |
| `https://www.brasseriebardot.nl/brasserie-bardot/` | **bron gewijzigd** (135.407 bytes, was 135.411) | `45e96b35…` |
| `…/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf` | **identiek aan de pin** | `487ba29f…` |

De twee HTML-pagina's zijn dus een bronwijziging en leveren geen referentie; de
dinerkaart-PDF is byte-identiek en is de enige referentiebron. Status van de pin:
`partially-verified`, één poging (`oneShot: true`).

De referentie `ops/benchmark/reference-references/bardot.json` (SHA-256
`63d39733…`) is uit die PDF opgesteld: **112 gerechten in 29 rubriekpaden**,
**7 supplementen**, **8 twijfelgevallen** en **0 arrangementen**. Elk gerecht
draagt een rubriekpad, een locator met pagina/kolom/baseline, een letterlijk
citaat uit de vastgezette tekst en per bedrag een prijsbewijs. Alle **143**
prijsbewijzen zijn machinematig tegen de vastgezette paginarijen gecontroleerd
(`ops/benchmark/cardReferenceIntegrity.js`); die controle weigert een verkeerde
baseline, kolom of bedrag.

Vastgelegde keuzes, zodat niets stil wordt afgeplat:

- **Dranken tellen mee** (telregel 1): wijnkaart, cocktails, mocktails,
  digestieven en whisky staan als rubrieken in de referentie.
- **Dagprijs zonder bedrag** (`Kreeft (500/600 gr.)`, `Kreeft, pasta aglio e
  olio`): wel bronregels, geen bedrag. Ze staan met de letterlijke regel in
  `ambiguous`, niet als geprijsd item, omdat de bestaande referentiecontrole een
  bedrag per item eist. Een extractie die ze leeg levert, verschijnt daardoor als
  verzonnen rij; dat staat erbij.
- **HOOFDGERECHTEN versus SPECIALITEITEN VAN BARDOT**: de rechterkolom print
  beide koppen; Poussin en Chateaubriand staan als subsectie, de rest als
  HOOFDGERECHTEN. De vlakke lezing staat als twijfelgeval beschreven; de
  kreeft-pasta tussen beide koppen valt onder dezelfde twijfel.
- **Oestertoppings** (`Asian Style`, `Rockefeller met daslook`), **Royal de
  Jarras, Brut Rosé** (geen eigen bedrag), **French sparkling wine**
  (omschrijving), **magnumregels** (eigen regel versus flesvariant) en
  **bronduplicaten** (`Espresso Martini`, `Martha's Porto`) staan met reden in
  `ambiguous`.

### K2 — Meting met de bestaande meetcode, Bardot naast Zuyd

```powershell
node ops/scripts/measure-menu-extraction-card-reference.js
```

Het script leest geen netwerk: het herspeelt de huidige pijplijn op de
vastgezette bytes, gebruikt `referenceComparison.js` en de telregels ongewijzigd
en schrijft `ops/benchmark/card-reference-measurement.json` (SHA-256
`b68f9760…`) en `.md` (`85cd33bb…`). Tweemaal uitgevoerd op dezelfde bytes:
identieke hashes. Alle hashes van tekstbestanden zijn EOL-stabiele
repositoryhashes (`repositoryTextSha256`, het bestaande projecthulpmiddel), zodat
een checkout met CRLF dezelfde waarden geeft; de vastgezette PDF-bytes houden de
gewone bytehash.

| Kaart | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Brasserie Bardot | 112 | 74 | 0 | 76 | 38 | 0 | 36 | 0,00% | 0,00% |
| Restaurant Zuyd | 36 | 34 | 34 | 2 | 0 | 0 | 0 | 100,00% | 94,44% |
| **Totaal (2 gemeten)** | **148** | **108** | **34** | **78** | **38** | **0** | **36** | **31,48%** | **22,97%** |

De Zuyd-uitkomst is gelijk aan de bestaande referentiemeting (34/36): dezelfde
referentie, dezelfde telregels, dezelfde code. De Bardot-uitkomst is de eerlijke
stand van de PDF-layoutlezing: 36 gerechten worden qua naam gevonden maar in een
verkeerde rubriek geplaatst, 38 rijen zijn beschrijvingsfragmenten
(`Per stuk`, `10 gram`, `gefrituurde kappertjes, uienconfit`) en 76
referentiegerechten worden niet gevonden. Nul prijsfouten betekent hier niet
"goed": de meeste rijen matchen niet eens op naam, dus er valt geen prijs te
vergelijken.

### K3 — Eén nieuwe poging voor Wolfslaar en T-Huis

```powershell
node ops/scripts/probe-menu-extraction-blocked-cards.js
```

Eén read-only poging per gepinde URL via de bestaande veilige route (inclusief
`robots.txt`), vastgelegd in `ops/benchmark/existing-card-probe-attempts.json`
(SHA-256 `6ea987c1…`, create-only):

| Kaart | Tijd | Uitkomst | Bewijs |
| --- | --- | --- | --- |
| Wolfslaar `/`, `/nl/menu-lunch`, `/nl/menu-diner` | 2026-10-22T18:06:09Z–18:06:10Z | **leesbaar** (`text/html`) | 105.453 / 70.597 / 69.108 bytes, `c202d9f8…` / `1e36ad74…` / `3e311a54…` |
| T-Huis `/`, `/menu/` | 2026-10-22T18:06:10Z | **leesbaar** (`text/html`) | 121.349 / 91.835 bytes, `d074fd18…` / `c4808261…` |

Beide kaarten zijn dus **niet meer geblokkeerd** vanuit deze omgeving; de eerdere
TLS-fout en redirect-lus traden nu niet op. Er is **geen** menu uit gelezen: deze
poging legt alleen bereikbaarheid vast, bewaart geen bytes en maakt geen
referentie. Criterium 5 staat voor deze twee kaarten daarmee op "bron
bereikbaar, referentiemeting open" — niet "gemeten" en niet "geblokkeerd".

### K4 — Matrix

Criterium 5 staat in `docs/guides/menu-extraction-acceptance-matrix.md` per
kaart bijgewerkt (gemeten, of bereikbaar zonder referentie, met de reden) met
verwijzing naar het eigenaarsbesluit (issuecomment-6315226470, optie 1). De
onjuiste kwalificatie "begrensd" is verwijderd.

### K5 — Voortgang

Per K staat één regel met naam in `ops/benchmark/output/criteria-progress.json`
(volgens de BE-21-afspraak gitignored) onder ronde `6347355753`; dezelfde regels
staan in de checkpoint op PR #60.

### Wat deze ronde expliciet niet doet

- Geen referentie of meting voor Wolfslaar en T-Huis: daarvoor is een nieuwe
  opdracht nodig (bytes vastleggen, referentie opstellen, meten). De bron is nu
  aantoonbaar bereikbaar, dus dat is de eerstvolgende zinvolle stap.
- Geen wijziging aan extractiecode, telregels, meetcode of bestaande
  referenties; geen provider, geen betaalde dienst, geen app-side AI, geen
  productie-, publicatie- of mergeactie.
- Dit blijft ontwikkelaarsbewijs: geen onafhankelijke review en geen
  productieacceptatie.
