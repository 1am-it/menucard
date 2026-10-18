# De Botanist Breda - controlled partial reference (#59)

Status: **ontwikkelaarsbewijs, geen onafhankelijke acceptatie en geen algemene
extractieclaim.** Datum: 2026-10-18. Branch `feat/menu-extraction-59`, PR #60.

Deze referentie hoort bij de eenmalige holdoutmeting in
`ops/benchmark/holdout-evaluation.json` (HOLD-REAL-01). Die eerste meting blijft
ongewijzigd als baseline: 151 items in 59 secties. De bron is daarna gebruikt
voor reparatie en is daarom verplaatst naar `representative` met
`usedForTuning: true`; hij is geen holdout meer.

## Gepinde bronversies

| Bron | Vastlegging |
| --- | --- |
| Entrypagina | `https://debotanistbreda.nl/`, 126831 bytes, SHA-256 `77c950de…b5b0` |
| Werkelijk gelezen menubron | `…/De-Botanist-Breda-Menukaart-voorjaar-20-03-2026_compressed.pdf`, 551498 bytes, SHA-256 `50fef0b6…7f85`, contenthash `eb9da86e…3ade7f`, 16 pagina's |
| Protocol | `MENU-EXTRACTION.md` v0.2, SHA-256 `15510b4c…b762` |

De homepagehash dekt de PDF niet. Daarom staat de PDF als aparte `menuSources`-
entry in `ops/benchmark/holdout-references.json` en in
`ops/benchmark/botanist-reference.json`.

## Methode

De referentie is opgesteld uit de tekstlaag met coördinaten van de gepinde PDF:
kolommen, sectiekoppen en de visuele volgorde zijn gevolgd. De productieparser is
niet als referentie gebruikt. Wat niet verliesvrij leesbaar is, staat expliciet
in `unsupportedSections` en is niet als gerecht gegokt.

Bestand: `ops/benchmark/botanist-reference.json` (21 ondersteunde secties,
141 referentierijen). Guard: `ops/benchmark/botanistReference.test.js`.

## Vergelijking met de deterministische parser

Uitgevoerd op dezelfde PDF-versie met de analyseketen van deze branch:

| Meting | Resultaat |
| --- | --- |
| Referentierijen | 141 |
| Parseritems totaal | 195 (na review 6249915021; was 196) |
| Gematcht op naam binnen dezelfde sectie | 95 |
| Ontbrekend t.o.v. referentie | 46 |
| Extra binnen een gematchte sectie | 5 |
| Prijsverschil bij een naam-match | 0 |
| Parseritems zonder referentiesectie (wijn/cocktail/lunch/verloren kop) | 95 (na review 6249915021; was 96) |

De 95 niet-gekoppelde items zijn geen dekkingbewijs: ze bevatten onder meer
wijn- en cocktailregels en items die hun sectiekop kwijt zijn. De 46 ontbrekende
referentieregels zitten vooral in drank-/lunch-/wijnblokken waar de parser
meerregelige blokken of prijsvarianten nog niet lossless leest. De 5 extra's
zijn concrete naamverschillen (bijvoorbeeld een afgekapte naam).

Na de P1-herstelronde van review 6249303096 is dezelfde gepinde PDF opnieuw
read-only geanalyseerd. De vergelijking met deze referentie bleef exact gelijk
(196 parseritems, 95/46/5, 0 prijsverschil, 96 niet-gekoppeld), maar de
analyse meldt nu eerlijk 12 supplementregels, 18 prijzen midden in de regel en
24 niet-gekoppelde prijsregels. Die laatste categorie is nieuw zichtbaar
gemaakt in plaats van stilzwijgend weggelaten.

Na de P1-herstelronde van review 6249657793 is dezelfde gepinde PDF nogmaals
read-only geanalyseerd. De itemlijst en de layouttellers zijn regel voor regel
gelijk aan de vorige HEAD: 196 items/54 secties, 12 supplementregels, 18
prijzen midden in de regel, 24 niet-gekoppelde prijsregels en 2 onbekende
koppen. De 46 ontbrekende en 96 niet-gekoppelde items blijven dus open; er is
geen referentie aangepast en geen nieuwe holdout geëvalueerd.

Na de P1-herstelronde van review 6249915021 is dezelfde gepinde PDF nogmaals
read-only geanalyseerd. De ambiguïteitsbeslissing gebruikt geen
integer-/decimaalnotatie meer. Daardoor is `Monkey 47` (geplakt, zonder
eenheid, gevolgd door `10.0`) nu de ene extra eerlijk gemelde ambigue regel:
195 items/54 secties, 19 ambigue regels, 24 niet-gekoppelde prijsregels, 12
supplementregels en 2 onbekende koppen. De referentiesecties en hun totalen
blijven exact gelijk (95 matched, 46 missing, 5 extra, 0 prijsverschil); alleen
de toch al niet-gekoppelde bucket daalt van 96 naar 95. Die ene regel is
structureel gelijk aan een glas/fles-regel zonder scheidingsteken en wordt dus
niet geraden. De referentie zelf is niet aangepast.

## Wat deze ronde aantoonbaar heeft hersteld

- Een herhaalde prijs (`4.2`, `0.6`) werd ten onrechte als tweede tekstlaag
  onderdrukt. Een laag moet nu minimaal 30% van de paginatekst dekken; de
  bestaande Smelt-overlaytest blijft groen.
- Naam en prijs op bijna dezelfde baseline worden samengevoegd; prijzen die
  pdfjs boven/onder de naam plaatst verdwijnen niet meer.
- ABV-percentages (`5.0%`) worden niet als naam of prijs opgeslagen.
- Twee sectiemarkers op één regel en herhalende tekstkolommen splitsen
  links/rechts; dit herstelde onder meer de warme dranken, bieren en side
  dishes.
- Een enkel Title-Case woord onder een item is een smaakvariant/description,
  geen nieuwe rubriek; prozatekst met leesteken wordt geen rubriek.
- Prijsbewijs is niet meer paginabreed: een dunne kolom behoudt haar geldige
  bedrag, naamgetallen (`Monkey 47`, `0.0`, `6 st.`) worden niet als prijs
  gelezen zolang er een echt prijsblok rechts staat, en een naam+prijs op twee
  baselines wordt alleen binnen 24 PDF-eenheden gekoppeld. Supplementregels
  met een expliciet `Supplement`-label worden geteld en niet als gerecht
  opgeslagen. Regressies in `pdfMenuStructuring.test.js`.
- HTML: een class-gebaseerd prijselement met hele euro's of één decimaal wordt
  als prijs gelezen (Colonia), en een cadeaukaartlink is geen menulink.

## Wat expliciet niet is opgelost

- Wijn- en cocktailpagina's met meerregelige blokken, glas/fles-prijzen en
  lange beschrijvingen zijn niet verliesvrij te koppelen. Ze staan als
  `unsupportedSections` in de referentie.
- De parser verliest op sommige pagina's nog de sectiekop (items belanden in
  een `Menukaart`-bucket) en maakt van een beschrijvingsregel soms een
  subrubriek. Dat is kwaliteitsbeperking, geen acceptatie.
- 195 items is geen kwaliteits- of volledigheidsbewijs. De vergelijking hierboven
  is de maat, niet het aantal.
- Geen OCR, geen renderingvendor, geen extra betaalde dienst en geen
  app-provider zijn geactiveerd.

## Herstelronde review 6250261342 — sectie- en naamdekking

Zelfde gepinde PDF (SHA-256 `50fef0b6…7f85`), read-only, alleen de
deterministische HTML/PDF-keten. Geen provider, OCR, renderingvendor,
netwerkactie, referentie-aanpassing of productieactie.

De referentie v1 blijft **ongewijzigd** de meetlat: 141 referentierijen in 21
secties. Nieuwe meting op dezelfde PDF:

| Meting | Resultaat |
| --- | --- |
| Parseritems | 214 in 50 categorieën |
| Gematcht op naam binnen dezelfde sectie | **130** (was 95) |
| Ontbrekend t.o.v. referentie | **11** (was 46) |
| Extra binnen een gematchte sectie | **4** (was 5) |
| Prijsverschil bij een naam-match | **0** |
| Parseritems zonder referentiesectie | 80 (was 95) |
| Layouttellers | 18 ambigu, 9 niet-gekoppelde prijsregels, 12 supplementregels, 4 overgenomen kolomsecties, 1 subrubriek, 13 naamcontinuaties, 2 portieregels |

De vergelijking is reproduceerbaar met
`node ops/benchmark/runBotanistComparison.js --pdf=<lokale PDF>`; de PDF-hash
wordt vooraf gecontroleerd en het script schrijft alleen
`ops/benchmark/botanist-comparison.json`.

### Fouttaxonomie per aanknopingspunt

| Aanknopingspunt | Bronbewijs (zelfde PDF) | Taxonomie | Uitkomst |
| --- | --- | --- | --- |
| `PREMIUM FRISDRANKEN` expected 10, actual 0 | p3: `// PREMIUM FRISDRANKEN` x36 y546,5; `// Double Dutch` x227,4 y526,2; namen links x42,8 met bedragen x184; rechts x227,4 met bedragen x369 | verloren kolomkop + prijskolom door paginabrede fallback-ankers; `Double Dutch` is een merk-subkop | **hersteld**: 10 items (3 links + 7 onder `PREMIUM FRISDRANKEN > Double Dutch`), 8 matched. Resterend: `Del Sol Pineapple` (ambigue naamregel) en `Double Dutch Ginger Beer` (inconsistente referentierij) |
| `fritz` expected 10, actual 0 | p3: `// fritz` x41,9 y436 met vijf fritz-limo-regels x41,9 en bedragen x184 | verloren prijskolom; de vijf lemonades horen bij het lagere Soof-blok, niet bij fritz | **deels hersteld**: 5/5 fritz-limo. De 5 lemonades zijn een **niet-ondersteund** blok (ander raster: namen x184,4, bedragen x369, geen kop) |
| `FRISDRANK` afgekapte namen | p2: `Sourcy` + `Still Water, Sourcy` y481,3 met één bedrag 3.0; `Sparkling Water (20cl)` y470; `Lipton Ice Tea Sparkling /` + twee vervolgregels; `Royal Club …` + `/ Ginger Ale` | meerregelige naam met expliciete connector/portie versus omschrijving | **Lipton en Royal Club volledig hersteld**; Sourcy als twee familie-/portieregels samengevoegd. v1 splitst die in vier losse gerechten → **voorstel v2** met bronbewijs |
| `SNACKS`: `Holtkamp ambachtelijke` | p11: y463,7 met bedrag 9,5; y452,5 `draadjesvlees bitterbal` + losse `8st.` | meerregelige naam + losse portie | **hersteld**: volledige naam; `8st.` is geteld als portie en niet als apart gerecht of hoofdprijs |
| `STARTERS` 5 missing / `DESSERTS` 4 / `LUNCH` 4 | p12/p15/p10: rechterkolom heeft geen eigen kop en zet de sectie van de linkerkolom voort | doorlopende sectie over kolommen | **hersteld**: STARTERS 10/10, DESSERTS 8/8, LUNCH 11/11; koppeling als onzeker gemarkeerd en als limitation/flag gemeld |
| `MEDITERRAANS` 0 | p13: `Blue Velvet Gnocchi` y520 met bedrag 13,5 op y518 | drie-woordnaam boven lokale prijsregel | **hersteld**: 3/3 |
| beschrijving werd subrubriek | p4 `England IPA`; p13 `Gemarineerde oesterzwam`; p12 `Krokante sprinkhaan` | beschrijving versus kop | **hersteld**: korte beschrijvingsregel direct onder een geprijsd item blijft omschrijving; geen verzonnen subrubriek |
| `Desperados` ontbrak | p4: `4.0%`/`5.2` op y365, naam op y363 (1,9 eenheid lager) | ABV-microbaseline boven het bedrag | **hersteld**: bedrag boven de naam binnen 3 eenheden wordt gekoppeld; ABV wordt nooit naam of prijs |
| wijn/cocktail/Petite | p7-p9, p5-p6, p11 | meerregelige blokken, glas/fles en porties | **niet opgelost / niet ondersteund**: geen lossless bewijs; wijnregels blijven de bekende beperking houden. Petite-porties staan in de naam of zijn als portieregel geteld |

### Voorstel referentie v2 (historisch, niet geaccepteerd)

`ops/benchmark/botanist-reference.proposed-v2.json` is een **historisch voorstel**
met status `proposed_not_accepted`, gebaseerd op v1. Het bevat drie
brononderbouwde correcties: Sourcy als twee familie-/portieregels, `Ginger Beer`
zonder merkvoorvoegsel, en de vijf lemonades buiten fritz als niet-ondersteund
Soof-blok. v1 blijft ongewijzigd de baseline. Review 6252891629 verwierp de
v2-noemer: de vijf leesbare Soof-rijen verdwenen uit de meetlat. De v2-bestanden
blijven als historie staan en worden niet overschreven; v3 hieronder vervangt
het voorstel, niet de baseline.

Alleen ter controle is het voorstel apart gescoord
(`botanist-comparison.proposed-v2.json`): 133 matched / 1 missing / 1 extra /
0 prijsverschil. Die meting hoort bij de keten vóór de supplementreparatie en
telde de zes supplementrijen nog als gewone gerechten. Ze is daarom historie,
geen actuele stand.

## Herstelronde review 6252891629 — supplementrubriek en referentie v3

Zelfde gepinde PDF (SHA-256 `50fef0b6…7f85`), read-only, alleen de
deterministische HTML/PDF-keten. Geen provider, OCR, renderingvendor,
netwerkactie, referentie-aanpassing of productieactie.

### P1: een expliciete supplementrubriek is geen gerechtenlijst

`// SUPPLEMENTEN` op p2 opent nu een supplementsectie voor de hele linkerkolom
tot de volgende aantoonbare sectiekop. De rechterkolom (`FRISDRANK`) blijft
onaangetast. Dezelfde regel geldt voor een herkenbare gewone kop
`SUPPLEMENTEN` of `SUPPLEMENTEN (per stuk)`. De bestaande inlinevormen
(`Supplement serranoham 2.5`, `+ Bresaola`, de lowercase wrapped continuation)
blijven ongewijzigd: een losse `Supplement ...`-regel opent geen sectie.

Op de gepinde PDF:

| Meting | Uitkomst |
| --- | --- |
| Parseritems | 208 (was 214) |
| `SUPPLEMENTEN` als gewone categorie | 0 items (was 6 met hoofdprijs) |
| `layout.supplementLines` | 18 (was 12) |
| `layout.supplementSections` | `SUPPLEMENTEN`, pagina 2, 6 regels |
| Quality gate | `pdf_supplements_skipped` met sectie en pagina; bron geblokkeerd als productgap |
| Limitation | noemt 18 supplementregels in `SUPPLEMENTEN` p. 2 |

De zes visueel gecontroleerde rijen (Havermelk 0.5, Hazelnootsiroop 0.6,
Karamelsiroop 0.6, Witte chocoladesiroop 0.6, Honing 0.6, Slagroom 0.6) zijn
geen parseritem meer en kunnen niet als gewoon hoofdgerecht doorstromen. Ze
blijven als expliciete productgap in de meting zichtbaar.

Referentie v1 (ongewijzigd 141 rijen) opnieuw gemeten: **124 matched / 11
missing / 4 extra / 0 prijsverschil**, plus **6 expliciete productgap-rijen**
en 80 niet-gekoppelde items. De daling van 130 naar 124 matched is geen
kwaliteitsdaling: dezelfde zes bronrijen werden eerder als gewone gerechten
geteld en zijn nu als productgap geclassificeerd. Boekhouding: 124 + 11 + 6 + 4
= 145 = 141 referentierijen + 4 extra (balanced).

### P2: referentie v3-voorstel met de vijf Soof-rijen in de noemer

`ops/benchmark/botanist-reference.proposed-v3.json` (`3.0.0-proposed`,
`proposed_not_accepted`) vervangt niets. Het behoudt de drie bronbevindingen
(Sourcy, Ginger Beer, fritz-versus-Soof) en zet de vijf leesbare
Soof-lemonades met naam en 4.8 terug in een sectie `SOOF LEMONADES` met
`support: unsupported_readability`, `headingEvidence: none_printed` en
contextbewijs (logo-/prosablok, afwijkend raster). Er is geen itemloze
`unsupportedSection` meer voor dit blok.

Noemer: 141 − 2 Sourcy = **139**. v2 verwijderde ook de vijf Soof-rijen (134);
v3 herstelt ze. De vijf tellen dus mee als missing.

Meting v3 op dezelfde PDF:

| Meting | Uitkomst |
| --- | --- |
| Referentierijen | 139 |
| Totaal | 127 matched / 6 missing / 1 extra / 0 prijsverschil |
| Waarvan productgap | 6 supplementrijen (apart, niet matched) |
| Totale brondekking | 127/139 = 0.9137 |
| Expliciet beperkte subset | 128 rijen: 127 matched / 1 missing / 1 extra / 0 prijsverschil = 0.9922 |
| Uitgesloten rijen | 11: 5 Soof (`unsupported_readability`) + 6 supplementen (`unsupported_product_field`), elk met reden |
| Boekhouding | 127 + 6 + 6 + 1 = 140 = 139 + 1 extra (balanced) |

De subsetscore vervangt de totale dekking niet en maakt de parser niet groener:
elke uitgesloten rij staat met naam, prijs en reden in
`supportedSubset.excludedRows`. Het Del Sol-naamprobleem blijft de enige
missing binnen de subset; het is een parsergap, geen referentiecorrectie.
v1 en v2 zijn niet overschreven.

## Herstelronde review 6253408889 — lokaal afwijkend naam-/prijsraster

De vijf leesbare Soof-lemonades op pagina 3 zijn geen parser-slachtoffer meer van
de ontbrekende tekstkop. De parser gebruikt nu pdfjs' eigen tekstbreedte om te
zien dat een naam die in de linkerkolom begint, fysiek over de paginakolomgrens
heen loopt. Als bovendien de rechterkolom op diezelfde baseline uitsluitend
bedragen/prijsvarianten bevat, wordt dat paar als één lokale rij gelezen.

De reparatie is bewust smal en generiek:

- de linkerkolom mag zelf geen bedrag bevatten;
- de linkertekst moet een plausibele gerechtsnaam zijn, geen langere prozalijn;
- minstens één tekstblok moet met pdfjs' eigen `width` aantoonbaar over de
  kolomgrens heen lopen;
- de rechterkolom mag uitsluitend prijzen en variantseparatoren bevatten;
- zonder `width` gebeurt niets (fail closed), nooit een geschatte tekenbreedte.

De gerepareerde rijen worden **niet** in de actieve rubriek overgeërfd. Hun
koprelatie is niet aantoonbaar, dus ze komen in de bestaande expliciet
ongerubriceerde/onzekere bucket (`sourcePath: []`, `uncertain: true`). De
reviewgate blijft ze als `unclear_category` blokkeren tot een mens de rubriek
benoemt of accepteert. Er is geen rubrieknaam uit het logo of uit de prose
verzonnen.

Op dezelfde gepinde PDF (SHA-256 `50fef0b6…7f85`):

| Meting | Uitkomst |
| --- | --- |
| Parseritems | 215 (was 208) |
| `layout.bridgedPricePairs` | 7 |
| `layout.unlinkedPriceLines` | 2 (was 9) |
| v1 | 124 matched / 11 missing / 4 extra / 0 prijsverschil; noemer 141 |
| v1 niet-gekoppeld | 87 (was 80) |
| v3-voorstel | 127 matched / 6 missing / 1 extra / 0 prijsverschil; noemer 139 |
| v3 `categoryUnknown` | 8 rijen, apart gerapporteerd en niet meegeteld als match |

De zeven gerepareerde rijen zijn vijf Soof-lemonades (naam + 4.8) en twee
pagina-11-oesters (`Oester naturel` 4.0, `Oester oosters` 4.5) die eerder
stilzwijgend buiten de parseruitvoer vielen. De OESTERS-sectie zelf blijft
3/3 gematcht; de twee pagina-11-rijen krijgen geen verzonnen sectie.

De vijf Soof-rijen staan nog steeds als missing in de SOOF-referentiesectie,
omdat `categoryUnknown` bewust geen match oplevert. `runBotanistComparison.js`
rapporteert ze nu apart met parserpad, lege `parserSourcePath`,
`categoryUncertain` en de referentiesectie waarin naam en bedrag voorkomen.
Zo is "correct gelezen, rubriek onbekend" meetbaar zonder de score op te hogen.
De beperkte subsetscore blijft 127/128; de totale dekking blijft 127/139.

## Wat expliciet open blijft

- Het lagere Soof-blok (5 lemonades) wordt nu met naam, bedrag, omschrijving en
  provenance gelezen, maar blijft zonder aantoonbare tekstkop expliciet
  ongerubriceerd/onzeker. In v1 zijn die rijen onderdeel van de
  141-rijenmeetlat; in het v3-voorstel tellen ze nog als missing in
  `SOOF LEMONADES` en apart in `categoryUnknown`. Dat is een eerlijke
  beperking, geen lege successtatus en geen opgehoogde score.
- De categoriekoppeling van de vijf rijen is nog niet opgelost; een
  rubrieksnaam uit het logo/prosablok wordt niet verzonnen. De bestaande
  reviewgate blokkeert opslaan tot een mens de rubriek benoemt of accepteert.
- Wijn-, cocktail- en Petite-blokken blijven niet verliesvrij; ze zijn niet
  als volledig geclaimd.
- Geen OCR, provider, betaalde fallback of browseracceptatie in deze ronde.
- 124/141 (v1) en 127/139 (v3-voorstel) zijn ontwikkelaarsbewijs, geen
  onafhankelijke bronwaarheid of productacceptatie. De supplementproductgap is
  apart zichtbaar en mag niet als gewone dekking worden geteld.
