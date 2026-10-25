# Ticket #65 — BE-28 frisse publieke stijl

Live contract en status: GitHub issue #65. Deze kopie legt het goedgekeurde contract vast in de repo.


**Eigenaarsbesluiten (2026-10-25):**
- "negeer even de md files eenmalig op dit vlak: geef het een modernere look o.a. toevoegen van emoji's … het moet technisch allemaal zo licht en snel mogelijk laden";
- donker thema: antraciet in plaats van zwart (geen zwart met fel geel, i.v.m. de associatie met NAC);
- knoppen in het donkere thema: **wit** (variant 4);
- emoji's overal, op desktop en telefoon (keuze 1);
- "Akkoord om dit te bouwen … zoals aangeleverd in de mockups".

**Goedgekeurde visuele referentie:** canvas "Onze Menukaarten – eigen gezicht v2", versie 14 (https://claude.ai/artifact/8VLxwWFHkffexpyLPyF5DD):
- licht: `Fris · home licht` en `Fris · zoeken 390 licht`;
- donker: `Fris · home antraciet` en `Fris · zoeken 390 antraciet`, **met de knopbehandeling van `Telefoon · knop wit`**: primaire knop, actieve chip en actief menutabblad wit (`#F2F3F4`, tekst `#1F2328`); prijzen als label met okergele tekst; het logo-tegeltje blijft okergeel;
- de bovenste rijen van het canvas (rustige versie, Espresso, Inkt) en de andere knopvarianten zijn **niet** gekozen.

### Uitkomst
De publieke site ziet er fris en eigen uit, in licht en antraciet, met emoji's, ronde kaarten en een duidelijke prijs, en laadt minstens zo snel als nu.

### Acceptatiecriteria
1. **Thema-tokens** (`app/globals.css`): het lichte thema volgt de frisse mockup (witte ondergrond, zachte vlakken, okergele hoofdknop); het donkere thema wordt antraciet (`#1F2328` ondergrond, `#2A2F35` kaarten, `#3A4048` randen, tekst `#F2F3F4`/`#B6BCC3`) met witte knoppen. Alles via tokens, zodat interne pagina's automatisch meekleuren. Het donkere thema blijft de standaard bij een eerste bezoek (themacontract ongewijzigd).
2. **Publieke pagina's** krijgen de stijl van de mockup: `app/page.js` (home), `app/search`, `app/alle-restaurants`, `app/restaurants`, `app/restaurant/[id]`, `app/menu/[id]`, plus de gedeelde header en `Wordmark`. Ronde kaarten met zachte schaduw (licht) of rand (donker), ronde zoekbalk en chips, prijs als duidelijk label, "🟢 Nu open" en "🌱 vegetarisch" als labels.
3. **Home** volgens de mockup: zoekblok met "📍 Breda · echte menukaarten" en een emoji-titel, maaltijdchips met emoji, de tegelrij "Populair in Breda" (snelle zoekopdrachten met bestaande zoeklogica) en de regel "⚡ / 💶 / 📵". De sectie **"Vanavond op de kaart"** toont alleen **echte** gerechten met prijs uit bestaande data of de bestaande zoek-API, zonder nieuwe backend of migratie. Kan dat niet eerlijk, laat de sectie dan weg en meld het. Nooit verzonnen gerechten of prijzen.
4. **Telefoon** (390 en 320 px): een zwevende menubalk onderin met 🔍 Zoeken en 🍽️ Restaurants (alleen bestaande bestemmingen), en zoekresultaten als kaarten met de prijs rechts. Geen horizontale overflow.
5. **Emoji's** overal, als systeemtekens: geen afbeeldingen, emoji-fonts of bibliotheken. Decoratieve emoji's zijn `aria-hidden`; de tekst blijft leesbaar voor schermlezers.
6. **Snelheid en toegankelijkheid:** geen nieuwe dependencies, fonts of afbeeldingen; de initiële overdracht van de home vóór en na meten en vastleggen (doel < 250 KB, niet groter dan nu); contrast AA (tekst ≥ 4,5:1, randen en focus ≥ 3:1) in beide thema's gemeten en vastgelegd; toetsenbord en focus blijven werken; tikvlakken ≥ 44 px.
7. **Documentatie:** `docs/guides/design-reference.md` en `docs/mockups/README.md` leggen dit besluit vast als opvolger van de betreffende Kleurtaal v2-regels (palet, groen, emoji, kaartvorm), met de referentie hierboven. Tests die de oude regels afdwingen (zoals `src/lib/colourLanguage.test.js`) worden alleen aangepast waar dit besluit de regel verandert.
8. **Bewijs:** een browsercheck met screenshots van de pagina's uit criterium 2, op 1280, 390 en 320 px, in licht en donker; `npm test` en `npm run build` groen.

### Niet in scope
- de interne pagina's herontwerpen (ze krijgen alleen de nieuwe tokens);
- nieuwe data, API's, migraties, publicatie of analytics;
- nieuwe functies zoals favorieten of accounts;
- foto's van restaurants of gerechten.

**Rollen:** Lead = Claude Code (contract, review, acceptatie, release). Developer = DeepSeek via de lokale runner.

## Bewijs (developer, 2026-10-25)

Developer-evidence: lokale, geïsoleerde productiebuild. Geen productie, geen
echte Supabase-credentials, geen merge of publicatie. Onafhankelijke review en
browseracceptatie door de Lead staan nog open.

| Onderdeel | Resultaat |
|---|---|
| Branch / commits | `feat/fresh-style-65`: tokens → home → pagina's → documentatie → browsercheck (zie `git log`) |
| `npm test` | 2819 tests, 2818 pass, 1 fail: `src/lib/menuAiTimeLimits.test.js` "Y1: no vercel.json was introduced". Die faalt ook op de base `a517052` (het bestand `vercel.json` is daar al getrackt); niet aangeraakt door #65 |
| `npm run build` | groen (43/43 statische pagina's) |
| Initiële overdracht `/` (dark, 1280 px, koude cache) | **190 KB vóór** (base `a517052`) → **148,7 KB ná** (document 4,4 KB, 13 requests). Doel < 250 KB en niet groter dan nu: gehaald |
| Contrast licht (live gemeten) | body 18,24:1 · secundair 7,24:1 · prijslabel 18,24:1 · hoofdknop 10,74:1 · chip 18,24:1 · menubalk 18,24:1 · veldrand 3,56:1 |
| Contrast donker (live gemeten) | body 14,22:1 · secundair 7,05:1 · prijslabel 6,95:1 · hoofdknop 14,22:1 · chip 10,31:1 · menubalk 10,31:1 · veldrand 3,56:1 |
| Browsercheck | `ops/browser/run-public-style-browser-check.js`: 148 checks, 0 failures, 35 screenshots (home, zoeken met resultaten, alle restaurants, restaurantpagina, menukaart op 1280/390/320 px in licht en donker; plus `/internal/login` en `/internal/coverage`) |
| Bewijsbestanden | `ops/browser/evidence/public-style-browser-evidence.json`, `ops/browser/evidence/public-style-transfer-before.json`; screenshots in `ops/browser/output/be-28/` (gegenereerd, niet gecommit) |
| "Vanavond op de kaart" | Gebouwd met alleen echte dinergerechten en echte prijzen uit de bestaande zoeklogica/data (`src/lib/publicTonight.js`); zonder eerlijke selectie vervalt de sectie. Geen nieuwe route, data of migratie |
| Zoekresultaten met prijs rechts | De bestaande `group=restaurant`-respons krijgt per voorbeeldgerecht de al bestaande publieke prijsvelden mee (`docs/api/dish-result-shape.md`); ranking en route ongewijzigd |

**Bekende gaten (eerlijk gemeld):**

- `/internal/coverage` kon lokaal niet inhoudelijk worden gecontroleerd: zonder
  Supabase-credentials toont die pagina een client-side fout. De screenshots
  laten dat zien. `/internal/login` is wél in licht en donker vastgelegd als
  bewijs dat de nieuwe tokens interne pagina's leesbaar houden; de echte
  coverage-dashboardcheck hoort bij de Lead/acceptatie.
- De app-side AI-activatie is niet aangeraakt (die vereist een eigen
  eigenaarsbesluit, BE-21); deze ronde gebruikt alleen de bestaande prepaid
  developer-runner.
- Card- en chipvlakken volgen de goedgekeurde mockup (zachte randen in licht,
  `#3A4048` in donker). Interactieve velden gebruiken `--input-border` (≥ 3:1);
  kaart- en chipvlakken zijn nooit de enige affordance (tekst, hover en
  focusring dragen de interactie). Zie `docs/guides/design-reference.md`.

