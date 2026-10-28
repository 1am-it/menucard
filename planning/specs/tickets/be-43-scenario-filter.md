# BE-43 — één scenario van de browsercheck draaien (#101)

Contract: https://github.com/1am-it/menucard/issues/101 (bron van waarheid; deze kopie volgt het issue).


**Eigenaarsbesluit (28 okt):** "1": na BE-42.

**Aanleiding:**
- `ops/browser/run-menu-review-browser-check.js` heeft 2.888 regels en 28 scenario's (729 controles) en kan alleen in zijn geheel draaien;
- een developer die aan één scherm werkt, draait dus steeds alles. Dat maakt de rondes lang en vult het werkgeheugen van het model (BE-41 ronde 1: 61,7M tokens, `aborted`).

### Acceptatiecriteria
1. **`--alleen=<naam>[,<naam>]` draait alleen de genoemde scenario's.** Dat geldt voor `run-menu-review-browser-check.js` en voor de andere `ops/browser/run-*-browser-check.js` die uit meerdere scenario's bestaan. Een onbekende naam geeft een duidelijke fout met de lijst van geldige namen, en draait niets.
2. **`--lijst`** toont de scenarionamen zonder iets te starten.
3. **Zonder vlag** draait alles, precies zoals nu: dezelfde 729 controles.
4. **Een gefilterde run** staat in het JSON-bewijs als `filter: [...]`, met `passed` alleen over de gekozen scenario's. Een gefilterde run mag nooit het volledige bewijsbestand overschrijven: schrijf hem naar een apart bestand, of helemaal niet.
5. **De uitvoer is kort:** één regel per scenario met het aantal geslaagde en gezakte controles, de details alleen bij een fout.
6. **`.agent/project/developer.md`:** de regel "tijdens het werk `--alleen`, aan het eind één volledige run".
7. **Bewijs:**
   - een unit-test voor het lezen van de vlag;
   - een volledige run met 0 fouten;
   - een gefilterde run van één scenario, met het aantal controles en de duur naast de volledige run.

### Niet in scope
- appwijzigingen;
- nieuwe controles;
- dependencies.

**Volgorde:** na BE-42 (#98).

