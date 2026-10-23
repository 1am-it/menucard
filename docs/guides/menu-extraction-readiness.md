# Menu-extractie — technische readinessreview

Status: reviewbaar bouwdocument, 2026-10-17. Hoort bij GitHub #59 en is
afzonderlijk van #53/PR #56. Dit document beschrijft de bestaande code, de
gaten en de uitvoeringsvolgorde; het is geen bewijs dat een provider of
productieactie is geactiveerd.

## Uitgangspunt en rollen

- AI Implementation Engineer: implementatie, tests en reviewbare PR.
- AI Delivery Lead: scopebewaking en onafhankelijke review.
- Product Owner: provider/model, kosten, privacy/retentie, externe toegang,
  migraties, merge en release.
- Broninhoud is onbetrouwbare data. Geen bronbevestiging, interne goedkeuring,
  export, merge of publicatie volgt automatisch uit een geslaagde analyse.

## Codemapping

| Protocolstap | Bestaande code | Hergebruik / gat |
| --- | --- | --- |
| Veilige ophaling, redirects, SSRF, robots | `src/lib/safeOutboundFetch.js`, `src/lib/restaurantSourceFetch.js`, `src/lib/sourceAnalysisPipeline.js` | Hergebruiken; geen tweede egress. |
| Same-host menuontdekking | `src/lib/sameHostDiscovery.js` (max. 5 kandidaten, één extra hop) | Hergebruiken; geen crawl. |
| HTML/JSON-LD | `src/lib/menuJsonLdExtraction.js`, `src/lib/htmlMenuStructure.js`, `src/lib/menuHierarchy.js` | Hergebruiken; tabs/uitklappers zonder DOM-bewijs blijven onzeker. |
| PDF-tekst | `src/lib/pdfTextExtraction.js` | Hergebruiken; alleen digitale tekstlaag, geen OCR. |
| PDF-structuur | `src/lib/pdfMenuStructuring.js` | Herkende secties werden alleen als `unknown_menu_contexts` bewaard; nu ook als canonieke reviewbare menucontext. |
| Analyse-uitkomst | `src/lib/restaurantSourceAnalysis.js` | Eén canonieke `extractionResult` toevoegen met broninventaris, dekking en beperkingen. |
| Receipt en review | `src/lib/urlIntakes.js`, `src/lib/batchAnalysis.js`, `src/lib/batchAnalysisHandlers.js` | Receipt blijft de duurzame reviewbron; PDF-menu's moeten daarin terechtkomen. |
| Concept | `src/lib/menuConcept.js`, `src/lib/menuConceptStore.js` | Bestaande versiegebonden opslag; geen automatische stap. |
| Publicatie/export | `src/lib/menuConceptReviewHandlers.js`, `src/lib/menuConceptExport.js`, `src/lib/menuExport.js` | Ongewijzigde, afzonderlijke poorten. |
| AI-grens | `src/lib/claudeStructuringAdapter.js` | Dode, altijd uitgeschakelde grens; vervangen door een providerneutrale adapter met geïnjecteerde call en schema-validatie. |
| Instructie | `MENU-EXTRACTION.md` | Nog niet versiegebonden in runtime geladen; hash/versie moeten server-side worden vastgelegd. |
| Benchmark | `src/lib/menuExtractionContract.js`, `ops/benchmark/*` | Alleen offline benchmarkcontract; niet automatisch het productcontract. |

## Schemagaten en grens

De bestaande receipt bewaart per menu: `name`, `contextSlug`, optioneel
`title`/`structure`, en per categorie pad, bronpad, positie, locator en
onzekerheid; per item alleen `name`, `desc` en één `price`. Het concept bewaart
daarvan één prijs per regel. Dat is voldoende voor de bestaande deterministische
HTML/PDF-extractie, maar niet voor alle eisen van #59:

| Vereiste | Bestaand | Status |
| --- | --- | --- |
| Menuvarianten | Context/titel/pad | Grotendeels; variantidentiteit is impliciet. |
| Geneste rubrieken | `menuHierarchy` pad/sourcePath/positie | Ondersteund. |
| Eén bekende prijs | `price` + `normalizePrice` | Ondersteund. |
| Glas/fles, klein/groot, vanaf | Eén `price` | **Gat**; niet stilzwijgend afplatbaar. |
| Supplement/arrangement/keuzegroep | Niet in productconcept | **Gat**; niet als gewoon gerecht opslaan. |
| Allergenen expliciet/onbekend | Alleen bestaande gepubliceerde items; nieuwe items krijgen geen status | **Gat**; onbekend mag nooit als lege/allergeenvrije lijst worden geëxporteerd. |
| Bronbewijs per item | Alleen categorieklocator; PDF-itemcontenthash niet in receipt | **Gat**; uitbreiden in versiegebonden resultaat. |
| Broninventaris/leesdekking | Vrije `notes`; PDF-context heeft pagina's/woorden/hash | **Gat**; gestructureerd toevoegen. |
| Instructie-/model-/adapterversie | Niet vastgelegd | **Gat**; resultaatmetadata toevoegen. |
| AI-methode in concept | `source_type` kent geen `ai_structured` | **Gat**; niet activeren zonder schema-/DB-ontwerp. |

Voor deze eerste bouwronde wordt daarom géén AI-uitvoer naar het bestaande
concept geschreven. De deterministische PDF/HTML-route wordt wel canoniek en
verliesarm gemaakt. AI-uitvoer met niet-ondersteunde prijs-/supplementvelden
moet door de validator worden geweigerd of als expliciete beperking worden
gerapporteerd; nooit afgeplat.

### Additief v1-contract in bestaande JSONB

Geen nieuwe databasetabel of migratie. De bestaande
`candidate_summary.menus` en `restaurant_source_analysis_jobs.field_evidence`
krijgen optionele, begrensde velden:

- menu: `sourceId`, `sourceUrl`, `extractionMethod`;
- item: `evidence: { locator, contentHash? }` (nooit ruwe brontekst);
- job: `source_inventory[]`, `limitations[]`, `extraction_result` en
  `protocol { instructionVersion, instructionHash, instructionFile, schemaVersion }`;
- `extraction_result`: `schemaVersion`, `status`, `sources[]`, `coverage`
  (`complete:false`, `reviewRequired:true`), `attentionGroups[]` en
  `limitations[]`.

Oudere rijen zonder deze velden blijven leesbaar; de PDF-fallback leidt dan
dezelfde menucontext af uit `unknown_menu_contexts`. Publicatie/export leest
deze metadata niet en erft dus geen nieuwe publieke velden.

## Uitvoeringsplan

### Ronde A — canoniek resultaat en PDF-continuatie

1. Voeg broninventaris, leesdekking en beperkingen toe aan de analyse-uitkomst.
2. Promoveer herkende PDF-secties naar dezelfde menucontextvorm als HTML, met
   bron-ID, positie, onzekerheid en bewijs.
3. Laat receipt, samenvatting, detail en concept dezelfde menucontexten gebruiken.
4. Maak nul herkende gerechten expliciet onvolledig; nooit een succesclaim.
5. Open handmatige controle op het exacte batchresultaat, niet op een
   ongerelateerde bronlijst.
6. Groepeer gedeelde rubriekonzekerheid; een groepshandeling accepteert alleen de
   getoonde items en lost geen prijs- of andere blokkades op.

### Ronde B — versiegebonden AI-contract

1. Laad `MENU-EXTRACTION.md` server-side met versie en SHA-256.
2. Definieer een providerneutraal resultaat- en validatieschema.
3. Voeg een adapterinterface met geïnjecteerde providercall, timeout,
   token-/document-/kostenbudget en begrensde retry-classificatie toe.
4. Test met een offline fake provider; geen echte provider, key of netwerk.

### Ronde C — activering (geblokkeerd)

Pas na expliciete keuze van provider/model, DPA/EU-verwerking, retentie,
kostenplafond en testtoegang. Geen betaalde fallback, OCR of browserdienst.

### Ronde D — acceptatie

Echte representatieve set en aparte ongeziene set; Smelt/Blossem alleen met
gecontroleerd bronbewijs. Tot die tijd blijven dit open acceptatiegaten.

## Concrete limieten

Bestaand en aantoonbaar:

- fetch: 2 MB, 8 s, 3 redirects;
- robots.txt: 200 KB, 5 s;
- PDF: 15 MB, 30 pagina's, 15 s, fallback max. 128 MB inflate;
- same-host: 5 kandidaten, één extra hop;
- batch: 10 URL's, 25 per dag, 5 attempts, lease 3 minuten, batch verloopt na
  24 uur;
- receipt: 10 minuten geldig;
- geen model-, token- of kostenlimiet bestaat vandaag, omdat geen provider is
  geconfigureerd.

Voorstel voor de adapter, nog niet geactiveerd: 60 s per call, 180 s per job,
50.000 inputtokens, 10.000 outputtokens, 5 documenten, 30 pagina's, 1 retry
alleen bij timeout/rate-limit/5xx, één call tegelijk per job, kostenplafond
verplicht door de eigenaar (`null` = weigeren).

De adapterinterface (`src/lib/menuExtractionAdapter.js`) weigert zonder
geconfigureerde provider, zonder expliciet kostenplafond, bij een te grote
bronset, bij timeout en bij schema-/bronverwijzingsfouten. `confidence`,
`reviewReady`, `approved` en `publicationReady` zijn verboden. Een geldige
uitvoer met prijsvarianten/supplementen/allergenen wordt als
`unsupportedProductFields` gemeld en niet stilzwijgend naar het concept
afgeplat. `src/lib/menuExtractionProtocol.js` laadt versie en SHA-256; een
ontbrekende of onversioned instructie geeft een concrete fout.

## Testmatrix

| Laag | Bewijs |
| --- | --- |
| HTML | bestaande structuurcorpus, geneste rubrieken, tabs/uitklappers, tabellen |
| PDF | tekstlaag, meerdere pagina's, geen tekstlaag, fallback, herkende secties |
| Prijs | één prijs, ontbrekend, meerdere/vanaf/op aanvraag als expliciete beperking |
| Receipt/concept | dezelfde menu's in samenvatting, detail en concept; geen stille afplatting |
| Onzekerheid | gegroepeerde rubriekonzekerheid; acceptatie geldt alleen voor die groep |
| Status | gevonden PDF + nul items is geen succes; bronbevestiging suggereert geen extractie |
| Veiligheid | SSRF, redirect, robots, promptinjectie, verkeerde vestiging, dubbele import |
| AI-offline | fake provider: geldig, ongeldig, timeout, budget, retry, geen netwerk |
| Regressie | `npm test`, `npm run test:menu-structure`, `npm run benchmark:menu-structure`, `npm run build` |

## Blokkades en eerlijke status

- Geen goedgekeurde backendprovider, providerconfiguratie, DPA/EU-retentie of
  kostenbudget: echte AI-calls worden niet gebouwd of geactiveerd.
- De twee openbare bronnen Smelt en Blossem zijn expliciet toegestaan en
  read-only geprobeerd; de bredere representatieve/ongeziene set en nieuwe
  externe toegang wachten op een apart besluit. De probes zijn geen
  productacceptatie.
- Er is een geïsoleerde lokale browserfixture zonder productiecredentials of
  -data; live staging-/productiebrowseracceptatie en echte schrijfacceptatie
  ontbreken nog.
- De service-worker-CLI bestaat, maar er is geen goedgekeurde scheduler of
  deployment die hem aanroept. Zonder die operationele beslissing blijft de
  browserpagina de zichtbare trigger; dat is een open acceptatiegat, geen
  automatische achtergrondclaim.

## Versiepinning

- Protocol: `MENU-EXTRACTION.md`, concept v0.3, SHA-256
  `a352effee402d8ccdbb8260aa21baabcfd2e8f8c160b36a1b21df36a430c2648`.
- Resultaatschema: `menu-extraction-result/v1`.
- Ticket: https://github.com/1am-it/menucard/issues/59
- Branch: `feat/menu-extraction-59`
- Acceptatiematrix en bewijs: `docs/guides/menu-extraction-acceptance-matrix.md`.
- Representatieve set en holdout: `ops/benchmark/menu-extraction-acceptance-set.json`.
- Verliesvrij v2-ontwerp (niet geïmplementeerd):
  `planning/architecture/menu-extraction-product-schema-v2.md`.
