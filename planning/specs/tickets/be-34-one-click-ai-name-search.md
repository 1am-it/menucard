# Ticket #81 — BE-34 Lees met AI met één klik en nieuw restaurant zoeken op naam

Live contract en status: GitHub issue #81.


**Aanleiding (praktijktest 27 okt):**
- "Lees met AI" in de resultaatrij opent de oude **handmatige** AI-import (kopiëren en plakken), terwijl de app de kaart zelf kan lezen (#59, route B, live).
- Een nieuw restaurant ("Bobby's Bar") is niet te vinden: "Zoek de bron voor mij" werkt alleen voor bekende restaurants.

**Eigenaarsbesluiten (27 okt):** "Akkoord met alle 3", en later "Akkoord" op de laadweergave, het nachtelijk ophalen van OpenStreetMap en "Alles nagelopen". Dat omvat oplossing 1 en oplossing 2, als BE-34 direct na BE-33 (#79).

**Visuele referentie:** de bestaande resultaatrij (BE-31), het toevoegformulier (scherm 7 van "Bronnen beoordelen v2") en het bestaande controle-scherm van "Lees met AI" (Lijst | Kaart). Er is geen nieuwe pagina.

### Acceptatiecriteria
1. **"Lees met AI" met één klik in de rij** (Dekking, Bronnen beoordelen, Toevoegen):
   - het start direct de bestaande server-side AI-lezing (#59) voor de bron van die rij, met dezelfde client, hetzelfde budget en dezelfde limieten;
   - de rij toont de voortgang ("⏳ AI leest de kaart… ± 1 minuut") met de kostenschatting, en daarna de uitkomst, bijvoorbeeld "✅ 42 gerechten gelezen · 3 controle nodig";
   - de knop **"Bekijk en controleer"** opent het bestaande controle-scherm (Lijst | Kaart), met het resultaat al geladen;
   - opslaan als concept gaat zoals nu;
   - mislukt de lezing, of is het budget op of de AI uit, dan volgt een eerlijke melding met als volgende stap "Handmatig toevoegen";
   - de handmatige import is alleen nog een kleine link **"Liever zelf plakken"**, nooit de eerste bestemming van "Lees met AI";
   - bij een bron die alleen afbeeldingen bevat (BE-33) gebruikt dezelfde knop het lezen van beeld.
2. **Een nieuw restaurant zoeken op naam** in "Restaurant of menu toevoegen":
   - staat de getypte naam niet in onze lijst, dan verschijnt **"✨ Zoek op internet: <naam>, Breda"**;
   - dat gebruikt de AI-zoeklaag van BE-32: bronvermelding verplicht, platforms geweigerd, budget vooraf gecontroleerd, kosten zichtbaar;
   - het voorstel toont de naam, het adres, de website en de menulink, met de herkomst;
   - **"Toevoegen als nieuw restaurant"** opent de bestaande onboarding met de naam, het adres en de website ingevuld;
   - daarna kan het lezen van de menukaart in dezelfde rij starten, met "Controleer" en daarna "Lees met AI";
   - er wordt nooit automatisch een restaurant aangemaakt: een mens bevestigt altijd;
   - het OpenStreetMap-adres gaat nu ook mee naar de onboarding (restpunt BE-32).
3. **"Alles nagelopen" bij gerechten van een afbeelding (BE-33):**
   - één knop met één bevestiging die het aantal noemt ("12 gerechten nagelopen?");
   - per gerecht blijft aanpassen mogelijk;
   - vastgelegd als menselijk besluit;
   - daarna kan "Opslaan als concept".
4. **Laten zien dat de app bezig is:**
   - **Nieuw gevonden:** een draaiend icoon met "🗺️ OpenStreetMap wordt opgehaald… (± 20 seconden, eerste keer per dag)", in plaats van "(0)" met een kale tekst;
   - **Vind bronnen:** een meelopende stappenlijst ("🗺️ OpenStreetMap ✓ · 🌐 Websites 4 van 10 · 🤖 AI-zoeken 1 van 2") met een voortgangsbalk, en de knop staat zolang op "Bezig…" en is niet klikbaar;
   - **per rij:** "⏳ Zoeken…" bij het restaurant waar de app op dat moment mee bezig is;
   - **na afloop:** "Bijgewerkt om HH:MM"; bij een mislukking de reden in gewone taal ("duurde te lang" of "server bezet") en de knop "Opnieuw proberen".
5. **OpenStreetMap 's nachts ophalen:**
   - een tweede dagelijkse Vercel-cron (naast de keep-alive in , alleen ) roept een route aan die het OSM-antwoord vooraf in de cache zet (, tag );
   - die route schrijft geen data, geeft niets terug behalve , en controleert  als die bestaat;
   - overdag staat "Nieuw gevonden" daardoor meteen klaar;
   - de Y1-test (alleen  in ) blijft groen.
6. **Bewijs:**
   - unit-tests met een nagebootste AI: de één-klik-lezing (geslaagd, mislukt, budget op, AI uit), het zoeken op naam (gevonden, niet gevonden, alleen een platform gevonden) en het meenemen van de gegevens naar de onboarding;
   - screenshots van de rij tijdens en na de AI-lezing, en van het zoeken op naam, op 1280 en 390 px, in licht en donker;
   - `npm test` en `npm run build` groen;
   - geen betaalde aanroep in tests.

### Niet in scope
- automatisch restaurants aanmaken, bevestigen of publiceren;
- een nieuwe sleutel of een hoger budget;
- een migratie (stoppen en melden);
- andere steden.

**Rollen:** Lead = Claude Code. Developer = DeepSeek via de lokale runner.
