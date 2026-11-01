# Werklijst van Bredase restaurants uit OpenStreetMap (BE-72, #178)

Voorbereiding, geen publicatie (besluit 021). Dit rapport hoort bij het script
`ops/scripts/breda-candidates.js` en bij `ops/data/breda-restaurant-candidates.json`.
De site leest geen van beide: `data/` en `app/` zijn niet aangeraakt en `next build`
geeft dezelfde routes.

- Opgehaald: 2026-11-01T09:29:18.126Z
- Bron: OpenStreetMap via de Overpass API, met de bestaande Breda-grens, de bestaande
  spiegels en de bestaande user-agent uit `src/lib/osmOverpass.js` — één verzoek.
- Bronvermelding: © OpenStreetMap-bijdragers, ODbL
- Kandidaten in de lijst: 261

## Wat er wel en niet in komt

Wel: restaurant, fast_food, cafe. Niet: een plaats met een
brand- of brand:wikidata-tag (keten), zonder `website` of `contact:website`, met een
disused:/was:-tag of met "closed" in `opening_hours`, en alles wat al in
`data/restaurants.json` staat (genormaliseerde naam of website-host).

| Reden om af te vallen | Aantal |
| --- | ---: |
| Andere soort dan restaurant/fast_food/cafe | 109 |
| Geen bruikbare website | 69 |
| Keten (brand, brand:wikidata) | 55 |
| Gesloten (disused:/was: of "closed") | 1 |
| Staat al op de site | 17 |
| Dubbel gemapt (zelfde naam en host) | 1 |

## Aantallen per soort

| Soort | Aantal |
| --- | ---: |
| restaurant | 203 |
| fast_food | 41 |
| cafe | 17 |
| **Totaal** | **261** |

## Aantallen per afstandsring tot de Grote Markt

| Ring | Aantal |
| --- | ---: |
| < 1 km | 146 |
| 1-2 km | 39 |
| > 2 km | 76 |

## De rangorde

De score is `afstand − bonus`, met een bonus van 500 m voor een
keuken die in de 25 nog ontbreekt. De afstand tot de Grote Markt blijft dus de hoofdregel:
een ontbrekende keuken komt hooguit 500 m verder weg toch eerder.
"Ontbreekt" betekent: geen woord van de `cuisine`-tag komt voor in `cuisine`, `cuisineLabel`
of `cuisineKeywords` van de 25 (Nederlandse keukenwoorden eerst naar het OSM-woord vertaald).
Een kandidaat zonder `cuisine`-tag krijgt geen bonus en geen oordeel.

## De top 100

| # | Naam | Keuken | Afstand | Website-host |
| ---: | --- | --- | ---: | --- |
| 1 | Tortillas Breda | mexican | 47 m | tortillas.nl |
| 2 | De Broodtoren | sandwich | 51 m | broodtoren.nl |
| 3 | Brandpunt | coffee;tea;cookies | 52 m | brandpuntbreda.nl |
| 4 | Enjoy Vietnam | vietnamese | 54 m | enjoyvietnam.nl |
| 5 | Sylvie's Baguettes | sandwich | 66 m | sylviesbaguettes.nl |
| 6 | Cafetaria De Toren | friture;burger | 70 m | cafetariadetoren.nl |
| 7 | De Colonie | breakfast;lunch;drinks;diner | 85 m | breda.colonie.nl |
| 8 | Popocatepetl | mexican | 88 m | popo.nl |
| 9 | Friet Panters | friture;snack | 95 m | frietpanters.nl |
| 10 | Dönerland Breda | kebab | 96 m | donerland-breda.nl |
| 11 | Lunchroom Canella | lunch | 100 m | canella-breda.nl |
| 12 | Tapasbar Plan B | tapas | 100 m | tapasbarplanb.nl |
| 13 | El Greco Breda | greek | 120 m | elgrecobreda.nl |
| 14 | Geisha Lounge | sushi | 120 m | geishalounge.nl |
| 15 | Restaurant Sirtaki Breda | greek | 139 m | restaurantsirtakibreda.nl |
| 16 | Le Smash | burger | 195 m | le-smash.com |
| 17 | Mariposa | spanish | 195 m | mariposabreda.nl |
| 18 | Ellis Gourmet Burger Breda | burger;salads;friture | 200 m | ellisgourmetburger.be |
| 19 | Tante Betsie | lunch | 203 m | tante-betsie.nl |
| 20 | Sultan Breda | turkish | 206 m | sultanbreda.nl |
| 21 | JanenAlleman | lunch | 219 m | janenallemanbreda.nl |
| 22 | Texburger | burger | 220 m | texburgerbreda.nl |
| 23 | Koffie Bij Teun | coffee_shop | 233 m | koffiebijteun.nl |
| 24 | Willy's Eethuis | kebab;turkish | 253 m | willys.eu |
| 25 | Een kopje geluk | coffee_shop | 254 m | eenkopjegeluk.nl |
| 26 | Saigon Deli | vietnamese | 272 m | saigondeli.nl |
| 27 | L'Anatra | turkish | 275 m | lanatra.nl |
| 28 | Rhodos Breda | greek | 282 m | rhodos-restaurant.nl |
| 29 | Bar Belle | tapas | 283 m | barbellebreda.com |
| 30 | Liefdegesticht | diner;lunch;drinks | 283 m | liefdegesticht.nl |
| 31 | Sol Y Sombra | tapas;spanish | 306 m | solysombra.nl |
| 32 | De Jongens van Zand & Klei | potato;fries | 308 m | zandenklei.nl |
| 33 | Bobbi's Bar | international | 311 m | bobbisbar.nl |
| 34 | Kees Kroket | burger;fries;friture;snacks | 315 m | keeskroketbreda.nl |
| 35 | Kej Caban | mexican | 328 m | kejcaban.nl |
| 36 | Restaurant Lades | turkish | 328 m | restaurantlades.nl |
| 37 | The Tosti Club | sandwich | 339 m | thetosticlub.nl |
| 38 | Gaudím | spanish | 345 m | gaudim.nl |
| 39 | Chidoz | mexican | 348 m | chidoz.mx |
| 40 | Brasserie Houtmarkt | breakfast;lunch;diner;drinks | 355 m | brasseriehoutmarkt.nl |
| 41 | KoffieTenTje | coffee_shop | 399 m | koffietentje.nl |
| 42 | Kamome | japanese | 404 m | kamomeramen.nl |
| 43 | Siri Sorn | thai | 415 m | siri-sorn-thaifood.com |
| 44 | Kamu | coffee_shop | 425 m | kamu-breda.nl |
| 45 | Ume Breda | japanese | 430 m | umebreda.nl |
| 46 | T-Thai | thai | 449 m | tthai.nl |
| 47 | Koya | iraqi | 454 m | restaurantkoya.nl |
| 48 | Gastropub De Kleine Wereld | — | 34 m | gastropubdkw.nl |
| 49 | New Maddox | — | 41 m | maddoxbreda.nl |
| 50 | Mr.Moos Bistro | — | 52 m | mrmoos.nl |
| 51 | Sabores | mediterranean;spanish;italian | 53 m | saboresbreda.nl |
| 52 | The Goat Breda | fast_food | 53 m | the-goat.nl |
| 53 | To Romano | italian | 59 m | toromano.nl |
| 54 | Holy Moly Club Breda | — | 60 m | holymolybreda.nl |
| 55 | Sticky Fingers | — | 60 m | stickyfingersbreda.nl |
| 56 | Da Attilio | italian | 66 m | da-attilio.nl |
| 57 | Teds - Breda Sutor | — | 69 m | teds-place.nl |
| 58 | Brisas | latin_american | 72 m | brisasbreda.nl |
| 59 | Has Döner Kebab | — | 84 m | hasdonerbreda.nl |
| 60 | Ichimoto | sushi | 588 m | ichimotosushi.nl |
| 61 | Teds Place Beda Botanique | lunch | 590 m | teds-place.nl |
| 62 | Madam Sas | — | 96 m | madamsas.nl |
| 63 | Ciao Belli | italian | 101 m | ciaobellibreda.nl |
| 64 | Cigkoftepoint Breda | sushi;turks | 608 m | cigkoftepoint.cashdesk.nl |
| 65 | Rodeo | grill;steak | 113 m | restaurant-rodeo.nl |
| 66 | Frituur Christ | fries;snacks | 615 m | frituurchrist.nl |
| 67 | Happy Tosti | — | 119 m | happytosti.nl |
| 68 | Ribsfactory Breda | — | 119 m | ribsfactory.nl |
| 69 | Goxu House Lunchrestaurant | korean;bubble_tea | 622 m | goxuhouse.com |
| 70 | Boterhal | — | 127 m | deboterhal.nl |
| 71 | Ciao Ciccio | italian:pasta | 128 m | ciaocicciobreda.nl |
| 72 | Farao | kebab;grill;pizza | 128 m | faraobreda.nl |
| 73 | Wok King | asian | 134 m | wok-king-breda.nl |
| 74 | Gastrobar De Markt | — | 136 m | demarktbreda.nl |
| 75 | Crafft Breda | — | 138 m | crafftbreda.nl |
| 76 | Eetcafé Johannes | — | 140 m | eetcafejohannes.nl |
| 77 | Cafetaria & Pizzeria Breda'tje | friture;pizza;italian_pizza | 141 m | bredatje-breda.nl |
| 78 | De Basis | — | 143 m | inspirecoffee.com |
| 79 | The Wings Paradise | — | 144 m | wingsparadise.nl |
| 80 | Al-Basha | syrian | 645 m | albasha-breda.nl |
| 81 | Kinzan Sushi | sushi | 647 m | kinzan.nl |
| 82 | Brick Coffee | coffee_shop | 648 m | brick-coffee.nl |
| 83 | Eethuis Prisiri | surinamese | 660 m | eethuisprisiri.nl |
| 84 | Yirga | — | 164 m | yirga.nl |
| 85 | 't Hart van Breda | — | 166 m | hartvanbreda.nl |
| 86 | Taste The Original | sandwich;organic;tea | 677 m | tastetheoriginal.nl |
| 87 | Publieke Werken | — | 179 m | cafepubliekewerken.com |
| 88 | Bühne | asian | 183 m | buhne-breda.nl |
| 89 | Burgertijd | burger | 685 m | burgertijd-online.nl |
| 90 | Yu & Me | asian | 190 m | yumebreda.nl |
| 91 | Zeezicht | drinks;beer;whine;lunch;diner | 196 m | zeezichtbreda.com |
| 92 | The Duck Truck | — | 197 m | theducktruck.nl |
| 93 | 5. by Cas | — | 203 m | omabreda.nl |
| 94 | De Bommel | — | 214 m | debommel.nl |
| 95 | El Quinto Pino | spanish;tapas | 720 m | elquintopinobreda.nl |
| 96 | Koffiebar Sowieso | — | 221 m | koffiebarsowieso.nl |
| 97 | Bistro Munch | — | 228 m | bistromunch.nl |
| 98 | Ontbijt, Lunch & Koffiehuys Markt 28 | — | 235 m | markt28.com |
| 99 | In Kannen En Kruiken | — | 240 m | inkannenenkruikenbreda.nl |
| 100 | Taj Mahal | indian | 246 m | tajmahalbreda.nl |

## Ontbrekende keukens die de lijst toevoegt

| Keuken | Kandidaten |
| --- | ---: |
| friture | 9 |
| lunch | 9 |
| sushi | 8 |
| burger | 7 |
| coffee | 7 |
| sandwich | 7 |
| turkish | 7 |
| japanese | 6 |
| kebab | 6 |
| spanish | 6 |
| tapas | 6 |
| greek | 4 |
| international | 4 |
| mexican | 4 |
| thai | 4 |
| diner | 3 |
| drinks | 3 |
| fries | 3 |
| regional | 3 |
| tea | 3 |
| afghan | 2 |
| breakfast | 2 |
| pancake | 2 |
| snack | 2 |
| snacks | 2 |
| surinamese | 2 |
| syrian | 2 |
| vietnamese | 2 |
| azie | 1 |
| bubble | 1 |
| cookies | 1 |
| cream | 1 |
| ice | 1 |
| iraqi | 1 |
| korean | 1 |
| moroccan | 1 |
| organic | 1 |
| oriental | 1 |
| potato | 1 |
| salads | 1 |
| zuidoost | 1 |

In totaal 103 kandidaten met een keuken die de 25 niet hebben.

## Wat dit rapport niet doet

- Geen restaurantwebsite opgehaald; dat is een latere stap.
- Geen database, geen Supabase, geen migratie en geen nieuwe dependency.
- `data/menus.json`, `data/restaurants.json` en `ops/scripts/menu-bootstrap/` zijn niet aangeraakt.
- Per kandidaat staan telefoon (191), openingstijden (74) en
  keuken (160) alleen zoals OpenStreetMap ze heeft; ontbreekt een veld, dan is het leeg.
