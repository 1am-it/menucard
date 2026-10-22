# Menu-extractie: bestaande kaarten, Bardot naast Zuyd (#59 criterium 5)

Ontwikkelaarsbewijs op de vastgezette bytes. Bardot is gemeten op de dinerkaart-PDF waarvan de SHA-256 gelijk is aan de hash in de kaartcapture; Zuyd op de al gepinde HTML-menupagina's. Geen netwerk, geen provider, geen database en geen publicatie.

## Totalen (alleen gemeten kaarten)

| Maat | Waarde |
| --- | --- |
| Kaarten gemeten / geblokkeerd | 2 / 0 |
| Referentiegerechten | 148 |
| Geëxtraheerde gerechten | 108 |
| Exact gematcht | 34 |
| Gemiste gerechten | 78 |
| Verzonnen gerechten | 38 |
| Prijsfouten | 0 |
| Rubriekfouten | 36 |
| Precisie | 31.48% |
| Recall | 22.97% |

De totalen zijn per kaart afzonderlijk te lezen en worden nooit tot één succescijfer samengevoegd.

## Per kaart

| Kaart | Status | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Brasserie Bardot | gemeten | 112 | 74 | 0 | 76 | 38 | 0 | 36 | 0.00% | 0.00% |
| Restaurant Zuyd | gemeten | 36 | 34 | 34 | 2 | 0 | 0 | 0 | 100.00% | 94.44% |

## Afwijkingen per kaart

### Brasserie Bardot

**Gemist (76)**
- `Café complet` — Dinerkaart › DESSERT — prijs 13.95 — citaat: “Café complet, zoete lekkernijen met koffie of thee naar keuze” (Dinerkaart › DESSERT › pagina 3, kolom links, y=356)
- `Chocolade truffels` — Dinerkaart › DESSERT — prijs 3.75 — citaat: “Chocolade truffels (2 stuks)” (Dinerkaart › DESSERT › pagina 3, kolom links, y=324)
- `Mousse au chocolat` — Dinerkaart › DESSERT — prijs 12.95 — citaat: “Mousse au chocolat, gezouten pecan, karamel” (Dinerkaart › DESSERT › pagina 3, kolom links, y=434)
- `Plateau de fromage` — Dinerkaart › DESSERT — prijs 10.95 / 15.95 — citaat: “Plateau de fromage, kweeperengelei, rozijnenbrood” (Dinerkaart › DESSERT › pagina 3, kolom links, y=400 (3 stuks) en y=390 (5 stuks))
- `Likeuren en Grappa` — Dinerkaart › DIGESTIVES — prijs 6.25 — citaat: “Likeuren en Grappa” (Dinerkaart › DIGESTIVES › pagina 3, kolom rechts, y=632)
- `Desem stokbrood met seizoensroomboter en olijfolie` — Dinerkaart › ExTRA BIjGERECHTEN — prijs 5.95 — citaat: “Desem stokbrood met seizoensroomboter en olijfolie” (Dinerkaart › ExTRA BIjGERECHTEN › pagina 3, kolom links, y=774 (bedrag op y=776))
- `Frisse botersalade` — Dinerkaart › ExTRA BIjGERECHTEN — prijs 5.50 — citaat: “Frisse botersalade” (Dinerkaart › ExTRA BIjGERECHTEN › pagina 3, kolom links, y=740 (bedrag op y=742))
- `Seizoensgroenten` — Dinerkaart › ExTRA BIjGERECHTEN — prijs 6.75 — citaat: “Seizoensgroenten” (Dinerkaart › ExTRA BIjGERECHTEN › pagina 3, kolom links, y=730 (bedrag op y=732))
- `Verse frites met Belgische mayonaise` — Dinerkaart › ExTRA BIjGERECHTEN — prijs 4.75 — citaat: “Verse frites met Belgische mayonaise” (Dinerkaart › ExTRA BIjGERECHTEN › pagina 3, kolom links, y=762 (bedrag op y=764))
- `Verse frites met truffelmayonaise en parmezaan` — Dinerkaart › ExTRA BIjGERECHTEN — prijs 5.75 — citaat: “Verse frites met truffelmayonaise en parmezaan” (Dinerkaart › ExTRA BIjGERECHTEN › pagina 3, kolom links, y=752 (bedrag op y=754))
- `Canard à l'orange` — Dinerkaart › HOOFDGERECHTEN — prijs 27.95 — citaat: “Canard à l'orange, knolselderij gratin, rode bietencrème, gele biet, Amsterdamse ui, sinaasappel gevogelte saus.” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=364)
- `Gnocchi` — Dinerkaart › HOOFDGERECHTEN — prijs 22.95 — citaat: “Gnocchi, saffraan, venkel, parmezaan” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=88)
- `Hele dorade van de grill` — Dinerkaart › HOOFDGERECHTEN — prijs 26.95 — citaat: “Hele dorade van de grill , kruidenolie van salie,” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=176)
- `Runderentrecote (220 gr.)` — Dinerkaart › HOOFDGERECHTEN — prijs 37.95 — citaat: “Runderentrecote (220 gr.), met beurre de Paris” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=298)
- `Chateaubriand (om te delen 450 gr.)` — Dinerkaart › HOOFDGERECHTEN › SPECIALITEITEN VAN BARDOT — prijs 74.95 — citaat: “Chateaubriand (om te delen 450 gr.), het beste stuk van de ossenhaas met Persillade boter of Béarnaise of Blauwe kaas of Groene pepersaus” (Dinerkaart › HOOFDGERECHTEN › SPECIALITEITEN VAN BARDOT › pagina 2, kolom rechts, y=564)
- `Poussin` — Dinerkaart › HOOFDGERECHTEN › SPECIALITEITEN VAN BARDOT — prijs 20.95 — citaat: “Poussin, krielkippetje van onze huisrotisserie met citroen, tijm en appelcompote” (Dinerkaart › HOOFDGERECHTEN › SPECIALITEITEN VAN BARDOT › pagina 2, kolom rechts, y=674)
- `Tournedos (170 gr.)` — Dinerkaart › HOOFDGERECHTEN — prijs 37.95 — citaat: “Tournedos (170 gr.), spinazie, champignons, truffeljus” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=242)
- `Charcuterie` — Dinerkaart › KLASSIEKE BORRELHAPPEN — prijs 16.95 — citaat: “Charcuterie, diverse vleeswaren” (Dinerkaart › KLASSIEKE BORRELHAPPEN › pagina 2, kolom links, y=578)
- `Kaviaar 'Osietra'` — Dinerkaart › KLASSIEKE BORRELHAPPEN — prijs 35.00 — citaat: “Kaviaar 'Osietra', 10 gram” (Dinerkaart › KLASSIEKE BORRELHAPPEN › pagina 2, kolom links, y=490)
- `Oesters: Naturel` — Dinerkaart › KLASSIEKE BORRELHAPPEN — prijs 4.00 — citaat: “Naturel met sjalottenvinaigrette en citroen” (Dinerkaart › KLASSIEKE BORRELHAPPEN › pagina 2, kolom links, y=742 (bedrag op y=744))
- `Paling` — Dinerkaart › KLASSIEKE BORRELHAPPEN — prijs 13.95 — citaat: “Paling, brioche, rode biet, Per 2 stuks crème fraîche en roze peper” (Dinerkaart › KLASSIEKE BORRELHAPPEN › pagina 2, kolom links, y=534)
- `Pata Negra (70 gr.)` — Dinerkaart › KLASSIEKE BORRELHAPPEN — prijs 21.95 — citaat: “Pata Negra (70 gr.), Spaanse Ibericoham” (Dinerkaart › KLASSIEKE BORRELHAPPEN › pagina 2, kolom links, y=644)
- `Paté en croute` — Dinerkaart › KLASSIEKE BORRELHAPPEN — prijs 16.95 — citaat: “Paté en croute, gefrituurde kappertjes, uienconfit” (Dinerkaart › KLASSIEKE BORRELHAPPEN › pagina 2, kolom links, y=610 (bedrag op y=612))
- `Espresso Martini` — Dinerkaart › MIX / COCKTAILS / GIN & TONIC — prijs 11.75 — citaat: “Espresso Martini” (Dinerkaart › MIX / COCKTAILS / GIN & TONIC › pagina 3, kolom rechts, y=544)
- `Copperhead gin 0.0% – Fever Tree` — Dinerkaart › MOCKTAILS — prijs 8.75 — citaat: “Copperhead gin 0.0% – Fever Tree” (Dinerkaart › MOCKTAILS › pagina 3, kolom rechts, y=434)
- `Pornstar Martini 0.0%` — Dinerkaart › MOCKTAILS — prijs 10.75 — citaat: “Pornstar Martini 0.0%” (Dinerkaart › MOCKTAILS › pagina 3, kolom rechts, y=412)
- `Spiced Mule 0.0%` — Dinerkaart › MOCKTAILS — prijs 6.95 — citaat: “Spiced Mule 0.0%” (Dinerkaart › MOCKTAILS › pagina 3, kolom rechts, y=424)
- `Kipfilet of witvis` — Dinerkaart › VOOR ONZE KLEINE GASTEN — prijs 15.95 — citaat: “Kipfilet of witvis, frites, salade” (Dinerkaart › VOOR ONZE KLEINE GASTEN › pagina 3, kolom links, y=696 (bedrag op y=698))
- `Bisque de homard` — Dinerkaart › VOORGERECHTEN — prijs 13.95 — citaat: “Bisque de homard, rivierkreeft, saffraanrouille” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=374)
- `Boudin Noir` — Dinerkaart › VOORGERECHTEN — prijs 18.95 — citaat: “Boudin Noir, gebakken bloedworst, brioche, appel, Calvados, gebakken eendenlever” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=132)
- `Escargots` — Dinerkaart › VOORGERECHTEN — prijs 12.95 — citaat: “Escargots, persillade, knoflooksabayon, croutons” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=308)
- `Garnalenkroketten` — Dinerkaart › VOORGERECHTEN — prijs 21.95 — citaat: “Garnalenkroketten (2 st.) met citroenmayonaise” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=340 (bedrag op y=342))
- `Gravad lax` — Dinerkaart › VOORGERECHTEN — prijs 17.95 — citaat: “Gravad lax, toast, aardappel, dragonmayonaise, venkel, citroen” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=186 (bedrag op y=188))
- `Klassieke steak tartaar (90 gram)` — Dinerkaart › VOORGERECHTEN — prijs 15.95 — citaat: “Klassieke steak tartaar (90 gram)” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=230 (bedrag op y=232))
- `Stracciatella` — Dinerkaart › VOORGERECHTEN — prijs 16.95 — citaat: “Stracciatella, tomaat, pruim, amandel en basilicum” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=274 (bedrag op y=276))
- `Champagne Charles LaFITTE, ODF Rosé` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 89.75 — citaat: “Champagne Charles LaFITTE, ODF Rosé” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=150 (alleen flesprijs))
- `Champagne Charles LaFITTE, ODF` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 79.75 — citaat: “Champagne Charles LaFITTE, ODF” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=178 (alleen flesprijs))
- `Champagne Louis Roederer Brut` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 99.00 — citaat: “Champagne Louis Roederer Brut” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=94 (alleen flesprijs))
- `Champagne Ruinart Brut Blanc de Blancs` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 165.00 — citaat: “Champagne Ruinart Brut Blanc de Blancs” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=76 (alleen flesprijs))
- `Champagne Vranken` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 55.00 / 95.00 / 185.00 — citaat: “Champagne Vranken cuvée Diamant Brut” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=132 (0,375 ltr.), y=122 (0.750 ltr.) en y=112 (1,5 ltr))
- … en 36 meer in het JSON-rapport

**Verzonnen (38)**
- `(2 stuks)` — DESSERT — prijs 3.75 — geen bronpassage (extractor-locator: pdf:2:item:6)
- `3 stuks` — DESSERT — prijs 10.95 — geen bronpassage (extractor-locator: pdf:2:item:3)
- `5 stuks` — DESSERT — prijs 15.95 — geen bronpassage (extractor-locator: pdf:2:item:4)
- `bol vanille-ijs` — DESSERT — prijs 2.50 — geen bronpassage (extractor-locator: pdf:2:item:1)
- `gezouten pecan, karamel` — DESSERT — prijs 12.95 — geen bronpassage (extractor-locator: pdf:2:item:2)
- `zoete lekkernijen met` — DESSERT — prijs 13.95 — geen bronpassage (extractor-locator: pdf:2:item:5)
- `0,375 ltr.` — Menukaart — prijs 55.00 — geen bronpassage (extractor-locator: pdf:1:item:66)
- `0.750 ltr.` — Menukaart — prijs 95.00 — geen bronpassage (extractor-locator: pdf:1:item:67)
- `1,5 ltr` — Menukaart — prijs 185.00 — geen bronpassage (extractor-locator: pdf:1:item:68)
- `10 gram` — Menukaart — prijs 35.00 — geen bronpassage (extractor-locator: pdf:1:item:7)
- `(2 st.) met citroenmayonaise` — Menukaart — prijs 21.95 — geen bronpassage (extractor-locator: pdf:1:item:10)
- `(90 gram)` — Menukaart — prijs 15.95 — geen bronpassage (extractor-locator: pdf:1:item:12)
- `blini’s en zure room` — Menukaart — prijs 5.00 — geen bronpassage (extractor-locator: pdf:1:item:8)
- `Bourgogne Chardonnay Meursault, Seguin Manuel Les Clos` — Menukaart — prijs 105.00 — geen bronpassage (extractor-locator: pdf:1:item:62)
- `Bourgogne Chardonnay Saint Aubin Domaine du Château Philippe le Hardi` — Menukaart — prijs 89.00 — geen bronpassage (extractor-locator: pdf:1:item:61)
- `Canard à l’orange, knolselderij gratin, rode bietencrème, gele biet, Amsterdamse ui, sinaasappel gevogelte saus.` — Menukaart — prijs 27.95 — geen bronpassage (extractor-locator: pdf:1:item:18)
- `Chateaubriand (om te delen 450 gr.), het beste stuk van de ossenhaas met Persillade boter of Béarnaise of` — Menukaart — prijs 74.95 — geen bronpassage (extractor-locator: pdf:1:item:16)
- `Copperhead gin – Fever Tree` — Menukaart — prijs 8.75 — geen bronpassage (extractor-locator: pdf:1:item:48)
- `diverse vleeswaren` — Menukaart — prijs 16.95 — geen bronpassage (extractor-locator: pdf:1:item:5)
- `eendenlever` — Menukaart — prijs 6.75 — geen bronpassage (extractor-locator: pdf:1:item:13)
- `Escargots, persillade, knoflooksabayon, croutons` — Menukaart — prijs 12.95 — geen bronpassage (extractor-locator: pdf:1:item:1)
- `Espresso Martini M I x / COCKTAILS / G IN & T ONIC :` — Menukaart — prijs 11.75 — geen bronpassage (extractor-locator: pdf:1:item:36)
- `gebakken bloedworst, brioche,` — Menukaart — prijs 18.95 — geen bronpassage (extractor-locator: pdf:1:item:14)
- `gefrituurde kappertjes, uienconfit` — Menukaart — prijs 16.95 — geen bronpassage (extractor-locator: pdf:1:item:4)
- `Gnocchi, saffraan, venkel, parmezaan` — Menukaart — prijs 22.95 — geen bronpassage (extractor-locator: pdf:1:item:22)
- `Hele dorade van de grill , kruidenolie van salie, Zeetong à la meunière Dagprijs` — Menukaart — prijs 26.95 — geen bronpassage (extractor-locator: pdf:1:item:21)
- `Likeuren en Grappa v.a.` — Menukaart — prijs 6.25 — geen bronpassage (extractor-locator: pdf:1:item:34)
- `Per 2 stuks` — Menukaart — prijs 13.95 — geen bronpassage (extractor-locator: pdf:1:item:6)
- `Per fles` — Menukaart — prijs 8.50 / 46.75 — geen bronpassage (extractor-locator: pdf:1:item:65)
- `Per stuk` — Menukaart — prijs 4.00 — geen bronpassage (extractor-locator: pdf:1:item:2)
- `Pornstar Martini C OGNAC & C ALVADOS :` — Menukaart — prijs 10.75 — geen bronpassage (extractor-locator: pdf:1:item:50)
- `Poussin, krielkippetje van onze` — Menukaart — prijs 20.95 — geen bronpassage (extractor-locator: pdf:1:item:15)
- `rivierkreeft, saffraanrouille` — Menukaart — prijs 13.95 — geen bronpassage (extractor-locator: pdf:1:item:9)
- `Runderentrecote (220 gr.), met beurre de Paris` — Menukaart — prijs 37.95 — geen bronpassage (extractor-locator: pdf:1:item:19)
- `Spaanse Ibericoham` — Menukaart — prijs 21.95 — geen bronpassage (extractor-locator: pdf:1:item:3)
- `Spiced Mule` — Menukaart — prijs 6.95 — geen bronpassage (extractor-locator: pdf:1:item:49)
- `tomaat, pruim, amandel` — Menukaart — prijs 16.95 — geen bronpassage (extractor-locator: pdf:1:item:11)
- `Tournedos (170 gr.), spinazie, champignons, truffeljus` — Menukaart — prijs 37.95 — geen bronpassage (extractor-locator: pdf:1:item:20)

**Prijsfouten (0)**
- geen

**Rubriekfouten (36)**
- `Crodino (alcoholvrij)` — verwacht Dinerkaart › APERATIEF — gelezen Menukaart
- `Martha's Porto 10 yrs.` — verwacht Dinerkaart › APERATIEF — gelezen Menukaart
- `Pernod / Ricard / Martini Bianco / Martini Rosso / Campari` — verwacht Dinerkaart › APERATIEF — gelezen Menukaart
- `Rode Port Ruby / Witte port` — verwacht Dinerkaart › APERATIEF — gelezen Menukaart
- `Armagnac VSOP` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen Menukaart
- `Calvados Père Magloire VSOP` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen Menukaart
- `Courvoisier VS` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen Menukaart
- `Martell VS` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen Menukaart
- `Rémy Martin VSOP` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen Menukaart
- `Crème brûlée` — verwacht Dinerkaart › DESSERT — gelezen Menukaart
- `Café Spécial` — verwacht Dinerkaart › DIGESTIVES — gelezen Menukaart
- `Espresso Martini` — verwacht Dinerkaart › DIGESTIVES — gelezen Menukaart
- `Limoncello Primo` — verwacht Dinerkaart › DIGESTIVES — gelezen Menukaart
- `Klassieke steak tartaar (150 gram)` — verwacht Dinerkaart › HOOFDGERECHTEN — gelezen Menukaart
- `Amaretto Sour` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Aperol Spritz` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Copperhead gin – Fever Tree` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Hendrick's gin – Fever Tree` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Limoncello Spritz` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Mimosa` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Moscow mule` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Negroni` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Pornstar Martini` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Whisky Sour` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen Menukaart
- `Chivas Regal 12 yrs.` — verwacht Dinerkaart › WHISKY — gelezen Menukaart
- `Glenfiddich 12 yrs.` — verwacht Dinerkaart › WHISKY — gelezen Menukaart
- `Jack Daniel's` — verwacht Dinerkaart › WHISKY — gelezen Menukaart
- `Jameson` — verwacht Dinerkaart › WHISKY — gelezen Menukaart
- `Oban 14 yrs.` — verwacht Dinerkaart › WHISKY — gelezen Menukaart
- `Banyuls Traditionnel Aphrodis` — verwacht Dinerkaart › WIJNEN & PORT — gelezen Menukaart
- `Martha's Porto 10 yrs.` — verwacht Dinerkaart › WIJNEN & PORT — gelezen Menukaart
- `Muscat de Beaumes de Venise` — verwacht Dinerkaart › WIJNEN & PORT — gelezen Menukaart
- `Pedro Ximénez, Mil Pesetas, Jerez` — verwacht Dinerkaart › WIJNEN & PORT — gelezen Menukaart
- `Sauternes, Le Terre du Lys d'Or` — verwacht Dinerkaart › WIJNEN & PORT — gelezen Menukaart
- `Pays d'Oc Merlot, Croix d'Or` — verwacht Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk — gelezen Menukaart
- `Viognier Condrieu Noordelijk Rhônegebied` — verwacht Dinerkaart › WIJNKAART › WITTE WIJNEN › Frankrijk — gelezen Menukaart

**Beperkingen**
- Alleen de dinerkaart-PDF (2025-11) is vastgezet en gebruikt. De twee HTML-pagina's uit dezelfde capture gaven bij verificatie andere bytes dan de gepinde hash en leveren daarom geen referentie.
- Pagina 1 is de omslag; pagina 4 is de wijnkaart. De dranken tellen mee omdat telregel 1 dranken in de vastgezette menubron meetelt.
- De sectie 'NAAST DE KAART / SERVEREN WIJ WISSELEND / SEIZOENSGERECHTEN' print geen gerecht en geen bedrag; er is niets geteld en dit is geen lege menukaart.
- De allergenenvermelding is algemeen ('Niet alle ingrediënten worden vermeld'). Allergenen per gerecht blijven onbekend, niet allergeenvrij.
- Wijnnamen staan over twee of drie regels; de naam is de aanduidingsregel en de producent of herkomst staat als producer, nooit samengevoegd.
- 'v.a. 6,25' bij Likeuren en Grappa is als prijsvariant met label 'vanaf' vastgelegd; de bron noemt geen ander bedrag.
- Deze referentie is uit de vastgezette PDF-tekst en de paginageometrie opgesteld, niet uit de parseruitvoer.
- Deze bron is een PDF zonder bijbehorende HTML-pagina — restaurantgegevens konden hier niet uit worden afgeleid.
- PDF https://brasseriebardot.nl/wp-content/uploads/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf: 7 supplementregel(s) zijn niet als gerecht opgenomen; het concept ondersteunt supplementen nog niet.
- PDF https://brasseriebardot.nl/wp-content/uploads/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf: 15 regel(s) met een prijs- of hoeveelheidsgetal dat niet eenduidig aan een gerecht is te koppelen, zijn niet als gerecht overgenomen.
- PDF https://brasseriebardot.nl/wp-content/uploads/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf: 31 prijsregel(s) konden zonder aantoonbare lokale naam-/prijskoppeling niet als gerecht worden opgenomen.
- PDF https://brasseriebardot.nl/wp-content/uploads/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf: 44 mogelijke rubriekkop(pen) zijn niet herkend en dus niet als rubriek opgeslagen.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (long_item_name, duplicate_item_within_category, unresolved_price, pdf_supplements_skipped, pdf_ambiguous_price_lines, pdf_unlinked_price_lines, pdf_unrecognised_headings); het resultaat is niet als volledig beoordeeld.

**Vastgezette bronversie:** 3 capture(s); html 9c6422963d28, html 45e96b351f93, pdf 487ba29f4bf8

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

## Integriteit en herhaalbaarheid

- Telregels: `docs/guides/menu-extraction-reference-counting-rules.md`, SHA-256 `0f09b74fdd9f33ecd58af4e3df8ab3c711ee70d32030bc4296f3af78adc2f09c` (ongewijzigd).
- Kaartcapture: `ops/benchmark/existing-card-references.json`, SHA-256 `dcb0e92b9cbefc7b56e5c934c722850078d3340c805498dd0e23bebbe2705bc4`.
- Bardot-pin: `ops/benchmark/card-reference-captures.json`, SHA-256 `06c00c1611289347d3afbf24e6ede7f2b489b8e659655b8a61f527637fc1304d`.
- Bardot-referentie: `ops/benchmark/reference-references/bardot.json`, SHA-256 `63d39733858c7ff2ccc7d3db0fd000eed5723d9bdbe83d3e308a38a0b807e9f1`, 112 items in 29 rubriekpaden en 7 supplementen.
- Zuyd-referentie: `ops/benchmark/reference-references/zuyd.json`, SHA-256 `fab4723f1d1d7dcc08fbac04eceb18d3d2214fc1e57a35ad3d893c6e7c7fca5b` (ongewijzigd).
- Iedere Bardot-referentiequote is tegen de vastgezette PDF-tekst gecontroleerd; 143 prijsbewijzen zijn opnieuw aan de vastgezette paginarij gekoppeld.
- De analyse is op de vastgezette bytes herhaald zonder netwerkoproep; hetzelfde script op dezelfde bytes levert hetzelfde rapport.
- Deze twee kaarten zijn geen ongeziene holdout en dit is geen productieacceptatie.

