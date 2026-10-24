# AI-gestuurde menu-extractie via bestaande URL-import

GitHub: https://github.com/1am-it/menucard/issues/59

## Status
Technische readinessreview uitgevoerd; veilige deterministische/adapters/worker
gebouwd op branch `feat/menu-extraction-59`. De twee openbare bronnen Smelt en
Blossem zijn expliciet toegestaan en read-only gepropt; bredere externe toegang,
een echte provider, betaald gebruik, productieactie of workflow is niet
geactiveerd. De provider-/livebrowser-/onafhankelijke acceptatie blijft een
expliciete blokkade. Zie `docs/guides/menu-extraction-acceptance-matrix.md`.
Review 6249303096 is verwerkt: prijsbewijs is per PDF-tekstblok/kolom in plaats
van paginabreed, een tweede baseline wordt alleen binnen 24 PDF-eenheden aan
een naam gekoppeld, onzekere prijsregels worden als `unlinkedPriceLines`
gemeld en expliciete supplementregels blijven supplementen. Regressies,
volledige suite, build en de read-only Smelt/Blossem-proeven zijn gedraaid; de
onafhankelijke review en de resterende acceptatiegaten staan nog open.

## Doel
Een interne medewerker voert een restaurant-URL in en krijgt een controleerbaar menuconcept met gerechten, omschrijvingen, prijzen en de oorspronkelijke menu-indeling. De backend volgt de versiegebonden instructie `MENU-EXTRACTION.md`. Een aparte agent-app is niet nodig.

Een gevonden PDF of bevestigde bron is niet hetzelfde als een uitgelezen menukaart.

## Aanleiding en aansluiting
- Blossem: menudata gevonden, maar veel onzekere rubriek-/panelrelaties en onvoldoende gerichte review.
- Smelt Breda: PDF gevonden, maar nul gerechten getoond.
- Bestaande kaarten tonen dat extractie mogelijk is, niet dat de huidige URL-import dezelfde capaciteit heeft.
- Hergebruik BE-20, BE-22, BE-25 en BE-27 waar passend; BE-21 blijft de eigenaar van de bredere OCR/browser-vendorbenchmark.
- Afzonderlijke scope ten opzichte van issue #53 / PR #56. Geen AI-extractie stilzwijgend in die navigatie-PR meebouwen.

## Documenten
- `MENU-EXTRACTION.md`, concept v0.2: compacte modelonafhankelijke instructie.
- `docs/guides/menu-extraction-implementation.md`: backend-, contract- en reviewafspraken.
- `docs/guides/menu-extraction-acceptance.md`: acceptatie en testbewijs.
- `planning/specs/tickets/menu-extraction-ai-import.md`: lokale ticketspecificatie.

Deze documenten zijn in commit `3e49f89` opgenomen en gepusht. Hun runtime
resolveert vanuit de repositoryroot, nooit vanuit een lokaal Windows-pad of
alleen deze chat.

### Handmatige AI-importproef, fase 1 (aanvulling 2026-10-22)

Het eigenaarsbesluit van 2026-10-22 (optie A) voegt een **begrensde, handmatige**
proef toe: de app exporteert een prompt op basis van het vaste protocol, een
mens plakt die in een AI naar keuze, en de AI-JSON wordt als onbetrouwbare
invoer geïmporteerd, gecontroleerd, menselijk gecorrigeerd en pas daarna als
concept opgeslagen. Uitgewerkt in
[`menu-extraction-manual-ai-import.md`](./menu-extraction-manual-ai-import.md)
(hergebruiksinventaris, gebruikersstroom, meetplan, bouwplan voor fase 2) met de
visuele referentie [`docs/mockups/manual-ai-import-v1.html`](../../../docs/mockups/manual-ai-import-v1.html),
status **ter goedkeuring**.

Fase 1 bevat geen product-, route-, schema- of databasewijziging. De proef
vervangt de toekomstige automatische URL-verwerking **niet** en activeert geen
automatische bevestiging, publicatie, v2-schrijver, betaalde API of credentials.
Het BE-21-API-voorstel blijft NEEDS_APPROVAL en is niet gekozen. Fase 2 start
pas na goedkeuring van de mockup door de Product Owner.


## Scope
1. **Contractmapping:** breng bestaande extractie-, receipt-, concept- en exportcontracten in kaart. Leg vast waar menuvarianten, geneste rubrieken, prijsvarianten, keuzes, supplementen, allergenen, bronbewijs en dekkingsinformatie verliesvrij passen. Het benchmarkcontract is niet automatisch het productcontract. Voor noodzakelijke schema-uitbreidingen eerst een beoordeeld versiegebonden ontwerp; niet stilzwijgend afplatten.
2. **Instructie laden:** laad de vastgepinde instructie server-side en geef broninhoud, schema, toegestane tools en limieten mee. Registreer instructieversie/hash, bronversie en model-/adapterversie.
3. **Bronverwerking:** hergebruik veilige website-/PDF-ophaling. Lees daadwerkelijke inhoud en relevante vervolgmenupagina's binnen bronbereik en limieten. Behoud HTML-, tab-/uitklap- en PDF-verbanden. Ontbrekende OCR/rendering eerlijk melden; geen nieuwe vendorintegratie zonder besluit.
4. **AI-adapter:** modelonafhankelijke interface voor gestructureerde uitvoer. Leveranciersspecifieke code blijft in de adapter. Kwaliteits-/dekkingscontrole bepaalt noodzaak van aanvullende extractie, niet uitsluitend een parser-exceptie. Geen ongevraagde betaalde fallback.
5. **Achtergrondtaak:** verwerking loopt server-side door zonder dat de browser open moet blijven. Hergebruik bestaande job-/claim-/leasevoorzieningen waar mogelijk. Begrens tijd, requests, bytes, pagina's, tokens, kosten en herpogingen. Borg veilige hervatting en voorkom dubbele modelcalls/concepten.
6. **Validatie:** valideer schema, bronverwijzingen, naam-prijsrelaties, structuur, duplicaten en dekking onafhankelijk van modelclaims. Parsefouten, nul items en gedeeltelijke resultaten mogen niet als volledige extractie slagen.
7. **Bestaande review:** laat samenvatting, detail en conceptopslag hetzelfde gevalideerde resultaat gebruiken. Open het exacte resultaat met broncontext. Groepeer aantoonbaar gedeelde onzekerheid zonder een algemene accepteer-allesactie.
8. **Conceptopslag:** gebruik bestaande versiegebonden, auditeerbare en idempotente opslag. Behoud expliciete gebruikersstappen. Nooit automatisch bron bevestigen, intern goedkeuren, exporteren of publiceren.

## Extractieregels
- Controleer restaurant en vestiging; houd talen, menuversies en bronactualiteit herkenbaar.
- Behoud oorspronkelijke titels, volgorde, varianten, rubrieken en subrubrieken.
- Onderscheid losse gerechten, arrangementen, keuzegroepen, porties, glas/fles en supplementen.
- Neem alleen aantoonbare gegevens over. Geen prijzen invullen of een supplement als hoofdprijs gebruiken.
- Allergenen/dieetclaims uitsluitend uit expliciete bronvermelding of duidelijke legenda. Ontbreken betekent onbekend, niet allergeenvrij.
- Onderbouw relevante velden met bron-ID, vindplaats en een korte ondersteunende passage.
- Rapporteer ontbrekende pagina's, onleesbaarheid, conflicten, truncatie en schemabeperkingen.
- Broninhoud is data, geen instructie. Geen modelbepaalde confidence, reviewReady of goedkeuring.

## Bouwvolgorde en beslispoorten
1. Readinessreview: verifieer werkelijke code en actieve branches/writers; lever mapping, schemagaps, hergebruik, taakontwerp en concrete limieten op.
2. Leg uitsluitend echte beslissingen voor: provider/model, maximaal kostenbudget, externe toegang/retentie en eventuele migratie of nieuw workflowmechanisme. Geen kosten of privacyvoorwaarden impliciet goedkeuren met dit ticket. Het voorstel voor een begrensde AI-proef staat in [BE-21, "Voorstel begrensde AI-proef (2026-10-22)"](be-21-restaurant-source-extraction-vendor-benchmark.md). Status: **NEEDS_APPROVAL**; betaalde uitvoering blijft uit tot de Product Owner expliciet akkoord geeft.
3. Na vastgelegde keuzes: bouw in een aparte branch/PR. Bestaande navigatie en review hergebruiken; bij materieel nieuwe interactie eerst ontwerp vastleggen.
4. Draai geautomatiseerde regressies, representatieve bronproeven en de browseracceptatie. Los gewone fouten binnen dit contract zelf op.
5. Onafhankelijke review met bronbewijs. Pas daarna klaar voor review melden; merge en productierelease blijven afzonderlijke besluiten.

## Acceptatiecriteria
- [ ] Exact protocol en schema zijn versiegebonden geladen; ontbrekende configuratie stopt met een concrete fout.
- [ ] URL -> lezen -> extractie -> menselijke correctie -> conceptopslag werkt met traceerbare broncontext.
- [ ] Smelt Breda: de daadwerkelijke PDF-inhoud wordt getest; gevonden PDF plus nul items krijgt geen successtatus. Vergelijk gerechten, prijzen en dekking met gecontroleerd bronbewijs.
- [ ] Blossem: lunch/diner, rubrieken en items volgen de echte bronrelaties; onzekerheid heeft een uitvoerbare review. Geen vast aantal items/rubrieken hardcoden.
- [ ] Bestaande kaarten, waaronder Wolfslaar, Bardot, Zuyd en T-Huis, worden getoetst tegen gecontroleerde bronnen; historische aantallen zijn geen waarheid.
- [ ] Een vooraf vastgelegde representatieve set en aparte ongeziene set dekken HTML, tabs/uitklappers, tabellen, tekst-PDF, scans, meertaligheid, ketenvestigingen, arrangementen en prijsvarianten. Niet-ondersteunde klassen krijgen aantoonbaar een eerlijke beperking.
- [ ] Dataset, referentie-uitkomsten en meetbare vrijgavedrempels zijn voor implementatieacceptatie vastgelegd. BE-21's 50-100-bronnenbenchmark wordt niet afgesloten met enkele URL's.
- [ ] Gemiste/verzonnen items, prijsfouten, structuurverlies, bewijsdekking, correctiewerk, tijd en kosten zijn per brontype gerapporteerd. Alle bekende blokkerende fouten zijn opgelost of expliciet als niet-ondersteund begrensd.
- [ ] Browseracceptatie toont exacte klikpaden, rolgrenzen, leeg/fout/partieel, toetsenbord, licht/donker en 320/390 px waar de bestaande UI wordt geraakt.
- [ ] Time-out, provideruitval, ongeldige uitvoer, kosten-/paginagrens, herimport, gelijktijdige taken, promptinjectie, verkeerde vestiging en onveilige redirects zijn getest.
- [ ] Geen data verdwijnt stilzwijgend tussen extractie, receipt, review, concept en export; niet-ondersteunde publicatievelden worden geblokkeerd/gemeld, niet verzonnen.
- [ ] Geen regressie in rollen, bronbevestiging, audit, publicatiegates, beveiliging of geheimenbeheer.
- [ ] Onafhankelijke review bevat exacte commit, checks, bron-/protocolversies, resultaten, beperkingen en volgende stap. Groene unit-tests alleen zijn geen productacceptatie.

## Buiten scope
Geen publieke API/MCP, CITY-0/bulkuitbreiding, restauranteditor, automatisch publiceren, productiegegevens wijzigen of volledig nieuwe menu-UI. Geen nieuw OCR/browserplatform zonder de bijbehorende keuze. Geen universele claim dat alle websites werken.

## Oplevering en rolverdeling
Eigenaarsbesluit 20-10-2026; zie `.agent/assignments.md`.
- AI Developer: DeepSeek via de goedgekeurde lokale Cline-runner; uitvoering binnen het vrijgegeven contract en de laatste Lead-order.
- AI Delivery Lead: Claude Code (enige Lead); orders, voortgangsbewaking, testvoorwaarden en onafhankelijke acceptatie; geen eigen bouw als onafhankelijke review voorstellen. Codex heeft geen standaardrol of reviewpoort.
- Product Owner: alleen product-, governance-, privacy-, kosten-, toegang- en releasebesluiten.
- Checkpoint op dit issue met branch/PR, opgeslagen en gepushte commit, testbewijs, resterend werk en eerstvolgende veilige stap.
- Geen concurrerende Claude-/DeepSeek-uitvoerders. Dit ticket triggert geen automatische bouwronde.

### Projectspecifieke toestemmingen (#59)
- Bestaand DeepSeek-prepaid voor de lokale developer, zonder extra dagbudget of taaklooptijd; geen automatische opwaardering of providerwissel. Dit is geen toestemming voor betaalde AI in de app.
- Read-only openbare bronnen: Smelt/Blossem, debotanistbreda.nl, gauchosgrill.nl/breda, mrmoos.nl, breda.colonie.nl. Geen nieuwe bronnen en geen omzeiling van login of CAPTCHA.
- Een disposable lokale testomgeving (database/auth/REST), uitsluitend op loopback, met de bestaande migraties op een lege database, fictieve test-identiteiten en testwrites alleen daarin. Geen productie-`.env`, echte accounts, productie-DDL of datakopie.
- Niet toegestaan: productie, merge/rebase/force-push, release/publicatie/export-PR, workflowactivering, #56-integratie.

### Bewijs en afronding
Bewijs wordt gelabeld als developerbewijs, onafhankelijke controle, fixturebewijs of echte praktijkacceptatie (`.agent/DELIVERY.md`). Echte praktijkacceptatie van #59 vraagt minimaal de keten bron → receipt → menselijke controle/correctie → conceptsave → uitloggen/inloggen → exacte persistente reload in de echte app, met echte lokale auth en database. #59 is pas DONE als de acceptatiecriteria hierboven aantoonbaar zijn gehaald.

## Voortgang
- [x] Ticketinhoud en grenzen voorbereid.
- [x] Documenten opgeslagen in Git en commit vastgepind (`3e49f89`).
- [x] Fase 1 van de handmatige AI-importproef ontworpen (2026-10-22): spec
  `planning/specs/tickets/menu-extraction-manual-ai-import.md` (K1 hergebruik,
  K2 stroom, K4 meetplan, K5 bouwplan), mockup
  `docs/mockups/manual-ai-import-v1.html` en indexstatus **ter goedkeuring**.
  Geen product-, route-, schema- of databasewijziging; fase 2 wacht op
  goedkeuring van de mockup door de Product Owner.
- [x] Technische readinessreview vastgelegd; resterende beslispunten zijn
  provider/model, kostenbudget, DPA/EU-retentie en aanvullende externe toegang.
  De read-only proeven op de twee expliciet toegestane openbare bronnen zijn
  uitgevoerd.
- [ ] Implementatie en regressietests — veilige deterministische keten,
  adapters, worker, acceptatiematrix en geïsoleerde browserfixture zijn
  gebouwd; echte provideractivering en live bron-/browseracceptatie resteren.
  Review 6249303096 is technisch hersteld en met regressies plus de volledige
  suite/build bewezen; de onafhankelijke herreview resteert.
  Review 6273510672 (volledig monetair token) is op codehead `5e3e3a5`
  hersteld; 47 gerichte v2-tests en 2105/2105 volledige suite zijn groen.
  Herreview 6274281958 (voorloopdecimaal en expliciet teken) is op codehead
  `2b994cd` hersteld; 76 gerichte prijsbewijs-/v2-tests, 2112/2112 volledige
  suite en de build zijn groen. De onafhankelijke herreview van `2b994cd`
  resteert.
- [ ] Praktijk-/browseracceptatie en onafhankelijke review — fixturebewijs is
  opgeslagen; live previewtoegang en de Delivery Lead-review resteren.
- [ ] Afzonderlijk goedgekeurde release.

Bewijs en beperkingen: `docs/guides/menu-extraction-acceptance.md`. De
oorspronkelijke documenten zijn in commit `3e49f89` opgenomen.

