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
| Parseritems totaal | 196 |
| Gematcht op naam binnen dezelfde sectie | 95 |
| Ontbrekend t.o.v. referentie | 46 |
| Extra binnen een gematchte sectie | 5 |
| Prijsverschil bij een naam-match | 0 |
| Parseritems zonder referentiesectie (wijn/cocktail/lunch/verloren kop) | 96 |

De 96 niet-gekoppelde items zijn geen dekkingbewijs: ze bevatten onder meer
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
- 196 items is geen kwaliteits- of volledigheidsbewijs. De vergelijking hierboven
  is de maat, niet het aantal.
- Geen OCR, geen renderingvendor, geen extra betaalde dienst en geen
  app-provider zijn geactiveerd.
