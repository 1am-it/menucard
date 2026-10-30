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
Gemeten: 2026-10-30T06:50:33.280Z · commit `536c69f09a3c` · poort 3171 · koude cache.

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
