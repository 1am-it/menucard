# BE-41 — vervolgstap en originele kaart (#97)

Contract: https://github.com/1am-it/menucard/issues/97 (bron van waarheid; deze kopie volgt het issue).


**Eigenaarsbesluit (28 okt):** "ik volg jouw advies 1". Dat betekent: schermen 1, 2 en 3 van de mockup, **zonder** de knop "Alle dubbele gerechten uitsluiten" en **zonder** een pdf die in het scherm zelf staat.

**Aanleiding:**
- In `/internal/menu-concepts` is alleen de restaurantnaam een link. Het label "Nog niet klaar: Los eerst 12 blokkades op." zegt wat er moet gebeuren, maar niet waar.
- In het beoordelingsscherm ontbreekt een snelle weg naar de originele menukaart, om het concept daarmee te vergelijken.

**Visuele referentie (goedgekeurd):** https://claude.ai/artifact/H62vFJAQA6HoMJUaPRqhKX, de artboards "Lijst: knop per vervolgstap", "Lijst op telefoon" en "Detail: knop naar originele kaart" (met optie 2 **uit**). Het artboard "Later mogelijk: pdf rechts ernaast" valt buiten scope.

### Acceptatiecriteria
1. **Lijst: de hele kaart is aanklikbaar.** Eén link per kaart, dus één tabstop, met een zichtbare focusring.
2. **Lijst: één knop voor de volgende stap per kaart**, op basis van dezelfde publicatieregel als BE-39 (`src/lib/menuConceptPublication.js`), geen tweede interpretatie:

   | Stand van de kaart | Knop | Gaat naar |
   | --- | --- | --- |
   | wacht op beoordeling | **"Beoordelen →"** | het detailscherm |
   | goedgekeurd, blokkades | **"N blokkades oplossen →"** | het tabblad Wijzigingen van het detailscherm |
   | goedgekeurd, bron niet bevestigd of geblokkeerd | **"Bron controleren →"** | het tabblad Bron |
   | goedgekeurd, GitHub-koppeling ontbreekt | geen knop, alleen het label | — |
   | klaar voor publicatie | **"Maak review-PR →"** | het detailscherm, het blok Publicatie |
   | PR open of gemerged | **"PR bekijken ↗"** | de opgeslagen PR-link, in een nieuw tabblad |
   | export mislukt of PR gesloten | **"Opnieuw proberen →"** | het blok Publicatie |
   | afgewezen | **"Bekijken →"** (omlijnd) | het detailscherm |

   De knop "Maak review-PR →" in de lijst start **nooit** zelf een export. De export blijft alleen in het detailscherm.
3. **Kleur van het tweede label:** geel bij "Nog niet klaar" en "Vorige poging mislukt", groen bij "Klaar voor publicatie", neutraal bij de rest. Gebruik de bestaande `status-badge`-rollen en thematokens, geen hardcoded kleuren, en contrast ≥ 4,5:1 in licht en donker.
4. **Detail: de knop "Originele menukaart openen ↗"** staat rechts naast de titel:
   - hij opent de `source_url` van het concept in een nieuw tabblad, met `rel="noopener noreferrer"`;
   - eronder staat een kleine regel: "Opent in een nieuw tabblad · <domein> · webpagina | pdf | afbeelding";
   - alleen bij een `http(s)`-URL. Bij een andere URL of geen URL staat er geen knop.
5. **Telefoon (390 en 320 px):** de knop voor de volgende stap staat over de volle breedte onder de labels, en de aanraakvlakken zijn ≥ 44 px. Er is geen horizontale scroll.
6. **Bewijs:**
   - unit-tests voor elke rij van de tabel in criterium 2;
   - een test voor de URL-regel van criterium 4, inclusief `javascript:` en een lege URL;
   - een regressietest dat de lijst nooit een export start;
   - screenshots op 1280, 390 en 320 px, in licht en donker, met fixturedata;
   - `npm test` en `npm run build` groen.

### Niet in scope
- een knop "Alle dubbele gerechten uitsluiten";
- een pdf die in het scherm zelf staat;
- exporteren vanuit de lijst;
- migraties;
- nieuwe dependencies.

**Volgorde:** na BE-40 (#95). Er is maar één developerronde tegelijk.

