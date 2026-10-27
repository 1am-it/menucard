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

## Implementatie (BE-32, ronde 2 — DeepSeek, 27 okt)

De motor en de schermen zijn gebouwd binnen de grenzen hierboven. Keuzes die een
reviewer moet kunnen volgen:

- **Laag 1 (OpenStreetMap):** één server-side POST naar de openbare
  Overpass-API met een eigen User-Agent, begrensd tot de Breda-bbox en met
  `next: { revalidate: 86400 }`, zodat er nooit per klik een opvraag gaat.
  `src/lib/osmSource.js` (puur, getest) bouwt de vraag, parseert het antwoord en
  koppelt een restaurant via een genormaliseerde naam (zonder soortwoord) plus
  postcode, of afstand als beide kanten coördinaten hebben. Twijfel is geen
  koppeling. Van de tags blijven alleen naam, adres, website, soort en het
  OSM-object-id over — geen telefoon, e-mail of openingstijden.
- **Laag 2 en 3:** de bestaande zelfde-website-zoekfunctie (BE-20, max. 5
  kandidaten) levert de menulink als een link of zijn tekst op een menu wijst;
  anders kiest dezelfde AI-client (zelfde model, zelfde sleutel, zelfde
  maandteller) uit die kandidaten, met een citaat dat met
  `normalizeEvidenceText` aantoonbaar in de tekst van die pagina staat. Zonder
  citaat of buiten de kandidatenlijst: geen voorstel.
- **Laag 4:** AI-zoeken alleen als er na laag 1 geen website bekend is, met de
  webzoekfunctie van dezelfde provider en per resultaat een bron-URL. Een vaste,
  geteste lijst bezorg- en reserveringsplatforms wordt altijd verworpen.
- **Voorstel en herkomst:** elk resultaat is een BE-24-voorstel
  (`add_candidate`) met de herkomst in het bestaande `note`-veld (max. 280
  tekens): laag, website, menulink, citaat, bron en de gemeten AI-kosten. De rij
  toont "Bevestig voorstel"; daarna volgt de bestaande controle. Wat blijft
  liggen is een 💡-taak in Bronnen beoordelen.
- **"Negeren" bij Nieuw gevonden:** een BE-24-voorstel `mark_unusable` op de
  sleutel van het OSM-object (`osm-node-…`, met de OSM-URL als `current_url`).
  `buildTriageView` kent alleen restaurant-id's uit `data/restaurants.json`, dus
  zo'n rij wordt daar als verweesd voorstel geteld en nooit werk op een ander
  scherm. Geen migratie, geen nieuwe tabel.
- **Budget:** vóór elke AI-aanroep wordt het bestaande maandbedrag uit de
  duurzame AI-kosten gelezen en met `budgetDecision` getoetst; een betaalde
  mislukking telt mee. De gemeten kosten van een run staan in het voorstel
  (`kosten: N cent`) en `readAllAiUsageRows` leest ze daar terug, zodat ze in
  dezelfde teller van 1000 cent vallen als de AI-lezingen en de AI-adviezen —
  geen tweede teller, geen nieuwe tabel. Eén geval blijft buiten de maandteller:
  een AI-zoekactie die niets bruikbaars oplevert (dan is er geen voorstel om de
  kosten in vast te leggen). De schermen tonen dat bedrag wel apart. Volledige
  vastlegging daarvan vraagt een eigen kostenrij (migratie); dat is een besluit
  voor de Lead, niet iets om hier stil te doen.
- **Bewijs:** unit-tests met nagebootste Overpass- en AI-antwoorden
  (`src/lib/osmSource.test.js`, `osmOverpass.test.js`, `sourceDiscovery.test.js`,
  `sourceDiscoveryHandlers.test.js`), een schermtest op de broncode
  (`sourceDiscoverySurface.test.js`) en een fixture-browsercheck met
  screenshots op 1280/390/320 px in licht en donker
  (`ops/browser/run-bronnen-vind-check.js`, `ops/browser/evidence/be-32/`).
  Geen echte betaalde aanroep, geen productietoegang.

