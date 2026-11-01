# Lanceringscheck publieke pagina's

Automatisch geschreven door `ops/browser/run-launch-check.js` (BE-70, #173).
Laatste meting: 2026-10-31T23:44:19.397Z · poort 3198 · bewijs: `ops/browser/evidence/launch-check.json`.

## Wat er gemeten is

Per pagina, in licht en donker op 1280, 390 en 320 px, op een verse lokale productieopbouw (`next build` + `next start`), met een echte browser via CDP en met gestubde API's waar een pagina die nodig heeft. Het thema gaat via de themakeuze in het instellingenpaneel, het paneel is dicht vóór de opname en elke opname heeft een `themeProof` (data-theme, actieve knop en de helderheid van `--bg`).

- **Laadgrootte:** de werkelijk overgedragen bytes bij de eerste lading, gemeten met CDP `Network.loadingFinished` (`encodedDataLength`) zonder cache. Budget: 250 kB per pagina.
- **Afbeeldingen:** geen afbeeldingen bij de eerste lading, behalve het logo en de iconen.
- **Overloop:** geen horizontale overloop (`scrollWidth` ≤ `innerWidth`).
- **Tikdoelen:** elk doel minstens 24 px; de hoofdknoppen minstens 44 px.
- **Koppen:** precies één h1 en geen overgeslagen niveau.
- **Toetsenbord:** de eerste Tab landt op een zichtbare focus.
- **a11y:** de bestaande audit (`ops/browser/lib/a11y-audit.js`) met 0 fouten.

## Uitslag per pagina

| Pagina | Laadgrootte (kB) | Afbeeldingen | Overloop | Tikdoelen | Hoofdknoppen | Koppen | Toetsenbord | a11y | Groen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 213.1 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/search?q=steak` | 194.4 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/search?q=qzxvbb` | 187.5 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/restaurant/6` | 210.4 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/menu/6-diner` | 213.1 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/restaurants` | 197.9 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/alle-restaurants` | 192.8 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/mijn-lijstje` | 206.3 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/mijn-lijstje` | 194.1 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/kies/be62stubcode0123456789` | 187.6 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/r/6` | 214.7 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/voor-restaurants` | 174.1 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/inloggen` | 167.8 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/privacy` | 172.4 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |
| `/colofon` | 180.4 kB (groen) | groen | groen | groen | groen | groen | groen | groen | groen |

Alle pagina's zijn groen op alle controles.

## Waar de bytes zaten

De zwaarste eerste ladingen, met de grootste antwoorden van die lading (CDP `Network.loadingFinished` → het pad en het type per respons).

- `/menu/6-diner` · 390 px · light · 228.7 kB · 42 aanvragen
  - 53.5 kB · Script · `/_next/static/chunks/4bd1b696-100b9d70ed4e49c1.js`
  - 45.2 kB · Script · `/_next/static/chunks/1255-55f5611cfd370a3f.js`
  - 25.8 kB · Stylesheet · `/_next/static/css/dd3fc74c50f63e7e.css`
  - 15 kB · Document · `/menu/6-diner`
  - 8.7 kB · Script · `/_next/static/chunks/app/search/page-6e046bef41fdd02e.js`
- `/menu/6-diner` · 390 px · dark · 228.7 kB · 42 aanvragen
  - 53.5 kB · Script · `/_next/static/chunks/4bd1b696-100b9d70ed4e49c1.js`
  - 45.2 kB · Script · `/_next/static/chunks/1255-55f5611cfd370a3f.js`
  - 25.8 kB · Stylesheet · `/_next/static/css/dd3fc74c50f63e7e.css`
  - 15 kB · Document · `/menu/6-diner`
  - 8.7 kB · Script · `/_next/static/chunks/app/search/page-6e046bef41fdd02e.js`
- `/r/6` · 390 px · light · 226.1 kB · 39 aanvragen
  - 53.5 kB · Script · `/_next/static/chunks/4bd1b696-100b9d70ed4e49c1.js`
  - 45.2 kB · Script · `/_next/static/chunks/1255-55f5611cfd370a3f.js`
  - 25.8 kB · Stylesheet · `/_next/static/css/dd3fc74c50f63e7e.css`
  - 12.3 kB · Document · `/restaurant/6`
  - 8.7 kB · Script · `/_next/static/chunks/app/search/page-6e046bef41fdd02e.js`
- `/menu/6-diner` · 320 px · light · 224 kB · 37 aanvragen
  - 53.5 kB · Script · `/_next/static/chunks/4bd1b696-100b9d70ed4e49c1.js`
  - 45.2 kB · Script · `/_next/static/chunks/1255-55f5611cfd370a3f.js`
  - 25.8 kB · Stylesheet · `/_next/static/css/dd3fc74c50f63e7e.css`
  - 15 kB · Document · `/menu/6-diner`
  - 8.7 kB · Script · `/_next/static/chunks/app/search/page-6e046bef41fdd02e.js`
- `/menu/6-diner` · 320 px · dark · 223.5 kB · 37 aanvragen
  - 53.5 kB · Script · `/_next/static/chunks/4bd1b696-100b9d70ed4e49c1.js`
  - 45.2 kB · Script · `/_next/static/chunks/1255-55f5611cfd370a3f.js`
  - 25.8 kB · Stylesheet · `/_next/static/css/dd3fc74c50f63e7e.css`
  - 15 kB · Document · `/menu/6-diner`
  - 8.7 kB · Script · `/_next/static/chunks/app/search/page-6e046bef41fdd02e.js`
- `/r/6` · 1280 px · dark · 218.7 kB · 40 aanvragen
  - 53.5 kB · Script · `/_next/static/chunks/4bd1b696-100b9d70ed4e49c1.js`
  - 45.2 kB · Script · `/_next/static/chunks/1255-55f5611cfd370a3f.js`
  - 25.8 kB · Stylesheet · `/_next/static/css/dd3fc74c50f63e7e.css`
  - 12.3 kB · Document · `/restaurant/6`
  - 6.4 kB · Script · `/_next/static/chunks/3652-896ed4e4eb830b8f.js`

## Open punten (eigenaar)

- `/privacy` en `/colofon` staan in de check en meten groen; de tekst bevat nog 6 placeholders die de eigenaar vóór de lancering invult (bron: `src/lib/legalCopy.js`, `LEGAL_PLACEHOLDERS`): `[DATUM]`, `[NAAM ORGANISATIE]`, `[ADRES]`, `[KVK-NUMMER]`, `[E-MAILADRES]`, `[REGIO VAN OPSLAG]`.

## Open punten

- `/restaurants` stuurt permanent door naar `/alle-restaurants` (BE-29); de meting is de doorverwijzing plus de doelpagina, dus dezelfde bytes als `/alle-restaurants`.
- `/r/[id]` is een korte QR-doorverwijzing naar `/restaurant/[id]` (BE-56): de meting is de doorverwijzing plus de restaurantpagina.

Ontwikkelaarsbewijs op een lokale opbouw: geen productie, geen onafhankelijke review en geen echte acceptatie.

