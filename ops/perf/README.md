# Meting publieke pagina's (BE-50, #120)

Dit bestand wordt geschreven door `node ops/perf/measure-public-pages.js`:
de meting start zelf een lokale productiebuild (`next build` +
`next start`) op een poort uit 3170-3179 en meet daarna elke publieke
pagina koud in een headless browser. Netwerk blijft lokaal.

Per pagina: overgedragen bytes per soort (HTML, JS, CSS, JSON/data), het
totaal, het aantal verzoeken en het grootste script. De volledige meting
staat in `ops/perf/evidence/public-pages.json`; de budgettest
`ops/perf/public-pages-budget.test.js` gebruikt die grenzen.

<!-- meting:begin -->
Gemeten: 2026-10-30T07:40:17.025Z · commit `2086bdc5d083` · poort 3170 · koude cache.

| Pagina | HTML | JS | CSS | JSON/data | Totaal | Verzoeken | Grootste script |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home (`/`) | 8.1 | 134.5 | 25.9 | 7.3 | **176.5** | 18 | 53.5 KB |
| Zoeken (q=pasta) (`/search?q=pasta`) | 3.1 | 125.7 | 25.9 | 4.1 | **159.5** | 15 | 53.5 KB |
| Alle restaurants (`/alle-restaurants`) | 3.1 | 125.7 | 25.9 | 4.1 | **159.6** | 14 | 53.5 KB |
| Restaurant (Bardot, 4 kaarten) (`/restaurant/6`) | 11.6 | 132.4 | 25.9 | 2.4 | **173.1** | 15 | 53.5 KB |
| Menu (T-Huis borrel, 138 gerechten) (`/menu/23-borrel`) | 26.3 | 129.7 | 25.9 | 0 | **182.6** | 13 | 53.5 KB |
| Mijn lijstje (`/mijn-lijstje`) | 5.1 | 121.6 | 25.9 | 2.4 | **155.7** | 13 | 53.5 KB |

Alle bedragen in KB. Het eigen productdoel uit `CLAUDE.md` is minder dan 250 KB overgedragen bij de eerste keer laden.
<!-- meting:eind -->

## Voor en na (BE-50, #120)

Nulmeting op `main` (`e3474fb`, 2026-10-30T06:27Z) en de meting na de wijziging
(`2086bdc`, 2026-10-30T07:40Z): hetzelfde script, dezelfde koude eerste lading,
dezelfde viewport. Bedragen in KB overgedragen.

| Pagina | Voor | Na | Verschil | JS voor → na | JSON/data voor → na | Verzoeken voor → na |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Home (`/`) | 176,7 | 176,5 | -0,2 | 134,7 → 134,5 | 7,3 → 7,3 | 18 → 18 |
| Zoeken (`/search?q=pasta`) | 174,4 | 159,5 | -14,9 | 134,7 → 125,7 | 10,0 → 4,1 | 17 → 15 |
| Alle restaurants (`/alle-restaurants`) | 179,6 | 159,6 | -20,0 | 134,7 → 125,7 | 15,2 → 4,1 | 26 → 14 |
| Restaurant (Bardot, 4 kaarten) (`/restaurant/6`) | 187,9 | 173,1 | -14,8 | 141,3 → 132,4 | 8,4 → 2,4 | 17 → 15 |
| Menu (T-Huis borrel, 138 gerechten) (`/menu/23-borrel`) | 197,5 | 182,6 | -14,9 | 138,6 → 129,7 | 5,9 → 0 | 15 → 13 |
| Mijn lijstje (`/mijn-lijstje`) | 170,6 | 155,7 | -14,9 | 130,6 → 121,6 | 8,4 → 2,4 | 15 → 13 |

Wat er veranderde, alleen op de posten die de meting aanwees:

1. `ac19b51` — het woordmerk (de link naar `/`) liet Next.js op elke andere
   publieke pagina de hele home vooruit laden: de routechunk van `/` (8,8 KB)
   plus de complete RSC-lading van de home (5,9 KB, inclusief de
   kandidatenlijst). `prefetch={false}` haalt dat weg; doel, class en
   toegankelijke naam van de link blijven gelijk.
2. `5830ba0` — de eigen terug-link naar de home op `/mijn-lijstje` kreeg dezelfde
   behandeling, en het deelblad met het kleine deelmenu
   (`ShareDialog`/`ShareMenu`) zit niet meer in het eerste JS-pakket: het wordt
   via `next/dynamic` pas gerenderd als het opengaat.

De grootste winst zit dus in het niet meer vooruitladen van de home op de andere
pagina's: 15 tot 20 KB minder per pagina en 2 tot 12 verzoeken minder.

Wat bewust **niet** is gedaan, met de reden:

- **Home blijft ±176 KB.** De eigen RSC-lading (7,3 KB) en de routechunk van de
  home zijn precies wat die pagina op het scherm zet. Ze weglaten of later laden
  verandert wat de home toont; dat is een product- en ontwerpkeuze, geen
  technische opruiming. Daarom gemeld en niet gedaan.
- **`/menu/23-borrel` houdt 26,3 KB HTML.** Daarin staan de 138 gerechten
  server-gerenderd, zonder JavaScript leesbaar en indexeerbaar. Kleiner maken
  kan alleen met paginering of uitklappen: een ontwerpwijziging.
- **De JS-basis van 121,6–134,5 KB blijft.** Dat is de frameworkbasis van
  Next.js 15 + React 19 en is op elke pagina vrijwel gelijk. Verkleinen vraagt
  een architectuurkeuze (ander framework of een andere opzet), geen reparatie
  binnen dit contract.
- **Het deelblad zelf levert ±0,3 KB op.** De chunk met het Emoji-component
  wordt toch al door het eerste JS-pakket gedeeld; verder splitsen verplaatst
  alleen dezelfde bytes.
- **Geen cache-headers aangepast.** Deze ronde voegt geen eigen statische
  dataset en geen API-route toe; de winst zit in minder route-JS en minder
  RSC-data, die Next.js zelf al levert en labelt.

De budgettest `ops/perf/public-pages-budget.test.js` leest de grens per pagina
uit `buildFirstLoadJs.gzipBytes` in `evidence/public-pages.json` en faalt boven
+10%: `/` 133.447 B, `/search?q=pasta` 131.644 B, `/alle-restaurants` 129.325 B,
`/restaurant/6` 138.321 B, `/menu/23-borrel` 141.067 B, `/mijn-lijstje`
127.057 B.

Deze sectie staat buiten de `meting:begin`/`meting:eind`-markeringen en blijft
dus staan als het meetscript de tabel opnieuw schrijft.
