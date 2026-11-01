# Holdout-meting menulezer — 50 restaurants in Breda

Meting volgens besluit 021 (BE-73, #180): dezelfde motor als de startvulling van BE-71
(ophalen, lezen en de volledigheidseis, **ongewijzigd**) over de top 50 van
`ops/data/breda-restaurant-candidates.json`. **Alleen meten:** er is niets naar `data/`
geschreven en er is niets gepubliceerd. Alleen de eigen websites van de kandidaten,
geen AI, geen OCR en geen betaalde dienst. Wie blokkeert wordt overgeslagen.

- Ophaaldatum: 2026-11-01
- Gegenereerd: 2026-11-01T10:13:59.448Z
- Selectie: de top 50 van de kandidatenlijst, 38 daarvan meetbaar
- Vooraf overgeslagen: niemand (Wolfslaar staat niet in deze top 50)
- Geslaagd: 3 · overgeslagen: 35 · geblokkeerd: 12 (van 50)

## De 25 bekende tegenover de 50 onbekende

| Batch | Geslaagd | Van | Percentage |
| --- | --- | --- | --- |
| 25 bestaande restaurants (BE-71, ronde 3) | 3 | 25 | 12% |
| 50 onbekende restaurants (deze meting) | 3 | 50 | 6% |

Verschil: -6 procentpunt. 12 site(s) blokkeerden en zijn niet meegeteld als meting.

## Werkwijze

- De kaart is gelezen door de ongewijzigde motor van BE-71: geen regel versoepeld, geen
  uitzondering voor één site, niets naar `data/` geschreven.
- De plek van de kaart komt uit wat de motor zelf ophaalde. Herkende hij gerechten, dan zegt de
  bron het: een html-pagina op de eigen site is `subpagina`, een pdf met tekstlaag is
  `pdf met tekstlaag` (de kaart-url in de tabel laat zien of dat de homepage of een subpagina is).
- Herkende hij geen gerechten, dan beslist het bewijs uit de cache van de pagina's die hij wél
  ophaalde, in deze volgorde: `pdf zonder tekstlaag`, `afbeelding` (een afbeelding met een
  menuwoord in de naam op een pagina zonder prijzen), `extern platform` (een menulink naar een
  andere host), `JavaScript` (minder dan 200 woorden en geen menulink) en anders
  `geen kaart online`.
- `geblokkeerd` is geen oordeel over de kaart: robots.txt of het netwerk weigerde het ophalen, dus
  er is niets gelezen. Er is nooit om een blokkade heen gewerkt.
- De steekproef per geslaagde kaart is de eerste 10 gerechten met een prijs, in kaartvolgorde.

## Plek van de kaart

| Plek | Aantal |
| --- | --- |
| geblokkeerd | 12 |
| geen kaart online | 12 |
| afbeelding | 8 |
| pdf met tekstlaag | 7 |
| subpagina | 6 |
| JavaScript | 3 |
| extern platform | 2 |

## Redenen, gegroepeerd

- geen gerechten herkend: 25
- robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald.: 8
- gerechten zonder categorie: 4
- menukopje met onzekere structuur: 3
- robots.txt van deze site kon niet betrouwbaar worden gelezen (HTTP 301) — de pagina is niet opgehaald.: 2
- gerechten zonder prijs: 1
- herkende sectie niet als gerechten opgeslagen: 1
- robots.txt van deze site weigert toegang (HTTP 403) — de pagina is niet opgehaald.: 1
- minder dan 8 gerechten: 1
- robots.txt van deze site staat het ophalen van deze pagina niet toe.: 1

## Per kandidaat

| # | Restaurant | Kaart | Vorm | Plek | Gerechten | Met prijs | Uitkomst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Tortillas Breda | https://www.tortillas.nl/menu/ | html | subpagina | 126 | 126 | geslaagd |
| 2 | De Broodtoren | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald. (unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error)) |
| 3 | Brandpunt | https://www.brandpuntbreda.nl/wp-content/uploads/Brandpunt_Menu_Compleet_v2.pdf | pdf | pdf met tekstlaag | 64 | 64 | overgeslagen: gerechten zonder categorie (1 sectie(s)); menukopje met onzekere structuur (8 sectie(s)); prijs buiten € 1–€ 150 (3 gerecht(en)); pdf-regels gelezen maar niet als gerecht opgeslagen (1 aandachtspunt(en)) |
| 4 | Enjoy Vietnam | https://www.enjoyvietnam.nl/menu | html | subpagina | 31 | 30 | overgeslagen: gerechten zonder prijs (1 gerecht(en)); prijs buiten € 1–€ 150 (1 gerecht(en)); herkende sectie niet als gerechten opgeslagen (1 aandachtspunt(en)); gerecht met meerdere prijzen (1 aandachtspunt(en)) |
| 5 | Sylvie's Baguettes | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald. (unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error)) |
| 6 | Cafetaria De Toren | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 7 | De Colonie | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald. (unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error)) |
| 8 | Popocatepetl | — | html | JavaScript | 0 | 0 | overgeslagen: geen gerechten herkend |
| 9 | Friet Panters | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 10 | Dönerland Breda | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald. (unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error)) |
| 11 | Lunchroom Canella | — | html | afbeelding | 0 | 0 | overgeslagen: geen gerechten herkend |
| 12 | Tapasbar Plan B | https://www.tapasbarplanb.nl/hapasmenu/ | html | subpagina | 31 | 31 | overgeslagen: herkende sectie niet als gerechten opgeslagen (1 aandachtspunt(en)) |
| 13 | El Greco Breda | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 14 | Geisha Lounge | — | html | extern platform | 0 | 0 | overgeslagen: geen gerechten herkend |
| 15 | Restaurant Sirtaki Breda | — | html | afbeelding | 0 | 0 | overgeslagen: geen gerechten herkend |
| 16 | Le Smash | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 17 | Mariposa | — | html | afbeelding | 0 | 0 | overgeslagen: geen gerechten herkend |
| 18 | Ellis Gourmet Burger Breda | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site kon niet betrouwbaar worden gelezen (HTTP 301) — de pagina is niet opgehaald. (invalid_or_unknown (redirect-cross-host)) |
| 19 | Tante Betsie | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 20 | Sultan Breda | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald. (unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error)) |
| 21 | JanenAlleman | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 22 | Texburger | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald. (unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error)) |
| 23 | Koffie Bij Teun | — | html | afbeelding | 0 | 0 | overgeslagen: geen gerechten herkend |
| 24 | Willy's Eethuis | — | html | JavaScript | 0 | 0 | overgeslagen: geen gerechten herkend |
| 25 | Een kopje geluk | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 26 | Saigon Deli | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 27 | L'Anatra | https://lanatra.nl/Lunch/ | html | subpagina | 12 | 12 | geslaagd |
| 28 | Rhodos Breda | — | html | afbeelding | 0 | 0 | overgeslagen: geen gerechten herkend |
| 29 | Bar Belle | — | html | extern platform | 0 | 0 | overgeslagen: geen gerechten herkend |
| 30 | Liefdegesticht | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site weigert toegang (HTTP 403) — de pagina is niet opgehaald. (access_denied (http 403)) |
| 31 | Sol Y Sombra | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site kon niet betrouwbaar worden gelezen (HTTP 301) — de pagina is niet opgehaald. (invalid_or_unknown (redirect-cross-host)) |
| 32 | De Jongens van Zand & Klei | https://www.zandenklei.nl/wp-content/uploads/2026/03/allergenen-menu.pdf | pdf | pdf met tekstlaag | 12 | 12 | overgeslagen: menukopje met onzekere structuur (5 sectie(s)); pdf-regels gelezen maar niet als gerecht opgeslagen (1 aandachtspunt(en)) |
| 33 | Bobbi's Bar | — | html | afbeelding | 0 | 0 | overgeslagen: geen gerechten herkend |
| 34 | Kees Kroket | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald. (unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error)) |
| 35 | Kej Caban | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald. (unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error)) |
| 36 | Restaurant Lades | — | html | afbeelding | 0 | 0 | overgeslagen: geen gerechten herkend |
| 37 | The Tosti Club | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 38 | Gaudím | https://www.gaudim.nl/lunch/ | html | subpagina | 13 | 13 | geslaagd |
| 39 | Chidoz | — | html | afbeelding | 0 | 0 | overgeslagen: geen gerechten herkend |
| 40 | Brasserie Houtmarkt | https://brasseriehoutmarkt.nl/wp-content/uploads/2024/10/drukklaar-nu-echt-Brasserie-Houtmarkt-Menukaart-zomer-2024-v1-1.pdf | pdf | pdf met tekstlaag | 65 | 65 | overgeslagen: gerechten zonder categorie (1 sectie(s)); menukopje met onzekere structuur (3 sectie(s)); dubbel gerecht binnen een categorie (3 gerecht(en)); pdf-regels gelezen maar niet als gerecht opgeslagen (1 aandachtspunt(en)) |
| 41 | KoffieTenTje | — | html | JavaScript | 0 | 0 | overgeslagen: geen gerechten herkend |
| 42 | Kamome | https://kamomeramen.nl/ | html | subpagina | 6 | 6 | overgeslagen: minder dan 8 gerechten (6 gerechten); herkende sectie niet als gerechten opgeslagen (1 aandachtspunt(en)) |
| 43 | Siri Sorn | — | — | geblokkeerd | 0 | 0 | geblokkeerd: robots.txt van deze site staat het ophalen van deze pagina niet toe. (rules_loaded (http 200)) |
| 44 | Kamu | https://www.kamu-breda.nl/wp-content/uploads/2026/03/KAART_LENTE_2026-1.pdf | pdf | pdf met tekstlaag | 82 | 82 | overgeslagen: menukopje met onzekere structuur (21 sectie(s)); dubbel gerecht binnen een categorie (1 gerecht(en)); pdf-regels gelezen maar niet als gerecht opgeslagen (1 aandachtspunt(en)) |
| 45 | Ume Breda | https://umebreda.nl/wp-content/uploads/2024/02/Menu-Ume-2024-2wb.pdf | pdf | pdf met tekstlaag | 10 | 7 | overgeslagen: gerechten zonder categorie (1 sectie(s)); gerechten zonder prijs (3 gerecht(en)); pdf-regels gelezen maar niet als gerecht opgeslagen (1 aandachtspunt(en)) |
| 46 | T-Thai | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 47 | Koya | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |
| 48 | Gastropub De Kleine Wereld | https://www.gastropubdkw.nl/dkw/wijnkaart-.pdf | pdf | pdf met tekstlaag | 64 | 64 | overgeslagen: gerechten zonder categorie (1 sectie(s)); menukopje met onzekere structuur (6 sectie(s)); prijs buiten € 1–€ 150 (4 gerecht(en)); pdf-regels gelezen maar niet als gerecht opgeslagen (1 aandachtspunt(en)) |
| 49 | New Maddox | https://maddoxbreda.nl/wp-content/uploads/2026/10/Maddox-Dinerkaart-Oktober-2026.pdf | pdf | pdf met tekstlaag | 23 | 23 | overgeslagen: menukopje met onzekere structuur (19 sectie(s)) |
| 50 | Mr.Moos Bistro | — | html | geen kaart online | 0 | 0 | overgeslagen: geen gerechten herkend |

## Bewijs per niet-geslaagde kandidaat

| # | Restaurant | Plek | Bewijs |
| --- | --- | --- | --- |
| 2 | De Broodtoren | geblokkeerd | unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error) |
| 3 | Brandpunt | pdf met tekstlaag | 64 gerechten uit een pdf met tekstlaag (/wp-content/uploads/Brandpunt_Menu_Compleet_v2.pdf) |
| 4 | Enjoy Vietnam | subpagina | 31 gerechten uit html op /menu |
| 5 | Sylvie's Baguettes | geblokkeerd | unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error) |
| 6 | Cafetaria De Toren | geen kaart online | homepage: 371 woorden, 0 menulink(en), geen kaart gevonden |
| 7 | De Colonie | geblokkeerd | unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error) |
| 8 | Popocatepetl | JavaScript | homepage: 3 woorden, 0 menulink(en) |
| 9 | Friet Panters | geen kaart online | homepage: 279 woorden, 0 menulink(en), geen kaart gevonden |
| 10 | Dönerland Breda | geblokkeerd | unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error) |
| 11 | Lunchroom Canella | afbeelding | 2 afbeelding(en) met een menuwoord op /, 0 prijzen in de html |
| 12 | Tapasbar Plan B | subpagina | 31 gerechten uit html op /hapasmenu/ |
| 13 | El Greco Breda | geen kaart online | homepage: 1448 woorden, 0 menulink(en), geen kaart gevonden |
| 14 | Geisha Lounge | extern platform | 1 menulink(en) naar takeaway.eatcard.nl op / |
| 15 | Restaurant Sirtaki Breda | afbeelding | 1 afbeelding(en) met een menuwoord op /, 0 prijzen in de html |
| 16 | Le Smash | geen kaart online | homepage: 523 woorden, 0 menulink(en), geen kaart gevonden |
| 17 | Mariposa | afbeelding | 10 afbeelding(en) met een menuwoord op /menu, 0 prijzen in de html |
| 18 | Ellis Gourmet Burger Breda | geblokkeerd | invalid_or_unknown (redirect-cross-host) |
| 19 | Tante Betsie | geen kaart online | homepage: 226 woorden, 0 menulink(en), geen kaart gevonden |
| 20 | Sultan Breda | geblokkeerd | unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error) |
| 21 | JanenAlleman | geen kaart online | homepage: 1014 woorden, 0 menulink(en), geen kaart gevonden |
| 22 | Texburger | geblokkeerd | unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error) |
| 23 | Koffie Bij Teun | afbeelding | 1 afbeelding(en) met een menuwoord op /, 0 prijzen in de html |
| 24 | Willy's Eethuis | JavaScript | homepage: 0 woorden, 0 menulink(en) |
| 25 | Een kopje geluk | geen kaart online | homepage: 546 woorden, 0 menulink(en), geen kaart gevonden |
| 26 | Saigon Deli | geen kaart online | homepage: 301 woorden, 1 menulink(en), geen kaart gevonden |
| 28 | Rhodos Breda | afbeelding | 52 afbeelding(en) met een menuwoord op /diner/, 0 prijzen in de html |
| 29 | Bar Belle | extern platform | 2 menulink(en) naar qrfy.io op /menu |
| 30 | Liefdegesticht | geblokkeerd | access_denied (http 403) |
| 31 | Sol Y Sombra | geblokkeerd | invalid_or_unknown (redirect-cross-host) |
| 32 | De Jongens van Zand & Klei | pdf met tekstlaag | 12 gerechten uit een pdf met tekstlaag (/wp-content/uploads/2026/03/allergenen-menu.pdf) |
| 33 | Bobbi's Bar | afbeelding | 3 afbeelding(en) met een menuwoord op /menukaart/lunch/, 0 prijzen in de html |
| 34 | Kees Kroket | geblokkeerd | unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error) |
| 35 | Kej Caban | geblokkeerd | unreachable (request-error, na een tweede poging met 20000 ms); eerste poging: unreachable (request-error) |
| 36 | Restaurant Lades | afbeelding | 2 afbeelding(en) met een menuwoord op /, 0 prijzen in de html |
| 37 | The Tosti Club | geen kaart online | homepage: 814 woorden, 0 menulink(en), geen kaart gevonden |
| 39 | Chidoz | afbeelding | 8 afbeelding(en) met een menuwoord op /menu/, 0 prijzen in de html |
| 40 | Brasserie Houtmarkt | pdf met tekstlaag | 65 gerechten uit een pdf met tekstlaag (/wp-content/uploads/2024/10/drukklaar-nu-echt-Brasserie-Houtmarkt-Menukaart-zomer-2024-v1-1.pdf) |
| 41 | KoffieTenTje | JavaScript | homepage: 164 woorden, 0 menulink(en) |
| 42 | Kamome | subpagina | 6 gerechten uit html op / |
| 43 | Siri Sorn | geblokkeerd | rules_loaded (http 200) |
| 44 | Kamu | pdf met tekstlaag | 82 gerechten uit een pdf met tekstlaag (/wp-content/uploads/2026/03/KAART_LENTE_2026-1.pdf) |
| 45 | Ume Breda | pdf met tekstlaag | 10 gerechten uit een pdf met tekstlaag (/wp-content/uploads/2024/02/Menu-Ume-2024-2wb.pdf) |
| 46 | T-Thai | geen kaart online | homepage: 213 woorden, 0 menulink(en), geen kaart gevonden |
| 47 | Koya | geen kaart online | homepage: 447 woorden, 1 menulink(en), geen kaart gevonden |
| 48 | Gastropub De Kleine Wereld | pdf met tekstlaag | 64 gerechten uit een pdf met tekstlaag (/dkw/wijnkaart-.pdf) |
| 49 | New Maddox | pdf met tekstlaag | 23 gerechten uit een pdf met tekstlaag (/wp-content/uploads/2026/10/Maddox-Dinerkaart-Oktober-2026.pdf) |
| 50 | Mr.Moos Bistro | geen kaart online | homepage: 202 woorden, 1 menulink(en), geen kaart gevonden |

## Steekproef: de eerste 10 gerechten met prijs per geslaagde kaart

### Tortillas Breda (1)

https://www.tortillas.nl/menu/ · html · 126 gerechten, 126 met prijs.

- Portie croquetas (Tapas & Bites) — € 9,50
- Portie uienringen (Tapas & Bites) — € 8,50
- Portie calamares (Tapas & Bites) — € 8,50
- Portie garnalen (Tapas & Bites) — € 12,50
- Portie albondigas (Tapas & Bites) — € 8,50
- Poppers (Tapas & Bites) — € 8,50
- Alitas Callejeras (Tapas & Bites) — € 9,50
- Elote (Tapas & Bites) — € 4,75
- Gepofte aardappel (Tapas & Bites) — € 5,25
- Bakje Batata (Tapas & Bites) — € 4,25

### L'Anatra (27)

https://lanatra.nl/Lunch/ · html · 12 gerechten, 12 met prijs.

- Brioche Anatolia (Lunch) — € 15,50
- Kıymalı Humus (Lunch) — € 14,50
- Çılbır (Lunch) — € 12,50
- Köfte Anatolia (Lunch) — € 14,50
- Falafel Anatolia (Lunch) — € 11,50
- Zeytin Salatası (Salade en soep) — € 11,50
- Mantar Çorbası (Salade en soep) — € 8,00
- Meze Tabağı (Borrel) — € 17,50
- Bitterballen (Borrel) — € 9,50
- Yeşil Biber (Borrel) — € 4,50

### Gaudím (38)

https://www.gaudim.nl/lunch/ · html · 13 gerechten, 13 met prijs.

- Sandvitx amb tonyina, ou dur i escalivada (BROODJES) — € 11,50
- Pa amb croquetes de pernil ibèric / gambes (BROODJES) — € 9,50
- Entrepà de pernil serrat, pebre i oli verge extra (BROODJES) — € 8,75
- Pa torrat amb tomàquet i formatge manxec (BROODJES) — € 11,50
- Hamburguesa de vedella amb ceba, pebrots i formatge gratinat (BROODJES) — € 13,50
- Ous remenats amb llonganissa (BROODJES) — € 11,50
- Truita de bacallà i bolets (BROODJES) — € 12,50
- Bikini amb pernil serrat i tetilla (BROODJES) — € 9,00
- Entrepà de sobrassada i formatge manxec (BROODJES) — € 10,50
- Plat de pinxos 6 peces (LUNCHSPECIALITEITEN) — € 18,00

