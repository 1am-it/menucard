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
Gemeten: 2026-10-30T06:27:14.006Z · commit `e3474fbe5c3c` · poort 3171 · koude cache.

| Pagina | HTML | JS | CSS | JSON/data | Totaal | Verzoeken | Grootste script |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home (`/`) | 8.1 | 134.7 | 25.9 | 7.3 | **176.7** | 18 | 53.5 KB |
| Zoeken (q=pasta) (`/search?q=pasta`) | 3.1 | 134.7 | 25.9 | 10 | **174.4** | 17 | 53.5 KB |
| Alle restaurants (`/alle-restaurants`) | 3.1 | 134.7 | 25.9 | 15.2 | **179.6** | 26 | 53.5 KB |
| Restaurant (Bardot, 4 kaarten) (`/restaurant/6`) | 11.6 | 141.3 | 25.9 | 8.4 | **187.9** | 17 | 53.5 KB |
| Menu (T-Huis borrel, 138 gerechten) (`/menu/23-borrel`) | 26.3 | 138.6 | 25.9 | 5.9 | **197.5** | 15 | 53.5 KB |
| Mijn lijstje (`/mijn-lijstje`) | 5.1 | 130.6 | 25.9 | 8.4 | **170.6** | 15 | 53.5 KB |

Alle bedragen in KB. Het eigen productdoel uit `CLAUDE.md` is minder dan 250 KB overgedragen bij de eerste keer laden.
<!-- meting:eind -->
