# BE-21 — Restaurant Source Extraction: Vendor Benchmark (OCR & Browser-Rendering)

## Status

**Update (2026-09-28): a local, leverancier-neutrale benchmark
FOUNDATION exists on the isolated `be-21-benchmark-foundation`
worktree/branch — not the real benchmark this ticket describes, not
yet pushed, not yet independently reviewed.** `ops/benchmark/` now
holds a case/fixture manifest (the six mandatory real sources recorded
as metadata only, `fetched: false`, never fetched or scored; local
BE-20 fixtures; fictional `.invalid`-TLD synthetic fixtures covering
all six stratification categories), a provider-neutral adapter
contract (`deterministic` wraps BE-20's own unmodified pipeline;
`ai_structured`/`ocr` are deliberately unavailable stubs — no vendor,
no secret, no network call), a score model that always re-derives
confidence via BE-20's own `deriveFieldConfidence` (never trusts a
value an adapter claims), a fully offline and tested-reproducible
runner, and machine-readable/human-readable reporting that carries an
explicit "this is not the real benchmark" disclaimer in the report
body itself. This closes none of this ticket's own acceptance
criteria — no real source has been fetched, no vendor evaluated, no
DPA/cost-ceiling deliverable produced — it only gives the eventual real
benchmark run a manifest, contract, scorer, and report shape to plug
into rather than starting from nothing. See `ops/benchmark/README.md`
for the full, honest account of what exists and what does not.

Proposed; not started. Documentation/planning only — no benchmark run,
vendor account, API key, secret, billing profile, migration, route,
workflow, or Supabase change has been made for this ticket. The
sentence above described this ticket before the local foundation
above existed and no longer reflects the current local state (though
every one of its claims — no vendor account, no API key, no secret, no
migration/route/workflow/Supabase change — remains equally true of the
foundation itself).

## Voortgang

BE-21 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2a. Documentatiecommit lokaal gemaakt
- [ ] 2b. Documentatiecommit gepusht
- [ ] 3. Implementatie-readinessreview groen
- [x] 4. Lokale productcode gebouwd en getest — beperkt tot de
      leverancier-neutrale benchmarkfoundation (`ops/benchmark/`); de
      echte 50-100-bronnen-benchmark, vendorkeuze, DPA en kostenplafond
      zelf blijven volledig open, zie "Status" hierboven.
- [ ] 5. Onafhankelijke pre-commitreview groen
- [x] 6. Lokale codecommit gemaakt
- [ ] 7. Gecombineerde pre-pushreview groen
- [ ] 8. Code gepusht
- [ ] 9. Productiecontrole

Step 4 here means the isolated benchmark harness/scripts and their
recorded results, never product code reachable from `/internal/*` —
see "Non-goals" below. See `015-be-ticket-structure-and-time-boxing.md`
for what this checklist means and how it must be kept up to date.

## Depends on

`be-20-general-restaurant-source-extraction.md` — this ticket is the
separate, later step its own "Non-goals for fase 1" and "Suggested
order" sections name: the vendor benchmark, comparison, and choice for
OCR (scanned/complex PDFs) and browser-rendering (JavaScript-dependent
sites), never a fase-1 build step. Depends on fase 1 already having
real, working evidence to benchmark against — this ticket is not
dispatched cold, before BE-20 itself is live and producing real
`json_ld`/`html`/`pdf_text`/`ai_structured` results. Reuses BE-20's own
`extraction_method`, content-hash, and confidence-tier contract as the
common shape every benchmarked vendor's output is measured against —
never a second, competing data shape invented for this ticket alone.

## Problem

BE-20's fase 1 deliberately ships without OCR or browser-rendering —
scanned/image PDFs and JavaScript-dependent sites (e.g. Mr. Moos in the
practice set) are explicitly out of scope there. Choosing a vendor for
either capability — Google Document AI, Azure Document Intelligence, or
AWS Textract for OCR; Browserless, a comparable managed service, or
self-hosted Playwright for browser-rendering — without first measuring
real accuracy, cost, latency, and privacy posture against real
restaurant sources would repeat exactly the mistake this project's own
engineering discipline (`CLAUDE.md`) warns against: adopting an
external dependency on assumption rather than demonstrated fit. This
ticket is that measurement step, isolated from any product build.

## Vaststaande productkeuzes (decided — not open questions)

1. This ticket produces a **benchmark report and a vendor
   recommendation**, never a shipped integration. No OCR, Browserless,
   Playwright, or other vendor code is implemented here.
2. The benchmark set is 50–100 real, authorized-to-test restaurant
   sources, stratified across HTML-only, digital PDF, scanned/image PDF,
   chain/location pages, multilingual sources, and JavaScript-dependent
   sites. The six sources BE-20 already names are a **mandatory
   subset**, never a substitute for the full set:
   - `https://debotanistbreda.nl/`
   - `https://bobbisbar.nl/`
   - `https://www.gauchosgrill.nl/breda`
   - `https://mrmoos.nl/`
   - `https://demarktbreda.nl/`
   - `https://breda.colonie.nl/`
3. Measured per field (name, address, phone, opening hours, menu title,
   dish, price, allergen): accuracy against a manually-verified
   reference set, false-positive rate, source-evidence coverage (share
   of fields with a valid content-hash reference), median human
   correction time per concept, and cost/latency per analysis — each
   broken down by source type, never reported as one blended average
   that hides a weak source type.
4. OCR and browser-rendering are compared **only after** fase-1
   evidence exists to benchmark against — never spun up speculatively
   ahead of BE-20's own build.
5. No CAPTCHA-solving, login-wall bypass, or processing of access-
   controlled content is evaluated, tested, or scored as a capability —
   a vendor's ability to defeat these is explicitly never a selection
   criterion, regardless of benchmark score.
6. Vendor choice, the data processing agreement/privacy review, and the
   per-analysis budget decision are this ticket's own explicit
   deliverables — not deferred again to a later ticket.
7. The benchmark itself runs isolated: never against the production
   database, never through the live `/internal/*` UI, never writing a
   real `url_intakes`/`restaurant_profile_drafts` row.

## Benchmark design

- **Source set**: 50–100 sources, stratified as in "Vaststaande
  productkeuzes" §2/§3. Each source's authorization to test (public,
  no login/CAPTCHA involved) is confirmed before inclusion — never
  assumed.
- **Reference data**: a manually-verified ground truth per field per
  source, built once, independent of any vendor's own output, so every
  vendor is scored against the same standard.
- **Metrics per source type, per vendor**: field accuracy, false-positive
  rate, source-evidence coverage, human correction time (measured, not
  estimated), cost per analysis, latency per analysis.
- **Isolation**: a standalone benchmark harness (scripts and recorded
  results), never code reachable from `/internal/*`, never a change to
  BE-19/BE-20's own routes, migrations, or job contract.
- **Reporting**: one comparison table per capability (OCR; browser-
  rendering) across every vendor actually tested — no vendor is named
  "best" without the measured numbers next to it.

## Vendor selection and privacy review (this ticket's own deliverable)

For whichever vendor the benchmark recommends per capability, this
ticket's own completion requires, explicitly confirmed and recorded —
never assumed, never left implicit:

- A data processing agreement with that vendor.
- Its actual EU-processing configuration (must be explicitly configured
  and verified, never assumed default — Google Document AI, for
  instance, requires directing calls at its own EU regional endpoint;
  this is a per-vendor configuration to confirm, not a given).
- Its retention and no-training commitment for submitted content.
- A concrete, agreed per-analysis and per-batch cost ceiling for
  production use (extending, never duplicating, BE-20's own "Cost
  limits and stop behavior" shape).
- Secret handling on BredaEats' side: environment-scoped, never shared
  with the existing Supabase CI secrets (`SUPABASE_ACCESS_TOKEN`/
  `SUPABASE_PROJECT_ID`/`SUPABASE_DB_PASSWORD`/`SUPABASE_DB_URL`), never
  logged, never committed.

## Acceptance criteria

- [ ] A benchmark report exists covering all 50–100 sources (the six
      mandatory sources included), with per-field, per-source-type
      metrics for every vendor actually tested.
- [ ] No vendor is recommended without its own measured numbers shown
      alongside the recommendation.
- [ ] The report explicitly states cost, latency, and human-correction-
      time findings per source type — not a single blended figure.
- [ ] A DPA, EU-processing configuration, and retention/no-training
      commitment are each explicitly confirmed (or explicitly still
      pending, never silently assumed) for the recommended vendor(s)
      before this ticket is considered complete.
- [ ] A concrete per-analysis and per-batch cost ceiling is proposed and
      owner-confirmed.
- [ ] No product code, route, migration, or UI reachable from
      `/internal/*` was added or changed to run this benchmark.

## Wat #59 (review 6318225879) expliciet naar dit ticket verschuift

#59 heeft vijf gecontroleerde referenties (Zuyd, Andalous, Pellens, Chocolat en
het geblokkeerde Senang Makan) en een deterministische meting van gemiste,
verzonnen, prijs- en rubriekfouten opgeleverd. Dat is **geen** afsluiting van
BE-21 en geen brede benchmark. Expliciet naar dit ticket verschoven, zonder iets
stil te schrappen:

1. **De brede, onafhankelijke benchmark over 50–100 bronnen**, inclusief de zes
   verplichte bronnen en de per-brontype uitsplitsing.
2. **Een nieuwe, nog ongeziene holdoutset.** De vijf #59-referentiebronnen zijn
   bekend en juist bedoeld om op bij te sturen; ze zijn geen holdout.
3. **De OCR-/browser-rendering-vendorvergelijking** met gemeten kosten, latency
   en kwaliteit per vendor, plus DPA, EU-verwerking, retentie/no-training en een
   owner-bevestigd kostenplafond.
4. **Menselijke correctietijd en kosten per brontype** over de bredere set; #59
   meet alleen de deterministische analysetijd en heeft geen providerkosten.
5. **De echte scan-/afbeeldingsklasse op schaal.** #59 levert de expliciete
   “menu alleen als afbeelding: niet ondersteund”-status en een werkende
   menselijke route, maar geen echte afbeeldingsbron of OCR-meting.
6. **Keten-/vestigingsvariatie, meertaligheid en arrangementen op schaal** buiten
   de vijf #59-bronnen.

Een vendor wordt in dit ticket nog steeds niet aanbevolen zonder de gemeten
cijfers ernaast. #59's vijf bronnen sluiten de 50–100-bronnenbenchmark niet af.

## Voorstel begrensde AI-proef (2026-10-22) — NEEDS_APPROVAL

Opgesteld door de Delivery Lead (Claude Code). Uitvoering door DeepSeek.
**Besluit Product Owner 2026-10-23: provider en model goedgekeurd: Anthropic
Claude API, `claude-haiku-5-5` ("gebruik claude").** De automatische route (B) mag
worden gebouwd en getest zonder betaalde aanroepen. De vergelijkingsarm met
`claude-sonnet-5-5` vervalt tot de eigenaar die apart vraagt.

**Besluit Product Owner 2026-10-23 (vervolg, "akkoord 1 en 2"): budget en
gegevensverwerking goedgekeurd.**
1. **Proefbudget: US$ 10, hard**, afgedwongen op drie niveaus:
   - de eigen Anthropic-werkruimte met een bestedingslimiet van $10, automatisch bijvullen uit en alleen vooraf gekocht tegoed;
   - de budgetlog van de proef met een cumulatief plafond van 900 eurocent;
   - per aanroep maximaal 30 eurocent, hooguit 40 aanroepen en 1 tegelijk.
2. **Gegevensverwerking:** alleen openbare menu-inhoud van toegestane bronnen, geen training op API-gegevens, bewaring maximaal 30 dagen en globale routering. Geen persoonsgegevens en geen productiedata.

**Nog open:** de API-sleutel, die de eigenaar zelf aanmaakt en alleen lokaal en gitignored neerzet. Daarna draait de Lead de live proef (`docs/guides/menu-extraction-ai-probe.md`) op de gepinde captures. Geen productieactivering, geen app-koppeling en geen andere provider of fallback.

**Besluit Product Owner 2026-10-24 ("akkoord 1"): tweede aanroepteller voor de herhaalde live-proef.**
De eerste live-reeks (2026-10-23/24) bereikte het plafond van 40 aanroepen. Die reeks bevat de diagnoseaanroepen; de werkelijke kosten waren ongeveer 1 eurocent per aanroep, terwijl het ledger aanroepen met onbekende kosten conservatief op 30 eurocent boekt. Dat ledger is ongewijzigd bewaard als `ops/benchmark/output/ai-probe-budget-ledger.run1.json`. Er komt één nieuwe teller met dezelfde grenzen: 40 aanroepen, 30 eurocent per aanroep, 1 tegelijk en cumulatief 900 eurocent. Het harde plafond blijft de $10-limiet van de Anthropic-werkruimte; er komt geen nieuw tegoed bij en automatisch bijvullen blijft uit.

**Besluit Product Owner 2026-10-24 ("akkoord mockup", "ok akkoord"): route B als hulpmiddel in de app.**
Uitkomst van live-run 2: 22 aanroepen, 23 eurocent. Gevonden: 265 van 407 gerechten; zonder Bardot 265 van 295 (90 %). Er waren 2 prijsfouten, het bewijs was 100 % geverifieerd en de tweede run was instabiel.
1. Lukt deterministisch lezen niet, dan kan de beheerder op "Lees met AI" klikken. Claude maakt dan een **concept** dat door het bestaande nalopen-scherm gaat. Er is nooit automatische publicatie.
2. Visuele referentie: de mockup "Automatisch menu uitlezen met AI" (3 schermen; https://claude.ai/artifact/Na8DHfPQfFHC3MACJg5J6y, versie 5), met twee aanpassingen:
   - benoemde prijsvarianten (bijvoorbeeld glas/karaf) zijn direct geldig en hoeven niet nagelopen te worden;
   - de keuze bij een ontbrekende prijs heet "Prijs onbekend".
3. Maandbudget voor de app: US$ 10, zichtbaar als "AI deze maand". Productie krijgt een aparte API-sleutel. Die wordt pas bij de vrijgave aangemaakt en in Vercel gezet; zonder sleutel blijft de functie uit.

**Besluit Product Owner 2026-10-24 ("1 en 5 !"): concept vergelijken met de originele kaart.**
Visuele referentie: de mockup "Automatisch menu uitlezen met AI", versie 11, met de schermen "Variant 1 · Niet overgenomen" en "Variant 5 · Originele kaart met markeringen".
1. **Variant 1** komt eerst. Een deterministische en gratis vergelijking toont de regels met een prijs uit de bron die bij geen enkel gerecht in het concept horen, als lijst met de keuzes "Toevoegen" en "Geen gerecht".
2. **Variant 5** volgt daarna. In het nalopen-scherm wissel je tussen Lijst en Kaart. De kaartweergave toont de originele kaart met markeringen: groen voor overgenomen, oranje voor niet overgenomen en rood voor afwijkend. Bij een PDF is dat de echte pagina, bij een website de opgehaalde tekst. "Bekijk op kaart" opent die weergave op de juiste regel.
3. Variant 2 vervalt. Variant 3 (wijzigingen bij opnieuw lezen) en variant 4 (tweede AI als controleur) zijn niet besloten.

**Lead-acceptatie 2026-10-24: "Lees met AI" en de kaartvergelijking (variant 1 en 5), lokaal getest in de praktijk.**
- Categorie: echte praktijk, lokaal. Gebruikt zijn de echte app (`next dev`, head 7001661), de lokale Supabase op loopback, de echte Anthropic-sleutel met `MENU_AI_FALLBACK_ENABLED=true`, en een sessie als INTERNAL. Bron: Restaurant Blossem.
- Run 1 (head bab93bb): 52 gerechten, maar alle 52 "niet op te slaan" door een leeg allergenenobject. Dat is hersteld in BB1 (81b6650).
- Run 2 en 3 (head 7001661): 52 gerechten, 40 en 45 "in orde", 12 en 7 "nalopen". De nalooppunten zijn terecht: stukprijzen, arrangementen en "p.p."-prijzen. De duur was 31-34 s en de kosten 1 eurocent per lezing; "AI deze maand" werkt mee.
- Kaartweergave: 43 prijsregels, alle 43 overgenomen, 0 gemist.
- Totale kosten van de praktijktest: 4 aanroepen, ongeveer 4 eurocent.
- Bekende grenzen:
  - de uitkomst verschilt per run (40 of 45 in orde);
  - een website wordt getoond als opgehaalde tekst, inclusief cookieteksten;
  - een PDF wordt getoond als tekst, omdat de bytes niet worden bewaard;
  - een kaart die alleen uit een afbeelding bestaat, wordt niet gelezen;
  - Bardot blijft open.
- Niet getest: productie of Vercel. Daarvoor zijn een aparte sleutel, migratie 0020 en de merge nodig; dat zijn eigenaarsacties.

**Oorspronkelijke status: NEEDS_APPROVAL.** Er wordt niets betaald, geen account aangemaakt en
geen sleutel gebruikt totdat de Product Owner provider/model, budget en
gegevensverwerking expliciet goedkeurt. Deze proef levert gemeten cijfers voor
dit ticket. Het is geen productieactivering en geen definitieve vendorkeuze.

### Wat al bestaat (geverifieerd in de code)

| Onderdeel | Pad | Stand |
| --- | --- | --- |
| Extractieprotocol | `MENU-EXTRACTION.md` (repo-root, v0.2, "niet actief") | Klaar; wordt met hash geladen door `src/lib/menuExtractionProtocol.js` |
| Providerneutrale adapter | `src/lib/menuExtractionAdapter.js` | Klaar: limieten, verplicht kostenplafond (`null` = weigeren), synchrone budgetreservering/-afrekening, time-out met annulering, schemavalidatie, verbod op `confidence`/`reviewReady` |
| Uitvoerschema en validator | `src/lib/menuExtractionSchema.js` | Klaar; elk veld met `sourceId`, `locator`, `quote`; quote wordt tegen brontekst getoetst |
| Runtime-hook | `src/lib/menuExtractionRuntime.js` | Klaar, overal uitgeschakeld (`disabledMenuExtractionRuntime` in `app/api/internal/v1/restaurant-analysis-jobs/route.js` en `src/lib/batchAnalysisRouteDeps.js`) |
| Standaardlimieten | `DEFAULT_EXTRACTION_LIMITS` | 60 s/call, 180 s/job, 50.000 in-, 10.000 uittokens, 5 documenten, 30 pagina's, 1 retry, 1 tegelijk |
| Benchmarkadapter | `ops/benchmark/adapters.js` (`ai_structured`) | Bewust uitgeschakelde stub |
| Referentiemeting | `ops/scripts/measure-menu-extraction-references.js`, `ops/benchmark/referenceComparison.js` (`compareControlledReference`) | Klaar, gepinde telregels |

**Gevonden tegenstrijdigheden (niet als waarheid overgenomen):**
- `docs/guides/menu-extraction-readiness.md` noemt `src/lib/claudeStructuringAdapter.js`
  "vervangen", maar die oude BE-20-grens wordt nog aangeroepen in
  `src/lib/restaurantSourceAnalysis.js`. Hij faalt altijd gesloten. De proef
  gebruikt hem niet en verandert hem niet; opruimen is apart werk.
- Dit ticket zegt dat er geen vendor wordt aanbevolen zonder een
  50–100-bronnenmeting. Deze proef is kleiner. Ze levert daarom alleen
  gemeten bewijs voor de vervolgkeuze, geen productieaanbeveling.
- De acceptatiematrix van #59 markeert criterium 5 als "begrensd" terwijl het
  besluit van de Product Owner nog openstaat.

### Wat nog ontbreekt (bouwwerk voor DeepSeek na akkoord)
1. **Providercall** als kleine module die de bestaande `call`-interface vult
   (bijvoorbeeld `src/lib/menuExtractionAnthropicCall.js`) met de officiële
   `@anthropic-ai/sdk`, alleen server-side. Protocol als `system`, bronnen als
   tekst-, PDF- of afbeeldingsblokken, uitvoer via structured outputs
   (`output_config.format`) op het bestaande schema, en de `signal` doorgeven.
2. **Kostenafrekening uit `usage`** met een vaste, gedateerde prijstabel in de
   code, zodat `costEurCents` exact wordt gezet. Een onbekende kost blijft
   "onbekend", nooit nul.
3. **Synchrone, persistente budgetlog** voor de proef, die `reserve`/`settle`
   van de adapter invult, met het proefplafond hieronder.
4. **Beeldbronnen**: de validator toetst een quote alleen tegen tekst. Bij een
   afbeelding is de quote een transcriptie die niet automatisch te controleren
   is. Die velden worden gemarkeerd als "visueel bewijs, menselijke controle
   verplicht".
5. **Benchmarkkoppeling**: de `ai_structured`-adapter vullen voor gepinde
   captures, de AI-uitvoer omzetten naar de vorm die
   `compareControlledReference` verwacht, en meten met dezelfde referenties en
   telregels.
6. **Geen productkoppeling**: de runtime blijft in de app uitgeschakeld. De proef
   draait uitsluitend als ops-script in de geïsoleerde omgeving, in een aparte
   branch en PR (#59-contract, bouwvolgorde stap 3), zodat #59 los kan worden
   gemerged.

### Stand van de bouw (2026-10-23, DeepSeek-ronde review 6370840673)

Punten 1, 2, 3 en 5 zijn gebouwd en offline getest. Punt 6 blijft ongewijzigd van
kracht: geen app-route, geen activering, alleen een ops-script. Punt 4
(beeldbronnen) is **niet** gebouwd; deze ronde stuurt tekst en blokkeert een PDF
zonder tekstlaag met `pdf_no_text_layer` in plaats van OCR te suggereren.

| Onderdeel | Pad | Stand |
| --- | --- | --- |
| Providercall | `src/lib/menuExtractionAnthropicCall.js` | Gebouwd; SDK exact `0.133.0`, model `claude-haiku-5-5`, protocol als `system`, `output_config.format` op het bestaande schema, `signal`, `maxRetries: 0`. Zonder `ANTHROPIC_API_KEY` uit. |
| Kosten uit `usage` | idem (`ANTHROPIC_PRICING`) | Gebouwd; vaste prijstabel 2026-10-22, USD 1:1 naar eurocent naar boven afgerond; onbekende kost blijft `null`/`cost_unknown`. |
| Budgetlog | `src/lib/menuExtractionBudgetLedger.js` | Gebouwd; synchroon, atomisch, met slot; 900 cent cumulatief, 30 per call, 40 calls, 1 tegelijk. |
| Beslisfunctie | `src/lib/menuExtractionRouteBDecision.js` | Gebouwd; alleen bij nul items, dekking onder 80%, `html_arrangements_skipped` of een PDF-layoutflag. Niet aan een route gekoppeld. |
| Proefharnas | `ops/scripts/run-menu-extraction-ai-probe.js` | Gebouwd; dry-run is standaard, `--live` vereist sleutel en expliciet budgetbestand, meet met de ongewijzigde `compareControlledReference`, twee runs per bron. |
| Documentatie | `docs/guides/menu-extraction-ai-probe.md`, #59-matrix | Bijgewerkt met werkruimte ($10, automatisch bijvullen uit), sleutel lokaal, commando's, grenzen en de dry-run-tabel. |

**Dry-run (geen netwerk, geen sleutel, 2026-10-23):** alle acht gepinde
captures zijn hash-geverifieerd en leesbaar; 22 geplande calls (twee runs per
bron, grotere sets in twee calls wegens de documentlimiet van 5); 22 eurocent
plafondraming in totaal, 4 cent voor de duurste bron. Zuyd, Andalous en Chocolat
hebben meer dan vijf captures en worden daarom per run in twee calls verstuurd.

**Afwijking van de oorspronkelijke proefset hierboven:** de vergelijkingsarm met
`claude-sonnet-5-5` is volgens het eigenaarsbesluit van 2026-10-23 vervallen en
het beeldmenu De Beyerd hoort niet bij deze acht gepinde bronnen. Deze ronde
gebruikt één model en acht bronnen; de 50-100-bronnenbenchmark blijft open.

**Nog niet gedaan:** een betaalde of echte aanroep, het aanmaken of gebruiken
van een sleutel, het akkoord op budget en gegevensverwerking, de live proef, de
onafhankelijke review en enige productieactivering.

### Voorstel: provider, model en ondersteuning
- **Provider:** Anthropic, Claude API (first-party).
- **Model:** `claude-haiku-5-5` als proefmodel. Daarnaast één vergelijkingsarm
  met `claude-sonnet-5-5` op exact dezelfde bronnen, om te zien of de 20x
  hogere prijs aantoonbaar betere extractie oplevert. Bron: Anthropic Models
  overview (geraadpleegd 2026-10-22). Haiku 5.5 is daar omschreven als model
  "for high-volume, latency-sensitive tasks such as classification,
  extraction"; alle huidige modellen ondersteunen tekst- en beeldinvoer.
- **Tekst:** HTML-tekst en tekst-PDF (PDF als documentblok, of de bestaande
  PDF-tekstextractie).
- **Beeld:** menu's als foto of scan (JPEG/PNG/WebP). Modellen vanaf
  Claude 4.7 lezen in hoge resolutie: maximaal 2.576 px op de lange zijde,
  ten hoogste 4.784 beeldtokens per afbeelding.
- **Gestructureerde uitvoer:** structured outputs op het bestaande schema. De
  eigen validator blijft daarnaast leidend.

### Verwachte kosten per menu (officiële prijzen, USD, 2026-10-22)
Prijzen: Haiku 5.5 $0,10 per miljoen inputtokens en $0,50 per miljoen
outputtokens (prompts tot 100.000 tokens); Sonnet 5.5 $2 / $10. Bron: Anthropic
Pricing. Denkstappen tellen als outputtokens.

| Situatie | Tokens (in / uit) | Haiku 5.5 | Sonnet 5.5 |
| --- | --- | --- | --- |
| Typisch tekstmenu | ~20.000 / ~8.000 | ~$0,006 | ~$0,12 |
| Beeldmenu, 4 pagina's | ~24.000 / ~10.000 | ~$0,007 | ~$0,15 |
| Plafond per call (50.000 / 16.000) | — | $0,013 | $0,26 |

### Proefbudget en harde stopgrenzen
- **Proefset:** de gepinde captures van Zuyd, Andalous, Pellens en Chocolat,
  Smelt (PDF) en Blossem, plus één echt beeldmenu (De Beyerd, alleen via de
  bestaande veilige route en robots.txt). Per bron 2 runs (stabiliteit) × 2
  modellen = maximaal 28 calls.
- **Verwachte totale kosten:** onder $5 (Haiku ≈ $0,20; Sonnet ≈ $4).
- **Proefplafond:** **$10**, hard op drie niveaus:
  1. een eigen Console-workspace voor deze proef met een **spend limit van $10**,
     **auto-reload uit**, en alleen vooraf gekochte credits;
  2. de budgetlog van de adapter stopt bij **900 eurocent cumulatief** (USD 1:1
     gerekend, dus conservatief) vóór de workspace-limiet;
  3. per call `maxCostEurCents: 30`, maximaal 40 calls in totaal, 1 tegelijk,
     1 retry alleen bij time-out, rate limit of 5xx. Voor de proef gaat
     `maxOutputTokens` van 10.000 naar 16.000, omdat denkstappen meetellen.
     Alle andere standaardlimieten blijven gelijk.
- **Directe stop** bij `cost_unknown`, `budget_settle_failed`, een schemafout
  boven de 50% van de calls, of elke poging tot een niet-gepinde bron.
- **Geen** Batch API, Files API, betaalde fallback, providerwissel of automatische
  opwaardering.

### Privacy en retentie
- **Gegevens:** alleen openbare menu-inhoud van de toegestane bronnen. Geen
  gebruikers- of accountgegevens, geen productiedata.
- **Training:** volgens Anthropic worden API-gegevens niet voor training
  gebruikt zonder uitdrukkelijke toestemming (API and data retention,
  geraadpleegd 2026-10-22).
- **Retentie:** de developerdocumentatie zegt dat prompts en uitvoer standaard
  niet worden bewaard, behalve bij "Covered Models" (Fable/Mythos, die hier niet
  gebruikt worden). Het privacy center zegt dat inputs en outputs binnen 30
  dagen worden verwijderd. Deze twee bronnen zijn niet identiek; de proef gaat
  uit van **maximaal 30 dagen**. ZDR is alleen via sales en is voor deze proef
  niet nodig.
- **Verwerkingslocatie:** de first-party API kent alleen `inference_geo`
  `"global"` (standaard) of `"us"` (1,1x prijs), en workspace-opslag is `"us"`.
  **EU-only verwerking kan niet via de first-party API.** Is EU-verwerking een
  harde eis, dan is het alternatief Claude via Google Cloud in een EU-regio
  (partner-operated, Google als verwerker, eigen prijzen, met een
  regiotoeslag). Dat vraagt een Google Cloud-account en is dan een aparte keuze.
- **Verwerkersovereenkomst (DPA):** te bevestigen bij het aanmaken van het
  account, vóór de eerste call. Wordt niet aangenomen.
- **Sleutel:** alleen in de gitignored lokale proefomgeving, nooit in de repo,
  de app, CI of productie. Na de proef wordt de sleutel ingetrokken.

### Meting en acceptatie van de proef (door de Lead, onafhankelijk)
Per bron en model, met dezelfde referenties en telregels als #59: gerechten
(match, gemist, verzonnen), prijzen en prijsvarianten, rubrieken,
bewijsdekking (quote aantoonbaar in de brontekst, of visueel en gemarkeerd),
schemafouten, stabiliteit tussen de twee runs, en **werkelijke kosten uit
`usage`**, naast de deterministische extractie van #59. Geen
productieconclusie zonder deze cijfers. Een protocolbestand is geen garantie
op juiste AI-uitvoer.

### Benodigde goedkeuring van de Product Owner
1. Provider en model: Anthropic Claude API, `claude-haiku-5-5`, met
   vergelijkingsarm `claude-sonnet-5-5`.
2. Proefbudget: $10 hard (workspace-limiet, auto-reload uit).
3. Gegevensverwerking: openbare menu's via globale routing (geen EU-only),
   geen training, retentie maximaal 30 dagen; of in plaats daarvan de
   EU-variant via Google Cloud.
4. Accountactie door de eigenaar: een Console-workspace met spend limit en een
   API-sleutel, gedeeld via de lokale gitignored proefomgeving.

Bronnen: [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview),
[Pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Vision](https://platform.claude.com/docs/en/build-with-claude/vision),
[Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency),
[API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention),
[Commerciële retentie](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data),
[Workspaces en spend limits](https://support.claude.com/en/articles/9796807-create-and-manage-workspaces-in-the-claude-console),
[Betaling en auto-reload](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage).

## Non-goals (explicitly out of scope)

- Implementing OCR, Browserless, self-hosted Playwright, or any other
  vendor integration in product code.
- Any change to BE-19's or BE-20's own migrations, routes, job contract,
  or UI.
- Any CAPTCHA-solving, login-wall bypass, or access-controlled-content
  processing capability — never evaluated, never scored, never built.
- A second, competing extraction data shape — this ticket measures
  against BE-20's own `extraction_method`/content-hash/confidence
  contract, never invents a parallel one.

## Suggested order

1. This ticket's own documentation commit, made and pushed, once BE-20
   itself is live and producing real fase-1 results to benchmark
   against.
2. An independent, read-only implementation-readiness review of the
   benchmark design above.
3. The isolated benchmark harness and run, against the 50–100-source
   set, entirely separate from the production database and the live
   `/internal/*` UI.
4. The benchmark report, vendor recommendation, and the privacy/cost
   deliverables in "Vendor selection and privacy review" above.
5. Only after this ticket is complete and its deliverables are
   owner-confirmed: a separate, later, explicitly-scoped ticket to
   actually build the chosen OCR/browser-rendering integration — not a
   phase of this ticket either.
