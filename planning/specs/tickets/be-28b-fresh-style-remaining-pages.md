# Ticket #68 — BE-28b Alle restaurants en overige publieke pagina's

Live contract en status: GitHub issue #68.


**Vervolg op #65 (BE-28, live via PR #66).** Bij de acceptatie bleek `/alle-restaurants` alleen nieuwe kleuren te hebben gekregen, niet de nieuwe opbouw.

**Eigenaarsbesluit (2026-10-25):** "ja heel goed ga met alles akkoord": de mockup en de standaard sortering "Met menukaart eerst".

**Goedgekeurde visuele referentie:** canvas "Onze Menukaarten – eigen gezicht v2", versie 17 (https://claude.ai/artifact/8VLxwWFHkffexpyLPyF5DD), borden `Alle restaurants · desktop antraciet`, `· desktop licht` en `· telefoon antraciet`. De bron-HTML staat in `docs/mockups/be-28-fresh-style-v1/` (`alle-restaurants-*.html`). Voor de rest gelden de BE-28-regels: antraciet met witte knoppen, emoji's overal.

### Acceptatiecriteria
1. **`/alle-restaurants`** volgt de mockup:
   - een emoji-tegel per keuken, met de naam, "keuken · prijsklasse" en 📍 het adres;
   - even hoge kaarten die in hun geheel klikbaar zijn;
   - **met menukaart:** de menukaart-labels met emoji en één knop "📋 Bekijk N menukaarten" (of "Bekijk menukaart" bij één);
   - **zonder menukaart:** geen grote knop, wel een neutraal label "Nog geen menukaart" en de link "Bekijk restaurant →" (op de telefoon een compacte regel met →).
2. **Chips en sorteren:**
   - de chip "📋 Met menukaart" en keuken-chips met emoji, die de bestaande filtering hergebruiken;
   - een sorteerkeuze met **"Met menukaart eerst" als standaard** en "A–Z" als alternatief;
   - het aantal ("25 restaurants · N met menukaart") wordt berekend uit de echte data.
3. **De keuken-emoji** komen uit één kleine, geteste mapping. Een onbekende keuken krijgt 🍽️.
4. **De restaurantpagina (`/restaurant/[id]`), de menukaartpagina (`/menu/[id]`) en `/restaurants`** volgen dezelfde stijl:
   - de kaarten, ronde chips en emoji-labels van de home en de zoekresultaten;
   - de reserveerknop blijft secundair, en "Bekijk menukaart" blijft leidend;
   - geen gedrag of routes gewijzigd.
5. **Geen pagina blijft achter in de oude stijl:** controleer elke publieke pagina, ook `/claim` en `/nvwa`, op 1280, 390 en 320 px, in licht en donker.
6. **Bewijs:**
   - de browsercheck van BE-28, uitgebreid naar deze pagina's, met screenshots;
   - een gemeten contrast;
   - de overdracht van `/alle-restaurants` vóór en na, niet groter dan nu;
   - `npm test` en `npm run build` groen.

### Niet in scope
- nieuwe data, API's, migraties;
- de interne pagina's herontwerpen;
- foto's;
- nieuwe functies.

**Rollen:** Lead = Claude Code. Developer = DeepSeek via de lokale runner.
