# Menu-extractie: bestaande kaarten, Bardot, Zuyd, Wolfslaar en T-Huis (#59 criterium 5)

Ontwikkelaarsbewijs op de vastgezette bytes. Bardot is gemeten op de dinerkaart-PDF waarvan de SHA-256 gelijk is aan de hash in de kaartcapture; Zuyd op de al gepinde HTML-menupagina's; Wolfslaar op de entrypagina, beide menupagina's en de menu-1-overzichtspagina die review 6349832755 K1 eenmalig vastlegde. T-Huis is vastgelegd maar niet meetbaar: de menupagina levert de vijf kaarten alleen als SVG-afbeelding. Geen netwerk, geen provider, geen database en geen publicatie.

Het eigenaarsbesluit voor deze vier kaarten is GitHub #59 issuecomment-6315226470 (optie 1, vier bestaande kaarten plus een ongeziene set).

## Totalen (alleen gemeten kaarten)

| Maat | Waarde |
| --- | --- |
| Kaarten gemeten / geblokkeerd | 3 / 1 |
| Referentiegerechten | 178 |
| Geëxtraheerde gerechten | 150 |
| Exact gematcht | 63 |
| Gemiste gerechten | 64 |
| Verzonnen gerechten | 36 |
| Prijsfouten | 0 |
| Rubriekfouten | 51 |
| Precisie | 42.00% |
| Recall | 35.39% |

De totalen zijn per kaart afzonderlijk te lezen en worden nooit tot één succescijfer samengevoegd.

## Per kaart

| Kaart | Status | Referentie | Extractie | Match | Gemist | Verzonnen | Prijsfouten | Rubriekfouten | Precisie | Recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Brasserie Bardot | gemeten | 112 | 86 | 0 | 61 | 35 | 0 | 51 | 0.00% | 0.00% |
| Restaurant Zuyd | gemeten | 36 | 34 | 34 | 2 | 0 | 0 | 0 | 100.00% | 94.44% |
| Restaurant Wolfslaar | gemeten | 30 | 30 | 29 | 1 | 1 | 0 | 0 | 96.67% | 96.67% |
| T-Huis | geblokkeerd | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n.v.t. | n.v.t. |

## Afwijkingen per kaart

### Brasserie Bardot

**Gemist (61)**
- `Rode Port Ruby / Witte port` — Dinerkaart › APERATIEF — prijs 5.00 — citaat: “Rode Port Ruby / Witte port” (Dinerkaart › APERATIEF › pagina 3, kolom rechts, y=710)
- `Chocolade truffels` — Dinerkaart › DESSERT — prijs 3.75 — citaat: “Chocolade truffels (2 stuks)” (Dinerkaart › DESSERT › pagina 3, kolom links, y=324)
- `Plateau de fromage` — Dinerkaart › DESSERT — prijs 10.95 / 15.95 — citaat: “Plateau de fromage, kweeperengelei, rozijnenbrood” (Dinerkaart › DESSERT › pagina 3, kolom links, y=400 (3 stuks) en y=390 (5 stuks))
- `Likeuren en Grappa` — Dinerkaart › DIGESTIVES — prijs 6.25 — citaat: “Likeuren en Grappa” (Dinerkaart › DIGESTIVES › pagina 3, kolom rechts, y=632)
- `Limoncello Primo` — Dinerkaart › DIGESTIVES — prijs 5.75 — citaat: “Limoncello Primo” (Dinerkaart › DIGESTIVES › pagina 3, kolom rechts, y=622)
- `Canard à l'orange` — Dinerkaart › HOOFDGERECHTEN — prijs 27.95 — citaat: “Canard à l'orange, knolselderij gratin, rode bietencrème, gele biet, Amsterdamse ui, sinaasappel gevogelte saus.” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=364)
- `Gnocchi` — Dinerkaart › HOOFDGERECHTEN — prijs 22.95 — citaat: “Gnocchi, saffraan, venkel, parmezaan” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=88)
- `Hele dorade van de grill` — Dinerkaart › HOOFDGERECHTEN — prijs 26.95 — citaat: “Hele dorade van de grill , kruidenolie van salie,” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=176)
- `Runderentrecote (220 gr.)` — Dinerkaart › HOOFDGERECHTEN — prijs 37.95 — citaat: “Runderentrecote (220 gr.), met beurre de Paris” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=298)
- `Chateaubriand (om te delen 450 gr.)` — Dinerkaart › HOOFDGERECHTEN › SPECIALITEITEN VAN BARDOT — prijs 74.95 — citaat: “Chateaubriand (om te delen 450 gr.), het beste stuk van de ossenhaas met Persillade boter of Béarnaise of Blauwe kaas of Groene pepersaus” (Dinerkaart › HOOFDGERECHTEN › SPECIALITEITEN VAN BARDOT › pagina 2, kolom rechts, y=564)
- `Poussin` — Dinerkaart › HOOFDGERECHTEN › SPECIALITEITEN VAN BARDOT — prijs 20.95 — citaat: “Poussin, krielkippetje van onze huisrotisserie met citroen, tijm en appelcompote” (Dinerkaart › HOOFDGERECHTEN › SPECIALITEITEN VAN BARDOT › pagina 2, kolom rechts, y=674)
- `Tournedos (170 gr.)` — Dinerkaart › HOOFDGERECHTEN — prijs 37.95 — citaat: “Tournedos (170 gr.), spinazie, champignons, truffeljus” (Dinerkaart › HOOFDGERECHTEN › pagina 2, kolom rechts, y=242)
- `Oesters: Naturel` — Dinerkaart › KLASSIEKE BORRELHAPPEN — prijs 4.00 — citaat: “Naturel met sjalottenvinaigrette en citroen” (Dinerkaart › KLASSIEKE BORRELHAPPEN › pagina 2, kolom links, y=742 (bedrag op y=744))
- `Pornstar Martini` — Dinerkaart › MIX / COCKTAILS / GIN & TONIC — prijs 11.75 — citaat: “Pornstar Martini” (Dinerkaart › MIX / COCKTAILS / GIN & TONIC › pagina 3, kolom rechts, y=534)
- `Copperhead gin 0.0% – Fever Tree` — Dinerkaart › MOCKTAILS — prijs 8.75 — citaat: “Copperhead gin 0.0% – Fever Tree” (Dinerkaart › MOCKTAILS › pagina 3, kolom rechts, y=434)
- `Pornstar Martini 0.0%` — Dinerkaart › MOCKTAILS — prijs 10.75 — citaat: “Pornstar Martini 0.0%” (Dinerkaart › MOCKTAILS › pagina 3, kolom rechts, y=412)
- `Spiced Mule 0.0%` — Dinerkaart › MOCKTAILS — prijs 6.95 — citaat: “Spiced Mule 0.0%” (Dinerkaart › MOCKTAILS › pagina 3, kolom rechts, y=424)
- `Escargots` — Dinerkaart › VOORGERECHTEN — prijs 12.95 — citaat: “Escargots, persillade, knoflooksabayon, croutons” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=308)
- `Garnalenkroketten` — Dinerkaart › VOORGERECHTEN — prijs 21.95 — citaat: “Garnalenkroketten (2 st.) met citroenmayonaise” (Dinerkaart › VOORGERECHTEN › pagina 2, kolom links, y=340 (bedrag op y=342))
- `Chivas Regal 12 yrs.` — Dinerkaart › WHISKY — prijs 7.75 — citaat: “Chivas Regal 12 yrs.” (Dinerkaart › WHISKY › pagina 3, kolom rechts, y=270)
- `Glenfiddich 12 yrs.` — Dinerkaart › WHISKY — prijs 8.00 — citaat: “Glenfiddich 12 yrs.” (Dinerkaart › WHISKY › pagina 3, kolom rechts, y=280)
- `Oban 14 yrs.` — Dinerkaart › WHISKY — prijs 10.75 — citaat: “Oban 14 yrs.” (Dinerkaart › WHISKY › pagina 3, kolom rechts, y=258)
- `Sauternes, Le Terre du Lys d'Or` — Dinerkaart › WIJNEN & PORT — prijs 7.25 — citaat: “Sauternes, Le Terre du Lys d'Or” (Dinerkaart › WIJNEN & PORT › pagina 3, kolom rechts, y=786)
- `Champagne Charles LaFITTE, ODF Rosé` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 89.75 — citaat: “Champagne Charles LaFITTE, ODF Rosé” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=150 (alleen flesprijs))
- `Champagne Charles LaFITTE, ODF` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 79.75 — citaat: “Champagne Charles LaFITTE, ODF” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=178 (alleen flesprijs))
- `Champagne Vranken` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 55.00 / 95.00 / 185.00 — citaat: “Champagne Vranken cuvée Diamant Brut” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=132 (0,375 ltr.), y=122 (0.750 ltr.) en y=112 (1,5 ltr))
- `Crémant de Bourgogne` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 7.75 / 45.75 — citaat: “Crémant de Bourgogne Cave de Viré Brut” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=234)
- `Pizzolato organic 0.0% 0,20 ltr.` — Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN — prijs 7.95 — citaat: “Pizzolato organic 0.0% 0,20 ltr.” (Dinerkaart › WIJNKAART › MOUSSERENDE WIJNEN › pagina 4, kolom rechts, y=56 (bedrag op y=58))
- `La Consulta 100% Malbec, Catena` — Dinerkaart › WIJNKAART › RODE WIJNEN › Argentinië — prijs 7.75 / 42.50 — citaat: “La Consulta 100% Malbec, Catena” (Dinerkaart › WIJNKAART › RODE WIJNEN › Argentinië › pagina 4, kolom rechts, y=508)
- `Bordeaux Lalande de Pomerol` — Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk — prijs 8.75 / 48.00 — citaat: “Bordeaux Lalande de Pomerol, Château La Pensée, Merlot 80%, Cabernet Sauvignon, Cabernet Franc” (Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk › pagina 4, kolom rechts, y=748)
- `Bordeaux Margaux, Château de Clairefont` — Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk — prijs 79.00 — citaat: “Bordeaux Margaux, Château de Clairefont” (Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk › pagina 4, kolom rechts, y=698 (alleen flesprijs))
- `Bordeaux Saint-Émilion Grand Cru` — Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk — prijs 8.50 / 46.75 — citaat: “Bordeaux Saint-Émilion Grand Cru Château La Fleur Cravignac” (Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk › pagina 4, kolom rechts, y=798)
- `Côtes du Rhône, Paul Jaboulet` — Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk — prijs 7.25 / 39.75 — citaat: “Côtes du Rhône, Paul Jaboulet Aîné Parallèle 45, Grenache, Syrah” (Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk › pagina 4, kolom links, y=68)
- `Languedoc Pinot Noir Réserve` — Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk — prijs 6.50 / 35.75 — citaat: “Languedoc Pinot Noir Réserve, Château Paul Mas” (Dinerkaart › WIJNKAART › RODE WIJNEN › Frankrijk › pagina 4, kolom links, y=98 (bedragen op y=94))
- `Piemonte 100% Nebbiolo Serre dei Roveri Barolo Riserva` — Dinerkaart › WIJNKAART › RODE WIJNEN › Italië — prijs 12.75 / 69.50 — citaat: “Piemonte 100% Nebbiolo Serre dei Roveri Barolo Riserva” (Dinerkaart › WIJNKAART › RODE WIJNEN › Italië › pagina 4, kolom rechts, y=588)
- `Primitivo Quota 29, Menhir Salento, Puglia` — Dinerkaart › WIJNKAART › RODE WIJNEN › Italië — prijs 7.50 / 41.75 — citaat: “Primitivo Quota 29, Menhir Salento, Puglia” (Dinerkaart › WIJNKAART › RODE WIJNEN › Italië › pagina 4, kolom rechts, y=658)
- `Zenato Ripassa della Valpolicella` — Dinerkaart › WIJNKAART › RODE WIJNEN › Italië — prijs 8.75 / 48.00 — citaat: “Zenato Ripassa della Valpolicella, Ripasso Superiore, Veneto” (Dinerkaart › WIJNKAART › RODE WIJNEN › Italië › pagina 4, kolom rechts, y=628)
- `Rioja Coto de Imaz Reserva, 100% Tempranillo` — Dinerkaart › WIJNKAART › RODE WIJNEN › Spanje — prijs 7.50 / 41.75 — citaat: “Rioja Coto de Imaz Reserva, 100% Tempranillo” (Dinerkaart › WIJNKAART › RODE WIJNEN › Spanje › pagina 4, kolom rechts, y=548)
- `Cali Shark California Red` — Dinerkaart › WIJNKAART › RODE WIJNEN › USA — prijs 7.50 / 41.75 — citaat: “Cali Shark California Red” (Dinerkaart › WIJNKAART › RODE WIJNEN › USA › pagina 4, kolom rechts, y=478)
- `Côtes d'Azur Rosé CHIC, Grenache, Cinsault, Château du Rouët` — Dinerkaart › WIJNKAART › ROSÉ WIJNEN — prijs 6.50 / 35.75 — citaat: “Côtes d'Azur Rosé CHIC, Grenache, Cinsault, Château du Rouët” (Dinerkaart › WIJNKAART › ROSÉ WIJNEN › pagina 4, kolom rechts, y=398)
- … en 21 meer in het JSON-rapport

**Verzonnen (35)**
- `Likeuren en Grappa v.a.` — DINERKAART › D ESSERT w I j NEN & PORT: › D IGESTIVES : — prijs 6.25 — geen bronpassage (extractor-locator: pdf:12:item:2)
- `Copperhead gin – Fever Tree` — DINERKAART › D ESSERT w I j NEN & PORT: › MOCKTAILS — prijs 8.75 — geen bronpassage (extractor-locator: pdf:14:item:1)
- `Pornstar Martini` — DINERKAART › D ESSERT w I j NEN & PORT: › MOCKTAILS — prijs 10.75 — geen bronpassage (extractor-locator: pdf:14:item:3)
- `Spiced Mule` — DINERKAART › D ESSERT w I j NEN & PORT: › MOCKTAILS — prijs 6.95 — geen bronpassage (extractor-locator: pdf:14:item:2)
- `Chocolade truffels (2 stuks)` — DINERKAART › Ex TRA BI j › Sauternes — prijs 3.75 — geen bronpassage (extractor-locator: pdf:8:item:5)
- `kweeperengelei` — DINERKAART › Ex TRA BI j › Sauternes — prijs 15.95 — geen bronpassage (extractor-locator: pdf:8:item:3)
- `Plateau de fromage` — DINERKAART › Ex TRA BI j › Sauternes — prijs 10.95 — geen bronpassage (extractor-locator: pdf:8:item:2)
- `Poussin, krielkippetje van onze` — DINERKAART › HOOFDGEREC HTEN › BARDOT — prijs 20.95 — geen bronpassage (extractor-locator: pdf:4:item:1)
- `Canard à l’orange, knolselderij gratin, rode bietencrème, gele biet, Amsterdamse ui, sinaasappel gevogelte saus.` — DINERKAART › HOOFDGEREC HTEN › Bogle Chardonnay — prijs 27.95 — geen bronpassage (extractor-locator: pdf:5:item:3)
- `Chateaubriand (om te delen 450 gr.), het beste stuk van de ossenhaas met Persillade boter of Béarnaise of` — DINERKAART › HOOFDGEREC HTEN › Bogle Chardonnay — prijs 74.95 — geen bronpassage (extractor-locator: pdf:5:item:1)
- `Gnocchi, saffraan, venkel, parmezaan` — DINERKAART › HOOFDGEREC HTEN › Bogle Chardonnay — prijs 22.95 — geen bronpassage (extractor-locator: pdf:5:item:7)
- `Hele dorade van de grill , kruidenolie van salie, Zeetong à la meunière Dagprijs` — DINERKAART › HOOFDGEREC HTEN › Bogle Chardonnay — prijs 26.95 — geen bronpassage (extractor-locator: pdf:5:item:6)
- `Runderentrecote (220 gr.), met beurre de Paris` — DINERKAART › HOOFDGEREC HTEN › Bogle Chardonnay — prijs 37.95 — geen bronpassage (extractor-locator: pdf:5:item:4)
- `Tournedos (170 gr.), spinazie, champignons, truffeljus` — DINERKAART › HOOFDGEREC HTEN › Bogle Chardonnay — prijs 37.95 — geen bronpassage (extractor-locator: pdf:5:item:5)
- `Garnalenkroketten (2 st.) met citroenmayonaise` — DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay — prijs 21.95 — geen bronpassage (extractor-locator: pdf:2:item:7)
- `Extra topping: Gin Tonic schuim & Sinaasappel` — DINERKAART › KL ASSIEKE BORRELHAPPEN — prijs 0.95 — geen bronpassage (extractor-locator: pdf:1:item:2)
- `Naturel met sjalottenvinaigrette en citroen Per stuk` — DINERKAART › KL ASSIEKE BORRELHAPPEN — prijs 4.00 — geen bronpassage (extractor-locator: pdf:1:item:1)
- `1,5 ltr` — DINERKAART › Menukaart — prijs 185.00 — geen bronpassage (extractor-locator: pdf:3:item:6)
- `Bordeaux Margaux` — DINERKAART › Menukaart — prijs 79.00 — geen bronpassage (extractor-locator: pdf:3:item:5)
- `Escargots, persillade, knoflooksabayon, croutons` — DINERKAART › Menukaart — prijs 12.95 — geen bronpassage (extractor-locator: pdf:3:item:1)
- `GERECHTEN : Sauternes` — DINERKAART › Menukaart — prijs 7.25 — geen bronpassage (extractor-locator: pdf:3:item:3)
- `z E KLEINE GASTEN Rode Port Ruby / Witte port` — DINERKAART › Menukaart — prijs 5.00 — geen bronpassage (extractor-locator: pdf:3:item:4)
- `DESSERT Pornstar Martini` — DINERKAART › N AAST DE KAART — prijs 11.75 — geen bronpassage (extractor-locator: pdf:9:item:2)
- `Indien wij rekening dienen te houden Chivas Regal 12 yrs.` — DINERKAART › N AAST DE KAART — prijs 7.75 — geen bronpassage (extractor-locator: pdf:9:item:4)
- `met een allergie` — DINERKAART › N AAST DE KAART — prijs 10.75 — geen bronpassage (extractor-locator: pdf:9:item:5)
- `Niet alle ingrediënten worden vermeld. Glenfiddich 12 yrs.` — DINERKAART › N AAST DE KAART — prijs 8.00 — geen bronpassage (extractor-locator: pdf:9:item:3)
- `w I j w ISSELEND E Limoncello Primo` — DINERKAART › N AAST DE KAART — prijs 5.75 — geen bronpassage (extractor-locator: pdf:9:item:1)
- `Champagne Charles LaFITTE` — DINERKAART › USA › MOUSSERENDE w I j NEN: — prijs 79.75 — geen bronpassage (extractor-locator: pdf:19:item:1)
- `Champagne Charles LaFITTE` — DINERKAART › USA › MOUSSERENDE w I j NEN: — prijs 89.75 — geen bronpassage (extractor-locator: pdf:19:item:2)
- `Champagne Vranken 0` — DINERKAART › USA › MOUSSERENDE w I j NEN: — prijs 55.00 — geen bronpassage (extractor-locator: pdf:19:item:3)
- `cuvée Diamant Brut 0.750 ltr.` — DINERKAART › USA › MOUSSERENDE w I j NEN: — prijs 95.00 — geen bronpassage (extractor-locator: pdf:19:item:4)
- `Languedoc-Roussillion` — DINERKAART › USA › ROSÉ w I j NEN: — prijs 41.25 — geen bronpassage (extractor-locator: pdf:18:item:1)
- `Ultimate Provence Rosé` — DINERKAART › USA › ROSÉ w I j NEN: — prijs 42.50 — geen bronpassage (extractor-locator: pdf:18:item:2)
- `Bourgogne Chardonnay Meursault, Seguin Manuel Les Clos` — DINERKAART › w I j NKAART › Fèvre-Fèvre — prijs 105.00 — geen bronpassage (extractor-locator: pdf:16:item:2)
- `Bourgogne Chardonnay Saint Aubin Domaine du Château Philippe le Hardi` — DINERKAART › w I j NKAART › Fèvre-Fèvre — prijs 89.00 — geen bronpassage (extractor-locator: pdf:16:item:1)

**Prijsfouten (0)**
- geen

**Rubriekfouten (51)**
- `Crodino (alcoholvrij)` — verwacht Dinerkaart › APERATIEF — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › APERATIEF:
- `Martha's Porto 10 yrs.` — verwacht Dinerkaart › APERATIEF — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › APERATIEF:
- `Pernod / Ricard / Martini Bianco / Martini Rosso / Campari` — verwacht Dinerkaart › APERATIEF — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › APERATIEF:
- `Armagnac VSOP` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › C OGNAC & C ALVADOS :
- `Calvados Père Magloire VSOP` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › C OGNAC & C ALVADOS :
- `Courvoisier VS` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › C OGNAC & C ALVADOS :
- `Martell VS` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › C OGNAC & C ALVADOS :
- `Rémy Martin VSOP` — verwacht Dinerkaart › COGNAC & CALVADOS — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › C OGNAC & C ALVADOS :
- `Café complet` — verwacht Dinerkaart › DESSERT — gelezen DINERKAART › Ex TRA BI j › Sauternes
- `Crème brûlée` — verwacht Dinerkaart › DESSERT — gelezen DINERKAART › Menukaart
- `Mousse au chocolat` — verwacht Dinerkaart › DESSERT — gelezen DINERKAART › Ex TRA BI j › Sauternes
- `Café Spécial` — verwacht Dinerkaart › DIGESTIVES — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › D IGESTIVES :
- `Espresso Martini` — verwacht Dinerkaart › DIGESTIVES — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › D IGESTIVES :
- `Desem stokbrood met seizoensroomboter en olijfolie` — verwacht Dinerkaart › ExTRA BIjGERECHTEN — gelezen DINERKAART › Ex TRA BI j
- `Frisse botersalade` — verwacht Dinerkaart › ExTRA BIjGERECHTEN — gelezen DINERKAART › Ex TRA BI j
- `Seizoensgroenten` — verwacht Dinerkaart › ExTRA BIjGERECHTEN — gelezen DINERKAART › Ex TRA BI j
- `Verse frites met Belgische mayonaise` — verwacht Dinerkaart › ExTRA BIjGERECHTEN — gelezen DINERKAART › Ex TRA BI j
- `Verse frites met truffelmayonaise en parmezaan` — verwacht Dinerkaart › ExTRA BIjGERECHTEN — gelezen DINERKAART › Ex TRA BI j
- `Klassieke steak tartaar (150 gram)` — verwacht Dinerkaart › HOOFDGERECHTEN — gelezen DINERKAART › HOOFDGEREC HTEN › Bogle Chardonnay
- `Charcuterie` — verwacht Dinerkaart › KLASSIEKE BORRELHAPPEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Kaviaar 'Osietra'` — verwacht Dinerkaart › KLASSIEKE BORRELHAPPEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Paling` — verwacht Dinerkaart › KLASSIEKE BORRELHAPPEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Pata Negra (70 gr.)` — verwacht Dinerkaart › KLASSIEKE BORRELHAPPEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Paté en croute` — verwacht Dinerkaart › KLASSIEKE BORRELHAPPEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Amaretto Sour` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Aperol Spritz` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Copperhead gin – Fever Tree` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Espresso Martini` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Hendrick's gin – Fever Tree` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Limoncello Spritz` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Mimosa` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Moscow mule` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Negroni` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Whisky Sour` — verwacht Dinerkaart › MIX / COCKTAILS / GIN & TONIC — gelezen DINERKAART › D ESSERT w I j NEN & PORT: › M I x / COCKTAILS / G IN & T ONIC :
- `Kipfilet of witvis` — verwacht Dinerkaart › VOOR ONZE KLEINE GASTEN — gelezen DINERKAART › Ex TRA BI j › V OOR ON
- `Bisque de homard` — verwacht Dinerkaart › VOORGERECHTEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Boudin Noir` — verwacht Dinerkaart › VOORGERECHTEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Gravad lax` — verwacht Dinerkaart › VOORGERECHTEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Klassieke steak tartaar (90 gram)` — verwacht Dinerkaart › VOORGERECHTEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay
- `Stracciatella` — verwacht Dinerkaart › VOORGERECHTEN — gelezen DINERKAART › KL ASSIEKE BORRELHAPPEN › Chablis Chardonnay

**Beperkingen**
- Alleen de dinerkaart-PDF (2025-11) is vastgezet en gebruikt. De twee HTML-pagina's uit dezelfde capture gaven bij verificatie andere bytes dan de gepinde hash en leveren daarom geen referentie.
- Pagina 1 is de omslag; pagina 4 is de wijnkaart. De dranken tellen mee omdat telregel 1 dranken in de vastgezette menubron meetelt.
- De sectie 'NAAST DE KAART / SERVEREN WIJ WISSELEND / SEIZOENSGERECHTEN' print geen gerecht en geen bedrag; er is niets geteld en dit is geen lege menukaart.
- De allergenenvermelding is algemeen ('Niet alle ingrediënten worden vermeld'). Allergenen per gerecht blijven onbekend, niet allergeenvrij.
- Wijnnamen staan over twee of drie regels; de naam is de aanduidingsregel en de producent of herkomst staat als producer, nooit samengevoegd.
- 'v.a. 6,25' bij Likeuren en Grappa is als prijsvariant met label 'vanaf' vastgelegd; de bron noemt geen ander bedrag.
- Deze referentie is uit de vastgezette PDF-tekst en de paginageometrie opgesteld, niet uit de parseruitvoer.
- Deze bron is een PDF zonder bijbehorende HTML-pagina — restaurantgegevens konden hier niet uit worden afgeleid.
- PDF https://brasseriebardot.nl/wp-content/uploads/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf: 6 supplementregel(s) zijn niet als gerecht opgenomen; het concept ondersteunt supplementen nog niet.
- PDF https://brasseriebardot.nl/wp-content/uploads/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf: 27 regel(s) met een prijs- of hoeveelheidsgetal dat niet eenduidig aan een gerecht is te koppelen, zijn niet als gerecht overgenomen.
- PDF https://brasseriebardot.nl/wp-content/uploads/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf: 4 prijsregel(s) konden zonder aantoonbare lokale naam-/prijskoppeling niet als gerecht worden opgenomen.
- PDF https://brasseriebardot.nl/wp-content/uploads/2025/11/DEF-Dinerkaart-Bardot-5-nov.-2025-.pdf: 5 mogelijke rubriekkop(pen) zijn niet herkend en dus niet als rubriek opgeslagen.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (long_item_name, duplicate_item_across_categories, unresolved_price, duplicate_item_within_category, pdf_supplements_skipped, pdf_ambiguous_price_lines, pdf_unlinked_price_lines, pdf_unrecognised_headings); het resultaat is niet als volledig beoordeeld.

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
- Menukaart https://www.restaurantzuyd.nl/lunch: 1 gerecht(en) met meerdere prijzen (prijsvarianten zoals aantal stuks, gewicht, glas/fles of een basis- en een uitgebreide prijs) zijn als prijsvarianten opgeslagen met het bedrag en het label dat de bron print; geen enkel bedrag is tot één prijs teruggebracht.
- Menukaart https://www.restaurantzuyd.nl/diner: sectie "Diner › VERRASSINGSMENU'S" is niet als gerechten opgenomen; 4 regel(s) horen bij een arrangement of keuzemenu (prijs per gang of portie) en zijn geen losse gerechten.
- Menukaart https://www.restaurantzuyd.nl/diner: 1 gerecht(en) met meerdere prijzen (prijsvarianten zoals aantal stuks, gewicht, glas/fles of een basis- en een uitgebreide prijs) zijn als prijsvarianten opgeslagen met het bedrag en het label dat de bron print; geen enkel bedrag is tot één prijs teruggebracht.
- Gelezen zonder automatisch herkende menukaart: https://www.restaurantzuyd.nl/kerstmenu.
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (html_arrangements_skipped); het resultaat is niet als volledig beoordeeld.

**Vastgezette bronversie:** 6 capture(s); html f4f685da725f, html 389470158b72, html 128cae10ca14, html 2bfaf63e7814, html 644810dfc971, html c9c130c079b7

### Restaurant Wolfslaar

**Gemist (1)**
- `Conference Peer` — Menukaart diner › Nagerechten — prijs 18.00 — citaat: “C onference Peer 18 pecannoot | kardemom | karamel | vanille” (Menukaart diner › Nagerechten › regel 2)

**Verzonnen (1)**
- `C onference Peer` — Menukaart diner › Nagerechten — prijs 18.00 — broncitaat: “C onference Peer pecannoot | kardemom | karamel | vanille 18”

**Prijsfouten (0)**
- geen

**Rubriekfouten (0)**
- geen

**Beperkingen**
- De lunch- en dinerpagina drukken dezelfde à la carte; elke pagina is in deze referentie een eigen menu, zodat structuurverlies per pagina zichtbaar blijft.
- Prijzen staan als hele euro's zonder decimalen of valutateken. De quote houdt de gedrukte vorm; alleen het vergelijkbare prijsveld is als 00 cent geschreven.
- De lunchpagina bevat daarnaast het Lunchmenu; de dinerpagina niet.
- De pagina's noemen geen allergenen per gerecht; er staat alleen een algemene mededeling over allergieën en diëten. Allergenen blijven onbekend, niet allergeenvrij.
- De vastgezette pagina's bevatten geen menutitel; dat is een structuurbevinding in de meting en is hier niet weggepoetst.
- Deze referentie is uit de vastgezette brontekst opgesteld en niet uit de parseruitvoer.
- Gelezen zonder automatisch herkende menukaart: https://www.restaurantwolfslaar.com/menu-1.
- Menukaart lijkt alleen als afbeelding beschikbaar op https://www.restaurantwolfslaar.com/menu-1 (11 afbeelding(en), o.a. https://www.restaurantwolfslaar.com/assets/thumbs/640-1000-fit/Afbeeldingen/Nieuwe-foto-indeling/Food-fotografie/2026/St); beeldanalyse/OCR is niet geconfigureerd.
- Menukaart https://www.restaurantwolfslaar.com/nl/menu-diner: sectie "Over ons" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://www.restaurantwolfslaar.com/nl/menu-diner: sectie "Menu en Wijnen" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://www.restaurantwolfslaar.com/nl/menu-diner: sectie "Agenda en Blog" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://www.restaurantwolfslaar.com/nl/menu-diner: 2 gerecht(en) met meerdere prijzen (prijsvarianten zoals aantal stuks, gewicht, glas/fles of een basis- en een uitgebreide prijs) zijn als prijsvarianten opgeslagen met het bedrag en het label dat de bron print; geen enkel bedrag is tot één prijs teruggebracht.
- Menukaart https://www.restaurantwolfslaar.com/nl/menu-lunch: sectie "Over ons" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://www.restaurantwolfslaar.com/nl/menu-lunch: sectie "Menu en Wijnen" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://www.restaurantwolfslaar.com/nl/menu-lunch: sectie "Agenda en Blog" is niet als gerechten opgenomen; 1 regel(s) zonder herkenbare losse prijs (mogelijk arrangement of keuzemenu).
- Menukaart https://www.restaurantwolfslaar.com/nl/menu-lunch: 2 gerecht(en) met meerdere prijzen (prijsvarianten zoals aantal stuks, gewicht, glas/fles of een basis- en een uitgebreide prijs) zijn als prijsvarianten opgeslagen met het bedrag en het label dat de bron print; geen enkel bedrag is tot één prijs teruggebracht.
- AI-structurering is niet geconfigureerd; alleen deterministische extractie is uitgevoerd.
- Kwaliteitscontrole op de deterministische extractie vraagt aandacht (unresolved_price, html_arrangements_skipped); het resultaat is niet als volledig beoordeeld.

**Vastgezette bronversie:** 4 capture(s); html 14abdb9e684e, html 22d60179c67b, html bc35f9ca7a5c, html 19abbe4aa63a

### T-Huis

- **Geblokkeerd:** De vastgezette menupagina levert geen tekst: de vijf kaarten (Food, Lunch, Wijn, Drank, Dessert) staan als SVG-afbeelding in de tabpanelen. Zonder beeldanalyse/OCR is er geen gerecht, prijs of rubriek uit de vastgezette bytes te bewijzen. Daarom is er geen referentie en wordt T-Huis niet als lege of geslaagde extractie geteld.

## Integriteit en herhaalbaarheid

- Telregels: `docs/guides/menu-extraction-reference-counting-rules.md`, SHA-256 `0f09b74fdd9f33ecd58af4e3df8ab3c711ee70d32030bc4296f3af78adc2f09c` (ongewijzigd).
- Kaartcapture: `ops/benchmark/existing-card-references.json`, SHA-256 `dcb0e92b9cbefc7b56e5c934c722850078d3340c805498dd0e23bebbe2705bc4`.
- Bardot-pin: `ops/benchmark/card-reference-captures.json`, SHA-256 `06c00c1611289347d3afbf24e6ede7f2b489b8e659655b8a61f527637fc1304d`.
- Wolfslaar-pin: `ops/benchmark/card-reference-captures.wolfslaar.json`, SHA-256 `0705abddd1344f8728c0f936ced9f1e43cf8ec765206e0f6c9c293c74c236ed7`.
- T-Huis-pin: `ops/benchmark/card-reference-captures.thuis.json`, SHA-256 `49ad24e90eb83b79a5fa29e8d85c8d760c81dfe12b78fe8a81185448f69e866f`.
- Bardot-referentie: `ops/benchmark/reference-references/bardot.json`, SHA-256 `63d39733858c7ff2ccc7d3db0fd000eed5723d9bdbe83d3e308a38a0b807e9f1`, 112 items in 29 rubriekpaden en 7 supplementen.
- Zuyd-referentie: `ops/benchmark/reference-references/zuyd.json`, SHA-256 `fab4723f1d1d7dcc08fbac04eceb18d3d2214fc1e57a35ad3d893c6e7c7fca5b` (ongewijzigd).
- Wolfslaar-referentie: `ops/benchmark/reference-references/wolfslaar.json`, SHA-256 `69413b2155f4918ad5e5fe07ec83a981ad98edff86a3683ff075fc569d3be2d8`, 30 items in 6 rubriekpaden, 4 arrangementen en 3 supplementen.
- T-Huis-referentie: `ops/benchmark/reference-references/thuis.json`, SHA-256 `c4f0594dbf09c11de3b4c9d3e3d0cebb5971adc1793a1623e0f63568b3889a14`; status `blocked`, geen item.
- Iedere Bardot-referentiequote is tegen de vastgezette PDF-tekst gecontroleerd; 143 prijsbewijzen zijn opnieuw aan de vastgezette paginarij gekoppeld.
- Iedere Wolfslaar-referentiequote is tegen de vastgezette HTML-tekst gecontroleerd; een quote die niet in de vastgezette bytes staat, stopt de meting.
- De analyse is op de vastgezette bytes herhaald zonder netwerkoproep; hetzelfde script op dezelfde bytes levert hetzelfde rapport.
- Deze vier kaarten zijn geen ongeziene holdout en dit is geen productieacceptatie.

