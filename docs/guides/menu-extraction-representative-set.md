# Menu-extractie — representatieve set en acceptatiedrempels

Status: meetplan voor #59, vastgelegd 2026-10-17 vóór de definitieve
acceptatievergelijking. Herzien 2026-10-18: de representatieve set en holdout
zijn machineleesbaar gepind in
[`ops/benchmark/menu-extraction-acceptance-set.json`](../../ops/benchmark/menu-extraction-acceptance-set.json);
de representatieve set is uitgevoerd. De drie gerepareerde praktijkbronnen zijn
na hun eenmalige meting naar representatief verplaatst; alleen Gauchos Breda
blijft holdout. Zie de [acceptatiematrix](menu-extraction-acceptance-matrix.md).
Protocol: `MENU-EXTRACTION.md` v0.2, SHA-256
`15510b4c0b74fee722ac2c51a3f40aa21b03e0161ccffdcb2008f3d27350b762`.

## Representatieve set

| ID | Bron | Vorm | Doel |
| --- | --- | --- | --- |
| R1 | `https://restaurantsmelt.nl/wp-content/uploads/2026/05/smelt_menu_breda_nederlands.pdf` | tekst-PDF, twee pagina's, twee kolommen | echte Smelt-case; prijzen, kolommen en dekking |
| R2 | `https://www.restaurantblossem.nl/` → `/nl/restaurant` | HTML, tab/uitklapstructuur | echte Blossem-case; lunch/diner-achtige rubrieken |
| R3 | bestaande structuurcorpus `ops/benchmark/structureCorpus.js` | synthetische HTML-fixtures | plat, genest, tabellen, kaarten, `br`-regels |
| R4 | bestaande PDF-fixtures | synthetische tekst-PDF's | prijs, kolom, geen tekstlaag, fallback |
| R5 | `data/menus.json` (Wolfslaar, Bardot, Zuyd, T-Huis) | gecontroleerde historische export | vorm-/mappingregressie, nooit actuele waarheid; live vergeleken op 2026-10-21, zie [bestaande kaarten](menu-extraction-existing-cards.md) |
| R6 | ongeldige/lege/geblokkeerde bronfixtures | fouten | time-out, robots, verkeerde vestiging, duplicaat |

## Ongeziene set

De holdout is op 2026-10-18 afzonderlijk gepind in het manifest. De vier door de
Product Owner goedgekeurde openbare bronnen zijn vóór de meting capture-only
vastgelegd in
[`ops/benchmark/holdout-references.json`](../../ops/benchmark/holdout-references.json)
en daarna elk precies één keer geëvalueerd. De statussen zijn expliciet:
`unused`, `evaluated_once` en `used_for_tuning`. Een getunede bron mag niet in
de holdout blijven; die moet naar de representatieve set en een nieuwe holdout
vragen. Smelt en Blossem zijn voor tuning gebruikt en mogen daarom nooit als
ongeziene holdout worden gepresenteerd. De Botanist, Mr Moos en Colonia zijn na
hun eerste meting voor reparatie gebruikt en daarom naar representatief
verplaatst; zij zijn geen holdout meer.

Op 2026-10-21 is een tweede ongeziene set van 19 bronnen vooraf gepind in
[`holdout-2-sources.json`](../../ops/benchmark/holdout-2-sources.json). Die set
wordt niet door de ontwikkelaar opgehaald of geïnspecteerd; de capture en de
enige evaluatie gebeuren door de Delivery Lead met een expliciet manifest. Zie
[holdouttooling](menu-extraction-holdout-tooling.md) voor de werkwijze,
uitvoerbestanden en regressies.

| Bron | Uitkomst eerste meting (baseline) | Beperking / huidige status |
| --- | --- | --- |
| De Botanist | 151 items in 59 secties uit de gelinkte 16-pagina-PDF; entryhash gelijk aan de pin | Baseline blijft staan. Na reparatie 195 items/54 secties; layoutreferentie 95/141 matched, 46 missing, 5 extra, 95 niet-gekoppeld. **Representatief/usedForTuning**, geen holdout. |
| Gauchos Grill Breda | HTTP 404 op de goedgekeurde Breda-URL; geen menu gelezen | Geen alternatieve URL of andere vestiging gebruikt. **Enige overgebleven holdout**. |
| Mr Moos | 0 items; `/menukaart` gelezen maar niet automatisch herkend | Na begrensde hubdetectie 247 items in 3 menu's; `/groepsmenu` geblokkeerd. **Representatief/usedForTuning**, geen holdout. |
| Colonia Breda | 0 items; homepage plus vijf kandidaatpagina's gelezen | Na HTML-prijselementreparatie 84 items in 16 secties; wijn/brunch/high tea gemeld als niet verliesvrij. **Representatief/usedForTuning**, geen holdout. |

Deze uitkomsten zijn één eerste observatie. De reparaties zijn niet in de
holdoutuitkomst teruggeschreven; de oorspronkelijke waarden staan in
`holdout-evaluation.json`. Zonder een nieuwe, vooraf gepinde holdout is er geen
tweede onafhankelijke meting.

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
- onafhankelijke menselijke item-voor-itemcontroles van de vier oorspronkelijke
  praktijkbronnen; de eerste meting is automatisch uitgevoerd en als observatie
  vastgelegd, en de drie gerepareerde bronnen zijn daarna representatief;
- een tweede holdoutmeting of een nieuwe holdout na de tuning; die is nog niet
  gepind;
- de 50–100-bronnen BE-21-set;
- live/staging browser- of schrijfacceptatie in een geïsoleerde omgeving (de
  lokale fixture is uitgevoerd; live niet);
- echte app-side provideractivering, kostenmeting en DPA/EU-retentietest.

Een groene test of een bereikbare URL is geen bewijs van volledige extractie.
