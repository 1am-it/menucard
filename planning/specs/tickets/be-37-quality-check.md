# Ticket #89 — BE-37 Kwaliteitscheck nieuwe stijl

Live contract en status: GitHub issue #89.


**Eigenaarsbesluit (27 okt):** "optie 1 ook". Volgorde: na BE-36 (#87).

**Visuele referentie:** de bestaande BE-28-stijl (`docs/mockups/be-28-fresh-style-v1/`, `docs/mockups/bronnen-v2/`). Er komt geen nieuwe opbouw en geen nieuw gedrag.

### Acceptatiecriteria
1. **Contrast:**
   - meet het contrast in licht en antraciet op de publieke pagina's (home, zoeken, alle restaurants, restaurant, menukaart) en de interne pagina's (Dekking, Bronnen beoordelen, Toevoegen, Menu importeren);
   - tekst moet minstens 4,5:1 halen, en randen, focus en essentiële iconen minstens 3:1;
   - herstel wat het niet haalt, via de tokens in `app/globals.css`;
   - leg de metingen vast in `docs/guides/design-reference.md`.
2. **Snelheid:**
   - meet de initiële overdracht van `/`, `/alle-restaurants`, `/restaurant/[id]` en `/menu/[id]`, met als doel minder dan 250 KB;
   - pak de grootste oorzaak aan als een pagina daarboven zit, zonder nieuwe dependencies;
   - leg vóór en na vast.
3. **Toetsenbord en schermlezer:**
   - alle knoppen, chips, rijen en dialogen zijn met het toetsenbord bereikbaar en hebben een zichtbare focus;
   - een dialoog sluit met Escape en geeft de focus terug;
   - decoratieve emoji zijn `aria-hidden`;
   - herstel wat ontbreekt.
4. **Telefoon:**
   - er is geen horizontale overloop op 320 en 390 px op dezelfde pagina's;
   - de tikvlakken zijn minstens 44 px.
5. **Slordigheden:**
   - de kolomkoppen in Dekking ("SELECTEERRESTAURANT" heeft een ontbrekende spatie en uitlijning);
   - dubbele weergave in Dekking (dezelfde rij boven en in "Resultaat van de controle");
   - de rest van de Engelse resten in de interne pagina's;
   - inconsistente knoplabels.
6. **Bewijs:**
   - een browsercheck met metingen en screenshots vóór en na, op 1280, 390 en 320 px, in licht en donker;
   - `npm test` en `npm run build` groen.

### Niet in scope
- nieuwe functies;
- een nieuwe opbouw van een pagina;
- een migratie;
- een ander palet.
