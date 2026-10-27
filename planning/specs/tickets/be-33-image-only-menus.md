# Ticket #79 — BE-33 Menukaarten alleen als afbeelding of scan

Live contract en status: GitHub issue #79.


**Aanleiding (praktijktest 27 okt):** Al Dente krijgt de uitkomst "Geen menukaart gevonden: alleen als afbeelding of scan", maar de app biedt "Lees met AI" aan. Dat leest nu alleen tekst en levert hier dus niets op. Ook Bardot (alleen afbeeldingen) faalde eerder.

**Eigenaarsbesluit (27 okt):** "bij 2 graag beste oplossing dus allebei". Dat betekent meteen een eerlijke vervolgstap, plus "Lees met AI" dat ook afbeeldingen en scans leest.

**Visuele referentie:** er is geen nieuwe pagina nodig. Het gaat om de bestaande "Lees met AI"-flow (#59) met de Lijst/Kaart-weergave (variant 5) en de resultaatrij uit BE-31, in de BE-28-stijl.

### Acceptatiecriteria
1. **Eerlijke vervolgstap:**
   - bij `image_only` (een afbeelding, of een pdf zonder tekstlaag) toont de rij **"📷 Lees met AI (afbeelding)"** als de AI aanstaat en er budget is;
   - is dat niet zo, dan toont de rij **"✍️ Handmatig toevoegen"**;
   - nooit meer "Lees met AI" dat toch niets kan;
   - de tekst "Deze import leest geen beeld" wordt aangepast aan de nieuwe werkelijkheid.
2. **"Lees met AI" leest beeld:**
   - **wat de AI krijgt:**
     - een pdf zonder tekstlaag gaat als document naar het bestaande model;
     - menu-afbeeldingen (jpg/png/webp) gaan als afbeelding, en alleen van dezelfde website als de bron;
     - **beeld vóór tekst (bijgewerkt in #84, ronde 2):** heeft een pagina
       menu-afbeeldingen en bevat de leesbare tekst geen menu (minder dan drie
       regels met een prijs), dan gaat de pagina als beeldbron naar de AI —
       ook als er navigatie-, footer- of openingstijdentekst staat. Een echte
       tekstmenu blijft een tekstbron;
     - **paginacontext (bijgewerkt in #84, ronde 2):** noemt de pagina-URL of de
       `<title>` zelf het menu (`menu-classico`, `menukaart-restaurant-2`), dan
       zijn afbeeldingen van dezelfde website kandidaat, ook zonder menuwoord in
       de bestandsnaam. `NOT_MENU` (logo, icoon, favicon, te kleine afbeelding)
       blijft gelden, en WordPress-varianten (`-300x212`, `-768x…`) tellen als
       één afbeelding met voorkeur voor het origineel;
   - **zelfde basis:** dezelfde client, hetzelfde model, dezelfde enable-vlag, hetzelfde schema en dezelfde validator;
   - **grenzen:**
     - maximaal 10 afbeeldingen of 10 pagina's per lezing (bijgewerkt in #84,
       ronde 2; was 6);
     - bij meer menu-afbeeldingen op één pagina leest de app de eerste 10 in
       paginavolgorde en zegt zij het echte aantal: "Deze pagina heeft N
       menu-afbeeldingen; de eerste 10 zijn gelezen." Nooit 0;
     - een vaste maximale bestandsgrootte;
     - de budgetcontrole gebeurt vooraf;
     - de kosten worden zichtbaar.
3. **Eerlijk over zekerheid:**
   - een citaat uit een afbeelding is niet automatisch letterlijk te controleren;
   - elk gerecht dat van beeld is gelezen, krijgt daarom de herkomst "gelezen van afbeelding N / pagina N" en het label **"Controle nodig"**;
   - de kaartweergave (variant 5) toont de afbeelding of pagina naast de lijst;
   - er wordt niets automatisch goedgekeurd;
   - de bestaande regels voor ontbrekende prijzen en "Prijs onbekend" blijven gelden.
4. **De keten erna is ongewijzigd:** concept, beoordelen, goedkeuren en de review-PR. Publiceren gaat nog steeds alleen via een mens.
5. **Bewijs:**
   - unit-tests met een nagebootste AI voor een scan-pdf en voor afbeeldingen;
   - de grenzen, budget op en AI uit;
   - de herkomst en het label "Controle nodig" per gerecht;
   - de rijstap bij `image_only` (AI aan of uit);
   - screenshots van de rij en van de kaartweergave met een afbeelding, op 1280 en 390 px, in licht en donker;
   - `npm test` en `npm run build` groen;
   - geen betaalde aanroep in tests of CI.

### Niet in scope
- OCR-bibliotheken of nieuwe dependencies;
- afbeeldingen van andere websites, zoals Instagram of Google;
- een migratie (stoppen en melden als het niet zonder kan);
- automatisch goedkeuren of publiceren;
- een hoger budget.

**Rollen:** Lead = Claude Code. Developer = DeepSeek via de lokale runner.
