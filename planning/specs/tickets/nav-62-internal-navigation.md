# Ticket #62 — interne navigatie en "Restaurant of menu toevoegen"

Live contract en status: GitHub issue #62. Deze kopie legt het goedgekeurde contract vast in de repo.


**Eigenaarsbesluiten:**
- 2026-10-23: de keuze voor variant 4b, de naamswijzigingen en "Restaurant of menu toevoegen".
- 2026-10-24: "akkoord mockup".

**Goedgekeurde visuele referentie:** de mockup "Nieuwe navigatie intern", 4 schermen (https://claude.ai/artifact/CthRNEbV12zu5osco3G1tS, versie 5).

### Uitkomst
Een interne medewerker ziet bovenaan alleen **Dekking**, **Werkvoorraad (N) ▾** en **+ Restaurant of menu toevoegen**. Het open werk staat met echte aantallen in het uitklapmenu. Alles wat nieuw binnenkomt (restaurant, menu, één of meerdere URL's) loopt via één formulier dat zelf de juiste route kiest.

### Acceptatiecriteria
1. **Bovenbalk:**
   - Dekking (was Dekkingsoverzicht);
   - Werkvoorraad met een totaal van het open werk;
   - de knop **+ Restaurant of menu toevoegen**;
   - Licht/Donker en Sign out.

   "Onboarding Restaurant" is geen apart item in de balk meer.
2. **Uitklapmenu Werkvoorraad:**
   - eerst "Open werk", met **echte, berekende aantallen**, aflopend gesorteerd: Menuconcepten beoordelen, Bronnen beoordelen, Nieuwe aanleveringen, en Beoordelen voor de editor-rol;
   - een scheidingslijn;
   - daaronder **Stadsoverzicht** (was Bronwerkvoorraad) en **Restaurantgegevens (concept)** (was Profielconcepten).

   Alleen de zichtbare labels veranderen; routes en id's blijven gelijk. Als een aantal niet te berekenen is, staat er geen nep-getal.
3. **De tegelpagina "Beheer" (`/internal`) vervalt als bestemming:**
   - na het inloggen en via het logo ga je naar het onderdeel met het meeste open werk; bij nul open werk naar Dekking;
   - `/internal` stuurt door volgens dezelfde regel;
   - rollen en toegang blijven ongewijzigd.
4. **"Restaurant of menu toevoegen"** is een nieuwe pagina met één formulier: een restaurantzoeker (leeg betekent een nieuw restaurant) en URL('s). De app kiest de route en hergebruikt de bestaande schermen en API's:
   - bekend restaurant met één URL: de bestaande analyse, daarna bij mislukking "Lees met AI" (#59);
   - nieuw restaurant: de bestaande Onboarding Restaurant-flow, met de URL ingevuld;
   - meerdere URL's: de bestaande batchanalyse.

   "Liever zelf invoeren of plakken" leidt naar de bestaande handmatige import. Bestaande routes en deeplinks blijven werken.
5. **Telefoon (390 en 320 px):**
   - de balk toont het logo, Dekking, Werk (N) en een **+**-knop van ten minste 44 px;
   - het menu toont dezelfde indeling, met Licht/Donker en Sign out onderin;
   - werkt met het toetsenbord en een schermlezer;
   - licht en donker thema via de bestaande tokens.
6. **Bewijs:**
   - tests voor de navigatiemodel-logica (sortering, aantallen, de landing-regel, rollen);
   - een browsercheck met screenshots (desktop en 390/320 px, licht en donker), te vergelijken met de mockup;
   - `npm test` en `npm run build` groen.

### Niet in scope
- nieuwe rollen of rechten;
- databasewijzigingen of migraties (stop en meld het als aantallen alleen met een migratie kunnen);
- publieke (niet-interne) pagina's;
- wijzigingen aan de extractie of AI-functies.

**Rollen:** Lead = Claude Code (contract, review, acceptatie, release). Developer = DeepSeek via de lokale runner.
