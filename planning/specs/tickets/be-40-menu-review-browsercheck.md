# BE-40 — browsercheck menuconcepten (#95)

Contract: https://github.com/1am-it/menucard/issues/95 (bron van waarheid; deze kopie volgt het issue).


**Eigenaarsbesluit (28 okt):** "1" (ja, repareren). Alleen testcode. Geen mockup nodig.

**Aanleiding:** `ops/browser/run-menu-review-browser-check.js` stopt in `imageOnlyScenario`:
- `suggestion.text` is `undefined`, omdat het script de `mark_unusable`-keuze zoekt. Die bestaat niet meer: sinds BE-33/BE-35 is de vervolgstap bij een menukaart die alleen als afbeelding bestaat "Lees met AI" of handmatig;
- de scenario's daarna, waaronder het BE-39-scenario `conceptPublicationScenario`, worden daardoor nooit uitgevoerd.

Gemeld in de BE-39-handoff (PR #94).

### Acceptatiecriteria
1. **`imageOnlyScenario` controleert het huidige scherm:**
   - de eerlijke status "Menu alleen als afbeelding · lees met AI of met de hand";
   - de huidige vervolgstap, zoals die op `main` en op de BE-39-branch werkelijk wordt getoond.

   Geen controle verwijderen zonder er een gelijkwaardige voor terug te zetten. Elke vervallen controle wordt in de PR genoemd, met de reden.
2. **Het hele script loopt door tot het einde, met 0 fouten:** alle scenario's, inclusief `conceptPublicationScenario` (BE-39), op 1280/390/320 px en in licht en donker, zoals het script die nu al aanroept.
3. **Andere drift:** stopt het script daarna op een andere plek door verouderde verwachtingen, dan wordt dat op dezelfde manier hersteld. Is het een echte fout in de app, dan wordt de app **niet** aangepast. Zo'n fout meld je in de handoff als bevinding.
4. **Bewijs:**
   - het aantal geslaagde controles van een volledige run, vastgelegd in het bestaande JSON-bewijs;
   - `npm test` groen;
   - geen appwijzigingen in de diff: alleen `ops/browser/**` en eventueel fixtures.

### Niet in scope
- wijzigingen aan de app (`app/**`, `src/**`);
- nieuwe scenario's buiten herstel;
- nieuwe dependencies;
- een merge.
