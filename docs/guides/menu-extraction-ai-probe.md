# Route B — begrensde AI-proef (#59 / BE-21)

Status: **ontwikkelaarsbewijs. Geen betaalde aanroep, geen sleutel gebruikt, geen
app-activering en geen onafhankelijke review.** Budget en gegevensverwerking zijn
door de eigenaar goedgekeurd (2026-10-23); de ronde van Lead-order 6373183699
maakte de live-proef robuust, de ronde van order 6373786786 (M1-M4) maakt het
API-schema accepteerbaar, de foutdetails compleet en de time-out echt begrensd,
en de ronde van order 6374528099 (N1-N4) zet het denken uit en geeft de JSON de
uitvoerruimte. De ronde van order 6375125413 (Q1-Q5) bewaart het letterlijke
antwoord van elke aanroep, diagnosticeert een afgekeurd citaat offline en scherpt
de citatenregel in het protocol aan. De ronde van order 6375740447 (R1-R4) haalt
het itemaantal bij het model weg: de adapter telt zelf en stelt een te ruime
`complete`-status neerwaarts bij, zichtbaar per aanroep. De ronde van order
6376108648 (S1-S5) pakt de drie afkeuroorzaken van de eerste volledige live-run
aan: een ondubbelzinnige `sourceId:`-regel in de bronkop, een gedocumenteerde
gelijkstelling van typografische tekens, een ondubbelzinnige prijsvariantregel en
een diagnose per bron waarom een geaccepteerd item niet matcht. Alle rondes zijn
offline getest.

[Acceptatiematrix](menu-extraction-acceptance-matrix.md) |
[Implementatieafspraken](menu-extraction-implementation.md) |
[BE-21](../../planning/specs/tickets/be-21-restaurant-source-extraction-vendor-benchmark.md)

## Wat er nu ligt

| Onderdeel | Pad | Wat het doet |
| --- | --- | --- |
| Providercall | `src/lib/menuExtractionAnthropicCall.js` | Vult de bestaande `call`-interface met de officiële `@anthropic-ai/sdk` (exact `0.133.0`). Model `claude-haiku-5-5`, `thinking: {type: 'disabled'}`, protocol als `system`, bronnen als tekst- of `document`-blok, uitvoer via `output_config.format` (`json_schema`). Kosten alleen uit `usage`. |
| Prijstabel | idem, `ANTHROPIC_PRICING` | Vast en gedateerd: Haiku 5.5 $0,10/$0,50 per miljoen tokens tot 100.000 prompttokens, daarboven $0,50/$2,50 (Anthropic Pricing, 2026-10-22). USD 1:1 naar eurocent, naar boven afgerond. |
| Budgetlog | `src/lib/menuExtractionBudgetLedger.js` | Synchrone, atomisch geschreven ledger (`reserve`/`settle`) in een gitignored pad. 900 cent cumulatief, 30 cent per call, 40 calls, 1 tegelijk (ook over processen). |
| Beslisfunctie | `src/lib/menuExtractionRouteBDecision.js` | Route B alleen bij nul items, dekking onder 80% tegen een bekende referentie, `html_arrangements_skipped` of een PDF-layoutprobleem. Niet aan een app-route gekoppeld. |
| Boekhoudnormalisatie | `src/lib/menuExtractionNormalization.js` | R1/R2 van review 6375740447: de adapter telt de items zelf en stelt `complete` met limitations neerwaarts bij, vóór de ongewijzigde validator. Elke correctie staat als `normalizations`-regel in het rapport en de JSONL. |
| Mismatchdiagnose | `ops/benchmark/mismatchDiagnosis.js` | S4 van review 6376108648: verklaart per bron waarom een geaccepteerd item niet matcht (rubriekpad met menutitel of extra niveau, prijs, naamvariant, niet in de referentie, niet geëxtraheerd). Diagnose: geen telling of verdict verandert. |
| Proefharnas | `ops/benchmark/menuExtractionProbe.js`, `ops/benchmark/menuExtractionProbeSet.js`, `ops/scripts/run-menu-extraction-ai-probe.js` | Hash-geverifieerde gepinde captures, dry-run-raming, live meting met de ongewijzigde `compareControlledReference`, twee runs per bron. |

De app-runtime blijft **uit**: `disabledMenuExtractionRuntime` in
`app/api/internal/v1/restaurant-analysis-jobs/route.js` en
`src/lib/batchAnalysisRouteDeps.js` is niet aangeraakt. Er is geen koppeling
tussen deze modules en een gebruikersroute.

## Dry-run (standaard, geen sleutel en geen netwerk)

```bash
node ops/scripts/run-menu-extraction-ai-probe.js
node ops/scripts/run-menu-extraction-ai-probe.js --source=zuyd --runs=2
```

De dry-run leest uitsluitend de lokaal aanwezige gepinde captures, controleert
elke SHA-256 tegen het manifest, leest de tekst (HTML zichtbare tekst; PDF moet
een tekstlaag hebben) en schrijft `ops/benchmark/output/ai-probe-report.json`
(gitignored). Het rapport noemt per bron: aantal captures, aantal calls,
prompttokens per call, het outputplafond, de geschatte kosten (plafond en
typisch) en de referentieomvang. Dezelfde acht bronnen worden ook door de
dry-run gecontroleerd op document-, invoer- en budgetgrenzen.

Uitkomst op deze checkout (2026-10-23, na N2): 22 geplande calls, 44 eurocent
plafondraming in totaal en 22 eurocent typisch, alle acht bronnen leesbaar. Het
outputplafond is nu 32.000 tokens per call; de plafondraming stijgt daardoor van
22 naar 44 cent, de typische raming blijft 22 cent. Zie de matrix voor de tabel
per bron.

De PDF.js-melding `Ensure that the standardFontDataUrl API parameter is
provided` op de Smelt-PDF is een bestaande waarschuwing uit de ongewijzigde
PDF-module; de tekstlaag wordt wel uitgelezen (Smelt: 3.150 prompttokens). De
dry-run eindigt met exitcode 0.

## Live (pas na goedkeuring van budget en gegevensverwerking)

```powershell
$env:ANTHROPIC_API_KEY = "<sleutel die de eigenaar zelf aanmaakt>"
node ops/scripts/run-menu-extraction-ai-probe.js --live --budget-file=ops/benchmark/output/ai-probe-budget-ledger.json
```

Vereist en afgedwongen:

- `--live` is verplicht; zonder die vlag is het altijd een dry-run.
- `ANTHROPIC_API_KEY` moet in de omgeving staan. Ontbreekt de sleutel, dan
  blijft de adapter `provider_not_configured` en wordt er niets aangeroepen.
- `--budget-file` is verplicht en moet binnen `ops/benchmark/output/` (of buiten
  de repository) liggen, zodat een ledger nooit als tracked bestand ontstaat.
- De ledger wordt **vóór** iedere call afgedwongen. Bij `cost_unknown`,
  `budget_settle_failed` of een overschreden plafond stopt de run direct en
  blijven de cijfers in het rapport staan. Meer dan de helft schemafouten bij
  minimaal twee calls stopt de run ook.
- Exitcodes: `0` rapport geschreven, `1` runtime-/integriteitsfout, `2` een
  voorwaarde weigerde de run (geen sleutel, geen budgetbestand, buiten budget,
  ongeldig pad).

## Robuustheid van de live-run (ronde 2026-10-23, review 6373183699)

De eerste live-run deed 13 calls, waarvan 12 zonder `usage`; er stond niets per
call op schijf en de run stopte niet. Dat is in deze ronde gerepareerd.

| Eis | Wat er nu gebeurt | Bewijs |
| --- | --- | --- |
| L1 logging per aanroep | Na **elke** call één regel in `ops/benchmark/output/ai-probe-live-calls.jsonl` (gitignored, `--calls-file=` om te overschrijven). Velden: bron, run, chunk, callnummer, `reason`/foutcode, HTTP-status, `stop_reason`, `usage`, kosten, duur in ms, provider-request-id. Eén `O_APPEND`-write + fsync per regel; geen sleutel, geen headers, geen prompt. Het rapport wordt na elke call atomisch herschreven, dus een onderbreking verliest alleen de call die nog liep. | `ops/benchmark/aiProbeCallLog.js`, `aiProbeCallLog.test.js`, L4-tests in `ops/scripts/run-menu-extraction-ai-probe.test.js` |
| L2 lange antwoorden | De providercall gebruikt `messages.stream(...)` + `finalMessage()` (SDK 0.133.0; `lib/MessageStream.d.ts`), niet meer `messages.create`. De SDK-timeout begrenst alleen de fetch tot de responseheaders; de adaptertimer begrenst de hele generatie. Die timer staat nu op **180 s** (`PROBE_CALL_TIMEOUT_MS`), drie keer de oude 60 s en ruim binnen de SDK-default van 10 minuten. | `src/lib/menuExtractionAnthropicCall.js`, `L2`-tests |
| L3 stoppen | Stop direct als de kosten van een call onbekend zijn (time-out, providerfout, afbreken), en na twee opeenvolgende providerfouten/time-outs. De stopreden staat in `report.stop` en als `kind: "stop"`-regel in de JSONL. De schemafoutregel blijft ongewijzigd. | `evaluateStop` in `ops/benchmark/menuExtractionProbe.js`, L3/L4-tests |
| L5 ledger | `ai-probe-budget-ledger.json` is niet gewijzigd of gereset. De proef loopt verder binnen de resterende ruimte; onbekende kosten blijven de reservering belasten. | ongewijzigd bestand |

De live-run zelf is **niet** door de developer gedraaid: geen sleutel gelezen of
gebruikt, geen betaalde aanroep. De Lead draait die na de review.

## Werkruimte en sleutel (voor de eigenaar, nog niet uitgevoerd)

1. Maak in de Claude Console een **aparte werkruimte** voor deze proef.
2. Zet een **bestedingslimiet van $10** en **automatisch bijvullen uit**; gebruik
   alleen vooraf gekochte credits.
3. Maak daar een API-sleutel aan en zet die **alleen lokaal** in de
   omgevingsvariabele van de shell. Niet in de repo, niet in `.env.local`, niet
   in CI en niet in een workflow.
4. Bevestig de verwerkersovereenkomst en de retentie (maximaal 30 dagen) vóór de
   eerste call; dat is een eigenaarsbesluit, geen automatisme van deze code.
5. Trek de sleutel na de proef in en verwijder het budgetbestand niet: dat is
   het bewijs van de besteding.

Zonder stap 1–4 is er geen betaalde aanroep. Deze ontwikkelronde heeft geen
sleutel aangemaakt of gebruikt en geen account- of providerinstelling gewijzigd.

## M1-M4: schema, foutdetails en de time-out (Lead-order 6373786786)

Aanleiding: de live proef kreeg `400 invalid_request_error "Schema is too complex."`
op het schema uit `buildOutputJsonSchema()` (3339 bytes) en een eerdere aanroep
stopte na 60,2 s met `APIConnectionError "Connection error."` zonder één
stream-event, terwijl de proef 180 s toestaat.

### M1 — het schema voor `output_config`

Toegepaste regels, met bron **Structured outputs**
(`platform.claude.com/docs/en/build-with-claude/structured-outputs`, opgehaald
2026-10-23):

| Regel uit de documentatie | Wat hier is gedaan |
| --- | --- |
| "Simplify nested structures. Deeply nested objects with optional fields compound the complexity. Flatten structures where possible." | Bijna elk veld is nu **verplicht**. Optionaliteit daalt van 15 naar 4 velden: per item 9 → 3 (`priceVariants`, `supplementOf`, `availability`), per rubriek 2 → 0, per menu 2 → 0, per `rejected`-regel 1 → 1 (`text`). |
| "Remove unsupported constraints (for example, `minimum`, `maximum`, `minLength`, `maxLength`)"; "Add `additionalProperties: false` to all objects" | Alleen `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `anyOf` en `description` komen voor. Geen numerieke, lengte- of patroonkeyword. |
| "Claude receives a simplified schema, but a helper that validates responses still enforces every constraint in your code." | `validateStructuredOutput` blijft volledig en leidend. Op **waarden** is het API-schema losser (bijv. `amountMinorUnits` en `currency` zijn nullable, de validator eist een bedrag alleen bij `priceStatus: known`); op **aanwezigheid** is het strenger, en dat is veilig omdat de lege waarde (`[]`, `""`, `false`, `null`) altijd beschikbaar en zelf geldig is. |
| "optional fields compound the complexity" | De vier velden waar de validator *lege waarde noch null* accepteert, blijven optioneel: `priceVariants` (een aanwezige lijst eist `multiple_undecomposed`), `supplementOf`, `availability` en `rejected[].text`. |

Het schema is **3274 bytes** in plaats van 3339: de winst zit in de vorm
(minder present/afwezig-alternatieven per genest object), niet in de omvang.
Of de API het nu accepteert, is een **live** check van de Lead; deze ronde doet
geen aanroep.

Terugvalvariant: `--output-mode=prompt` (standaard `schema`). Die modus stuurt
**geen** `output_config`, zet hetzelfde schema één keer als data in het
instructieblok en laat het JSON-contract aan het protocol plus de validator.
De modus staat in het rapport en in elke JSONL-regel (`outputMode`); de dry-run
telt in `prompt`-modus de schematekst mee in de promptraming.

### M2 — foutdetails

Bij een fout bevatten de JSONL-regel en het rapport nu:

- `errorClass` — de SDK-foutklasse (`APIError`, `APIConnectionError`, `APIUserAbortError`, …);
- `errorType` — het API-fouttype (`invalid_request_error`, …);
- `errorMessage` — opgeschoonde melding, **maximaal 300 tekens**, witruimte
  genormaliseerd, `sk-…`/`x-api-key`/`authorization`/`bearer` geredigeerd;
- `requestId` — het provider-request-id;
- `errorCause` — de transportcode (`ECONNRESET`, `UND_ERR_SOCKET`, …), zodat een
  gesloten verbinding te onderscheiden is van een API-fout;
- `deadlineHit` — `true` als **onze** deadline de aanroep beëindigde.

Er worden nooit headers of een sleutel gelezen of opgeslagen; de bestaande
veldenweigerlijst van de call log blijft van kracht.

### M3 — welke time-out geldt

Vastgesteld, met bewijs per stap:

1. **De proef** geeft `PROBE_LIMITS.callTimeoutMs = 180000` door aan de adapter
   (`runBoundedProbe` → `runStructuredExtraction`), die de waarde overneemt in
   plaats van zijn eigen standaard (gemeten: een limiet van 1200 ms stopte na
   1203 ms; de `60_000` in `menuExtractionProtocol.js` is alleen de default).
2. **De adapter** wapent `timer(effective.callTimeoutMs)` — dus 180 s, geen 60 s.
3. **De client**: `@anthropic-ai/sdk` 0.133.0 heeft `DEFAULT_TIMEOUT = 600000`
   (10 minuten) en elke request krijgt expliciet `timeout: 180000` mee.
4. **De SDK-time-out** staat alleen om het wachten op responseheaders
   (`fetchWithTimeout` → `setTimeout(abort, ms)`), niet om de generatie.
5. **Onze module** bevat geen 60 s-constante (regressietest).

Conclusie: de 60,2 s-afsluiting kwam **niet** uit de SDK, de client, de
request-opties of een adapterlimiet — die lagen alle op 180 s of 600 s. Wat
overblijft is het verbindingspad buiten dit proces (provider-edge/netwerk), dat
de verbinding sloot terwijl er nog geen responseheader was. Dat is precies
waarom M1 het schema vereenvoudigt: een schema dat snel compileert, voorkomt dat
die wachttijd ontstaat.

Herstel in deze ronde: de providercall wapent nu **zelf** een harde deadline op
`limits.callTimeoutMs` (abort van stream én request, `reason: timeout`,
`deadlineHit: true`). De ingestelde proeflimiet geldt daarmee aantoonbaar op de
generatie, niet alleen op het wachten op headers. Bewijs (offline, echte SDK +
echte lokale socket, geen provider): een SSE-bron die **65 s** wacht met
responseheaders wordt zonder fout uitgelezen —
`RESULT ok elapsedMs=65137 menus=0 deadlineHit=false` in
`ops/benchmark/output/m3-slow-header-fixture.log` (script
`ops/benchmark/output/m3-slow-header-fixture.cjs`, beide gitignored). Een
60 s-afsluiting trad daar niet op. De eerste poging faalde op de fixture zelf
(de SSE-regels misten het `event:`-veld dat de SDK gebruikt); dat is een
fixturefout, geen time-out.

### M4 — regressies zonder netwerk

- `src/lib/menuExtractionAnthropicCall.test.js`: M1 (alleen gedocumenteerde
  keywords/types; optionaliteit exact vier velden; een maximaal
  validator-geldige uitvoer past; de validator blijft leidend), M1-modi
  (`prompt` zonder `output_config`, hetzelfde schema in de prompt, onbekende
  modus geweigerd), M2 (400 met klasse/type/melding/request-id,
  `APIConnectionError` met oorzaakcode, opschonen en 300 tekens), M3 (limiet
  komt aan als `options.timeout`, de deadline beëindigt een hangende generatie,
  de SDK-standaard is 600000, geen 60 s-constante).
- `ops/scripts/run-menu-extraction-ai-probe.test.js`: `--output-mode` parsen en
  weigeren, modus en foutidentiteit in rapport én JSONL.
- `ops/benchmark/aiProbeCallLog.test.js`: de nieuwe velden blijven binnen de
  whitelist; sleutel, header en prompt blijven geweigerd.

## N1-N4: denkbudget en uitvoerruimte (Lead-order 6374528099)

Aanleiding: twee live Zuyd-calls (5 captures, 12.143 inputtokens) stopten na
ongeveer 55 s met `stop_reason: max_tokens` bij een plafond van 16.000
uitvoertokens. `usage.output_tokens_details.thinking_tokens` was **9.776**; de
respons bevatte een `thinking`-blok en daarna een `text`-blok van **12.671
tekens** met correcte maar afgekapte menu-JSON. Het model dacht standaard na en
dat denken ging van `max_tokens` af. Kosten: 1 cent per aanroep.

### N1 — het denken uitzetten, met de officiële parameter

Het veld is `thinking` op de Messages-request. Bewijs, twee bronnen die op
elkaar aansluiten:

| Bron | Wat er staat |
| --- | --- |
| Geïnstalleerde `@anthropic-ai/sdk` **0.133.0** | `MessageCreateParams.thinking?: ThinkingConfigParam` (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:5355`); `ThinkingConfigDisabled = { type: 'disabled' }` (:3954-3955); `ThinkingConfigParam = ThinkingConfigEnabled \| ThinkingConfigDisabled \| ThinkingConfigBetweenTools \| ThinkingConfigAdaptive` (:3990). |
| Anthropic-documentatie, **Claude Haiku 5.5 — What's new**, sectie "Adaptive thinking and effort" (`platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5`, opgehaald 2026-10-23) | "Adaptive thinking is on by default. Although you can still turn thinking off with `thinking: {"type": "disabled"}` at `high` effort or below, the better way to trade response quality against speed and cost is to use the effort parameter." |
| Anthropic-documentatie, **Claude Haiku 5.5 overview** (zelfde datum) | "Context window: 1M tokens · Max output: 128K tokens"; thinking = "Adaptive"; default effort `medium`. |

De extractie-aanroep stuurt daarom expliciet `thinking: { type: 'disabled' }`
(`THINKING_CONFIG` in `src/lib/menuExtractionAnthropicCall.js`), in beide
uitvoermodi. Dat is het minimum dat de documentatie toestaat: het denken staat
uit in plaats van op een kleiner budget, en `effort` blijft ongemoeid. De
instelling staat in het rapport (`report.thinking`) en in de metadata van de
callmodule; de JSONL-regel bevat haar niet.

### N2 — `maxOutputTokens` onderbouwd

| Gegeven | Waarde | Bron |
| --- | --- | --- |
| Gemeten uitvoer vóór afkapping | 12.671 tekens JSON, `output_tokens` 16.000, waarvan 9.776 denken | live Zuyd-calls, Lead-diagnose |
| Nog nodig | ± 20.000 tekens JSON | Lead-schatting |
| Tokenschatting JSON | 20.000 / 3 ≈ 6.700, naar boven afgerond 8.000 | conservatief: JSON met accolades, quotes en prijzen zit dichter bij 3 dan bij 4 tekens per token |
| Gekozen plafond | **32.000** = 4 × 8.000, 2 × het oude plafond | `PROBE_LIMITS.maxOutputTokens` |
| Modelmaximum | **128.000** outputtokens (synchrone Messages API) | Claude Haiku 5.5 overview |
| Kosten bij het gemeten Zuyd-prompt | 12.143 in + 32.000 uit = $0,0172143 → **2 eurocent** | `ANTHROPIC_PRICING`, `estimateCostFromTokens` |
| Kosten in het slechtste geval binnen deze proef | 50.000 in (invoerlimiet) + 32.000 uit = $0,021 → **3 eurocent** | idem; ruim onder de 30 cent per call |

`maxDocuments` blijft **5**: het contextvenster (1M tokens) was nooit het
probleem, dus de chunkgrootte is niet aangepast. Referenties, telregels en
meetcode zijn ongewijzigd. Een plafond boven 128.000 wordt door
`buildAnthropicRequest` geweigerd (`input_limit`) in plaats van stil door de
provider ingekort.

### N3 — denktokens en bloktypen vastleggen

Per call staan nu in de JSONL-regel én in het rapport:

- `thinkingTokens` — `usage.output_tokens_details.thinking_tokens`, of `null`
  als de provider het niet meldde. `output_tokens` blijft het inclusieve,
  gefactureerde totaal; de som volgt uit de kostenregel en wordt niet dubbel
  geteld;
- `contentBlockTypes` — het type van elk inhoudsblok in volgorde, bijvoorbeeld
  `["thinking","text"]`. Nooit de tekst, nooit de signature.

Het rapport heeft daarnaast `thinking`, `thinkingSource` en in `totals`
`thinkingTokens` en `callsWithThinking`. De call log weigert nu expliciet de
velden `thinking`, `thinkingText` en `content`: de denktekst en de responsbody
kunnen de schijf niet bereiken, ook niet per ongeluk.

### N4 — regressies zonder netwerk

| Eis | Test |
| --- | --- |
| Het request bevat de denkinstelling | `menuExtractionAnthropicCall.test.js`: "N1: thinking is disabled in both output modes …" en de K1-requestassertie |
| `max_tokens` volgt de nieuwe limiet | idem (4000 uit `limits`, 128.000 op het modelmaximum, 128.001 geweigerd) en `menuExtractionProbe.test.js`: "N2: the output ceiling follows the measured JSON …" |
| `thinkingTokens` wordt vastgelegd | `menuExtractionAnthropicCall.test.js` (N3, ook bij `max_tokens`), `run-menu-extraction-ai-probe.test.js` (rapport + JSONL), `aiProbeCallLog.test.js` (whitelist en weigering van denktekst) |
| `thinking`-blok gevolgd door `text`-blok wordt gelezen | `menuExtractionAnthropicCall.test.js`: "N3: a thinking block before the JSON is read …", inclusief bewijs dat de denktekst en signature niet in het record staan |

Deze ronde bevat **geen** betaalde of echte aanroep, leest en gebruikt de sleutel
niet, wijzigt het ledger niet en koppelt niets aan de app. De 32.000-limiet en
het uitgezette denken zijn dus **ontwikkelaarsbewijs**: de Lead bevestigt ze met
een live-aanroep.

## Q1-Q4: letterlijke bewijscitaten (Lead-order review 6375125413)

Aanleiding: beide live Zuyd-aanroepen van ronde N1-N4 eindigden met `end_turn` en
werden daarna door de validator afgekeurd met `schema_violation`. Bijna alle
meldingen waren `evidence.quote is not present in the cited source`,
geconcentreerd in `menus[0].categories[3]`, plus een keer
`currency must be absent/null unless known`. In een eerder ruw antwoord voegde
het model regels samen tot een citaat met een zelfgekozen scheidingsteken
(`"Naam - beschrijving - 23,50"`) terwijl de bron die delen op aparte regels
heeft. De probe bewaarde de ruwe uitvoer niet, dus de exacte gevallen waren niet
meer te controleren. Deze ronde sluit die twee gaten: het antwoord blijft
bewaard, en de citatenregel is in het protocol zelf ondubbelzinnig.

### Q1 - de ruwe uitvoer bewaren

| Onderdeel | Invulling |
| --- | --- |
| Wat | het letterlijke `text`-blok van het antwoord, per aanroep |
| Waar | `ops/benchmark/output/ai-probe-raw/` (gitignored), override met `--raw-output-dir=<pad>` |
| Naam | `<bron>-r<run>-c<chunk>-call<n>-<sha256[0..12]>.json.txt` |
| Verwijzing | `report.calls[].rawOutputFile`, `rawOutputSha256`, `rawOutputChars` en dezelfde velden in de JSONL-regel |
| Schrijven | atomair (tijdelijk bestand + rename), idempotent bij gelijke inhoud, weigert een leeg, te groot of onveilig antwoord |

Alleen het `text`-blok wordt bewaard. Een `thinking`-blok, een signature, een
header, een sleutel en de prompt bereiken de schijf nooit; de denktekst blijft
buiten het record (N3) en de call log whitelist staat `answerText` niet toe. Een
antwoord zonder tekst (transportfout) schrijft geen bestand: dat wordt
`rawOutputFile: null`, geen verzonnen bewijs. Mislukt het schrijven, dan staat de
fout in `rawOutputError` en blijft het extractieresultaat ongewijzigd - de aanroep
is al gedaan en al belast.

### Q2 - diagnose per afgekeurd citaat

`ops/benchmark/quoteDiagnostics.js` (pure functies) en
`ops/scripts/diagnose-ai-probe-quotes.js` (offline CLI) geven per mislukt citaat:

- het citaat en het item (`menus[i].categories[j].items[k]`, menutitel, rubriek);
- de dichtstbijzijnde bronfragmenten, met capture-id, regelnummer, tekenoffset,
  een similarity-score en de tekst zelf;
- een classificatie: `added_separator` (alle delen staan in de bron, ook met
  spaties ertussen; alleen het scheidingsteken is verzonnen), `merged_lines`
  (delen bestaan, maar niet als een reeks), `changed_characters` (zelfde woorden,
  andere tekens zoals `6.50` vs `6,50`), `whitespace_only` (onzichtbare witruimte
  zoals een zero-width space) of `invented_text` (geen bronpassage). Een citaat
  dat een bron noemt die niet in de invoer zat, is `unknown_source` en wordt
  apart geteld, nooit als een van de vijf tekstklassen.

```bash
node ops/scripts/diagnose-ai-probe-quotes.js
node ops/scripts/diagnose-ai-probe-quotes.js --source=zuyd
node ops/scripts/diagnose-ai-probe-quotes.js --raw-file=ops/benchmark/output/ai-probe-raw/<bestand> --source=zuyd
```

De CLI verifieert elk antwoord tegen de opgeslagen SHA-256 voordat het iets
beweert, gebruikt alleen de captures die die aanroep werkelijk kreeg, schrijft
`ops/benchmark/output/ai-probe-quote-diagnosis.json` en doet geen netwerk- of
modelaanroep. Zonder bewaard antwoord meldt hij `answer_missing` in plaats van
te zwijgen.

### Q3 - de citatenregel in het protocol

`MENU-EXTRACTION.md` is bij deze ronde **v0.3** geworden (SHA-256
`a352effee402d8ccdbb8260aa21baabcfd2e8f8c160b36a1b21df36a430c2648`; de pin
staat inmiddels op v0.4, zie de S1-S5-ronde hieronder). Paragraaf 4
zegt nu expliciet dat een citaat een aaneengesloten, letterlijke tekstreeks uit
een bron is, bij voorkeur alleen de gerechtregel; nooit regels samenvoegen, nooit
een scheidingsteken toevoegen, en een prijs op een andere regel krijgt een eigen
passage of blijft onbewezen. Goed en fout staan als voorbeeld in het protocol.
De validator is **niet** versoepeld: `menuExtractionSchema.js` gebruikt dezelfde
normalisatie als voorheen (witruimte, waaronder een regeleinde, klapt samen tot
een spatie; tekens en volgorde moeten kloppen). Die normalisatie is als
`normalizeEvidenceText` en `quoteIsPresentInSource` geeexporteerd, zodat de
diagnose niet anders kan oordelen dan de validator.

### Q4 - meten ondanks afkeuring

Bij een afgekeurde uitvoer staat in het rapport en in de console:

- `rejected.items` - het aantal items in het afgekeurde antwoord;
- `rejected.itemsWithInvalidQuote` - items zonder bruikbaar citaat (ontbrekend,
  onbekende bron of niet in de bron gevonden), met `itemsWithQuoteNotFound`,
  `itemsWithoutQuote` en `itemsWithUnknownSource` als uitsplitsing;
- `rejected.classes` - de classificatie per citaat;
- `totals.rejectedOutputs`, `totals.itemsInRejectedOutputs`,
  `totals.itemsWithInvalidQuote`, `totals.answersSaved` en
  `totals.answersNotSaved`.

Een afgekeurde uitvoer telt **niet** als extractie: `actualItems` en `matched`
blijven 0, het antwoord komt niet in `menus` en dus niet in de vergelijking. Dit
is diagnose, geen acceptatie.

### Q5 - regressies zonder netwerk

| Eis | Test |
| --- | --- |
| Q1 bewaren en verwijzen | `ops/benchmark/aiProbeRawOutput.test.js` (naam, hash, idempotent, weigeringen, integriteit, mislukte rename) en `run-menu-extraction-ai-probe.test.js`: "Q1: the literal answer of a call is saved and referenced ..." |
| Q1 alleen tekst, nooit denktekst | `src/lib/menuExtractionAnthropicCall.test.js`: "Q1: the call record keeps the literal answer text and never the reasoning text", "Q1: a cut-off answer keeps the partial text", "Q1: a transport failure has no answer text" |
| Q2 classificatie en dichtstbijzijnde fragmenten | `ops/benchmark/quoteDiagnostics.test.js` (alle vijf klassen plus `unknown_source`, ontbrekend citaat, geen JSON, offsets/regels, fragmentatie) en `ops/scripts/diagnose-ai-probe-quotes.test.js` |
| Q3 protocolregel | `src/lib/menuExtractionProtocol.test.js` (versie 0.3, vaste hash, de regel moet in de tekst staan) |
| Q4 meten zonder tellen, validator streng | `run-menu-extraction-ai-probe.test.js`: "Q4: a rejected answer reports its items and invalid citations and still counts as zero extraction"; `menuExtractionAdapter.test.js`: "Q3/Q4: a citation that joins source lines with an added separator is rejected, and stays rejected"; `quoteDiagnostics.test.js`: "Q4: the diagnosis stays with the validator ..." |

Deze ronde bevat **geen** betaalde of echte aanroep, leest de sleutel niet,
wijzigt het ledger niet, versoepelt de validator niet en koppelt niets aan de
app. Alles hierboven is ontwikkelaars- en fixturebewijs; de Lead draait de
diagnose op de bewaarde live-uitvoer zodra die er is.

## R1-R4: afgeleide telling en conservatieve status (Lead-order review 6375740447)

Aanleiding: na Q1-Q5 waren beide live Zuyd-antwoorden inhoudelijk bruikbaar -
0 ongeldige citaten bij 52 en 23 items - maar afgekeurd op twee velden die het
model zelf invulde: `coverage.itemsExtracted` klopte niet en `complete` kwam
voor met een niet-lege `limitations`. Een taalmodel telt onbetrouwbaar; een
getal dat de code exact kan afleiden hoort niet van het model te komen.

| Eis | Invulling | Bewijs |
| --- | --- | --- |
| R1 afgeleide telling | `runStructuredExtraction` laat de ruwe uitvoer eerst door `applyDerivableNormalizations` (`src/lib/menuExtractionNormalization.js`) gaan: `coverage.itemsExtracted` wordt het werkelijke aantal items in `menus[].categories[].items[]`, **vóór** de validatie. Het veld staat niet meer in het provider-schema (`buildOutputJsonSchema()`, schema- én promptmodus), dus het model wordt er niet meer naar gevraagd. De backend-contractdefinitie en de validatorregel blijven ongewijzigd. | `src/lib/menuExtractionNormalization.test.js`, `menuExtractionAdapter.test.js` (R4), `menuExtractionAnthropicCall.test.js` (R1/R2) |
| R2 conservatieve status | Claimt het model `complete` en geeft het niet-lege `limitations` mee, dan stelt de adapter bij naar de eerstvolgende niet-complete status van het bestaande schema: `partial` (of `no_items` als er geen items zijn). Alleen naar beneden: `partial`, `no_items` en een schone `complete` blijven staan. | idem, plus de probe-regressie hieronder |
| R3 rapport en JSONL | Elke aanroep draagt `normalizations: [{rule, field, from, to, reason}]` in `report.calls[]` en in de JSONL-regel; het rapport heeft een `normalization`-kop (schemaversie + regels) en `totals.normalizationsApplied`. De console print elke toepassing als regel `genormaliseerd (niet stil): call ...`. De vergelijking met de referentie werkt op de geaccepteerde uitvoer zoals voorheen. | `run-menu-extraction-ai-probe.test.js`: "R3 ... report and the JSONL show the normalizations applied per call" |
| R4 regressies zonder netwerk | Een fout aantal wordt gecorrigeerd en de uitvoer is geldig; `complete` met limitations wordt bijgestuurd en vastgelegd; een ongeldig citaat blijft afgekeurd (de correctie redt het niet); de handmatige import (`manualMenuImportImport.js` valideert direct) verandert niet en de bestaande tests blijven groen. | `menuExtractionNormalization.test.js` (7 tests), 3 R4-tests in `menuExtractionAdapter.test.js`, 2 R3-tests in de probe-suite |

Wat deze ronde **niet** doet: geen echte of betaalde aanroep, geen sleutel, geen
wijziging aan het ledger, geen versoepeling van de validator, geen koppeling aan
de app, geen wijziging aan referenties, telregels of meetcode, geen andere
provider en geen publicatie of merge. Rapportversie is `1.3.0`. Een
`complete`-claim met ongebruikte bronnen wordt niet door de adapter bijgesteld;
die blijft een expliciete validatorafkeuring, zodat de correctie niet breder
wordt dan de bewezen telfout en de statusregel.

## S1-S5: bron-id, typografische tekens, prijsvarianten en diagnose (Lead-order review 6376108648)

Aanleiding: de eerste volledige live-run van de Lead (2026-10-24 00:3x, 17
aanroepen van ongeveer 1 cent per stuk, gestopt op het ledgerplafond) gaf drie
afkeuroorzaken die niets met de menukaart zelf te maken hebben:

- **S1** Smelt en Blossem: alle citaten `unknown_source`, omdat het model
  `"sourceId":"smelt-01.BRON"` schreef. De oude bronkop was één regel,
  `BRON smelt-01 | https://… | pdf`, met het label aan de id vast.
- **S2** Zuyd: afgekeurd op vier citaten waarin alleen het aanhalingsteken
  verschilde (`‘Catch of the day’` in de bron, `'Catch of the day'` in het
  antwoord).
- **S3** Pellens: twee keer afgekeurd op items met `priceVariants` én een
  `amountMinorUnits`, met een andere `priceStatus` dan `multiple_undecomposed`.

Daarnaast vroeg de Lead (**S4**) om per bron vast te leggen waaróm
geaccepteerde items niet matchen (Chocolat: 37 items, 0 matches) en (**S5**) om
regressies zonder netwerk.

### S1 - ondubbelzinnige bron-id

`sourceHeaderText` in `src/lib/menuExtractionAnthropicCall.js` schrijft de id nu
op een eigen regel, met de rest eronder in plaats van ernaast:

```text
sourceId: smelt-01
url: https://voorbeeld.example/menu.pdf
kind: pdf
pages: 3
```

De documenttitel van een PDF-bron is `sourceId: <id>` en niets anders. De
instructietekst bij de bronnen zegt expliciet dat de id letterlijk en volledig
wordt overgenomen, met `smelt-01.BRON` en `BRON smelt-01` als foute vormen, en
`MENU-EXTRACTION.md` paragraaf 4 zegt hetzelfde als vaste regel. Een id die niet
in de aangeleverde inventaris staat, blijft een validatorafkeuring: de
normalisatie accepteert niets extra.

### S2 - typografische tekens

`normalizeEvidenceText` in `src/lib/menuExtractionSchema.js` stelt uitsluitend
deze tekenklassen gelijk (Lead-besluit, bewust en gedocumenteerd):

| Varianten | Gelijk aan |
| --- | --- |
| `‘ ’ ‚ ′` | `'` |
| `“ ” „ ″` | `"` |
| `– —` | `-` |
| harde spatie (U+00A0) | gewone spatie |

Daarna blijven de bestaande regels gelden: witruimte (ook een regeleinde) klapt
samen tot één spatie, trimmen en kleine letters. **Elk ander verschil blijft
fout**: andere woorden, samengevoegde regels, een toegevoegd scheidingsteken, een
gewijzigd cijfer of een andere volgorde. De tabel staat als
`TYPOGRAPHIC_EQUIVALENTS` in de validator en wordt door de validator, de
citatendiagnose (`quoteDiagnostics`), de bewijsdekking in het rapport
(`evidenceCoverage`) en de handmatige import gebruikt - één regel, geen tweede
stille kopie. De rapportdekking gebruikt dezelfde normalisatie, zodat een citaat
dat de validator goedkeurt nooit als gat in het rapport verschijnt.

### S3 - prijsvarianten

Het protocol (paragraaf 4) en het API-schema zeggen nu dezelfde, enige
toegestane combinatie bij meerdere gedrukte prijzen:

- `priceVariants` gevuld met elke gedrukte prijs en het label uit de bron;
- `priceStatus` = `multiple_undecomposed`;
- `amountMinorUnits` en `currency` = `null`.

Goed en fout staan als voorbeeld in het protocol (`known` met een hoofdprijs
naast varianten is fout; een bedrag naast varianten is fout). In
`buildOutputJsonSchema()` dragen `priceStatus`, `amountMinorUnits`, `currency`,
`priceText` en `priceVariants` nu een korte `description` met die regel - tekst
alleen, geen extra constraint-keyword. De validator blijft leidend en de adapter
repareert geen prijzen.
### S4 - diagnose per bron (waarom matcht een geaccepteerd item niet?)

`ops/benchmark/mismatchDiagnosis.js` verklaart per bron de rijen die de
ongewijzigde vergelijking al als rubriekfout, prijsfout, gemist of verzonnen
telt. Het rapport krijgt `sources[].mismatchDiagnosis`
(`menu-mismatch-diagnosis/v1`) met de klassen `category_path`, `price`,
`name_variant`, `not_in_reference` en `not_extracted`, een uitsplitsing van het
padverschil (`menu_title`, `extra_level`, `other`) en de detailrijen. Het is
**diagnose**: geen match, geen telling en geen verdict verandert, en referenties,
telregels en meetcode zijn niet aangeraakt.

Uitkomst op de bewaarde antwoorden van de live-run (offline herspeeld met de
ongewijzigde vergelijking; geen nieuwe aanroep):

| Bron | Status | Items | Match | Rubriek | Verzonnen | Diagnose |
| --- | --- | --- | --- | --- | --- | --- |
| Chocolat (run 1, 2 calls) | geaccepteerd | 37 | 0 | 25 | 12 | 25x pad: 11x alleen de menutitel (`LUNCHKAART CHOCOLAT` → `Lunchkaart`), 14x een extra niveau (`Dinerkaart > À la carte > Voorgerechten` naast `DINERKAART CHOCOLAT > VOORGERECHTEN`); 1x naamvariant (`STEAK TARTARE` → `STEAK TARTARE 90 GRAM`); 11x een arrangement buiten de referentie (2/3/4-gangen, Chocolat Gastronomique 4-7 gangen EUR 65-95, lunch-/dinerarrangement EUR 59/89) |
| Andalous (run 1, 2 calls) | geaccepteerd | 99 | 82 | 3 | 14 | 3x extra rubriekniveau (`Menukaart > Visgerechten` naast `Menukaart > Warme voorgerechten > Visgerechten`); 2x naamvariant met een toevoeging in de naam (`(kindermenu)`, `(1 pers.)`, en `Hoofdgerechten*` in de referentie); 12x een Ramadan-aanbod dat niet in de referentie staat |

De Chocolat-uitkomst is dus **geen** bewijs dat de kaart niet gelezen is: 25 van
de 26 referentierijen zijn met naam en prijs gevonden, maar onder een ander
rubriekpad. De telregels blijven zoals ze zijn; dit is de verklaring, niet een
correctie. Voor Smelt en Blossem zegt deze herspeling niets over de kwaliteit:
hun antwoorden zijn afgekeurd (S1) en tellen als nul extractie.

### S5 - regressies zonder netwerk

| Eis | Test |
| --- | --- |
| S1 bronkop en documenttitel | `src/lib/menuExtractionAnthropicCall.test.js`: "S1: the source header names the exact id on its own line, so it cannot be glued to a label" |
| S1/S2/S3 in het protocol | `src/lib/menuExtractionProtocol.test.js`: versie 0.4, vaste hash, de drie regels moeten in de tekst staan |
| S2 gelijkstelling en de grens ervan | `src/lib/menuExtractionSchema.test.js` (curly/straight quotes, dubbele quotes, en/em-dash, prime, harde spatie; samengevoegd, verzonnen en gewijzigd cijfer blijven afgekeurd; de tabel mag alleen de gedocumenteerde tekens bevatten; een onbekende `sourceId` blijft afgekeurd) |
| S2 route B | `src/lib/menuExtractionAdapter.test.js`: "S2: a typographic quote is the same passage through the whole adapter, and a joined quote stays refused" |
| S2 handmatige import | `src/lib/manualMenuImport.test.js`: "S2: een typografisch citaat is dezelfde passage in de handmatige import" en "S2: een samengevoegd of verzonnen citaat blijft in de handmatige import afgekeurd" |
| S2 rapportdekking | `ops/benchmark/menuExtractionProbe.test.js`: de bewijsdekking telt met dezelfde normalisatie |
| S3 API-hint | `src/lib/menuExtractionAnthropicCall.test.js`: "S3: the API schema states the price-variant rule where the model reads it" |
| S3 validator blijft leidend | `src/lib/menuExtractionSchema.test.js`: de enige goede combinatie plus de twee live foutvormen van Pellens |
| S4 diagnose | `ops/benchmark/mismatchDiagnosis.test.js` (menutitel, extra niveau, ander pad, prijs, naamvariant, niet-in-referentie, niet-geextraheerd, geen verschil, en de Chocolat-vorm op de ongewijzigde vergelijking) en `ops/scripts/run-menu-extraction-ai-probe.test.js`: "S4: the report explains per source why an accepted item did not match, without touching a count" |

Wat deze ronde **niet** doet: geen echte of betaalde aanroep, geen sleutel, geen
wijziging of reset van het ledger, geen koppeling aan de app, geen wijziging aan
referenties, telregels of meetcode, geen andere provider en geen publicatie of
merge. Rapportversie is `1.4.0`; de acceptatieset staat op revisie `1.4.0`
(alleen de protocolpin is naar v0.4 verschoven). Wat deze ronde **niet bewijst**:
of S1-S3 de live-run nu wél laten slagen - dat moet de volgende live-run van de
Lead laten zien.

## Wat de proef meet

Per bron, met dezelfde referenties en telregels als #59 (ongewijzigde
`ops/benchmark/referenceComparison.js`):

- gemiste, verzonnen en gematchte gerechten;
- prijsfouten en prijsvarianten (aantal items met varianten, aantal varianten);
- rubriekfouten, plus een aparte **informatieve** telling waarbij alleen de
  gekozen menutitel verschilt (de officiële telling blijft de strikte);
- bewijsdekking: ieder citaat moet letterlijk in de aangeleverde brontekst
  staan (de validator eist dat al; het rapport telt het onafhankelijk na);
- werkelijke kosten uit `usage` per bron en in totaal;
- stabiliteit tussen de twee runs (identiek of Jaccard-percentage);
- dekking en eerlijke beperkingen: een bron zonder leesbare tekst, zonder
  tekstlaag of met een gewijzigde hash wordt `blocked` met de exacte reden.

## Wat begrensd blijft

- **Geen OCR en geen beeldmenu's.** Een PDF zonder tekstlaag wordt geblokkeerd
  met `pdf_no_text_layer`; afbeeldingsmenu's vallen buiten deze ronde.
- **Acht bronnen, geen benchmark.** Dit is bewijs voor de vervolgkeuze, niet de
  50–100-bronnenbenchmark van BE-21.
- **Smelt en Blossem** gebruiken de bestaande acceptatiereferenties uit
  `source-references.json`; die hebben geen citaten per regel. Hele en
  één-decimalige bedragen worden voor de vergelijking als eurocent gelezen,
  zonder het referentiebestand te wijzigen.
- **Menutitel.** Kiest het model een andere titel dan de referentie, dan telt dat
  in de officiële rubriekfout. De extra titel-telling maakt dat zichtbaar zonder
  de telregel te veranderen.
- **Geen automatische herhaling.** De SDK staat op `maxRetries: 0`; een time-out
  of 5xx blijft als mislukte call in het rapport staan en de reservering blijft
  belast. De eerdere proefopzet noemde één retry; die is in deze ronde bewust
  niet gebouwd.
- **Geen productiegebruik.** Geen app-route, geen database, geen publicatie,
  geen merge en geen onafhankelijke acceptatie.

## Bewijs bij deze ronde

- `npm test` (volledige suite) en `npm run build` zijn op de checkpoint-head
  gedraaid; de exacte aantallen staan in de checkpoint op PR #60.
- K1–K6-regressies: `src/lib/menuExtractionAnthropicCall.test.js`,
  `src/lib/menuExtractionBudgetLedger.test.js`,
  `src/lib/menuExtractionRouteBDecision.test.js`,
  `ops/benchmark/menuExtractionProbe.test.js`,
  `ops/benchmark/menuExtractionProbeSet.test.js`,
  `ops/scripts/run-menu-extraction-ai-probe.test.js`.
- L1–L5-regressies van deze ronde: `ops/benchmark/aiProbeCallLog.test.js`
  (logregel, weigeren van sleutel/header, partiële regel), de L1/L2-tests in
  `src/lib/menuExtractionAnthropicCall.test.js` (streamen, mislukte aanroep met
  en zonder `usage`, kosten nooit overnemen van de vorige call), de L3-tests in
  `ops/benchmark/menuExtractionProbe.test.js` (onbekende kosten, twee
  opeenvolgende providerfouten, time-out 180 s) en de L4-tests in
  `ops/scripts/run-menu-extraction-ai-probe.test.js` (time-out → stop,
  providerfout zonder usage → stop, één JSONL-regel per call, tussentijds
  rapport na een onderbreking, gestreamde usage → juiste kosten).
- De dry-run is op de acht gepinde captures gedraaid; de tabel staat in de
  matrix en in `ops/benchmark/output/ai-probe-report.json` (gitignored).
- M1-M4-regressies van deze ronde staan in `src/lib/menuExtractionAnthropicCall.test.js`,
  `ops/scripts/run-menu-extraction-ai-probe.test.js` en
  `ops/benchmark/aiProbeCallLog.test.js` (lijst hierboven). De M3-fixture met de
  echte SDK op een lokale socket staat bewust **niet** in de suite: 65 s per
  run, gitignored script, resultaat in `ops/benchmark/output/m3-slow-header-fixture.log`.
- Dit is **ontwikkelaarsbewijs en fixturebewijs**: geen betaalde aanroep, geen
  echte modeluitvoer, geen browseracceptatie en geen onafhankelijke review.
