# Route B — begrensde AI-proef (#59 / BE-21)

Status: **ontwikkelaarsbewijs. Geen betaalde aanroep, geen sleutel gebruikt, geen
app-activering en geen onafhankelijke review.** Budget en gegevensverwerking zijn
door de eigenaar goedgekeurd (2026-10-23); deze ronde (Lead-order 6373183699)
maakt de live-proef robuust en test dat offline.

[Acceptatiematrix](menu-extraction-acceptance-matrix.md) |
[Implementatieafspraken](menu-extraction-implementation.md) |
[BE-21](../../planning/specs/tickets/be-21-restaurant-source-extraction-vendor-benchmark.md)

## Wat er nu ligt

| Onderdeel | Pad | Wat het doet |
| --- | --- | --- |
| Providercall | `src/lib/menuExtractionAnthropicCall.js` | Vult de bestaande `call`-interface met de officiële `@anthropic-ai/sdk` (exact `0.133.0`). Model `claude-haiku-5-5`, protocol als `system`, bronnen als tekst- of `document`-blok, uitvoer via `output_config.format` (`json_schema`). Kosten alleen uit `usage`. |
| Prijstabel | idem, `ANTHROPIC_PRICING` | Vast en gedateerd: Haiku 5.5 $0,10/$0,50 per miljoen tokens tot 100.000 prompttokens, daarboven $0,50/$2,50 (Anthropic Pricing, 2026-10-22). USD 1:1 naar eurocent, naar boven afgerond. |
| Budgetlog | `src/lib/menuExtractionBudgetLedger.js` | Synchrone, atomisch geschreven ledger (`reserve`/`settle`) in een gitignored pad. 900 cent cumulatief, 30 cent per call, 40 calls, 1 tegelijk (ook over processen). |
| Beslisfunctie | `src/lib/menuExtractionRouteBDecision.js` | Route B alleen bij nul items, dekking onder 80% tegen een bekende referentie, `html_arrangements_skipped` of een PDF-layoutprobleem. Niet aan een app-route gekoppeld. |
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

Uitkomst op deze checkout (2026-10-23): 22 geplande calls, 22 eurocent
plafondraming in totaal, alle acht bronnen leesbaar. Zie de matrix voor de
tabel per bron.

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
- Dit is **ontwikkelaarsbewijs en fixturebewijs**: geen betaalde aanroep, geen
  echte modeluitvoer, geen browseracceptatie en geen onafhankelijke review.
