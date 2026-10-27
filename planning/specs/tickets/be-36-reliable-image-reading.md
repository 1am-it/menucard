# Ticket #87 — BE-36 Betrouwbare AI-lezing van menukaarten als afbeelding of scan

Live contract en status: GitHub issue #87.


**Aanleiding (praktijktest 27 okt, Al Dente, 9 menu-afbeeldingen):**
- Na PR #86 bereikt de lezing de AI, maar de uitkomst wisselt per keer: 13 gerechten, `page_limit`, 2 gerechten, `output_truncated` (live gemeten door de Lead).
- De oorzaken zitten in onze eigen instellingen, niet in de AI:
  - alle afbeeldingen gaan in één aanroep;
  - het antwoord is begrensd op 10.000 output-tokens;
  - de validatie keurt de hele lezing af bij een kleine afwijking;
  - de foutmelding is algemeen.

**Eigenaarsbesluit (27 okt):** "akkoord", inclusief "pas dan ook de md files aan als het werkt". De eigenaar verwacht dat kleine menukaarten van een paar pagina's betrouwbaar gelezen worden.

### Acceptatiecriteria
1. **Lezen per pagina:**
   - een beeldbron (afbeeldingen of een scan-pdf) wordt per afbeelding of pagina gelezen, met maximaal 2 tegelijk of na elkaar, binnen de bestaande functieduur van 300 s;
   - de deelresultaten worden samengevoegd tot één lezing, met dezelfde menukaart- en menukopjesstructuur;
   - dubbele gerechten op een paginagrens worden samengevoegd;
   - elk gerecht houdt zijn herkomst ("afbeelding N" of "pagina N").
2. **Ruimte en opnieuw proberen:**
   - per aanroep een outputgrens die past bij één pagina, met marge;
   - mislukt één pagina (afgekapt, tijdelijk niet bereikbaar, ongeldig antwoord), dan probeert de app die pagina automatisch één keer opnieuw;
   - mislukt het daarna nog, dan gaat de rest van de lezing gewoon door, en volgt de melding "Pagina N kon niet gelezen worden" met **"Opnieuw proberen"** voor alleen die pagina.
3. **Milde validatie:**
   - een afwijking in één gerecht (herkomst "pagina" of "afbeelding", een ontbrekende prijs, een twijfelachtig menukopje) zet alleen dat gerecht op "Controle nodig";
   - de lezing als geheel wordt alleen afgekeurd als er echt niets bruikbaars is;
   - `page_limit` en dergelijke gelden voor pdf-pagina's, niet voor losse afbeeldingen.
4. **Duidelijke meldingen:**
   - elke foutreden krijgt een eigen, begrijpelijke zin met een volgende stap. Bijvoorbeeld: "De AI is even niet bereikbaar, probeer het over een minuut opnieuw", "Pagina 4 kon niet gelezen worden", "Het budget van deze maand is op";
   - nooit meer alleen "Ga verder met de handmatige import";
   - de handmatige import blijft een kleine link.
5. **Kosten:**
   - de schatting en het maximum per lezing volgen het aantal pagina's (±1 cent per pagina);
   - het budget wordt vooraf gecontroleerd en de echte kosten tellen mee in de maandteller.
6. **Dekking (restpunt BE-35):**
   - "Opnieuw controleren" haalt de pagina echt opnieuw op, ook bij een uitslag van vandaag;
   - heeft "Vind bronnen" een menulink gevonden die nog niet bevestigd is, dan toont de rij die link met "Bevestig voorstel" in plaats van de homepage te controleren.
7. **Documentatie (als het werkt):**
   - de relevante md-bestanden beschrijven het nieuwe gedrag en de grenzen: `MENU-EXTRACTION.md`/protocol, `docs/guides/design-reference.md` waar het de schermen raakt, en de ticketspecs BE-33 en BE-36;
   - oude, onjuiste uitspraken worden verwijderd.
8. **Bewijs:**
   - unit-tests met een nagebootste AI: 9 pagina's waarvan er één eerst mislukt en daarna lukt, één afgekapt antwoord, een gerecht met afwijkende herkomst, samenvoegen en ontdubbelen, meldingen per reden;
   - `npm test` en `npm run build` groen;
   - **acceptatie door de Lead met een echte AI** op Al Dente (`/menukaart-restaurant-2/` + `/menu-classico/`): drie keer achter elkaar een geslaagde lezing met het grootste deel van de gerechten van de kaart, plus één keer Bardot.

### Niet in scope
- een hoger maandbudget;
- een ander AI-model of een nieuwe sleutel;
- een migratie;
- automatisch goedkeuren of publiceren.

**Rollen:** Lead = Claude Code (ook de acceptatie met een echte AI). Developer = DeepSeek via de lokale runner.

### Stand van de implementatie (ontwikkelaar, 27 okt)

Gebouwd in `src/lib/menuReadingPages.js` (puur), `src/lib/menuAiReadHandlers.js`
(de lus), `src/lib/menuExtractionAdapter.js` (reparatiehaak en `page_limit`
alleen voor documenten), `src/lib/menuAiImport.js` (meldingen en budget per
lezing), `src/lib/manualMenuImportState.js` (paginalijst in de verzegelde staat)
en `src/components/AiMenuReadBlock.js` + `app/internal/menu-import/page.js`
(gedeeltelijke lezing en "Opnieuw proberen").

- **Per pagina:** een afbeelding of een pdf-pagina per aanroep, 8.000
  outputtokens (document: 8.000 per pagina), 60 s per aanroep, maximaal twee
  tegelijk, na 240 s geen nieuwe pagina. Dezelfde client, hetzelfde model,
  dezelfde validator.
- **Samenvoegen:** gelijke menukaarten en menukopjes samen, een gerecht met
  dezelfde naam en prijs op een paginagrens een keer, herkomst per gerecht
  behouden, dekking opnieuw opgebouwd (`complete` of `partial`).
- **Opnieuw proberen:** een keer automatisch per pagina; daarna een gedeeltelijke
  lezing met "Pagina N kon niet gelezen worden." en "Opnieuw proberen" voor die
  pagina. Dat verzoek (`{ state, retry_pages: [N] }`) leest alleen die pagina en
  schrijft een nieuwe versie van hetzelfde concept.
- **Milde validatie:** afwijkende herkomst en ontbrekende prijs worden gerepareerd
  en als "Controle nodig" getoond; de strikte validator blijft beslissen en
  `page_limit` geldt niet meer voor losse afbeeldingen.
- **Kosten:** ongeveer 1 cent per pagina als schatting, 3 cent reservering per
  pagina met een maximum van 30 cent per lezing, vooraf gecontroleerd; de echte
  kosten van alle aanroepen samen staan als een lezing in de maandteller.
- **Meldingen:** elke reden heeft een eigen zin met een volgende stap; de
  handmatige import blijft een kleine link.

Bewijs (nagebootste AI, geen echte aanroep): `src/lib/menuReadingPages.test.js`,
`src/lib/menuAiReadPages.test.js` (9 pagina's, een mislukte pagina die de tweede
keer lukt, een blijvend afgekapte pagina, `retry_pages`, `page_limit`, budget) en
de bijgewerkte `src/lib/menuAiReadImage.test.js` en
`src/lib/menuAiReadHandlers.test.js`. `npm test` en `npm run build` horen groen
te zijn; de acceptatie met een echte AI op Al Dente (drie keer) en Bardot doet de
Lead.

**Restpunten:** een scan-pdf gaat nog als een document in een aanroep (een pagina
renderen vraagt een nieuwe afhankelijkheid); `MENU-EXTRACTION.md` (v0.4) is
ongewijzigd, dus de gepinde protocolhash blijft geldig.

