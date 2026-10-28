# Ticket #90 — BE-38 Straks op de kaart

Live contract en status: GitHub issue #90.


**Eigenaarsbesluit (27 okt):** "dit is een hele goede aanpassing graag doorvoeren". Geen mockup nodig. Volgorde: na BE-37.

**Aanleiding:** "Vanavond op de kaart" (BE-29) toont alleen restaurants die nu open zijn, en verdwijnt bij minder dan 3 gerechten. Om 16:30 bijvoorbeeld hebben maar 2 restaurants een borrelkaart, en dan staat er niets op de home.

**Visuele referentie:** de bestaande sectie "Vanavond op de kaart" in de BE-28-stijl. Alleen de titel en de inhoudsregel veranderen.

### Acceptatiecriteria
1. **Terugvalregel:** zijn er voor het huidige moment minder dan 3 geschikte gerechten, dan toont de sectie **"Straks op de kaart · vanaf HH:MM"**:
   - het zijn gerechten van het **eerstvolgende moment van vandaag** (bijvoorbeeld diner) van restaurants die dan open zijn;
   - "vanaf" is het vroegste openingstijdstip van die restaurants;
   - dezelfde regels gelden als bij BE-29: een echte prijs, een bestelbaar gerecht, één per restaurant, prijsspreiding en een vaste selectie per dag.
2. **Na sluitingstijd:** is er vandaag niets meer, dan "Morgen op de kaart" met de lunch van morgen.
3. **Labels:**
   - een gerecht uit de terugval krijgt "🕒 Opent om HH:MM" in plaats van "Nu open";
   - het label "Nu open" blijft alleen voor wat nu echt open is.
4. **Verbergen:** alleen als er ook na de terugval minder dan 3 gerechten zijn, verdwijnt de sectie.
5. **Server en browser:** de browser bepaalt alles wat van de klok afhangt (zoals BE-29), en de server-HTML bevat niets dat van de klok afhangt.
6. **Bewijs:**
   - unit-tests met een vaste datum en tijd: 16:30 met 2 borrelrestaurants geeft "Straks op de kaart · vanaf 17:30"; 23:30 geeft "Morgen op de kaart"; als er genoeg is, de normale titel;
   - screenshots op 1280 en 390 px, in licht en donker;
   - `npm test` en `npm run build` groen.

### Niet in scope
- nieuwe data;
- AI;
- een migratie.
