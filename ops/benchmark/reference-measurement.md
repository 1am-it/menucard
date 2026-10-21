# Menu-extractie: gecontroleerde referentiemeting (#59)

Gemeten op 4 van 5 vastgezette bronversies met de huidige code op de vastgezette bytes. Senang Makan is geblokkeerd en telt niet als lege of geslaagde extractie.

De referenties zijn vooraf uit de brontekst opgesteld; deze meting is geen ongeziene holdout en geen productieacceptatie. Er is geen OCR, provider of publicatie gebruikt.

Bij een verzonnen rij bestaat per definitie geen referentie-citaat; de regel noemt dan de passage of locator die de extractor zelf bij dat item gaf, of “geen bronpassage”.

## Totalen (alleen gemeten bronnen)

| Maat | Waarde |
| --- | --- |
| Bronnen gemeten / geblokkeerd | 4 / 1 |
| Referentiegerechten | 171 |
| Geëxtraheerde gerechten | 157 |
| Exact gematcht | 120 |
| Gemiste gerechten | 39 |
| Verzonnen gerechten | 25 |
| Prijsfouten | 2 |
| Rubriekfouten | 10 |
| Precisie | 76.43% |
| Recall | 70.18% |

## Per bron

| Bron | Status | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Restaurant Zuyd | gemeten | 36 | 25 | 23 | 11 | 0 | 2 | 0 | 92.00% | 63.89% |
| Andalous Restaurant Breda | gemeten | 86 | 81 | 77 | 7 | 2 | 0 | 2 | 95.06% | 89.53% |
| Restaurant Pellens | gemeten | 23 | 27 | 0 | 19 | 23 | 0 | 4 | 0.00% | 0.00% |
| Restaurant Chocolat | gemeten | 26 | 24 | 20 | 2 | 0 | 0 | 4 | 83.33% | 76.92% |
| Senang Makan | geblokkeerd | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n.v.t. | n.v.t. |

## Afwijkingen per bron

### Restaurant Zuyd

**Gemist (11)**
- `Eendenlever` — Diner › A LA CARTE — prijs 28.00 — citaat: “Eendenlever gebakken lever │ macaron │ crème van lever │ peer │ steranijs 28” (Diner › A LA CARTE › regel 7)
- `Kaasassortiment` — Diner › A LA CARTE — prijs 13.00 / 19.50 — citaat: “Kaasassortiment selectie van kazen │ Zuydvruchtencompote │ brood vier stuks 13 - zes stuks 19,50 - in plaats van dessert, supplement 8,50” (Diner › A LA CARTE › regel 9)
- `Kaasgerecht ‘3 x Epoisses’` — Diner › A LA CARTE — prijs 17.00 — citaat: “Kaasgerecht ‘3 x Epoisses’ - 17 - in plaats van dessert, supplement 8,50” (Diner › A LA CARTE › regel 8)
- `Ossenhaas` — Diner › A LA CARTE — prijs 35.00 — citaat: “Ossenhaas rosé gebraden ossenhaas │ runderstoverij │ 'triple fried' pont-neuf │ paprika │ jus Stroganoff 35 - supplement eendenlever 9” (Diner › A LA CARTE › regel 6)
- `Oesterproeverij Deluxe` — Diner › BITES - voor bij het aperitief — prijs 29.50 — citaat: “Oesterproeverij Deluxe - 6 stuks opgemaakte oesters - 29,50” (Diner › BITES - voor bij het aperitief › regel 2)
- `Eendenlever` — Lunch › A LA CARTE — prijs 28.00 — citaat: “Eendenlever gebakken lever │ macaron │ crème van lever │ peer │ steranijs 28” (Lunch › A LA CARTE › regel 7)
- `Kaasassortiment` — Lunch › A LA CARTE — prijs 13.00 / 19.50 — citaat: “Kaasassortiment selectie van kazen │ Zuydvruchtencompote │ brood vier stuks 13 - zes stuks 19,50 - in plaats van dessert, supplement 8,50” (Lunch › A LA CARTE › regel 9)
- `Kaasgerecht ‘3 x Epoisses’` — Lunch › A LA CARTE — prijs 17.00 — citaat: “Kaasgerecht ‘3 x Epoisses’ - 17 - in plaats van dessert, supplement 8,50” (Lunch › A LA CARTE › regel 8)
- `Ossenhaas` — Lunch › A LA CARTE — prijs 35.00 — citaat: “Ossenhaas rosé gebraden ossenhaas │ runderstoverij │ 'triple fried' pont-neuf │ paprika │ jus Stroganoff 35 - supplement eendenlever 9” (Lunch › A LA CARTE › regel 6)
- `Lobster roll` — Lunch › SANDWICHES — prijs 25.00 — citaat: “Lobster roll brioche │ kreeft │ frisse salade │ kreeftensoep 25” (Lunch › SANDWICHES › regel 2)
- `Sandwich Zuyd` — Lunch › SANDWICHES — prijs 19.50 — citaat: “Sandwich Zuyd krentenbrood │ dungesneden ossenhaas │ eendenlever │ rucola │ truffel │ kaas 19,50” (Lunch › SANDWICHES › regel 1)

**Verzonnen (0)**
- geen

**Prijsfouten (2)**
- `Zeetongfilet` — Diner › A LA CARTE — verwacht 39.00; geëxtraheerd 28.00 — citaat: “Zeetongfilet - gebakken zeetongfilet │ Hollandse garnaal │ saffraan │ pompoen │ bouillabaisse 39” (Diner › A LA CARTE › regel 5)
- `Zeetongfilet` — Lunch › A LA CARTE — verwacht 39.00; geëxtraheerd 28.00 — citaat: “Zeetongfilet - gebakken zeetongfilet │ Hollandse garnaal │ saffraan │ pompoen │ bouillabaisse 39” (Lunch › A LA CARTE › regel 5)

**Rubriekfouten (0)**
- geen

**Beperkingen**
- Lunch en diner zijn twee afzonderlijke menuvarianten; beide zijn als eigen menu opgenomen.
- De kerstmenu- en afhaalpagina's zijn arrangementen; hun gangen hebben geen eigen prijs en zijn geen losse referentiegerechten.
- De vastgezette menupagina's bevatten geen allergenenlegenda per gerecht; allergenen blijven onbekend, niet allergeenvrij.
- Deze referentie is uit de vastgezette brontekst opgesteld en niet uit de parseruitvoer.
- Gelezen zonder automatisch herkende menukaart: https://www.restaurantzuyd.nl/kerstmenu.
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.

**Vastgezette bronversie:** 6 capture(s); html f4f685da725f, html 389470158b72, html 128cae10ca14, html 2bfaf63e7814, html 644810dfc971, html c9c130c079b7

### Andalous Restaurant Breda

**Gemist (7)**
- `Mixed Grill Andalous` — Menukaart › Hoofdgerechten* — prijs 27.50 / 48.50 — citaat: “Mixed Grill Andalous, €27,50 (1 pers.) / €48,50 (2 pers.) Mix van Ribeye South America, Lams-Rack, Marokkaanse kefta, kipfilet geserveerd met champignonsaus” (Menukaart › Hoofdgerechten* › regel 7)
- `Grillburger Andalous` — Menukaart › Kindermenu — prijs 11.50 — citaat: “Grillburger Andalous, €11 ,50 Gegrilde rundergehakt in een speciaal hamburgerbrood met cheddar, mayonaise, ketchup, sla en tomaat geserveerd met friet.” (Menukaart › Kindermenu › regel 3)
- `Pasta bolognese` — Menukaart › Pasta's — prijs 13.00 — citaat: “Pasta bolognese, €13,00 Klassieke pasta met gekruid rundergehakt in tomatensaus met basilicum” (Menukaart › Pasta's › regel 3)
- `Pasta funghi` — Menukaart › Pasta's — prijs 11.00 — citaat: “Pasta funghi , €11,00 V Heerlijke romige vegetarische pasta met champignons en uitjes” (Menukaart › Pasta's › regel 2)
- `Pasta zalm` — Menukaart › Pasta's — prijs 16.00 — citaat: “Pasta zalm, €16,00 Pasta met zalm, spinazie en diverse groente in een romige witte saus” (Menukaart › Pasta's › regel 1)
- `Gamba croquettes` — Menukaart › Visgerechten — prijs 9.50 — citaat: “Gamba croquettes, €9,50 Verfijnde croquettes gevuld met ragouts en gerold in kruim van geroosterd brood, geserveerd met een huisgemaakte saus” (Menukaart › Visgerechten › regel 1)
- `Kip loempia’s` — Menukaart › Warme voorgerechten — prijs 8.00 — citaat: “Kip loempia’s, €8,00 Oosterse loempiarollen gevuld met gekruide kip en groente (2 st)” (Menukaart › Warme voorgerechten › regel 4)

**Verzonnen (2)**
- `€` — Menukaart — prijs 39.50 — geen bronpassage (extractor-locator: pdf:1:item:1)
- `Geraspte kaas` — Menukaart › Pasta's — prijs 2.00 — broncitaat: “Geraspte kaas meerprijs €2,00”

**Prijsfouten (0)**
- geen

**Rubriekfouten (2)**
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
- Gelezen zonder automatisch herkende menukaart: https://www.andalous-breda.nl/ramadan-menu/.
- Doorgestuurd naar een al gelezen pagina; niet nogmaals verwerkt: https://www.andalous-breda.nl/ramadan → https://www.andalous-breda.nl/ramadan-menu/.
- PDF https://andalous-breda.nl/wp-content/uploads/2026/02/Ramadan-menu-kaart-Essaouira-_20240316_170004_0000.pdf_compressed-1.pdf: 20 mogelijke rubriekkop(pen) zijn niet herkend en dus niet als rubriek opgeslagen.
- Gelezen zonder automatisch herkende menukaart: https://www.andalous-breda.nl/fr/ramadan-menu/.
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (pdf_unrecognised_headings, html_arrangements_skipped); het resultaat is niet als volledig beoordeeld.

**Vastgezette bronversie:** 8 capture(s); html 8c2fb5e31c5f, html 93b11284b922, html 69b1011c0777, html 1faa547bd4b3, html a22fb64af8d9, html a469bf6ab62b, pdf 9a32541b2a5a, html 521e389ce669

### Restaurant Pellens

**Gemist (19)**
- `Verveine` — Onze kaart › Lunch › À la carte › Dessert — prijs 14.00 — citaat: “Verveine karnemelk, peer €14,00” (Lunch › À la carte › Dessert › regel 1)
- `Eekhoorntjesbrood` — Onze kaart › Lunch › À la carte › Groenten — prijs 22.00 / 26.00 — citaat: “Eekhoorntjesbrood biet, koffie €22,00 €26,00” (Lunch › À la carte › Groenten › regel 5)
- `Fruits de Terre` — Onze kaart › Lunch › À la carte › Groenten — prijs 18.00 — citaat: “Fruits de Terre wisselende samenstelling €18,00 —” (Lunch › À la carte › Groenten › regel 1)
- `Meloes-ui` — Onze kaart › Lunch › À la carte › Groenten — prijs 17.00 — citaat: “Meloes-ui balsamico, oude kaas €17,00 —” (Lunch › À la carte › Groenten › regel 4)
- `Spitskool` — Onze kaart › Lunch › À la carte › Groenten — prijs 18.00 / 24.00 — citaat: “Spitskool huacatay, pommes dauphine €18,00 €24,00” (Lunch › À la carte › Groenten › regel 6)
- `Vijgenblad` — Onze kaart › Lunch › À la carte › Groenten — prijs 18.00 — citaat: “Vijgenblad radijs, gerookte boter €18,00 —” (Lunch › À la carte › Groenten › regel 2)
- `Wortel` — Onze kaart › Lunch › À la carte › Groenten — prijs 19.00 — citaat: “Wortel venkel, shiso €19,00 —” (Lunch › À la carte › Groenten › regel 3)
- `Beekridder` — Onze kaart › Lunch › À la carte › Pellens — prijs 21.00 / 31.00 — citaat: “Beekridder vijgenblad, gerookte boter €21,00 €31,00” (Lunch › À la carte › Pellens › regel 2)
- `Hamachi` — Onze kaart › Lunch › À la carte › Pellens — prijs 22.00 — citaat: “Hamachi druif, prei €22,00 —” (Lunch › À la carte › Pellens › regel 1)
- `Hollands melkrund` — Onze kaart › Lunch › À la carte › Pellens — prijs 37.00 — citaat: “Hollands melkrund beenmerg, pommes dauphine — €37,00” (Lunch › À la carte › Pellens › regel 6)
- `Langoustine` — Onze kaart › Lunch › À la carte › Pellens — prijs 23.00 / 38.00 — citaat: “Langoustine wortel, bouillabaisse €23,00 €38,00” (Lunch › À la carte › Pellens › regel 3)
- `Meloes-ui` — Onze kaart › Lunch › À la carte › Pellens — prijs 17.00 — citaat: “Meloes-ui balsamico, oude kaas €17,00 —” (Lunch › À la carte › Pellens › regel 4)
- `Wilde eend` — Onze kaart › Lunch › À la carte › Pellens — prijs 24.00 / 39.00 — citaat: “Wilde eend biet, koffie €24,00 €39,00” (Lunch › À la carte › Pellens › regel 5)
- `Entrecôte` — Onze kaart › Lunch › Brioches — prijs 21.50 — citaat: “Entrecôte zwarte knoflook €21,50” (Lunch › Brioches › regel 1)
- `Ui oude kaas` — Onze kaart › Lunch › Brioches — prijs 12.50 — citaat: “Ui oude kaas €12,50” (Lunch › Brioches › regel 4)
- `Wagyu A5 Miyazaki` — Onze kaart › Lunch › Brioches — prijs 47.00 — citaat: “Wagyu A5 Miyazaki €47,00” (Lunch › Brioches › regel 5)
- `Entrecôte` — Onze kaart › Lunch › Salades — prijs 24.50 — citaat: “Entrecôte €24,50” (Lunch › Salades › regel 1)
- `Van onze boerderij` — Onze kaart › Lunch › Salades — prijs 17.50 — citaat: “Van onze boerderij €17,50” (Lunch › Salades › regel 3)
- `Zeevruchten` — Onze kaart › Lunch › Salades — prijs 22.50 — citaat: “Zeevruchten €22,50” (Lunch › Salades › regel 2)

**Verzonnen (23)**
- `Brioche` — Welkom bij Pellens › Les Brioches — prijs 12.50 — broncitaat: “Brioche Ui · oude kaas€12.50”
- `Brioche` — Welkom bij Pellens › Les Brioches — prijs 15.50 — broncitaat: “Brioche Pulled pork€15.50”
- `Brioche` — Welkom bij Pellens › Les Brioches — prijs 19.50 — broncitaat: “Brioche Jamón Ibérico€19.50”
- `Brioche` — Welkom bij Pellens › Les Brioches — prijs 21.50 — broncitaat: “Brioche Entrecôte · zwarte knoflook€21.50”
- `Brioche` — Welkom bij Pellens › Les Brioches — prijs 47.00 — broncitaat: “Brioche Wagyu A5 Miyazaki€47.00”
- `Verveinekarnemelk, peer` — Welkom bij Pellens › Onze kaart › À la carte › Dessert — prijs 14.00 — broncitaat: “Verveinekarnemelk, peer €14,00”
- `2 gangenvoor- en hoofdgerecht of hoofdgerecht en dessert` — Welkom bij Pellens › Onze kaart › À la carte › Formule du Jour — prijs 45.00 — broncitaat: “2 gangenvoor- en hoofdgerecht of hoofdgerecht en dessert €45,00”
- `3 gangenvoor-, hoofdgerecht en dessert` — Welkom bij Pellens › Onze kaart › À la carte › Formule du Jour — prijs 55.00 — broncitaat: “3 gangenvoor-, hoofdgerecht en dessert €55,00”
- `Fruits de Terrewisselende samenstelling` — Welkom bij Pellens › Onze kaart › À la carte › Groenten — prijs 18.00 — broncitaat: “Fruits de Terrewisselende samenstelling €18,00 —”
- `Meloes-uibalsamico, oude kaas` — Welkom bij Pellens › Onze kaart › À la carte › Groenten — prijs 17.00 — broncitaat: “Meloes-uibalsamico, oude kaas €17,00 —”
- `Vijgenbladradijs, gerookte boter` — Welkom bij Pellens › Onze kaart › À la carte › Groenten — prijs 18.00 — broncitaat: “Vijgenbladradijs, gerookte boter €18,00 —”
- `Wortelvenkel, shiso` — Welkom bij Pellens › Onze kaart › À la carte › Groenten — prijs 19.00 — broncitaat: “Wortelvenkel, shiso €19,00 —”
- `Hamachidruif, prei` — Welkom bij Pellens › Onze kaart › À la carte › Pellens — prijs 22.00 — broncitaat: “Hamachidruif, prei €22,00 —”
- `Hollands melkrundbeenmerg, pommes dauphine` — Welkom bij Pellens › Onze kaart › À la carte › Pellens — prijs 37.00 — broncitaat: “Hollands melkrundbeenmerg, pommes dauphine — €37,00”
- `Meloes-uibalsamico, oude kaas` — Welkom bij Pellens › Onze kaart › À la carte › Pellens — prijs 17.00 — broncitaat: “Meloes-uibalsamico, oude kaas €17,00 —”
- `Entrecôtezwarte knoflook` — Welkom bij Pellens › Onze kaart › Brioches — prijs 21.50 — broncitaat: “Entrecôtezwarte knoflook €21,50”
- `Uioude kaas` — Welkom bij Pellens › Onze kaart › Brioches — prijs 12.50 — broncitaat: “Uioude kaas €12,50”
- `Wagyu A5Miyazaki` — Welkom bij Pellens › Onze kaart › Brioches — prijs 47.00 — broncitaat: “Wagyu A5Miyazaki €47,00”
- `2 gangenvoor- en hoofdgerecht of hoofdgerecht en dessert` — Welkom bij Pellens › Onze kaart › Formule du Jour — prijs 45.00 — broncitaat: “2 gangenvoor- en hoofdgerecht of hoofdgerecht en dessert €45,00”
- `3 gangenvoor-, hoofdgerecht en dessert` — Welkom bij Pellens › Onze kaart › Formule du Jour — prijs 55.00 — broncitaat: “3 gangenvoor-, hoofdgerecht en dessert €55,00”
- `Salade` — Welkom bij Pellens › Salades — prijs 17.50 — broncitaat: “Salade Van de boerderij€17.50”
- `Salade` — Welkom bij Pellens › Salades — prijs 22.50 — broncitaat: “Salade Zeevruchten€22.50”
- `Salade` — Welkom bij Pellens › Salades — prijs 24.50 — broncitaat: “Salade Entrecôte€24.50”

**Prijsfouten (0)**
- geen

**Rubriekfouten (4)**
- `Jamón Ibérico` — verwacht Onze kaart › Lunch › Brioches; geëxtraheerd Welkom bij Pellens › Onze kaart › Brioches — citaat: “Jamón Ibérico €19,50”
- `Pulled pork` — verwacht Onze kaart › Lunch › Brioches; geëxtraheerd Welkom bij Pellens › Onze kaart › Brioches — citaat: “Pulled pork €15,50”
- `Frites met mayonaise` — verwacht Onze kaart › Lunch › Erbij; geëxtraheerd Welkom bij Pellens › Erbij — citaat: “Frites met mayonaise €6,00”
- `Salade van onze boerderij` — verwacht Onze kaart › Lunch › Erbij; geëxtraheerd Welkom bij Pellens › Erbij — citaat: “Salade van onze boerderij €7,00”

**Duplicaten in de extractie**
- `Brioche` — Welkom bij Pellens › Les Brioches — 5 keer (referentiefrequentie 0)
- `Salade` — Welkom bij Pellens › Salades — 3 keer (referentiefrequentie 0)

**Beperkingen**
- De diner-tab bevat alleen arrangementen (Menu Pellens, Menu légumes, Formule du Jour) en geen losse gerechten; er is daarom geen diner-gerechtreferentie.
- De pagina bevat een verborgen tweede weergave van brioches en salades; die is geen tweede gerecht en telt één keer.
- De allergeninformatie staat alleen in de algemene FAQ; allergenen per gerecht blijven onbekend.
- Deze referentie is uit de vastgezette brontekst opgesteld en niet uit de parseruitvoer.
- Menukaart https://pellens.nl/: sectie "Welkom bij Pellens › Onze kaart › À la carte › Menu Pellens" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://pellens.nl/: sectie "Welkom bij Pellens › Onze kaart › À la carte › Menu légumes" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://pellens.nl/: sectie "Welkom bij Pellens › Menu Pellens" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://pellens.nl/: sectie "Welkom bij Pellens › Menu légumes" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (duplicate_item_across_categories, duplicate_item_within_category, html_arrangements_skipped); het resultaat is niet als volledig beoordeeld.

**Vastgezette bronversie:** 1 capture(s); html 66f57e267289

### Restaurant Chocolat

**Gemist (2)**
- `SANDWICH CHOCOLAT` — LUNCHKAART CHOCOLAT › LUNCHGERECHTEN — prijs 18.00 — citaat: “SANDWICH CHOCOLAT €18 Steak Tartare · Pata Negra · Truffel Roerei (supp. ganzenlever €4)” (LUNCHKAART CHOCOLAT › LUNCHGERECHTEN › regel 6)
- `STEAK TARTARE` — LUNCHKAART CHOCOLAT › LUNCHGERECHTEN — prijs 17.00 — citaat: “STEAK TARTARE 90 GRAM €17 Gerookte Ei-dooier · Kappertjes · Zoetzuur (supp. 130 gr. €8)” (LUNCHKAART CHOCOLAT › LUNCHGERECHTEN › regel 1)

**Verzonnen (0)**
- geen

**Prijsfouten (0)**
- geen

**Rubriekfouten (4)**
- `CHOCOLAT & CHOCOLAT PUUR` — verwacht DINERKAART CHOCOLAT › NAGERECHTEN; geëxtraheerd NAGERECHTEN — citaat: “CHOCOLAT & CHOCOLAT PUUR 19 Bereidingen van pure Chocolat”
- `CHOCOLAT & CHOCOLAT WIT` — verwacht DINERKAART CHOCOLAT › NAGERECHTEN; geëxtraheerd NAGERECHTEN — citaat: “CHOCOLAT & CHOCOLAT WIT 19 Bereidingen witte Chocolat”
- `KAAS ASSORTIMENT` — verwacht DINERKAART CHOCOLAT › NAGERECHTEN; geëxtraheerd NAGERECHTEN — citaat: “KAAS ASSORTIMENT 22 4 Soorten · Wortel Gember Compôte · Kletzenbrood”
- `SURPRISE` — verwacht DINERKAART CHOCOLAT › NAGERECHTEN; geëxtraheerd NAGERECHTEN — citaat: “SURPRISE 18 Wisselend dessert van onze Patissier”

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

