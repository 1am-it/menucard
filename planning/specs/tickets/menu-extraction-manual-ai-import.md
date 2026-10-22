# Handmatige AI-import: ontwerp fase 1 (#59)

GitHub: https://github.com/1am-it/menucard/issues/59 · PR #60 (draft)

Status: **fase 2 gebouwd** (2026-10-22, developerronde na review
`6348147293`). Fase 1 was het ontwerp; de eigenaar keurde mockup v2 op
2026-10-22 goed en voegde vier punten (a)–(d) toe. Die staan in
`docs/mockups/manual-ai-import-v3.html`, dat v2 vervangt. Deze ronde bouwt de
drie stappen, de begrensde import en de bijbehorende regressies; er is geen
provider, geen betaalde API en geen publicatie geactiveerd en er is niets
gemerged. De onafhankelijke review en de handmatige proef (K9) blijven bij de
Lead en de eigenaar.

Basis: `c86aaad6e85af44acfa83591343f0741f908b0b0`; de v1-tekst stond op
`5492d2cc36c5f195082e3154df4f6d31612c05cf`, de v2-tekst op `8430773`.

Visuele referentie: `docs/mockups/manual-ai-import-v3.html` (**goedgekeurd**).
`manual-ai-import-v2.html` en `manual-ai-import-v1.html` zijn vervangen en
blijven alleen voor de geschiedenis. Waar de v1-flow en deze tekst verschillen,
wint v3; de controle- en poortregels van K2 §4–§9 en K5 gelden onverkort.

## Eigenaarsbesluit en afbakening (2026-10-22, optie A)

Een begrensde, **handmatige** AI-importproef:

1. De app exporteert een prompt op basis van het vaste protocol.
2. De eigenaar plakt die in een AI naar keuze.
3. De AI-JSON wordt als **onbetrouwbare invoer** geïmporteerd, gecontroleerd,
   door een mens gecorrigeerd en pas daarna als concept opgeslagen.

Dit vervangt **niet** de toekomstige automatische verwerking van grote aantallen
URL's. Niet toegestaan en hier niet ontworpen: automatische bevestiging,
publicatie, activering van de v2-schrijver, een betaalde API, en wijzigingen aan
accounts, abonnementen of credentials. Een geldige JSON of een gevonden quote is
geen kwaliteitsacceptatie. Het BE-21-voorstel voor een API-proef (`5492d2c`)
blijft NEEDS_APPROVAL en is **niet** gekozen.

Fase 2 is gestart na de expliciete goedkeuring van het ontwerp door de Product
Owner (mockup v2 plus (a)–(d), review `6348147293`). Deze ronde bouwt alleen wat
hieronder staat; de produktie-achtige acceptatie (echte bronnen, browser en
onafhankelijke review) blijft bij de Lead en de eigenaar.

## Herziening v2: de vereenvoudigde stroom (eigenaarsbesluit 2026-10-22)

De Product Owner koos op 22-10 twee dingen: (1) **zo eenvoudig mogelijk** — één
kolom, drie stappen, gewone taal en zo min mogelijk scrollen; (2) **per
onduidelijkheid één gerichte vervolgprompt** ("Vraag AI"), plus één knop voor
alle open punten tegelijk. Deze herziening vervangt de drieluik-presentatie van
v1. De controle-, bewijs- en poortregels in K2 §4–§9 en K5 blijven ongewijzigd
gelden: niets wordt afgevlakt, niets automatisch bevestigd.

### De stroom in drie stappen

1. **Prompt maken.** Bovenaan de restaurantnaam. Daaronder per bron één regel
   met een vinkje of een waarschuwing in gewone taal: "Lunch (website): gaat mee
   in de prompt", "Diner (scan): voeg het bestand zelf toe". Eén knop
   **Kopieer prompt**. De inhoud van de prompt verandert niet (vaste instructie,
   schema, limieten, per bron id/URL/hash/tekst); die staat alleen niet meer in
   de hoofdweergave. Onder de bronnen staat wat de mens zelf moet doen: de scan
   toevoegen.
2. **Antwoord plakken.** Het veld **Welke AI gebruikte je?** (zie hieronder),
   het plakveld met teller en de knop **Controleren**. De app bindt de import
   aan de meest recente geldige export van deze gebruiker voor dit resultaat en
   toont die binding in "Technische details". Zijn er twee geldige exports, dan
   vraagt de app kort welke prompt is gebruikt ("14:12 of 14:40") in plaats van
   te gokken. Zonder geldige export is importeren niet mogelijk. De garantie
   blijft: protocolhash en schemaversies komen uit het bundel, nooit uit de JSON
   of uit een modelbewering.
3. **Nalopen en opslaan.** De samenvatting in gewone taal: "9 gerechten · 5 in
   orde · 4 nalopen". Alleen de regels die aandacht vragen staan open; elke
   regel heeft één korte reden en passende knoppen:
   - "twee prijzen" → [Kies] (glas/fles/weglaten), **zonder** Vraag AI;
   - "uit scan, controleer" → [Klopt] [Wijzig] [Weglaten] [Vraag AI];
   - "is een toeslag" → [Klopt] [Wijzig] [Weglaten] [Vraag AI];
   - "staat niet in de bron" → [Klopt] [Wijzig] [Weglaten] [Vraag AI].
   De regels die in orde zijn, staan ingeklapt. **Concept opslaan** blijft
   uitgeschakeld tot alle open punten zijn nagelopen, met de reden en het aantal
   open punten erbij. Er is geen accepteer-alles.

De vier technische toestanden uit §4 blijven bestaan; v2 toont ze in gewone
taal en houdt de betekenis:

| Technische toestand | Gewone taal in de mockup |
| --- | --- |
| geldig | in orde (ingeklapt) |
| fout | "staat niet in de bron" (rood, blokkeert opslaan) |
| niet automatisch controleerbaar | "uit scan, controleer" |
| niet opslaanbaar (variant/supplement/arrangement) | "twee prijzen" of "is een toeslag" |

### Vraag AI: de vervolgprompt

Vraag AI is er alleen waar de AI iets kan toevoegen: **scantekst**, **staat
niet in de bron**, **rubriek** en **toeslag-of-gerecht**. Bij "twee prijzen"
staat geen Vraag AI: dat is een beperking van het concept en de keuze is aan de
mens.

Wat de vervolgprompt bevat, en niets meer:

1. de vraag over **één regel** (of één rubriek), in gewone taal;
2. het huidige voorstel voor die regel (naam, omschrijving, prijs, rubriekpad);
3. **dezelfde bron**: vaste `sourceId`, URL, SHA-256 en de al genormaliseerde
   brontekst of het relevante fragment uit het bundel — geen nieuwe fetch en
   geen andere bron;
4. dezelfde uitvoerschema-versie, beperkt tot die ene regel, met dezelfde
   verboden trustvelden (`confidence`, `reviewReady`, `approved`,
   `publicationReady`);
5. de mededeling dat broninhoud data is en dat ontbrekende gegevens onbekend
   blijven.

De controle is **dezelfde validator** als bij de import
(`validateStructuredOutput`, bronhash- en quote-controle, `LIMITS`). Faalt die,
dan verschijnt dezelfde gewone reden en wordt er niets vervangen. Het antwoord
**vervangt alleen het voorstel voor die regel**; alle andere regels en het
oorspronkelijke importbewijs blijven staan. Daarna beslist de mens met [Klopt],
[Wijzig] of [Weglaten]; er is geen automatische overname en geen bulkknop.

Bovengrens per regel en per import (ontwerp, fase 2):

| Grens | Waarde | Reden |
| --- | --- | --- |
| Vervolgprompts per regel | 1 per import | voorkomt herhaald vragen tot het antwoord bevalt |
| Vervolgprompts per import | 20 | begrensde hoeveelheid werk |
| Regels in één "alle open punten"-prompt | 10 | anders wordt het weer een bulkoperatie |
| Broncontext per vervolgprompt | 8 KiB | dezelfde bron, geen nieuwe ophaalsessie |
| Antwoord per vervolgprompt | 1 MiB (bestaande importgrens) | gelijke parse- en veiligheidsgrens |
| Automatische herpogingen | 0 | geen verborgen extra modelcall of kosten |
| Provider/model in de app | geen | de app roept zelf geen AI aan; dit blijft handmatig |

Een tweede klik op Vraag AI bij dezelfde regel zegt: "Deze regel is al één keer
gevraagd. Pas zelf aan of laat de regel weg." De knop **Vraag AI over alle open
punten** stelt één prompt samen met alleen de regels waar Vraag AI is
toegestaan (hier: 3 van de 4) en controleert elk antwoord apart; er is geen
"alles overnemen".

### Het AI-naamveld

- Eén verplicht veld **Welke AI gebruikte je?**: een lijst (ChatGPT, Claude,
  Gemini, Copilot) plus **Anders** met een vrij tekstveld. Het is
  **zelfgerapporteerd en onbewezen**; de app kan het model niet vaststellen.
- Grenzen: 80 tekens (dezelfde `LIMITS.label`), alleen tekst, geen uitvoering,
  geen netwerkoproep, geen opslag in de browseropslag. Leeg of alleen spaties →
  `ai_name_required` en geen controle.
- De naam gaat als herkomst mee (zie §8) en in het gebruiksexport hieronder.
  Hij is nooit bewijs van kwaliteit, dekking of goedkeuring.

### App-AI-gebruiksexport (eigenaarsbesluit 22-10)

Het export bevat **alleen metagegevens**, geen brontekst, geen AI-antwoorden en
geen persoonsgegevens:

| Veld | Inhoud |
| --- | --- |
| toepassing | vaste waarde `handmatige-ai-import` |
| route | het interne pad of de handler die de stap uitvoerde |
| aiNaam | de zelfgerapporteerde naam uit het AI-veld |
| aantallen | per stap: prompts gemaakt, imports gecontroleerd, vervolgprompts, opgeslagen concepten, geweigerd |
| tijd | datum plus tijdvak; geen vrije tekst |
| kosten | alleen als gemeten (bedrag en valuta); anders letterlijk **"via abonnement, niet gemeten"** |

Geen automatische prijstabel, geen schatting en geen totaal dat "gemeten"
suggereert. Het export is geen facturatie, geen kostenbewaking en geen bewijs
dat een model is gebruikt.

### Wat v2 niet verandert

Geen automatische bevestiging, geen publicatie, geen export, geen v2-schrijver,
geen provider of betaalde API in de app, geen accepteer-alles en geen nieuwe
bron. De technische details (protocol- en schemaversies, hashes, bron-ID's,
AI-naam) worden nog steeds vastgelegd en gecontroleerd; ze staan alleen
ingeklapt.

## Referenties

| Onderdeel | Bron |
| --- | --- |
| Instructie en versie | [`MENU-EXTRACTION.md`](../../../MENU-EXTRACTION.md), concept v0.2 |
| Protocol laden/hash | `src/lib/menuExtractionProtocol.js` |
| Uitvoerschema/validator | `src/lib/menuExtractionSchema.js` |
| Adapter en niet-opslaanbare velden | `src/lib/menuExtractionAdapter.js` |
| Bronidentiteit en bon | `src/lib/urlIntakeReceiptHash.js`, `src/lib/menuOriginReceiptGuard.js` |
| Menselijke controle en correctie | `app/internal/source-triage/batch/MenuReview.js`, `src/lib/menuStructureReview.js` |
| v2-mapping zonder afvlakking (alleen-lezen) | `src/lib/menuProductMappingV2.js`, `src/lib/menuProductGuardsV2.js` |
| Telregels | [`menu-extraction-reference-counting-rules.md`](../../../docs/guides/menu-extraction-reference-counting-rules.md) |
| Vastgezette referenties | `ops/benchmark/reference-references/index.json` |
| Mockup | [`manual-ai-import-v3.html`](../../../docs/mockups/manual-ai-import-v3.html) (**goedgekeurd**; v2 en v1 zijn vervangen) |
| #59-hoofdspec | [`menu-extraction-ai-import.md`](./menu-extraction-ai-import.md) |


## K1 Hergebruiksinventaris

Per onderdeel van de gevraagde stroom: welk bestaand bestand, welke functie, wat
er al is en wat **precies** ontbreekt. Niets in deze tabel is in fase 1
gewijzigd.

| Stap | Bestaand bestand | Functie / constante | Wat er is | Wat precies ontbreekt |
| --- | --- | --- | --- | --- |
| Startpunt | `app/internal/source-triage/batch/page.js`, `BatchAnalysisView.js` | `BatchAnalysisPage`, `BatchDetail`, `MenuControl`-aanroep | Interne batchpagina met per resultaat "Menukaart controleren" en "Concept opslaan" | Geen startpunt voor een prompt-export; de kaart toont alleen het al geparseerde resultaat |
| Instructie | `MENU-EXTRACTION.md`, `src/lib/menuExtractionProtocol.js` | `loadMenuExtractionProtocol`, `canonicalProtocolText`, `protocolMetadata`, `DEFAULT_EXTRACTION_LIMITS` | Versiegebonden laden, LF-genormaliseerde SHA-256, metadata zonder tekst, concrete fout bij ontbreken | Geen prompt-samensteller; de tekst gaat volgens de modulecommentaar nooit naar een browser (T1) |
| Uitvoerschema | `src/lib/menuExtractionSchema.js` | `EXTRACTION_OUTPUT_SCHEMA`, `EXTRACTION_OUTPUT_SCHEMA_VERSION`, `LIMITS`, `validateStructuredOutput`, `findForbiddenKey` | Exacte sleutels, limieten, quote-in-brontekst-controle, verbod op `confidence`/`reviewReady`/`approved`/`publicationReady` | Geen importenvelop, geen schemaversie ín de JSON (T3), geen mensgerichte foutlabels |
| Niet-opslaanbaar | `src/lib/menuExtractionAdapter.js` | `unsupportedProductFields` | Meldt `priceVariants`, `isFrom`, `supplementOf`, `allergens`, `availability` | Alleen veldnamen, geen regels/items; UI kan geen regel blokkeren of labelen (T9) |
| Bron en bon | `src/lib/urlIntakeReceiptHash.js`, `src/lib/menuOriginReceiptGuard.js`, `supabase/migrations/0013_be19_url_intakes.sql` | `computeAnalysisResultHash`, `loadOriginReceipt`, `originReceiptBlock`, `ORIGIN_RECEIPT_SELECT` | Canonieke URL, `fetched_at`, `candidate_summary`, `analysis_result_hash` (64 hex), autoritatieve bon | Bon verloopt na 10 minuten (T5); geen per-bron ophaaltijd (T6); geen bewaarde brontekst (T7) |
| Broninventaris | `src/lib/restaurantSourceAnalysis.js`, `src/lib/menuExtractionResult.js` | `addSource`, `buildExtractionResult`, `sanitizeSource` | `id`, `url`, `kind`, `status`, `contentHash` (SHA-256 van de tekst), tellingen, beperking | `contentHash` is optioneel en `kind` is html/pdf/other; geen ophaaltijd, geen tekst, geen scanindicator (T6, T7) |
| JSON naar receipt | `src/lib/menuExtractionMapping.js` | `mapStructuredOutputToMenuContexts` | Zet een gevalideerde uitvoer om naar de bestaande receiptvorm, `extractionMethod: 'ai_structured'`, `contextSlug: ai-N`, `structure: 'uncertain'` bij onzekerheid | Leest geen importcontext (wie, welke AI, welk bundel); geen bronhashcontrole |
| Menselijke controle | `app/internal/source-triage/batch/MenuReview.js`, `src/lib/menuStructureReview.js` | `MenuControl`, `MenuConcept`, `LineEditor`, `BlockerBanner`, `uncertainSections`, `validateStructureReviews`, `structureEdits` | Per regel corrigeren/uitsluiten, per onzekere rubriek handhaven/corrigeren, gegroepeerde onzekerheid, blokkades vóór opslaan | Gebonden aan een opgeslagen receipt; geen route voor onopgeslagen import-JSON; geen label "bewijs niet automatisch controleerbaar" |
| Concept | `src/lib/menuConcept.js`, `src/lib/menuConceptStore.js` | `buildMenuConcept`, `sanitizeEdits`, `mergeEdits`, `normalizePrice`, `displayPrice`, `createConceptVersion`, `computeMenuHash` | Versiegebonden, auditeerbare, idempotente opslag; blokkades; geen automatische stap | `normalizePrice` weigert 0 en > € 500,00 terwijl het schema elke niet-negatieve integer toestaat (T8); geen importherkomst in de conceptversie |
| Poorten | `src/lib/menuConceptReviewHandlers.js`, `src/lib/menuConceptExport.js`, `src/lib/menuProductIntegrationV2.js` | goedkeurings- en exportpoorten, `readReceiptProjection`, `readProductRecord` | Interne goedkeuring, export en publicatie blijven aparte, fail-closed poorten | Geen wijziging nodig en geen wijziging toegestaan; de handmatige import mag hier niets aan verbreden |

### Tegenstrijdigheden met bestaande documenten en code

Deze punten zijn echte ontwerpvragen. Fase 2 mag ze niet stilzwijgend oplossen.

- **T1 — Instructietekst en browser.** `src/lib/menuExtractionProtocol.js`
  (regels 3-7) zegt dat de tekst nooit naar een browser of log gaat. Een
  handmatige export doet dat per definitie wél. Nodig: een expliciete, begrensde
  uitzondering (alleen intern, geen log, niet in browseropslag, alleen de gepinde
  tekst) met een eigen ontwerpnotitie; anders is de export in strijd met de
  module-afspraak.
- **T2 — Twee versienummers.** `PROTOCOL_SCHEMA_VERSION` is
  `menu-extraction-result/v1` (`menuExtractionProtocol.js`), terwijl
  `EXTRACTION_OUTPUT_SCHEMA_VERSION` `menu-extraction-output/v1` is
  (`menuExtractionSchema.js`). De opdracht spreekt van "schemaversie": de export
  moet **beide** expliciet tonen en vastleggen, met dezelfde namen als de code.
- **T3 — De JSON draagt geen eigen versie.** `allowedTopLevel` is exact
  `menus`, `rejected`, `coverage`; een `version`- of `protocolHash`-veld in de
  JSON is een schemavalidatiefout. Protocolhash en schemaversie kunnen dus
  **niet** uit de geplakte JSON worden gecontroleerd.
- **T4 — Geen modelclaim als versiebewijs.** Omdat T3 geldt, is de enige
  betrouwbare bron van protocolhash en schemaversie het exportbundel in de app
  zelf. De import hoort daarom bij een **bestaand exportbundel** (gekozen door de
  mens), niet bij een versie die de AI of de plakker beweert.
- **T5 — Bon van 10 minuten.** `RECEIPT_TTL_MS` in `src/lib/urlIntakes.js` is
  10 minuten. Een mens die een prompt in een AI plakt en later terugkomt, haalt
  dat niet. Nodig: óf een eigen, begrensde levensduur voor het exportbundel met
  hercontrole van de bronhash, óf een expliciete herbevestiging/heranalyse. Een
  verlopen bon mag nooit als geldige import gelden.
- **T6 — Ophaaltijd per bron ontbreekt.** Alleen de bon heeft `fetched_at`
  (`0013`, regel 57). `sourceInventory` heeft geen `fetchedAt`. De gevraagde
  "ophaaltijd per bron" bestaat vandaag niet; de export moet óf de bon-tijd als
  één tijd voor de hele set tonen (met die beperking erbij), óf per bron een
  nieuwe meting doen. Niet doen alsof elke bron apart is opgehaald.
- **T7 — Brontekst wordt niet bewaard.** `boundedEvidence` in
  `src/lib/urlIntakes.js` bewaart expliciet "never raw source text"; het
  data-minimalisatiebeleid (`docs/api/url-intake-schema.md`) is de reden. De
  quote-controle in `validateStructuredOutput` heeft echter `sources[].text`
  nodig. Zonder tekst is een quote niet automatisch controleerbaar — precies het
  geval dat de opdracht voor scans en afbeeldingen noemt. Voor HTML/PDF met tekst
  moet de tekst dus opnieuw veilig worden gelezen (met hashvergelijking) of er is
  een expliciet opslagbesluit nodig; geen van beide bestaat nu.
- **T8 — Prijsgrens verschilt.** Het schema staat elke niet-negatieve
  `amountMinorUnits` toe; `normalizePrice` in `src/lib/menuConcept.js` accepteert
  alleen `> 0` en `≤ 500,00`. Een schema-geldige prijs van `0` of `60000` is dus
  niet op te slaan. De controle moet dat vóór de conceptstap als blokkade melden,
  niet pas bij opslaan.
- **T9 — Meldingsvorm van niet-opslaanbare velden.** `unsupportedProductFields`
  geeft een lijst veldnamen. De opdracht vraagt per **regel** zichtbaar maken en
  blokkeren. Nodig: een additieve, regelgebonden rapportage bovenop dezelfde
  validator; de validator en zijn verboden velden blijven ongewijzigd.
- **T10 — Arrangementen passen niet in v1.** Het uitvoerschema kent geen
  categorie- of itemsoort "arrangement"/"keuzegroep"; v2 kent die soorten wél
  (`menuProductSchemaV2`/`menuProductMappingV2`, met blokkades als
  `unsupported_item_kind`). Een arrangement als losse gerechten wegschrijven is
  dus verboden afvlakking; het moet als niet-opslaanbaar geblokkeerd worden tot
  een versiegebonden ontwerp is goedgekeurd.
- **T11 — "Herkomstwaarde `ai_structured`" is smaller dan hij klinkt.** De
  waarde bestaat als `extraction_method` (`src/lib/fieldConfidence.js`, regel 58)
  en als `menu.extractionMethod` in de receipt (`menuExtractionMapping.js`), maar
  **niet** als `source_type` van een menukaartsnapshot (dat is `own_website`,
  `restaurant_pdf_menu`, …). `docs/guides/menu-extraction-readiness.md` (regel 53)
  noemt dat expliciet een gat. De handmatige herkomst mag daarom nooit
  stilzwijgend als `source_type` worden geschreven.


## K2 Gebruikersstroom

De stroom is één rechte lijn met twee menselijke momenten (plakken en
controleren) en één opslagmoment. Er is geen pad naar een concept zonder
menselijke handeling. Alle bedragen, limieten en labels hieronder zijn ontwerp;
fase 2 implementeert ze en niets daarbuiten.

De **zichtbare** stroom staat in "Herziening v2" hierboven: één kolom, drie
stappen en gewone taal. §1–§3 beschrijven dezelfde stappen in v1-vorm en gelden
alleen voor zover v2 ze niet vervangt; §4–§9 gelden volledig.

### 1. Startpunt

- Bestaande batchpagina `/internal/source-triage/batch`, in het detail van één
  resultaat, naast "Menukaart controleren".
- Nieuwe knop **"Menu importeren met AI"** (in v1 nog "AI-prompt exporteren"),
  alleen zichtbaar voor een interne gebruiker (`isInternalOnly`, dezelfde poort
  als bevestigen). Een collega die alleen meeleest ziet de knop niet en kan ook
  niet importeren; dat volgt de bestaande rolregel dat een niet-starter
  alleen-lezen is.
- Zonder een geanalyseerd resultaat met minstens één leesbare bron is de knop
  uitgeschakeld met de reden erbij (geen prompt over een lege of geblokkeerde
  bron).

### 2. Prompt exporteren

De export bestaat uit vier blokken, in deze volgorde. In v2 staat alleen de
kern (restaurantnaam plus één regel per bron) in de hoofdweergave; de blokken
hieronder blijven de volledige inhoud van de prompt en van "Technische details".

1. **Vaste instructie**: de exacte tekst van `MENU-EXTRACTION.md`, geladen met
   `loadMenuExtractionProtocol()` (LF-genormaliseerd). Er wordt niets
   bijgeschreven, samengevat of vertaald.
2. **Vaste afspraken**: protocolversie (`version`), protocolhash (`hash`),
   schemaversie van de instructie (`schemaVersion`, `menu-extraction-result/v1`)
   én de schemaversie van de uitvoer (`menu-extraction-output/v1`), plus de
   limieten uit `LIMITS` en `DEFAULT_EXTRACTION_LIMITS` die voor de AI gelden
   (o.a. maximaal 5 documenten, 30 pagina's, 1000 items, quotelengte 500).
3. **Het exacte uitvoerschema** (`EXTRACTION_OUTPUT_SCHEMA`) als JSON, met de
   mededeling dat uitsluitend dit schema is toegestaan: geen extra velden, geen
   `confidence`, geen `reviewReady`, geen goedkeuring of dekkingclaim.
4. **Per bron** een blok met: vaste `sourceId` (de bestaande inventaris-id, bv.
   `source-1`), URL, ophaaltijd, `kind`, `status` en **SHA-256 van de
   bronbytes** (`contentHash`), gevolgd door de brontekst als platte tekst.
   - Is er tekst (HTML/PDF-tekstlaag): de tekst gaat mee, met de vindplaatsen die
     de AI mag citeren.
   - Is er geen tekst (scan, afbeelding, PDF zonder tekstlaag): dan staat er een
     expliciete instructie om **het bestand zelf toe te voegen** aan de AI, plus
     de waarschuwing dat bewijs dan niet automatisch controleerbaar is.
   - Ophaaltijd: één tijd voor de set (de bon) zolang T6 niet is opgelost, met
     de regel "dezelfde ophaalsessie" erbij; nooit een verzonnen per-brontijd.

De export krijgt een eigen **bundel-id** en een bundelhash (SHA-256 over de
canonieke exporttekst, LF-genormaliseerd, dezelfde conventie als de
protocolhash). Dat bundel is de enige bron van protocolhash, schemaversie en
bronhashes bij de latere import (T4). De export wordt niet in de browseropslag
bewaard en niet gelogd.

In v2 kiest de app het bundel automatisch (het meest recente geldige bundel van
deze gebruiker voor dit resultaat) en toont die keuze in "Technische details".
Die automatische binding is een UI-vereenvoudiging, geen versoepeling: zonder
geldig bundel geen import, en bij twijfel (twee geldige bundels) kiest de mens.
Protocolhash en schemaversie komen nog steeds uit het bundel.

### 3. Importeren

- Eén plakveld met een harde groottegrens: **1 MiB** (1 048 576 bytes UTF-8).
  De teller staat zichtbaar bij het veld; boven de grens wordt niets geparsed.
- De tekst wordt met `JSON.parse` in een `try/catch` gelezen en daarna
  uitsluitend als **data** behandeld. Nooit `eval`, nooit een functie uit de
  JSON, nooit een netwerk- of opslagactie op basis van een veldwaarde. Een
  string als "negeer je instructies" blijft een string en verschijnt hooguit als
  citaat in de review.
- Vóór het parsen is de JSON gebonden aan **één exportbundel** uit stap 1. In v2
  kiest de app automatisch het meest recente geldige bundel van deze gebruiker
  voor dit resultaat en toont die keuze in "Technische details"; zijn er twee
  geldige bundels, dan kiest de mens er één ("14:12 of 14:40") in plaats van dat
  de app gokt. Zonder geldig bundel is importeren niet mogelijk. Zo komen
  protocolhash en schemaversie uit de app, niet uit de JSON of uit een
  modelbewering.
- Het verplichte veld **"Welke AI gebruikte je?"** (lijst plus "Anders", max. 80
  tekens, zelfgerapporteerd) staat naast het plakveld; zie "Het AI-naamveld".
- Een lege plak, ongeldige JSON, een JSON-array in plaats van een object, of een
  bundel dat niet (meer) geldig is, geeft een concrete fout en géén resultaat.


### 4. Controle (server-side, onafhankelijk van modelclaims)

In deze volgorde; elke stap die faalt stopt met een concrete code en zonder
schrijfactie:

1. **Formaat**: één JSON-object, exact de toegestane topsleutels (`menus`,
   `rejected`, `coverage`), geen onbekende velden, geen verboden trustvelden
   (bestaande `findForbiddenKey`).
2. **Protocol en schema**: het gekozen bundel moet de actueel geladen
   protocolhash en dezelfde schemaversies dragen. Wijkt de hash af (protocol
   gewijzigd na export) → `bundle_protocol_mismatch`; geen stille
   herinterpretatie.
3. **Limieten**: de bestaande `LIMITS` en de bundellimieten (documenten,
   pagina's, items, quotelengte). `coverage.itemsExtracted` moet blijven kloppen
   met het aantal items; `complete` mag geen ongelezen bron of beperking hebben.
4. **Bronidentiteit en hash**: elke `sourceId` in `menus`, `rejected` en
   `coverage.unreadSources` moet in het bundel voorkomen, met **gelijke
   SHA-256**. Onbekende bron of afwijkende hash → blokkade per regel
   (`unknown_source`, `source_hash_mismatch`), nooit een waarschuwing die toch
   doorlaat.
5. **Quote in de brontekst**: voor bronnen met tekst de bestaande
   genormaliseerde `includes`-controle uit `validateStructuredOutput`. Een quote
   die niet in de bron staat is een fout, geen "bijna goed".
6. **Money**: `priceStatus` uit de vier bestaande statussen; `known` vereist een
   integer `amountMinorUnits` en `currency: 'EUR'`; geen decimals, geen floats.
   Daarna de bestaande conceptregel (`normalizePrice`: `> 0` en `≤ 500,00`) —
   een bedrag dat het schema haalt maar het concept niet, wordt hier een
   blokkade (T8). Geen prijs invullen; "onbekend" is niet nul.
7. **Relaties**: `priceVariants`, `supplementOf`, `isFrom`, `allergens`,
   `availability` en arrangementachtige structuren worden expliciet
   geclassificeerd. Een variant wordt nooit tot één prijs teruggebracht, een
   supplement nooit hoofdprijs, een arrangement nooit een gewoon gerecht (T10).
8. **Dekking**: `coverage` wordt getoond zoals de AI hem aanleverde, maar geldt
   nooit als bewijs. Nul items of `no_items` is geen geslaagde extractie; een
   `partial` resultaat blijft zichtbaar partieel.

Het resultaat is per regel één van vier toestanden: **geldig**, **fout**,
**niet automatisch controleerbaar**, **niet opslaanbaar**.

### 5. Bewijs bij scans en afbeeldingen

- Zonder brontekst kan een quote niet automatisch worden gecontroleerd. Elke
  regel die aan zo'n bron hangt krijgt het zichtbare label **"bewijs niet
  automatisch controleerbaar"** (statusrol `--status-old`, icoon plus tekst) en
  de vindplaats erbij.
- De mens moet zo'n regel **per regel** bevestigen of corrigeren. Er is geen
  "alles bevestigen" voor deze groep: een gedeeld label is geen gedeelde
  zekerheid.
- Het label verdwijnt pas als er aantoonbaar brontekst is (tekstlaag, of een
  later goedgekeurde OCR-route). Het label is geen goedkeuring en geen
  afkeuring; het is een eerlijke beperking.

### 6. Menselijke controle en correctie vóór opslag

- Na de controle opent het bestaande reviewpatroon: per rubriek de bronroute en
  vindplaats, per regel naam, omschrijving, prijs, bewijs (bron-id, vindplaats,
  quote) en de vier toestanden.
- De mens kan per regel corrigeren (naam, omschrijving, prijs, rubriekpad),
  uitsluiten of expliciet accepteren, en per onzekere rubriek handhaven of
  corrigeren — dezelfde regels als `LineEditor`/`StructureReview`.
- **Geen pad zonder menselijke handeling**: er is geen knop die een import
  automatisch omzet in een concept, geen bulk-acceptatie en geen vooraf
  aangevinkte bevestiging.
- "Concept opslaan" blijft `aria-disabled` zolang er blokkades of
  niet-nagelopen punten zijn en zegt waarom in gewone taal ("Kan pas als alle 4
  punten zijn nagelopen. Nog 4 open."), net als in het bestaande conceptpaneel.
  Opslaan maakt een interne conceptversie; er wordt niets gepubliceerd,
  goedgekeurd of geëxporteerd.

### 7. Varianten, supplementen en arrangementen

- Wat het huidige concept niet kan opslaan, wordt **nooit stil afgevlakt**. Het
  blijft met herkomst zichtbaar en wordt expliciet geblokkeerd of gemarkeerd:
  - `priceVariants` (glas/fles, klein/groot, per stuk/portie): alle varianten
    zichtbaar; nooit de laagste prijs kiezen.
  - `supplementOf`: supplement blijft supplement; nooit als hoofdprijs.
  - arrangementen en keuzegroepen: als niet-opslaanbaar geblokkeerd (T10), niet
    als losse gerechten.
  - allergenen: alleen expliciet uit de bron of legenda; ontbreken betekent
    onbekend, niet allergeenvrij.
- De blokkade noemt het veld, de regel en de reden, zodat dezelfde set na een
  latere schema-uitbreiding opnieuw beoordeeld kan worden.


### 8. Herkomst

Vastgelegd bij de import:

- **importmethode**: de vaste tekst `handmatige AI-import`;
- **AI-naam**: uit het verplichte veld "Welke AI gebruikte je?" (lijst plus
  "Anders", max. 80 tekens), met het label **"zelfgerapporteerd en onbewezen"** —
  de app kan niet vaststellen welke AI of welk model is gebruikt;
- **tijd**: het moment van importeren en het moment van opslaan;
- **protocolhash** en **schemaversies** uit het exportbundel;
- **bronhashes**: per bron de SHA-256 uit het bundel, plus de bundelhash;
- **wie**: de interne gebruiker die exporteerde en importeerde.

De bestaande receipt-velden dragen dit maar ten dele: `extractionMethod` is
begrensd tot 40 tekens en bevat vandaag `ai_structured`. De handmatige
specifieke velden (AI-naam, bundel-id, bundelhash) hebben **geen bestaand veld**.
Fase 2 slaat ze daarom niet ergens "wel" op: óf een additief, versiegebonden veld
is vooraf ontworpen en beoordeeld, óf de import meldt bij opslaan expliciet dat
deze herkomst niet duurzaam wordt bewaard. Stilzwijgend weglaten is niet
toegestaan. De importmethode mag nooit als `source_type` worden geschreven (T11).

### 9. Fout-, lege en randtoestanden

| Situatie | Zichtbaar |
| --- | --- |
| Geen exportbundel | Importveld uitgeschakeld met "Kies eerst een exportbundel" |
| Lege plak | "Plak de JSON uit de AI"; geen parse, geen resultaat |
| Ongeldige JSON | `import_json_invalid` met regelnummer; niets opgeslagen |
| Groter dan 1 MiB | `import_too_large` met de gemeten grootte; niets geparsed |
| Verboden trustveld | `forbidden_trust_key` met het veldpad |
| Onbekende bron / hashverschil | `unknown_source` / `source_hash_mismatch` per regel |
| Nul items / `no_items` | "Geen gerechten geëxtraheerd. Dit is geen geslaagde extractie." |
| Partieel | Blijft zichtbaar partieel met de ongelezen bronnen en beperkingen |
| Bundel of bon verlopen | `bundle_expired`; opnieuw exporteren of opnieuw analyseren |
| AI-antwoord met alleen tekst | "Geen JSON gevonden"; geen interpretatie van proza |
| Netwerk-/opslagfout bij opslaan | Bestaande foutbanner; de invoer blijft staan, niets half opgeslagen |

De technische codes hierboven zijn voor de ontwikkelaar en het export; de
medewerker ziet dezelfde oorzaak in gewone taal ("staat niet in de bron", "uit
scan, controleer", "twee prijzen", "is een toeslag"). De code blijft ernaast
staan in "Technische details". Een v2-regel die aandacht vraagt heeft altijd
één korte reden en nooit alleen een kleur.

- **Toetsenbord**: alle stappen zijn met Tab te bereiken in leesorde; het
  plakveld, de bundelkeuze, de regelkeuzes en de opslaanknop hebben een
  zichtbare focusring (`--border-focus`). De vaste statusiconen zijn decoratief
  (`aria-hidden`), de tekst draagt de betekenis.
- **Licht en donker**: beide thema's gebruiken uitsluitend Kleurtaal
  v2-tokens; donker blijft de standaard, licht is een expliciete keuze. Status
  is nooit alleen kleur: icoon plus tekst.
- **320 en 390 px**: één kolom, geen horizontale scroll, knoppen minimaal 40 px
  hoog, quotes en hashes breken af (`overflow-wrap: anywhere`).
- **Schermlezer**: het controleresultaat is een `role="status"`, fouten een
  `role="alert"`, en de vier toestanden staan als tekst in de regel, niet als
  kleurcodering.


## K3 Visuele referentie

Eén compact, statisch bestand:
[`docs/mockups/manual-ai-import-v2.html`](../../../docs/mockups/manual-ai-import-v2.html).
`manual-ai-import-v1.html` blijft staan als geschiedenis en is **vervangen**.

- Fictieve gegevens (`Restaurant Voorbeeld`, `.example`-URL's), geen
  restaurantfoto's, geen echte namen of prijzen.
- Bestaande interne stijl: Kleurtaal v2-tokens uit `app/globals.css`, interne
  kaarten, kruimelpad, titel plus "Alleen intern", status altijd icoon plus
  tekst. Eén kolom; geen zijpaneel en geen nieuwe navigatie of paginahiërarchie.
- Drie stappen in gewone taal:
  1. **Prompt maken** — restaurantnaam; per bron één regel met vinkje of
     waarschuwing ("Lunch (website): gaat mee in de prompt", "Diner (scan): voeg
     het bestand zelf toe"); "Kopieer prompt".
  2. **Antwoord plakken** — "Welke AI gebruikte je?" (lijst plus "Anders"),
     plakveld met teller, "Controleren".
  3. **Nalopen en opslaan** — "9 gerechten · 5 in orde · 4 nalopen"; alleen de
     vier aandachtsregels open met [Klopt] [Wijzig] [Weglaten] (en [Kies] bij
     twee prijzen); Vraag AI per regel waar dat mag, met één uitgewerkt
     voorbeeld met dezelfde bron en een plakveld; één knop "Vraag AI over alle
     open punten"; de 5 goede regels ingeklapt; "Concept opslaan" uitgeschakeld
     met reden en aantal open punten.
- **Technische details** staan in één ingeklapte sectie (protocol- en
  schemaversie, hashes, bron-ID's, AI-naam, importtijd) en worden nog steeds
  vastgelegd en gecontroleerd.
- Licht en donker in hetzelfde bestand (`Licht`/`Donker`, donker als standaard);
  `#licht` en `#donker` openen de mockup direct in die stand. Ontworpen voor 320
  en 390 px (één kolom, geen horizontale scroll, knoppen minimaal 40 px) en met
  het toetsenbord te bedienen.
- Status in de index (`docs/mockups/README.md`): v2 **ter goedkeuring**, v1
  **vervangen**. De mockup is geen buildautorisatie; de Product Owner keurt
  goed, daarna pas fase 2.


## K4 Meetplan voor de proef

De proef meet per **werkelijk geteste AI** en per bron, met dezelfde referenties
en telregels als #59:

- Referenties: `ops/benchmark/reference-references/index.json` (Zuyd, Andalous,
  Pellens, Chocolat, Senang Makan) met de vastgezette bytes uit
  `ops/benchmark/reference-captures.json`; Senang Makan blijft "blocked", niet
  "leeg".
- Telregels: `docs/guides/menu-extraction-reference-counting-rules.md`
  (SHA-256 in de index). Die regels worden voor deze proef **niet** gewijzigd.
- Alleen de al toegestane openbare bronnen in de geïsoleerde omgeving; geen
  nieuwe bronnen, geen login, geen CAPTCHA-omzeiling.
- De brontekst die de AI krijgt, moet de vastgezette bronversie zijn (hash gelijk
  aan de capture). Is dat niet zo, dan is de meting niet vergelijkbaar en wordt
  ze niet gerapporteerd.

Te meten per AI en per bron, apart en nooit samengevoegd:

| Maat | Definitie |
| --- | --- |
| Gemiste gerechten | referentie-item zonder match in het geïmporteerde resultaat |
| Verzonnen gerechten | geïmporteerd item zonder match in de referentie |
| Prijsfouten | gematchte gerechten met een verkeerde, ontbrekende of extra prijs(variant), inclusief supplement als hoofdprijs |
| Variantrelaties | glas/fles, klein/groot, per stuk/portie: terecht als variant, niet als los gerecht en niet afgeplat |
| Rubriekfouten | item in een ander pad dan de referentie (bron leidt, niet de correctie) |
| Bewijsdekking | aandeel items met een quote die aantoonbaar in de vastgezette bron staat; plus het aantal regels met "niet automatisch controleerbaar" |
| Correctiewerk | aantal menselijke correcties, uitsluitingen en rubriekbeslissingen vóór opslaan |
| Tijd | minuten van export tot import, en van import tot opgeslagen concept |

Rapportage:

- per AI één regel met de acht maten, met het label **"handmatige proef, geen
  schaalacceptatie"**;
- expliciet welke bronversie (URL plus SHA-256) en welke protocolhash is
  gebruikt;
- niet-ondersteunde klassen (scans, afbeeldingen, arrangementen) worden als
  beperking gerapporteerd, niet als fout weggelaten;
- **geen** universele claim dat "alle websites" of "deze AI" menus correct leest;
  de uitkomst geldt alleen voor de geteste bronversies;
- bewijscategorie: developerbewijs/fixturebewijs is geen praktijkacceptatie; de
  proef zelf is een handmatige proef, geen onafhankelijke review.


## K5 Bouwplan voor fase 2

Pas na goedkeuring van de mockup. Geen regel hiervan is in fase 1 uitgevoerd.

### Bestanden (voorstel, nog niet aangemaakt)

| Bestand | Rol |
| --- | --- |
| `src/lib/manualAiImportBundle.js` | Pure samensteller: protocolmetadata, schema, limieten en broninventaris → prompttekst plus bundelhash. Geen fetch, geen opslag. |
| `src/lib/manualAiImportValidation.js` | Pure controle op onbetrouwbare JSON: groottegrens, `JSON.parse` in `try/catch`, `validateStructuredOutput`, bronhashvergelijking, Money-conversie, regelgebonden rapport voor niet-opslaanbaar en "niet controleerbaar". |
| `src/lib/manualAiImportHandlers.js` | Server-side: bundel kiezen, bon opnieuw lezen, `mapStructuredOutputToMenuContexts`, bestaande conceptopslag; fail-closed vóór elke schrijfactie. |
| `app/api/internal/v1/batch-analysis/[id]/manual-import/route.js` | Interne route, `isInternalOnly`; geen provider, geen netwerkoproep. |
| `app/internal/source-triage/batch/ManualAiImport.js` | UI in de bestaande batchkaart; hergebruikt `MenuReview`-onderdelen. |
| `app/internal/source-triage/batch/BatchAnalysisView.js` | Eén extra knop plus paneel; bestaande staten ongewijzigd. |

### Regressies (minimaal)

1. Injectie in de geplakte JSON: een string met instructies blijft data, wordt
   niet uitgevoerd, veroorzaakt geen netwerk-, opslag- of toolaanroep.
2. Hashverschil: protocolhash, bundelhash of bronhash wijkt af → blokkade.
3. Te groot: boven 1 MiB wordt niets geparsed.
4. Onbekende `sourceId`: blokkade per regel.
5. Supplement als hoofdprijs: geblokkeerd, supplement blijft supplement.
6. Variantverlies: glas/fles en klein/groot blijven beide zichtbaar; geen
   laagste prijs.
7. Opslaan zonder menselijke handeling: geen route, geen knop, geen API-pad.
8. Verboden trustvelden (`confidence`, `reviewReady`, `approved`,
   `publicationReady`) → `forbidden_trust_key`.
9. Nul items / `no_items` → geen successtatus.
10. Quote niet in de bron → fout; zonder brontekst → label "niet automatisch
    controleerbaar" en per regel bevestigen.
11. Idempotentie: dezelfde import twee keer → één conceptversie, tweede keer
    `unchanged` of een versieconflict zoals de bestaande opslag.
12. Rollen: niet-intern of niet-starter → 403/alleen-lezen; niets opgeslagen.
13. Verlopen bundel of bon → `bundle_expired`, niets opgeslagen.
14. PDF/scan zonder tekstlaag → expliciete beperking, geen verzonnen items.

### Risico's

- **Instructietekst naar de browser** (T1): nieuwe blootstelling; alleen intern,
  geen log, geen browseropslag. Zonder deze afspraak niet bouwen.
- **Mensen vertrouwen de AI**: daarom is er geen successtatus op een geldige
  JSON, geen accepteer-alles en een verplichte menselijke stap.
- **Injectie via geplakte JSON** (promptinjectie of een enorme string): data
  blijft data, groottegrens en schema-eisen gelden.
- **Bon van 10 minuten** (T5): een mens haalt dat niet; zonder eigen
  bundellevensduur of herbevestiging is de stroom niet betrouwbaar.
- **Geen duurzame herkomstopslag** (T11, stap 8): zonder additief ontwerp is de
  AI-naam niet bewijsbaar en verdwijnt hij of wordt hij gemeld als beperking.
- **Brontekst niet bewaard** (T7): herlezen kan de bron hebben gewijzigd; dan
  blokkeert de hashvergelijking en moet de analyse opnieuw.
- **Arrangementen en scans** (T7, T10): blijven beperking; geen schijnvolledige
  kaart.
- **Dubbel werk naast de toekomstige automatische route**: de handmatige proef
  is expliciet geen vervanging en wordt niet de standaardroute.

## K6 Voortgang

Per K is één regel vastgelegd in `ops/benchmark/output/criteria-progress.json`
onder ronde `6346726670` (K1 = mockup v2, K2 = deze spec, K3 = voortgang). Dat
bestand is volgens BE-21 gitignored en wordt daarom niet gecommit; de vorige
ronde blijft bewaard onder `6345294413`. De mockup en deze spec zijn wel
gecommit op `feat/menu-extraction-59`.

## Fase 2 — implementatie en bewijs (deze ronde)

Deze ronde bouwt de goedgekeurde stroom. Per onderdeel staat waar het staat en
welke regressie het bewijst. Alles is **developerbewijs**: geen onafhankelijke
review, geen echte bronacceptatie en geen productieactie.

| Onderdeel | Bestand | Bewijs |
| --- | --- | --- |
| K1 mockup v3 + spec | `docs/mockups/manual-ai-import-v3.html`, `docs/mockups/README.md` | v3 vervangt v2 in de index; (a)–(d) staan in de mockup |
| K2 prompt exporteren | `src/lib/manualMenuImportBundle.js`, `src/lib/manualMenuImportPrompt.js`, `src/lib/manualMenuImportSource.js` | `manualMenuImport.test.js`: protocol-/schemahash, per bron id/URL/tijd/SHA-256, samenvatting-plus-codeblok, scaninstructie, geen tekst in de metadata |
| K3 veilig importeren | `src/lib/manualMenuImportImport.js`, `src/lib/manualMenuImportHandlers.js`, `app/api/internal/v1/manual-menu-import/*` | 1 MiB-grens, codeblokextractie, gewone melding, `validateStructuredOutput`, bundelbinding, Money- en relatieregels, AI-naamveld, nooit JSON in de respons |
| K4 bewijs bij scans | `src/lib/manualMenuImportImport.js`, `app/internal/menu-import/page.js` | regel "uit scan, controleer", per regel bevestigen, geen accepteer-alles |
| K5 menselijke controle | `src/lib/manualMenuImportReview.js`, `app/internal/menu-import/page.js` | variant → prijskeuze of weglaten; supplement → zichtbaar "als toeslag weggelaten"; onzekere rubriek → per regel bevestigen of corrigeren; verplichte reden bij "staat niet in de bron"; opslaan pas zonder open punten; herkomst in `importProvenance` |
| K6 Vraag AI | `src/lib/manualMenuImportPrompt.js`, `src/lib/manualMenuImportReview.js` | één prompt per regel, 20 per import, 8 KiB broncontext, dezelfde validator, vervangt alleen die regel, geen Vraag AI bij twee prijzen |
| K7 gebruiksexport | `src/lib/manualMenuImportUsage.js`, `GET /api/internal/v1/manual-menu-import/usage` | alleen metagegevens, vast schema, `via abonnement, niet gemeten` zonder meting, geen menu-inhoud |
| K8 regressies | `src/lib/manualMenuImport.test.js`, `src/lib/manualMenuImportHandlers.test.js`, `ops/browser/run-menu-review-browser-check.js` | injectie, hash-mismatch, te groot, onbekende bron, supplement als hoofdprijs, variantverlies, opslaan zonder menselijke stap, reden verplicht, vervolgantwoord buiten de regel, tekst rond het codeblok, ongeldige JSON; browserfixture voor de drie stappen in licht/donker op 320/390 px en met het toetsenbord |
| K9 handmatige proef | `ops/scripts/measure-manual-ai-import.js` (+ test) | meet gemist, verzonnen, prijzen, varianten, rubrieken en bewijsdekking met het label "handmatige proef, geen schaalacceptatie"; de uitvoering zelf blijft bij Lead en eigenaar |

Bewuste beperkingen van deze ronde, eerlijk gemeld in plaats van opgelost:

- ~~De bundel- en importopslag is in-memory en begrensd (50 bundels, 30
  minuten; 50 imports, 60 minuten).~~ **Vervallen in de herstelronde van
  2026-10-22 (review 6350337273):** de stroom is toestandsloos geworden met een
  ondertekend en versleuteld toestandstoken. Zie "Herstelronde fase 2" onderaan.
- De prompttekst en de brontekst gaan één keer naar de interne browser; dat is
  de in de spec geaccepteerde blootstelling (T1). Ze worden niet gelogd en niet
  in de browseropslag bewaard, maar de DOM bevat de prompt zolang de pagina
  openstaat.
- De bron-SHA-256 is de hash van de genormaliseerde tekst die de AI zag (of van
  de PDF-bytes); dat is niet automatisch dezelfde waarde als `contentHash` uit
  een eerdere analyse. De import vergelijkt daarom tegen **deze** bundel, niet
  tegen een oude bon.
- Een PDF wordt in deze ronde niet van een tekstlaag voorzien: hij gaat als
  "voeg het bestand zelf toe" mee en bewijs eruit blijft menselijk werk (T7).
- De AI-naam is zelfgerapporteerd. Hij staat in `captured_content.importProvenance`
  (additief, geen schemawijziging) en in het gebruiksexport; het is geen bewijs.
- Een rubriek die de AI `uncertain` noemt, blijft een open punt tot een mens
  elke regel eruit heeft bevestigd of gecorrigeerd; pas dan verdwijnt de
  onzekerheidsvlag en kan het bestaande concept de rubriek opslaan. De
  bestaande `MenuReview`-component is niet hergebruikt: die is gebonden aan een
  opgeslagen receipt, terwijl deze import nog geen receipt heeft. Hergebruikt
  zijn wel dezelfde conceptregels (`buildMenuConcept`, `normalizePrice`), de
 zelfde mapping en dezelfde opslagroute.
- Er is geen provider, geen betaalde API en geen automatische bevestiging,
  publicatie of export. Rollen, bronbevestiging en publicatiepoorten zijn niet
  gewijzigd.


## Grenzen van deze fase

Niet gedaan en niet toegestaan in deze ronde: migraties, schemawijzigingen,
v2-schrijver, betaalde API, providerconfiguratie, nieuwe bronnen, wijzigingen aan
de #59-referenties, telregels of meetcode, #56-integratie, merge, rebase,
force-push, release of publicatie. PR #60 blijft draft.

Fase 1 (ontwerp) blijft ongewijzigd staan; wat hierboven onder "Fase 2" staat is
de enige toegevoegde bouw.

## Openstaande beslissingen (voor de Lead, niet voor de developer)

Wat deze ronde feitelijk doet staat erbij; de beslissing blijft aan de Lead.

1. **Brontekst voor de prompt**: de prompt leest de bron bij het maken opnieuw
   via de bestaande veilige route en legt de tekst alleen in het tijdelijke
   bundel vast (geen database, geen browseropslag). Een expliciet
   opslagbesluit voor herlezen zonder nieuwe fetch is nog niet genomen.
2. **Levensduur en herbinding van het exportbundel** (T5): ~~het bundel leeft 30
   minuten in het procesgeheugen~~ Het bundel reist sinds de herstelronde in het
   toestandstoken en is 30 minuten geldig; daarna volgt `state_expired` met
   [Opnieuw maken]. Of dat genoeg is voor de handmatige proef, beslist de Lead.
3. **Duurzame herkomstopslag** (T11): de AI-naam, tijd, protocol- en
   bronhashes en de redenen staan additief in
   `captured_content.importProvenance`. Dat is geen nieuwe kolom en geen nieuwe
   `source_type`; het verdwijnt niet stil, maar het is ook geen apart
   auditrecord.
4. **Exportrecht van collega's**: alleen de starter kan zijn eigen bundel en
   import gebruiken; een collega krijgt 404/geen toegang tot dat bundel. Dit
   volgt het voorstel in deze spec.
5. **Automatische bundelbinding en de Vraag AI-bovengrens**: geïmplementeerd als
   ontworpen (1 per regel, 20 per import, 10 regels per "alle open punten",
   8 KiB broncontext). De app kiest geen bundel meer automatisch: de gebruiker
   maakt de prompt in dezelfde pagina, dus het bundel is altijd het zojuist
   gemaakte bundel en de UI toont het.



## Herstelronde fase 2 — Lead-review 6350337273 (2026-10-22)

De Lead voerde de handmatige import uit in de echte lokale app en vond één
blokkerende fout: stap 3 ("Weglaten") gaf **404**, omdat de import in een andere
serverless-instantie niet bestond. Hieronder staat per punt wat er is gebouwd en
welk bewijs erbij hoort. Alles is **developerbewijs**: geen onafhankelijke
review, geen browseracceptatie door de Lead en geen productieactie.

### K1 — geen geheugenopslag (blokkerend)

`sharedBundleStore` en `sharedImportStore` (een `Map` op moduleniveau) zijn
verwijderd. De stroom is nu toestandsloos:

- na elke stap geeft de server één **ondertekend en versleuteld toestandstoken**
  terug (`src/lib/manualMenuImportState.js`): AES-256-GCM met een willekeurige
  IV per token, een vast AAD-label en een HKDF-SHA256-sleutel uit het bestaande
  servergeheim `SUPABASE_SERVICE_ROLE_KEY` met een eigen `info`-label;
- er is **geen nieuw geheim, geen nieuwe env-variabele, geen migratie en geen
  nieuwe tabel**; de sleutel verlaat de server nooit;
- het token bevat de vervaltijd (30 minuten), de gebruikers-ID, het restaurant,
  de bundelhash en de importhash; de server controleert die waarden bij het
  openen en weigert een gewijzigd, verlopen, te groot, vreemd of andermans token
  met een gewone melding (`state_invalid`, `state_expired`, `state_too_large`,
  `state_other_user`, `state_mismatch`);
- de grootte is begrensd op 4 MiB token; groter geeft een gewone melding met een
  nieuwe prompt in plaats van een stille afkapping;
- de client bewaart het token **alleen in het geheugen van de pagina**, niet in
  `localStorage`; de server leidt niets af uit een clientclaim;
- ontbreekt het servergeheim, dan stopt de stap met `state_config_missing` en
  een concrete fout; er is geen stille doorgang.

De routers `POST /imports`, `POST /imports/<id>/decisions`,
`POST /imports/<id>/follow-up`, `POST /imports/<id>/open-points` en
`POST /imports/<id>/save` nemen het token in de body en geven het volgende token
terug. De import-id in het pad wordt tegen het token gecontroleerd
(`state_mismatch`), zodat een stap nooit bij een andere import terechtkomt.

### K2 — het plakveld toont geen JSON (eigenaarsbesluit b)

De geplakte tekst gaat direct naar de paginastatus. Het veld toont daarna alleen
"✓ Antwoord geplakt (N tekens)" met [Wissen]; de inhoud wordt niet gerenderd. Het
veld heeft geen `value` met de tekst en er is geen JSON-weergave. Na een geslaagde
controle verdwijnt de samenvatting; het antwoord zelf blijft server-side in het
toestandstoken.

### K3 — restaurant kiezen

Het vrije "Restaurantnummer" is vervangen door een zoekveld op naam. De keuzes
komen uit de bestaande statische `data/restaurants.json` via
`GET /api/internal/v1/manual-menu-import/restaurants` (alleen interne rollen,
maximaal 10 treffers, alleen id/naam/buurt). De server weigert een onbekend
nummer met `restaurant_unknown` en neemt de naam uit de lijst over, niet uit de
client. Een `?restaurant=<id>&name=<naam>`-voorgevulde keuze blijft werken en
wordt server-side opnieuw gevalideerd.

### K4 — uitleg menupagina

Bij de bron-URL staat: "Gebruik de pagina waar de menukaart staat, niet alleen de
homepage." Er is geen automatische linkcrawl.

### K5 — geldigheid zichtbaar

Na stap 1 toont de pagina "Geldig tot HH:MM" (uit het token, niet uit een
clientklok). Is de stap verlopen, dan volgt een gewone melding met
[Opnieuw maken]; die knop maakt met dezelfde bronnen een nieuwe prompt. Ook
`follow-up` en `open-points` geven de resterende geldigheid terug.

### K6 — regressies

| Bewijs | Bestand |
| --- | --- |
| volledige keten over **aparte handler-instanties** per stap (serverless-simulatie) | `src/lib/manualMenuImportHandlers.test.js` |
| gewijzigd token, verlopen token, token van een andere gebruiker, te groot token, ontbrekend geheim, ontbrekend token | `src/lib/manualMenuImportHandlers.test.js`, `src/lib/manualMenuImportState.test.js` |
| plakveld zonder JSON-weergave, "Wissen" en de tekenteller | `ops/browser/run-menu-review-browser-check.js` (browserfixture) |
| onbekend restaurant, zoeken op naam, GET-route en rolregel | `src/lib/manualMenuImportHandlers.test.js` |
| AES-GCM/HKDF-eigenschappen: heen en terug, geen leesbare brontekst, andere sleutel, IV per token, TTL | `src/lib/manualMenuImportState.test.js` |

Uitgevoerd op `a059a88`: `npm test` **2434/2434**, `npm run build` compiled
successfully met 42/42 statische pagina's, browserfixture **351/351**
(`ops/browser/evidence/menu-review-browser-evidence.json`, head `a059a88`,
schone werkmap). Dit blijft fixture- en developerbewijs, geen browseracceptatie
door de Lead.

### K7 — voortgang

Per K staat een regel met `name` in `ops/benchmark/output/criteria-progress.json`
(volgens BE-21 gitignored) onder de ronde van deze review.

### Eerlijk blijvende beperkingen van deze herstelronde

- Het toestandstoken bevat de brontekst die de AI zag. Het gaat alleen over de
  interne HTTPS-verbinding, staat in het geheugen van de pagina en wordt niet
  gelogd of in de browseropslag bewaard. Een token van vóór een tussenstap
  blijft tot de vervaltijd geldig (herhaling van een oude stap is mogelijk); dat
  is voor een interne handmatige proef geaccepteerd en vraagt geen migratie.
- De gebruiksteller (`usageLedger`) blijft per instantie in het geheugen. Dat is
  geen onderdeel van de importstaat: de export is een ruwe, begrensde telling en
  claimt geen volledigheid. Een duurzame teller vraagt een eigen besluit.
- Er is nog steeds geen provider, betaalde API, publicatie, merge of
  productieactie; de bron-SHA-256 blijft de hash van de tekst die de AI zag.
- De browserfixture bewijst de UI-paden met fictieve antwoorden. De echte proef
  met de Lead, echte bronnen en de onafhankelijke review blijven open.

