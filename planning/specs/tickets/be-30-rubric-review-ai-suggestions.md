# Ticket #72 — BE-30 Rubriekindeling controleren met AI-advies

Live contract en status: GitHub issue #72.


**Aanleiding (2026-10-25, praktijktest met Restaurant Smelt):** het scherm toont per onzekere rubriek alleen de naam, het aantal gerechten en "vindplaats: pdf:N". Zonder de gerechten of de kaart te zien kun je niet echt beoordelen of de rubriek klopt.

**Eigenaarsbesluit (2026-10-25):** "1 akkoord", dus de combinatie hieronder. Er is geen aparte mockup: het is een uitbreiding van het bestaande scherm in de BE-28-stijl, met screenshots ter controle (advies Lead, eigenaar volgt de adviezen).

### Acceptatiecriteria
1. **Gerechten per rubriek** (gratis, werkt ook met AI uit): elke onzekere rubriek is uitklapbaar en toont haar gerechten met prijs, zoals ze uit de bron zijn gelezen.
2. **Naar de bron:**
   - een link "Bekijk pagina N" opent de bron-pdf op die pagina (`#page=N`), of bij een website de bron-URL;
   - de reden van de twijfel staat in gewone taal bij de rubriek, voor zover de analyse die kent (bijv. "kopje niet herkend").
3. **AI-advies** (alleen als de AI-hulp aanstaat en er budget is):
   - **de aanroep:**
     - één aanroep per bronversie voor alle onzekere rubrieken samen;
     - hetzelfde model, dezelfde sleutel en dezelfde aanroepteller als "Lees met AI";
     - telt mee in het maandbudget van 1000 cent;
   - **het advies per rubriek:**
     - "klopt zo" of "corrigeer naar X";
     - met een **letterlijk citaat** uit de bron als bewijs, gecontroleerd met de bestaande bewijscontrole (`normalizeEvidenceText`);
     - zonder geldig citaat, of bij twijfel: geen advies;
   - **de weergave:**
     - het advies staat voorgeselecteerd, met een kleine zekerheidsaanduiding;
     - de mens bevestigt;
     - de AI beslist nooit zelf en schrijft niets weg zonder die bevestiging;
   - **als de AI niet beschikbaar is** (uit, budget op, fout of time-out): een eerlijke melding; het scherm werkt dan zoals in criterium 1 en 2.
4. **In één keer bevestigen:**
   - een knop "Alles klopt zo", of met AI "Neem alle adviezen over";
   - met één bevestigingsstap die het aantal noemt ("8 rubrieken bevestigen?");
   - per rubriek blijft handmatig aanpassen mogelijk.
5. **Gelijk gebleven:** de bestaande rechten, de vastlegging van wie wat besloot, en de regel "pas daarna kun je de bron bevestigen". Een AI-advies wordt vastgelegd als advies (`ai_suggested`), apart van het menselijke besluit.
6. **Bewijs:**
   - unit-tests: advies met geldig citaat, advies zonder geldig citaat dat wordt verworpen, budget op, AI uit, en bulkbevestiging;
   - een nagebootste AI-aanroep in de tests; geen betaalde aanroep in CI;
   - screenshots op 1280 en 390 px, licht en donker, met en zonder AI-advies;
   - `npm test` en `npm run build` groen.

### Niet in scope
- nieuwe AI-modellen of sleutels; een hoger budget;
- automatisch publiceren of automatisch bevestigen zonder mens;
- OCR of het uploaden van bestanden;
- een migratie (alleen als het advies niet zonder kan op te slaan: dan stoppen en melden).

**Rollen:** Lead = Claude Code. Developer = DeepSeek via de lokale runner.
