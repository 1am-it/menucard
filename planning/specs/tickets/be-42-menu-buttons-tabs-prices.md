# BE-42 — kaartnamen als knoppen, menukaart in tabbladen, rustigere prijzen (#98)

Contract: https://github.com/1am-it/menucard/issues/98 (bron van waarheid; deze kopie volgt het issue). Uitvoering in twee rondes: deel 1 = 1A + 3B, deel 2 = 2A.


**Eigenaarsbesluit (28 okt):** **1A, 2A, 3B** uit de mockup.

**Visuele referentie (goedgekeurd):** https://claude.ai/artifact/1U4XCdA9eqH3R3RJvNvH6a. Het gaat om de artboards "1A · kaartnamen zijn knoppen", "2A · tabbladen met de hele kaart" en "Prijs" in variant **B · zacht vlak**.

**Aanleiding (eigenaar):**
- "Bekijk 4 menukaarten" gaat naar de algemene restaurantpagina.
- Een klik op bijvoorbeeld "Borrelkaart" gaat óók daarheen, want de hele kaart is één link.
- De restaurantpagina toont maar een preview van zes gerechten van één kaart.
- De zwarte prijsvlakken trekken te veel aandacht.

### Acceptatiecriteria
1. **1A, de restaurantkaart in `/alle-restaurants`:**
   - de kaart is geen ene grote link meer. De restaurantnaam is de link naar de restaurantpagina;
   - elke kaartnaam (Lunchkaart, Dinerkaart, Borrelkaart, Specialiteiten, …) is een eigen knop naar **die** menukaart (`/menu/<id>`);
   - de grote knop "Bekijk N menukaarten" vervalt;
   - restaurants zonder menukaart blijven zoals ze zijn ("Nog geen menukaart" en "Bekijk restaurant →");
   - toetsenbord: logische tabvolgorde (naam, dan de kaartknoppen), zichtbare focus, aanraakvlakken ≥ 44 px.
2. **2A, de restaurantpagina:** de "Menukaart preview" wordt een sectie **"Menukaarten"** met één tabblad per kaart, met het aantal gerechten erbij. Onder het actieve tabblad staat de **hele** kaart, per menukopje, met naam, beschrijving en prijs.
   - **Standaardtabblad:** vast en zonder klok, dus de eerste kaart in de volgorde lunch, diner, borrel, overige. De server-HTML bevat niets dat van de klok afhangt (de BE-29-regel).
   - **Tabbladen werken zonder JavaScript:** het zijn echte links, bijvoorbeeld `?kaart=<id>`, die de server rendert. Met JavaScript wisselen ze zonder dat de hele pagina opnieuw laadt.
   - **Zuinig:** alleen de gekozen kaart staat in de HTML of wordt geladen, nooit alle kaarten tegelijk. De eerste overdracht van de restaurantpagina blijft < 250 KB. Meet dat voor en na, met Bardot als grootste geval.
   - **Behouden:** de bronregel per kaart (zoals "Dinerkaart nov. 2025 · gescraped uit pdf…") en de link naar de originele kaart.
   - **Behouden:** de aparte menupagina `/menu/<id>`.
   - **Gerecht zonder prijs:** "prijs onbekend" in gedempte tekst, nooit een verzonnen prijs.
3. **3B, de prijs:** overal waar nu het donkere prijsvlak staat, komt een zacht vlak in `var(--surface-soft)` met `var(--text-primary)`. Dat geldt ten minste voor de restaurantpagina, de menupagina en "Vanavond/Straks op de kaart" op de home.
   - De prijs blijft vet en rechts uitgelijnd.
   - Contrast ≥ 4,5:1 in licht en donker.
   - Noem in de PR elke plek die is aangepast.
4. **Bewijs:**
   - unit-tests voor het kaartmodel (1A) en voor de tabbladkeuze plus de standaardkaart (2A);
   - een regressietest dat de restaurantpagina maar één kaart in de HTML heeft;
   - transfermeting vóór en na;
   - screenshots op 1280, 390 en 320 px, in licht en donker, van `/alle-restaurants`, `/restaurant/6` (Bardot, 4 kaarten) en een restaurant met één kaart;
   - `npm test` en `npm run build` groen.

### Niet in scope
- nieuwe data;
- de interne schermen;
- foto's;
- migraties;
- nieuwe dependencies.

**Volgorde:** na BE-40 (#95) en BE-41 (#97). Er is maar één developerronde tegelijk.

