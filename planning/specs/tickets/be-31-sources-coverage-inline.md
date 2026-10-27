# Ticket #74 — BE-31 Bronnen beoordelen, Dekking en afhandelen waar je het start

Live contract en status: GitHub issue #74.


**Eigenaarsbesluiten (2026-10-27):**
- akkoord met het nieuwe adres `/internal/bronnen`;
- "Nog niet gecontroleerd" verhuist naar Dekking;
- eerst een mockup, en daarna "ja ga met alles akkoord" over de mockup "Bronnen beoordelen v2" (8 schermen);
- afhandelen waar je het start;
- de samenhang met "Restaurant of menu toevoegen";
- het zichtbare woord **"menukopjes"** in plaats van "rubriek(indeling)".

**Goedgekeurde visuele referentie:** canvas "Bronnen beoordelen v2", versie 12 (https://claude.ai/artifact/Q6qq7anMZPNxygGEJU3qs3), scherm 1 tot en met 7. De bron-HTML staat in `docs/mockups/bronnen-v2/`. Scherm 8 ("Nieuw gevonden") en de knoppen "✨ Vind bronnen" en "✨ Zoek de bron voor mij" horen bij ronde 2 (BE-32) en blijven in deze ronde verborgen.

### Acceptatiecriteria
1. **Adres:**
   - "Bronnen beoordelen" leeft op `/internal/bronnen`;
   - `/internal/source-triage` stuurt met een 308 door naar `/internal/bronnen`;
   - `/internal/source-triage/batch` stuurt door naar `/internal/bronnen`, en een eventueel batch-id blijft bruikbaar;
   - de navigatie en het kruimelpad volgen het nieuwe adres;
   - technische namen (tabellen, API's, id's) blijven gelijk.
2. **Bronnen beoordelen toont alleen echt werk:**
   - **wat erin staat:** open voorstellen, bronnen die aandacht vragen, en batchresultaten die een menselijke actie vragen;
   - **filters:** chips "Alles", "🧪 Batches", "💡 Voorstellen" en "📡 Aandacht", met echte aantallen;
   - **details:** pas na het kiezen van een taak; daarvóór staat er "Kies een taak links";
   - **geen werk:** alleen "✅ Geen open bronwerk" met een link naar Dekking, zonder chips en zonder detailpaneel;
   - **telefoon:** een lijst, en een taak opent als eigen scherm;
   - **teller:** het aantal bij Werkvoorraad bovenin klopt met dit aantal taken.
3. **Dekking: "Nog niet gecontroleerd":**
   - restaurants zonder bruikbare broncontrole staan hier, met de bestaande reden-teksten, en niet meer in Bronnen beoordelen;
   - je kunt restaurants selecteren en dan klikken op "🔎 Controleer N geselecteerde", of per rij op "Controleer bron";
   - dit hergebruikt de bestaande batchanalyse met de bestaande limieten (10 per batch, 25 per dag) en de regel "loopt zolang de pagina open is".
4. **Afhandelen in de rij** (één gedeeld component voor Dekking en "Toevoegen"): per rij staan de voortgang (⏳), de uitkomst en precies één volgende stap:
   - ✅ zeker resultaat → "Bevestig bron", via de bestaande bevestigroute;
   - ⚠️ twijfel → "Menukopjes controleren", het scherm van BE-30, met daarna terug naar de rij;
   - 📋 geen menukaart gevonden → "Lees met AI";
   - ⛔ geblokkeerd, of geen bruikbaar resultaat → "Handmatig toevoegen".

   Wat niet is afgerond, blijft als taak in Bronnen beoordelen staan. Er wordt niets gekopieerd: het is dezelfde batch en dezelfde jobrij.
5. **"Restaurant of menu toevoegen":** het resultaat van een of meer links verschijnt onder het formulier als dezelfde rijen. De aparte batchpagina is niet meer nodig als bestemming.
6. **Zichtbare tekst:**
   - "rubriek", "rubrieken" en "rubriekindeling" worden overal in de interne UI "menukopje(s)": titels, knoppen, statussen, twijfelredenen en het AI-advies uit BE-30;
   - code-identifiers blijven gelijk.
7. **Bewijs:**
   - unit-tests: de takenselectie (alleen actiegevraagd), de tellers, de redirects, de rijstatussen en de eerstvolgende stap per status;
   - een browsercheck met screenshots van scherm 1 tot en met 7 op 1280, 390 en 320 px, in licht en donker;
   - `npm test` en `npm run build` groen.

### Niet in scope (dat is BE-32)
- OpenStreetMap, AI-zoeken naar websites of menulinks, en "Nieuw gevonden";
- migraties: als iets alleen met een migratie kan, stoppen en melden;
- publicatie; nieuwe rollen.

### Herstel ronde 2 — alleen echt werk, ook met echte data (Lead review 6439131777, eigenaarsbesluit 2026-10-27)

De Lead zag op de preview tien batchtaken voor bijna hetzelfde restaurant en een
doodlopend resultaat ("Handmatig toevoegen") bij een restaurant dat al een
menukaart heeft. Daarom, zonder migraties en zonder automatisch verlopen:

1. **Eén taak per restaurant**, met het nieuwste batchresultaat van dat
   restaurant. Oudere resultaten voor hetzelfde restaurant zijn geen taak meer.
   De titel is altijd de restaurantnaam, nooit "N restaurants".
2. **Alleen klaarliggende beslissingen zijn een taak:** ✅ zeker resultaat
   (Bevestig bron), ⚠️ Menukopjes controleren, 💡 open voorstel en 📡 bron vraagt
   aandacht. Een lopend resultaat is geen taak.
3. **Doodlopende uitkomsten zijn geen taak:** geen bruikbaar resultaat,
   robots-/toegangsblokkade en "geen menukaart gevonden" staan in Dekking onder
   "Nog niet gecontroleerd" met de bestaande reden en de passende stap in de rij
   ("Handmatig toevoegen" of "Lees met AI").
4. **Geen taak** voor een restaurant met een actieve, bevestigde bron of een
   gepubliceerde menukaart, tenzij het nieuwste resultaat iets **anders** zegt
   dan die bron (bijvoorbeeld een andere menu-URL).
5. **Leeftijd** staat in de taak en in de rij ("resultaat van 12 dagen
   geleden"), met "Opnieuw controleren" via de bestaande batchanalyse en
   limieten. Niets verloopt automatisch.
6. **"Oude resultaten opruimen"** sluit de geselecteerde of alle batchresultaten
   af als "afgehandeld door <medewerker> op <datum>", met één bevestiging die
   het aantal noemt. Niets wordt gewist: de vastlegging gaat additief naar de
   bestaande `field_evidence` van de jobrij (zoals BE-30), dus zonder migratie.
7. **De teller bij Werkvoorraad** volgt dezelfde taakdefinitie.

Dezelfde afbakening blijft gelden: geen BE-32-werk, geen publicatie, geen merge.

**Rollen:** Lead = Claude Code. Developer = DeepSeek via de lokale runner.
