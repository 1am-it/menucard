# Golf 1 — Breda naar 50 restaurants (BE-79, #195)

Werkwijze: besluit 021 en het #195-contract. Per restaurant de eigen website
(robots.txt gerespecteerd, met rust tussen verzoeken), daarna OSM-gegevens uit
`ops/data/breda-restaurant-candidates.json`. Niets verzonnen: een veld dat niet
uit de bron blijkt, blijft leeg. `leadChecked` zet de developer nooit; dat doet de
Lead na de prijscontrole.

Bron voor de buurt: `ops/data/breda-buurten.json` (postcode 4811 → Binnenstad,
met straatuitzonderingen), onderbouwd met de bestaande data en bewaakt door
`ops/data/breda-buurten.test.js`.

## Prijscontrole

`price-check.js` (BE-78) staat niet in deze checkout; dat ticket is nog niet
gemerged. De developer vergelijkt de kaart daarom zelf met de bron en meldt dat
hier per kaart. Zodra BE-78 er is, hoort de Lead deze controle opnieuw te doen
vóór `leadChecked`.

## Stand per restaurant (batch 1, in de volgorde van de opdracht)

| # | Restaurant | Uitkomst |
|---|---|---|
| 1 | Tortillas Breda | **open** — `tortillas.nl` is de site van de vestiging Eindhoven ("Lekker Mexicaans eten in Eindhoven"); geen Breda-pagina of Breda-kaart gevonden. Niet toegevoegd tot dat is uitgezocht. |
| 2 | Enjoy Vietnam | **overgeslagen: gesloten** — de eigen site zegt zelf "Enjoy Vietnam is permament geloten/closed". |
| 3 | De Colonie | **toegevoegd als 26, zonder kaart** — adres, telefoon en omschrijving van `breda.colonie.nl` (werkt zonder `www`; met `www` bestaat het domein niet meer), openingstijden uit OSM. De menukaart-pagina noemt alleen High tea (€ 21,50 p.p.) en brunch (€ 19,50 p.p.) en geen gerechten met prijzen, dus geen kaart en geen prijsniveau. |
| 4 | Popocatepetl | **overgeslagen: keten** — landelijke keten (opdracht van de Lead). |
| 5 | Lunchroom Canella | **open** — site bestaat; de kaart staat als losse gerechtpagina's in `food_menu-sitemap.xml`, nog niet overgenomen. |
| 6 | Tapasbar Plan B | **open** — site bestaat (openingstijden van de site); `/menu/` geeft 404, menulink nog niet gevonden. |
| 7 | El Greco Breda | **open** — site bestaat ("Pita Gyros El Greco", bestelkaart met prijzen als HTML-tekst). |
| 8 | Geisha Lounge | **open** — site bestaat (keuken Zo–Do 12:00–21:45, Vr–Za 12:00–22:15); `/menu` geeft 404. |
| 9 | Restaurant Sirtaki Breda | **open** — site bestaat (elke dag 16:30–22:00); `/menukaart` is groter dan 5 MB en levert geen tekst. |
| 10 | Le Smash | **overgeslagen: keten** — elf vestigingen in Nederland, de site is één landelijke kaart. |
| 11 | Mariposa | **open** — site bestaat; de menukaart op `/menu` is alleen een reeks afbeeldingen ("Klik voor een vergroting"). |
| 12 | Ellis Gourmet Burger Breda | **overgeslagen: keten** — landelijke/Belgische keten (opdracht van de Lead). |
| 13 | Tante Betsie | **open** — site bestaat; de lunchpagina bevat geen gerechten met prijzen. |
| 14 | Sultan Breda | **overgeslagen: geen website** — `www.sultanbreda.nl` resolvet niet meer (ENOTFOUND). |
| 15 | JanenAlleman | **open** — site bestaat, met de volledige kaart als HTML-tekst en prijzen (soepen, broodjes, salades, planken, high tea, kindermenu). |

Open betekent: website gecontroleerd, restaurant bestaat, maar het restaurant is
in deze ronde niet afgerond. Die punten gaan door in de volgende ronde van
dezelfde batch; ze zijn niet stilzwijgend overgeslagen.

## Toegevoegd in deze ronde

- **26 — De Colonie** (Grote Markt 26-28, Binnenstad): zonder kaart.
  Bron: eigen site en OSM-openingstijden.
