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
Gemeten: 2026-10-30T06:30:57.376Z · commit `a8d51e820da4` · poort 3171 · koude cache.

| Pagina | HTML | JS | CSS | JSON/data | Totaal | Verzoeken | Grootste script |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home (`/`) | 8.1 | 134.7 | 25.9 | 7.3 | **176.7** | 18 | 53.5 KB |
| Zoeken (q=pasta) (`/search?q=pasta`) | 3.1 | 125.9 | 25.9 | 4.1 | **159.8** | 15 | 53.5 KB |
| Alle restaurants (`/alle-restaurants`) | 3.1 | 125.9 | 25.9 | 4.1 | **159.8** | 14 | 53.5 KB |
| Restaurant (Bardot, 4 kaarten) (`/restaurant/6`) | 11.6 | 132.6 | 25.9 | 2.4 | **173.2** | 15 | 53.5 KB |
| Menu (T-Huis borrel, 138 gerechten) (`/menu/23-borrel`) | 26.3 | 129.9 | 25.9 | 0 | **182.8** | 13 | 53.5 KB |
| Mijn lijstje (`/mijn-lijstje`) | 5.1 | 130.6 | 25.9 | 8.4 | **170.7** | 15 | 53.5 KB |

Alle bedragen in KB. Het eigen productdoel uit `CLAUDE.md` is minder dan 250 KB overgedragen bij de eerste keer laden.
<!-- meting:eind -->
