# BE-39 — Klaar voor publicatie (#93)

Contract: https://github.com/1am-it/menucard/issues/93 (bron van waarheid; deze kopie volgt het issue).


**Eigenaarsbesluit (28 okt):** advies van de Lead gevolgd. De status "Klaar voor publicatie" komt er nu; een aparte Beheer-pagina niet. Geen mockup nodig, want het is een statuslabel in een bestaand scherm met een bestaand badgepatroon.

**Aanleiding:** sinds 28 oktober staat de GitHub-koppeling aan (`GITHUB_EXPORT_TOKEN` en `GITHUB_EXPORT_REPOSITORY`). In de lijst `/internal/menu-concepts` zie je niet welke goedgekeurde kaart echt naar de site kan. Dat zie je pas als je een kaart opent en kijkt of "Maak review-PR" werkt.

**Visuele referentie:** de bestaande lijst en de badges in `app/internal/menu-concepts/MenuConceptsView.js` (`STATUS_VIEW`, `EXPORT_VIEW`), in de BE-28-stijl.

### Acceptatiecriteria
1. **Eén publicatiestatus per goedgekeurde kaart in de lijst.** Elke kaart met de status "Intern goedgekeurd" krijgt precies één tweede badge:
   - **"Klaar voor publicatie"** alleen als alle echte poorten groen zijn:
     - nieuwste versie;
     - goedgekeurd;
     - geen blokkades;
     - bron bevestigd en niet geblokkeerd;
     - dezelfde inhoud nooit eerder afgewezen (`wasRejectedBefore`);
     - GitHub-koppeling geconfigureerd.
   - Bestaat er al een export, dan de echte exportstatus met de bestaande `EXPORT_VIEW`-teksten. Een opgeslagen export telt nooit als bewijs dat de kaart klaar is.
   - Anders **"Nog niet klaar"**, met de eerste reden in gewone taal, bijvoorbeeld "Bron nog niet bevestigd".
   - Wachtende en afgewezen kaarten blijven zoals ze nu zijn.
2. **Eén regel, geen tweede interpretatie.** Een pure functie (CommonJS, `src/lib/menuConceptPublication.js`) bepaalt de status op de server. De bestaande poorten blijven gelden: `wasRejectedBefore`, de blokkades, de bronstatus en `githubConfigured`. Het detailscherm gebruikt dezelfde functie voor `canExport`; alleen "niet-opgeslagen correcties" blijft een controle in de browser.
3. **Telling in de lijstkop:** "N klaar voor publicatie", of niets als N = 0.
4. **Gemerged is niet live:** bij "Review-PR gemerged" staat de korte regel "live na de volgende deploy".
5. **Zuinig:**
   - één extra query voor de exports van de getoonde kaarten (`menu_snapshot_exports`), geen query per kaart;
   - **geen GitHub-API-aanroep** in de lijst;
   - geen migratie.
6. **Bewijs:**
   - unit-tests voor elke status: klaar, elke "nog niet klaar"-reden, elke exportstatus, en een geblokkeerde bron;
   - een regressietest dat het detailscherm en de lijst hetzelfde oordeel geven;
   - screenshots op 1280 en 390 px, in licht en donker, met fixturedata;
   - `npm test` en `npm run build` groen.

### Niet in scope
- een Beheer-pagina;
- automatisch exporteren of mergen;
- nieuwe GitHub-rechten;
- migraties;
- nieuwe dependencies.
