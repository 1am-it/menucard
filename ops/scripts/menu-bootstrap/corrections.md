# Correctielog van de menulezer

Wat de lezer van de startvulling (besluit 021, BE-71) geleerd heeft, en waarom.
Elke regel komt uit een review: de Lead legt een uitzondering voor, de eigenaar
beslist, en de developer bouwt een regel met een test. Zo hoeft niemand op het
chatgeheugen te vertrouwen.

**Werkwijze** (besluit 021, aanvulling van 1 nov 2026):
1. De lezer draait over een batch. De Lead kijkt de prijzen na tegen de website.
2. De Lead legt alleen uitzonderingen en regelvragen aan de eigenaar voor, als
   genummerde keuzes met een advies.
3. Elk besluit wordt hier een regel: het besluit, het voorbeeld, de test en de
   status.
4. De developer bouwt de regel met een fixture en een test, en draait de batch
   opnieuw.

Een regel geldt voor alle restaurants, niet voor één kaart. Een correctie die
maar voor één kaart geldt, hoort hier niet. Die gaat als aandachtspunt naar de
houder (later ticket) of blijft een uitzondering met een reden in het rapport.

## Regels

| # | Regel | Besluit | Voorbeeld | Status |
|---|---|---|---|---|
| R1 | Een gerechtnaam in alleen hoofdletters krijgt een gewone hoofdletter: eerste letter groot, de rest klein. Afkortingen van hooguit 3 letters (BBQ, XL) en eigennamen uit de restaurantnaam blijven zoals ze zijn. | Eigenaar, 1 nov 2026 (1b) | "STEAK TARTARE" → "Steak tartare"; "SANDWICH CHOCOLAT" → "Sandwich Chocolat" | gebouwd in ronde 3 (`R1: een naam in alleen hoofdletters krijgt een gewone hoofdletter, met de twee uitzonderingen`) |
| R2 | Twee gerechten met dezelfde naam en een andere prijs blijven staan zoals op de site. We verzinnen geen namen. De omschrijving toont het verschil. Dit wordt later een tip voor de houder ("geef ze een eigen naam"). | Eigenaar, 1 nov 2026 (2a) | Makanan: twee keer "Bami/Nasi Rames" (€ 14 en € 15) | vastgelegd, geen code nodig; de houdertip volgt in een later ticket |
| R3 | Een dubbele punt aan het eind van een categoriekop gaat weg. | Eigenaar, 1 nov 2026 (3a) | "Visgerechten indien voorradig:" → "Visgerechten indien voorradig" | gebouwd in ronde 3 (`R3: een dubbele punt aan het eind van een categoriekop gaat weg`) |
| R0 | Een tekstregel tussen haakjes direct na een naam zonder prijs is een omschrijving, nooit een gerechtnaam. Een kop zonder prijs boven een groep gerechten is een categorie. | Lead, review ronde 1 (BE-71) | Makanan: "(bami, nasi goreng of witte rijst …)" | gebouwd in ronde 2 |

## Voortgang per batch

| Batch | Datum | Geslaagd | Nagekeken prijzen | Fouten in prijzen |
|---|---|---|---|---|
| 25 bestaande, ronde 1 | 1 nov 2026 | 2 / 25 | 34 / 34 | 0 |
| 25 bestaande, ronde 2 | 1 nov 2026 | 3 / 25 | 34 / 34 (Zenza nog niet) | 0 |
| 25 bestaande, ronde 3 | 1 nov 2026 | 3 / 25 geschreven (5, 17, 22) | nog niet nagekeken | — |

Ronde 3 voegde R1 en R3 toe en verbeterde de kandidaatkeuze: de 13 sites zonder
herkende gerechten werden er 11. Gantau Village en Senang Makan lezen nu een pdf
met een tekstlaag op de eigen site (68 en 10 gerechten), maar halen de eis niet
(onzekere secties, gerechten zonder categorie, gerechten zonder categorie in de
kerstbestellijst). De overige 11, met het bewijs uit de cache:

| # | Restaurant | Waar de kaart staat | Bewijs uit de cache |
|---|---|---|---|
| 1 | Restaurant Wolfslaar | afbeelding | `/menu` (= `/menu-1`): 317 woorden, 16 afbeeldingen, 0 prijzen in de html |
| 3 | Con Fuego | in JavaScript geladen | homepage: 11 woorden tekst, geen menulink |
| 6 | Brasserie Bardot | in JavaScript geladen | homepage: 110 woorden, geen menulink |
| 8 | Al Dente Ristorante | afbeelding | `/menukaart-restaurant-2/`: 7 afbeeldingen met "kaart" in de naam, 0 prijzen |
| 9 | Beers & Barrels | extern platform | de kaart-pdf's staan op `static.rce.eu`, een andere host |
| 10 | Salon de Provence | in JavaScript geladen | homepage: 1,9 kB, alleen een lege pagina |
| 11 | De Beyerd | afbeelding | `/cafe-lunchkaart/`: 4 afbeeldingen met "kaart" in de naam, 0 prijzen |
| 14 | The Chai Affairs | in JavaScript geladen | homepage: 3,3 kB, alleen een lege pagina |
| 16 | Restaurant Smelt | in JavaScript geladen | homepage: 78 woorden, geen menulink |
| 20 | Klein Java | afbeelding | `/gerechten`: 310 woorden, 1 afbeelding met "gerecht" in de naam, 0 prijzen |
| 23 | T-Huis | afbeelding | `/menu/`: 17 afbeeldingen, 74 woorden, 0 prijzen |

Soort in het kort: 5 afbeelding, 5 in JavaScript geladen, 1 extern platform. Geen
ervan wordt omzeild; ze gaan naar de handmatige route.
