# Menu-extractie: gecontroleerde referentiemeting (#59)

Gemeten op 4 van 5 vastgezette bronversies met de huidige code op de vastgezette bytes. Senang Makan is geblokkeerd en telt niet als lege of geslaagde extractie.

De referenties zijn vooraf uit de brontekst opgesteld; deze meting is geen ongeziene holdout en geen productieacceptatie. Er is geen OCR, provider of publicatie gebruikt.

Bij een verzonnen rij bestaat per definitie geen referentie-citaat; de regel noemt dan de passage of locator die de extractor zelf bij dat item gaf, of “geen bronpassage”.

## Totalen (alleen gemeten bronnen)

| Maat | Waarde |
| --- | --- |
| Bronnen gemeten / geblokkeerd | 4 / 1 |
| Referentiegerechten | 185 |
| Geëxtraheerde gerechten | 170 |
| Exact gematcht | 165 |
| Gemiste gerechten | 17 |
| Verzonnen gerechten | 2 |
| Prijsfouten | 0 |
| Rubriekfouten | 3 |
| Precisie | 97.06% |
| Recall | 89.19% |

## Per bron

| Bron | Status | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Restaurant Zuyd | gemeten | 36 | 34 | 34 | 2 | 0 | 0 | 0 | 100.00% | 94.44% |
| Andalous Restaurant Breda | gemeten | 87 | 84 | 81 | 3 | 0 | 0 | 3 | 96.43% | 93.10% |
| Restaurant Pellens | gemeten | 36 | 26 | 24 | 12 | 2 | 0 | 0 | 92.31% | 66.67% |
| Restaurant Chocolat | gemeten | 26 | 26 | 26 | 0 | 0 | 0 | 0 | 100.00% | 100.00% |
| Senang Makan | geblokkeerd | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n.v.t. | n.v.t. |

## Afwijkingen per bron

### Restaurant Zuyd

**Gemist (2)**
- `Kaasassortiment` — Diner › A LA CARTE — prijs 13.00 / 19.50 — citaat: “Kaasassortiment selectie van kazen │ Zuydvruchtencompote │ brood vier stuks 13 - zes stuks 19,50 - in plaats van dessert, supplement 8,50” (Diner › A LA CARTE › regel 9)
- `Kaasassortiment` — Lunch › A LA CARTE — prijs 13.00 / 19.50 — citaat: “Kaasassortiment selectie van kazen │ Zuydvruchtencompote │ brood vier stuks 13 - zes stuks 19,50 - in plaats van dessert, supplement 8,50” (Lunch › A LA CARTE › regel 9)

**Verzonnen (0)**
- geen

**Prijsfouten (0)**
- geen

**Rubriekfouten (0)**
- geen

**Beperkingen**
- Lunch en diner zijn twee afzonderlijke menuvarianten; beide zijn als eigen menu opgenomen.
- De kerstmenu- en afhaalpagina's zijn arrangementen; hun gangen hebben geen eigen prijs en zijn geen losse referentiegerechten.
- De vastgezette menupagina's bevatten geen allergenenlegenda per gerecht; allergenen blijven onbekend, niet allergeenvrij.
- Deze referentie is uit de vastgezette brontekst opgesteld en niet uit de parseruitvoer.
- Menukaart https://www.restaurantzuyd.nl/lunch: sectie "Lunch › LUNCHMENU'S" is niet als gerechten opgenomen; 4 regel(s) horen bij een arrangement of keuzemenu (prijs per gang of portie) en zijn geen losse gerechten.
- Menukaart https://www.restaurantzuyd.nl/lunch: 1 gerecht(en)/regel(s) met meerdere prijzen (prijsvarianten zoals klein/hoofd, glas/fles of aantal stuks) zijn niet als losse prijs opgeslagen; de deterministische context ondersteunt één prijs per gerecht en er is geen prijs geraden.
- Menukaart https://www.restaurantzuyd.nl/diner: sectie "Diner › VERRASSINGSMENU'S" is niet als gerechten opgenomen; 4 regel(s) horen bij een arrangement of keuzemenu (prijs per gang of portie) en zijn geen losse gerechten.
- Menukaart https://www.restaurantzuyd.nl/diner: 1 gerecht(en)/regel(s) met meerdere prijzen (prijsvarianten zoals klein/hoofd, glas/fles of aantal stuks) zijn niet als losse prijs opgeslagen; de deterministische context ondersteunt één prijs per gerecht en er is geen prijs geraden.
- Gelezen zonder automatisch herkende menukaart: https://www.restaurantzuyd.nl/kerstmenu.
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (html_arrangements_skipped); het resultaat is niet als volledig beoordeeld.

**Vastgezette bronversie:** 6 capture(s); html f4f685da725f, html 389470158b72, html 128cae10ca14, html 2bfaf63e7814, html 644810dfc971, html c9c130c079b7

### Andalous Restaurant Breda

**Gemist (3)**
- `Loaded Fries Scampi` — Menukaart › Hoofdgerechten* — prijs 17.00 — citaat: “Loaded Fries Scampi, €17,00 Gekruide friet met gemarineerde scampi garnalen overgoten met kaassaus en diverse groentes” (Menukaart › Hoofdgerechten* › Visgerechten › regel 1)
- `Mixed Grill Andalous` — Menukaart › Hoofdgerechten* — prijs 27.50 / 48.50 — citaat: “Mixed Grill Andalous, €27,50 (1 pers.) / €48,50 (2 pers.) Mix van Ribeye South America, Lams-Rack, Marokkaanse kefta, kipfilet geserveerd met champignonsaus” (Menukaart › Hoofdgerechten* › regel 7)
- `Grillburger Andalous` — Menukaart › Kindermenu — prijs 11.50 — citaat: “Grillburger Andalous, €11 ,50 Gegrilde rundergehakt in een speciaal hamburgerbrood met cheddar, mayonaise, ketchup, sla en tomaat geserveerd met friet.” (Menukaart › Kindermenu › regel 3)

**Verzonnen (0)**
- geen

**Prijsfouten (0)**
- geen

**Rubriekfouten (3)**
- `Gamba croquettes` — verwacht Menukaart › Visgerechten; geëxtraheerd Menukaart › Warme voorgerechten › Visgerechten — citaat: “Gamba croquettes, €9,50 Verfijnde croquettes gevuld met ragouts en gerold in kruim van geroosterd brood, geserveerd met een huisgemaakte saus”
- `Pil Pil` — verwacht Menukaart › Visgerechten; geëxtraheerd Menukaart › Warme voorgerechten › Visgerechten — citaat: “Pil Pil, €11,00 Gamba’s op Spaanse manier bereid in knoflook en peper”
- `Pil Pil a la Andalous` — verwacht Menukaart › Visgerechten; geëxtraheerd Menukaart › Warme voorgerechten › Visgerechten — citaat: “Pil Pil a la Andalous, €12,00 Gamba’s in een huisgemaakte saus met knoflook, tomaat, citroen en verse kruiden”

**Beperkingen**
- De Ramadan-PDF is een seizoensarrangement; de gangen hebben geen eigen prijs en zijn geen losse referentiegerechten.
- De Frans-talige ramadanpagina en de pagina's /thuisbezorgd en /werken zijn gelezen maar bevatten geen menukaart met losse gerechten; ze zijn geen referentiebron.
- De pagina /ramadan is naar /ramadan-menu/ doorgestuurd en telt als één pagina (telregel 5).
- De bron bevat alleen een algemene allergenenmededeling, geen allergenenlegenda per gerecht; allergenen blijven onbekend.
- Deze referentie is uit de vastgezette brontekst en PDF-tekst opgesteld en niet uit de parseruitvoer.
- Menukaart https://www.andalous-breda.nl/menukaart/: sectie "Menukaart › Koude dranken › Meer informatie" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://www.andalous-breda.nl/menukaart/: sectie "Menukaart › Koude dranken › Contactgegevens" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://www.andalous-breda.nl/menukaart/: 1 gerecht(en)/regel(s) met meerdere prijzen (prijsvarianten zoals klein/hoofd, glas/fles of aantal stuks) zijn niet als losse prijs opgeslagen; de deterministische context ondersteunt één prijs per gerecht en er is geen prijs geraden.
- Gelezen zonder automatisch herkende menukaart: https://www.andalous-breda.nl/ramadan-menu/.
- Doorgestuurd naar een al gelezen pagina; niet nogmaals verwerkt: https://www.andalous-breda.nl/ramadan → https://www.andalous-breda.nl/ramadan-menu/.
- PDF https://andalous-breda.nl/wp-content/uploads/2026/02/Ramadan-menu-kaart-Essaouira-_20240316_170004_0000.pdf_compressed-1.pdf: 1 prijsregel(s) konden zonder aantoonbare lokale naam-/prijskoppeling niet als gerecht worden opgenomen.
- PDF https://andalous-breda.nl/wp-content/uploads/2026/02/Ramadan-menu-kaart-Essaouira-_20240316_170004_0000.pdf_compressed-1.pdf: 20 mogelijke rubriekkop(pen) zijn niet herkend en dus niet als rubriek opgeslagen.
- PDF https://andalous-breda.nl/wp-content/uploads/2026/02/Ramadan-menu-kaart-Essaouira-_20240316_170004_0000.pdf_compressed-1.pdf bevat geen betrouwbaar herkenbare gerechten met prijs.
- Gelezen zonder automatisch herkende menukaart: https://www.andalous-breda.nl/fr/ramadan-menu/.
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (pdf_unlinked_price_lines, pdf_unrecognised_headings, html_arrangements_skipped, no_deterministic_items); het resultaat is niet als volledig beoordeeld.

**Vastgezette bronversie:** 8 capture(s); html 8c2fb5e31c5f, html 93b11284b922, html 69b1011c0777, html 1faa547bd4b3, html a22fb64af8d9, html a469bf6ab62b, pdf 9a32541b2a5a, html 521e389ce669

### Restaurant Pellens

**Gemist (12)**
- `Eekhoorntjesbrood` — Onze kaart › Diner › À la carte › Groenten — prijs 22.00 / 26.00 — citaat: “Eekhoorntjesbrood biet, koffie €22,00 €26,00” (Diner › À la carte › Groenten › regel 5)
- `Spitskool` — Onze kaart › Diner › À la carte › Groenten — prijs 18.00 / 24.00 — citaat: “Spitskool huacatay, pommes dauphine €18,00 €24,00” (Diner › À la carte › Groenten › regel 6)
- `Beekridder` — Onze kaart › Diner › À la carte › Pellens — prijs 21.00 / 31.00 — citaat: “Beekridder vijgenblad, gerookte boter €21,00 €31,00” (Diner › À la carte › Pellens › regel 2)
- `Langoustine` — Onze kaart › Diner › À la carte › Pellens — prijs 23.00 / 38.00 — citaat: “Langoustine wortel, bouillabaisse €23,00 €38,00” (Diner › À la carte › Pellens › regel 3)
- `Wilde eend` — Onze kaart › Diner › À la carte › Pellens — prijs 24.00 / 39.00 — citaat: “Wilde eend biet, koffie €24,00 €39,00” (Diner › À la carte › Pellens › regel 5)
- `Eekhoorntjesbrood` — Onze kaart › Lunch › À la carte › Groenten — prijs 22.00 / 26.00 — citaat: “Eekhoorntjesbrood biet, koffie €22,00 €26,00” (Lunch › À la carte › Groenten › regel 5)
- `Spitskool` — Onze kaart › Lunch › À la carte › Groenten — prijs 18.00 / 24.00 — citaat: “Spitskool huacatay, pommes dauphine €18,00 €24,00” (Lunch › À la carte › Groenten › regel 6)
- `Beekridder` — Onze kaart › Lunch › À la carte › Pellens — prijs 21.00 / 31.00 — citaat: “Beekridder vijgenblad, gerookte boter €21,00 €31,00” (Lunch › À la carte › Pellens › regel 2)
- `Langoustine` — Onze kaart › Lunch › À la carte › Pellens — prijs 23.00 / 38.00 — citaat: “Langoustine wortel, bouillabaisse €23,00 €38,00” (Lunch › À la carte › Pellens › regel 3)
- `Wilde eend` — Onze kaart › Lunch › À la carte › Pellens — prijs 24.00 / 39.00 — citaat: “Wilde eend biet, koffie €24,00 €39,00” (Lunch › À la carte › Pellens › regel 5)
- `Ui oude kaas` — Onze kaart › Lunch › Brioches — prijs 12.50 — citaat: “Ui oude kaas €12,50” (Lunch › Brioches › regel 4)
- `Wagyu A5 Miyazaki` — Onze kaart › Lunch › Brioches — prijs 47.00 — citaat: “Wagyu A5 Miyazaki €47,00” (Lunch › Brioches › regel 5)

**Verzonnen (2)**
- `Ui` — Onze kaart › Lunch › Brioches — prijs 12.50 — broncitaat: “Ui oude kaas €12,50”
- `Wagyu A5` — Onze kaart › Lunch › Brioches — prijs 47.00 — broncitaat: “Wagyu A5 Miyazaki €47,00”

**Prijsfouten (0)**
- geen

**Rubriekfouten (0)**
- geen

**Beperkingen**
- De diner-tab bevat naast de arrangementen (Menu Pellens, Menu légumes, Formule du Jour) dezelfde à-la-cartekaart als de lunch-tab: À la carte › Pellens (6), Groenten (6) en Dessert (1). Die dertien gerechten staan volgens telregel 5 als eigen referentie-items onder het pad Diner.
- De pagina bevat een verborgen tweede weergave van brioches en salades; die is geen tweede gerecht en telt één keer.
- De allergeninformatie staat alleen in de algemene FAQ; allergenen per gerecht blijven onbekend.
- Deze referentie is uit de vastgezette brontekst opgesteld en niet uit de parseruitvoer.
- Menukaart https://pellens.nl/: sectie "Onze kaart › Lunch › Formule du Jour" is niet als gerechten opgenomen; 2 regel(s) horen bij een arrangement of keuzemenu (prijs per gang of portie) en zijn geen losse gerechten.
- Menukaart https://pellens.nl/: sectie "Onze kaart › Diner › Menu Pellens" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://pellens.nl/: sectie "Onze kaart › Diner › Menu légumes" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://pellens.nl/: sectie "Onze kaart › Diner › À la carte › Formule du Jour" is niet als gerechten opgenomen; 2 regel(s) horen bij een arrangement of keuzemenu (prijs per gang of portie) en zijn geen losse gerechten.
- Menukaart https://pellens.nl/: 10 gerecht(en)/regel(s) met meerdere prijzen (prijsvarianten zoals klein/hoofd, glas/fles of aantal stuks) zijn niet als losse prijs opgeslagen; de deterministische context ondersteunt één prijs per gerecht en er is geen prijs geraden.
- Menukaart https://pellens.nl/: een verborgen tweede weergave van dezelfde kaart is één keer geteld; 10 gerecht(en) zijn niet dubbel opgenomen.
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (duplicate_item_across_categories, html_arrangements_skipped); het resultaat is niet als volledig beoordeeld.

**Vastgezette bronversie:** 1 capture(s); html 66f57e267289

### Restaurant Chocolat

**Gemist (0)**
- geen

**Verzonnen (0)**
- geen

**Prijsfouten (0)**
- geen

**Rubriekfouten (0)**
- geen

**Beperkingen**
- De /menu-pagina toont alleen tegels naar de lunch- en dinerkaart en is geen menukaart.
- De pagina /arrangementen bevat arrangementprijzen voor gezelschappen en geen losse gerechten.
- De allergeninformatie is een algemene mededeling; allergenen per gerecht blijven onbekend.
- Deze referentie is uit de vastgezette brontekst opgesteld en niet uit de parseruitvoer.
- Gelezen zonder automatisch herkende menukaart: https://www.restaurant-chocolat.nl/menu/.
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.

**Vastgezette bronversie:** 6 capture(s); html 186958b4753f, html 0754bdd2f6ca, html 4ac64c425f1c, html 7122b5d1c92b, html 3acbf4874eed, html a35ee43d2d68

### Senang Makan

- **Geblokkeerd:** robots.txt van deze site was niet bereikbaar (HTTP 503) — de pagina is niet opgehaald.
- Geen vastgezette bytes en dus geen referentie: de bron was op het moment van vastleggen niet leesbaar via de bestaande veilige route (HTTP 503 op robots.txt).
- Dit is een bronbeperking, geen lege menukaart en geen succesvolle extractie.
- De afhaal-PDF is niet vastgelegd omdat de website zelf niet leesbaar was; de PDF-URL is niet geraden.

## Integriteit en herhaalbaarheid

- Telregels: `docs/guides/menu-extraction-reference-counting-rules.md`, SHA-256 `0f09b74fdd9f33ecd58af4e3df8ab3c711ee70d32030bc4296f3af78adc2f09c`.
- Capturemetadata: `ops/benchmark/reference-captures.json`, SHA-256 `a042e47a0241359aa9f94283875c1c9127488d25a611ced40b80c629ef8361ce`.
- Iedere referentiequote is tegen de vastgezette bytes gecontroleerd; iedere capture is opnieuw op SHA-256 en bytegrootte gecontroleerd.
- De analyse is op de vastgezette bytes herhaald zonder netwerkoproep; hetzelfde script op dezelfde bytes levert hetzelfde rapport.
- Deze vijf bronnen zijn geen ongeziene holdout: de referenties zijn opgesteld om op bij te sturen.

