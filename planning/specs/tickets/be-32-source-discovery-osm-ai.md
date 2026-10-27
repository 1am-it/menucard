# Ticket #75 — BE-32 Vind bronnen met OpenStreetMap en AI

Live contract en status: GitHub issue #75.


**Volgorde:** na BE-31 (live 27 okt). Eigenaar gaf start-akkoord op 27 okt ("ja").

**Eigenaarsbesluit (2026-10-27):** "alles akkoord". Dit omvat:
- besluit 017: OpenStreetMap en AI mogen in de stap "Vinden", altijd als voorstel;
- de lagen 1 en 2 nu, en laag 3 (AI met internet-zoeken) voor restaurants zonder bekende website;
- het bestaande budget: $10 per maand.

**Visuele referentie:** canvas "Bronnen beoordelen v2", versie 12: scherm 5 (Vind bronnen), scherm 7 (Zoek de bron voor mij) en scherm 8 (Nieuw gevonden).

### Acceptatiecriteria
1. **"✨ Vind bronnen" in Dekking** stelt per restaurant een website en een menulink voor, met de herkomst erbij, in deze volgorde:
   - 🗺️ OpenStreetMap (een server-side opvraag, gecachet, voor Breda);
   - 🌐 het bestaande zoeken op dezelfde website;
   - 🤖 een AI-keuze tussen de pagina's van **dezelfde** website, met een citaat;
   - 🤖 AI-zoeken alleen als er geen website bekend is: met bronvermelding, en bezorg- of reserveringsplatforms worden genegeerd.

   Alles is een voorstel dat de mens per rij bevestigt.
2. **"✨ Zoek de bron voor mij"** in "Restaurant of menu toevoegen": dezelfde motor, voor één restaurant.
3. **"🆕 Nieuw gevonden"** in Dekking:
   - restaurants die in OpenStreetMap staan en niet bij ons;
   - "＋ Toevoegen" opent het formulier met alles ingevuld;
   - "Negeren" wordt onthouden;
   - Dekking voegt nooit zelf iets toe.
4. **Kosten en limieten:**
   - AI-aanroepen tellen mee in het bestaande maandbudget van 1000 cent;
   - de kosten staan zichtbaar na "Vind bronnen";
   - de bestaande daglimieten blijven gelden;
   - er komt geen nieuwe betaalde dienst bij.
5. **Herkomst en licentie:**
   - de herkomst wordt per voorstel opgeslagen;
   - de bronvermelding "© OpenStreetMap-bijdragers" is zichtbaar;
   - er worden geen persoonsgegevens opgeslagen.
6. **Dekking-pagina volgens mockup scherm 5:** de bovenkant wordt Nederlands ("Dekking 📊", drie tegels: restaurants, met menukaart, nog niet gecontroleerd) in de BE-28-stijl; de bestaande tabellen per buurt en keuken blijven, in het Nederlands.
7. **Bronnen beoordelen (restpunten BE-31):** "Oude resultaten opruimen" werkt alleen op een selectie of heet expliciet "Alle N opruimen"; het vlak "Kies een taak links" over de volle hoogte zoals in de mockup.
8. **Documentatie:** `planning/decisions/017-source-discovery-osm-ai.md` beschrijft het besluit, en besluit 016 krijgt een verwijzing ernaar.
9. **Bewijs:**
   - tests met nagebootste OpenStreetMap- en AI-antwoorden; geen echte betaalde aanroep in tests;
   - screenshots;
   - `npm test` en `npm run build` groen.

### Niet in scope
- het automatisch toevoegen of publiceren van restaurants of bronnen;
- een geplande, periodieke controle;
- een hoger budget;
- andere steden.

**Rollen:** Lead = Claude Code. Developer = DeepSeek via de lokale runner.
