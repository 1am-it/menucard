# Menu-extractie — representatieve set en acceptatiedrempels

Status: meetplan voor #59, vastgelegd 2026-10-17 vóór de definitieve
acceptatievergelijking. Dit is geen claim dat de set al volledig is uitgevoerd.
Protocol: `MENU-EXTRACTION.md` v0.2, SHA-256
`15510b4c0b74fee722ac2c51a3f40aa21b03e0161ccffdcb2008f3d27350b762`.

## Representatieve set

| ID | Bron | Vorm | Doel |
| --- | --- | --- | --- |
| R1 | `https://restaurantsmelt.nl/wp-content/uploads/2026/05/smelt_menu_breda_nederlands.pdf` | tekst-PDF, twee pagina's, twee kolommen | echte Smelt-case; prijzen, kolommen en dekking |
| R2 | `https://www.restaurantblossem.nl/` → `/nl/restaurant` | HTML, tab/uitklapstructuur | echte Blossem-case; lunch/diner-achtige rubrieken |
| R3 | bestaande structuurcorpus `ops/benchmark/structureCorpus.js` | synthetische HTML-fixtures | plat, genest, tabellen, kaarten, `br`-regels |
| R4 | bestaande PDF-fixtures | synthetische tekst-PDF's | prijs, kolom, geen tekstlaag, fallback |
| R5 | `data/menus.json` (Wolfslaar, Bardot, Zuyd, T-Huis) | gecontroleerde historische export | vorm-/mappingregressie, nooit actuele waarheid |
| R6 | ongeldige/lege/geblokkeerde bronfixtures | fouten | time-out, robots, verkeerde vestiging, duplicaat |

## Ongeziene set

De ongeziene set wordt pas na de implementatieronde gekozen uit nog niet
gebruikte, toegestane bronnen. Er worden hier geen URL's verzonnen. Zonder
toegang of een vooraf gecontroleerde referentie blijft dit expliciet
`niet uitgevoerd`; Smelt en Blossem alleen zijn geen volledige dekking.

## Meetbare drempels (voorstel, vóór acceptatie)

- **0** verzonnen gerechten en **0** verzonnen prijzen.
- **100%** van de geëxtraheerde items heeft bron-ID, locator en ondersteunende
  passage/hash; een item zonder bewijs is geen geaccepteerd item.
- **100%** van de ontbrekende/onzekere onderdelen heeft een reden en
  dekkingregistratie.
- Prijsstatus is expliciet; geen stilzwijgende laagste prijs, geen supplement
  als hoofdprijs, geen allergenen als leeg/onbekend exporteren.
- Voor gecontroleerde referenties: geen structuurverlies in titel, variant,
  rubriekpad, volgorde en prijsrelatie; afwijkingen zijn blokkades.
- Precision/recall, prijsfouten, correctiewerk, tijd en kosten worden per
  brontype gerapporteerd; drempels worden niet achteraf verlaagd.
- Een onvolledige PDF (zoals de huidige Smelt-kolomparser) mag niet als
  geslaagde volledige extractie worden gepresenteerd.

## Uitgevoerde bronproeven

| Bron | Observatie | Beoordeling |
| --- | --- | --- |
| Smelt Breda PDF | 2 pagina's, 894 woorden, huidige parser: 50 items in 6 rubrieken; namen als `Hollands Zwitsers` en `Smelt's Cheese Burger Burrata salade` tonen kolom-/baselinevermenging; categorieën en aantallen zijn niet bronvast | **niet geaccepteerd**; inhoudelijke parserbeperking blijft open |
| Blossem Breda HTML | 23 items in 8 rubrieken, titel `PROEF HET BESTE VAN HET SEIZOEN`, bron `/nl/restaurant` | extractie loopt; nog geen onafhankelijke item-voor-item acceptatie |
| Smelt homepage | geen menulink gevonden op de landingspagina; Breda-pagina bevat de PDF-link | homepage alleen is geen extractiebewijs |

Deze observaties zijn van 2026-10-17 en daarmee achterhaald door de
gecontroleerde bronvergelijking van 2026-10-18 in
`menu-extraction-acceptance.md`: Smelt 37/37 en Blossem 43/43 items exact, met
byte-/contenthash en expliciete uitsluitingen. Ze blijven hier als historie
staan; de nieuwste vergelijking is leidend. Die vergelijking is geautomatiseerd
tegen een gecontroleerde capture en is geen onafhankelijke menselijke
acceptatie.

Deze resultaten zijn read-only verkregen via de bestaande robots-, SSRF-,
redirect- en omvangscontroles. Er zijn geen productiegegevens of concepten
geschreven.

## Niet-uitgevoerd

- onafhankelijke menselijke vergelijking van alle Smelt-regels met de PDF (de
  geautomatiseerde vergelijking met de gecontroleerde capture is uitgevoerd);
- een onafhankelijke menselijke Blossem-item-voor-itemcontrole (de
  geautomatiseerde vergelijking is uitgevoerd);
- de 50–100-bronnen BE-21-set en de ongeziene set;
- browser-/schrijfacceptatie in een geïsoleerde omgeving;
- echte provideractivering, kostenmeting en DPA/EU-retentietest.

Een groene test of een bereikbare URL is geen bewijs van volledige extractie.
