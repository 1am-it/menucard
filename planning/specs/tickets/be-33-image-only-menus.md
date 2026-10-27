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
     - **site-opmaak is geen menukaart (bijgewerkt in #84, ronde 3):** een
       afbeelding die in dezelfde lezing op meer dan één pagina staat (een
       kop- of site-afbeelding) valt af, net als de WordPress-header- en
       site-icoonvorm (`cropped-` in de bestandsnaam) en een beeld met een
       opgegeven breedte én hoogte waarvan de langste zijde kleiner is dan
       600 px. Alleen een ontbrekende maat is nooit een reden om af te vallen;
     - **elke ingang leest beeld (bijgewerkt in #84, ronde 3):** de rij in
       Dekking (`job_id`) én de pagina "Menu importeren" (`state`) lezen
       dezelfde beeldbronnen. De verzegelde bundel bewaart alleen metadata, dus
       de beeldbron-URL's worden server-side opnieuw gelezen — altijd uit de
       door de server verzegelde staat, nooit uit het verzoek. Tekstbronnen en
       beeldbronnen gaan samen naar hetzelfde model;
   - **zelfde basis:** dezelfde client, hetzelfde model, dezelfde enable-vlag, hetzelfde schema en dezelfde validator;
     **bijgewerkt in #87:** de lezing gaat pagina voor pagina door diezelfde
     keten (een afbeelding of een pdf-pagina per aanroep). Voor de ongewijzigde
     validator loopt een milde reparatie (`repairPageOutput`): een afwijkende
     herkomst of een ontbrekende prijs maakt van dat ene gerecht "Controle nodig"
     in plaats van de hele pagina te weigeren. Zie BE-36;
   - **grenzen:**
     - maximaal 10 afbeeldingen of 10 pagina's per lezing (bijgewerkt in #84,
       ronde 2; was 6);
     - **bijgewerkt in #87:** per aanroep gaat precies één pagina mee, met een
       antwoordplafond van 8.000 tokens (een document 8.000 per pagina), een
       time-out van 60 s en maximaal twee pagina's tegelijk. De lezing start na
       240 s geen nieuwe pagina meer, zodat alles binnen de functieduur van 300 s
       blijft. `page_limit` geldt alleen voor pdf-pagina's, niet voor losse
       afbeeldingen;
     - de tien afbeeldingen gelden over de hele lezing, in volgorde van bron en
       pagina (bijgewerkt in #84, ronde 3). Een lezing met minstens één
       bruikbare afbeelding wordt nooit geweigerd; zij zegt het echte aantal:
       "Deze lezing heeft N menu-afbeeldingen; de eerste 10 zijn gelezen." en
       de kostenschatting volgt het gelezen aantal. Nooit 0;
     - een pagina die buiten die tien valt wordt geen lege beeldbron in de
       bundel: zij valt uit de lezing, zodat de bundel, de dekking van het
       antwoord en wat het model ziet dezelfde bronnen noemen;
     - een vaste maximale bestandsgrootte;
     - de budgetcontrole gebeurt vooraf;
     - de kosten worden zichtbaar.
3. **Eerlijk over zekerheid:**
   - een citaat uit een afbeelding is niet automatisch letterlijk te controleren;
   - elk gerecht dat van beeld is gelezen, krijgt daarom de herkomst "gelezen van afbeelding N / pagina N" en het label **"Controle nodig"**;
   - **bijgewerkt in #87:** ontbreekt of wijkt de herkomst af, dan vult de app de
     pagina aan die in die aanroep is gelezen; het gerecht blijft staan met dat
     label in plaats van de hele pagina te laten vallen (BE-36, criterium 3);
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
