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
