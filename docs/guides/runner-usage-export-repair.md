# Runner-verbruiksexport - beperkte herstelronde (#59)

Status: **developeropgeleverd inclusief herstelronde E1, nog geen onafhankelijke
review of ingebruikname**. Datum: 2026-10-21. Basis:
`aabcf7abf74480646659865e95492e80eb300ed3` (`feat/menu-extraction-59`, PR #60).
Opdrachten: Lead-reviews 6321467897 en 6321713308 (bevinding E1);
eigenaarsbesluit issuecomment-6320004560; uitzondering vastgelegd in
[developerrol](../../.agent/project/developer.md).

De herziene runner staat **naast** de live runner buiten deze repository en is
hier alleen met hash en bewijs vastgelegd. Deze notitie verandert geen
productcode, provider, budget, ordervalidatie, writer-lock, git, prompt,
GitHub-afhandeling, herstelbeleid of configuratie.

## Levering

| Bestand | SHA-256 | Opmerking |
| --- | --- | --- |
| `runner.next.cjs` | `e090c4b0bb90152a782eb9a99721701f8875441972da2325440f9284a60a12c8` | volledige herziene runner, 396 regels, inclusief E1 |
| `runner.next.test.cjs` | `decb29738aeffe3654602ae68e971eee7db8751717ec55f663c4874d2d310930` | 9 gerichte regressies |
| `runner.cjs` (live) | `68c04c5288c956d52cfdc3371c65e4f64f6de417086d8092fa602f2729d6549a` | **niet gewijzigd** |

## Herstel

1. **Tussenstand.** Alleen Cline's cumulatieve totalen
   (`totalInputTokens`, `totalOutputTokens`, `totalCacheReadTokens`,
   `totalCacheWriteTokens`, `totalCost`) worden bewaard. Delta's overschrijven
   geen totaal en hetzelfde totaal wordt nooit opgeteld. Een tussentijdse
   meting is expliciet `partial`; alleen een geslaagd afgeronde ronde met een
   echte eindmeting is `complete`. Een fout- of afgebroken ronde blijft
   `partial` en behoudt het bekende bedrag.
2. **Ronde-uitkomst los van exportstatus.** Alle exportaanroepen lopen via
   `recordUsageSafely`. Een lees- of schrijffout wordt een begrensde
   `usageWarning` in `last-run.json` en verandert de ronde-uitkomst niet.
   `status.json`, `state.json`, de handoff en het GitHub-checkpoint worden dus
   nooit overgeslagen door een exportprobleem.
3. **Geen gegevensverlies.** Een corrupt of verkeerd gevormd exportbestand wordt
   eerst byte-gelijk gekopieerd naar `usage-export.json.corrupt-<tijdstip>.json`;
   pas daarna begint een geldig document. Elke leesfout anders dan `ENOENT`
   laat het origineel ongemoeid. Schrijven gebeurt atomisch met begrensde
   `EPERM`/`EBUSY`/`EACCES`-herhalingen; het tijdelijke bestand wordt bij een
   blijvende fout opgeruimd en het origineel blijft byte-identiek.
4. **Contractvorm ongewijzigd.** `schemaVersion: 1`,
   `kind: bouwregie-usage-export`, `projectId: menucard`,
   `provenance: cline-reported`, `amountUnit: major` en de bestaande runvelden
   blijven gelijk. `cacheAccounting` blijft `unknown`, omdat het
   bouwregiecontract alleen `separate`, `included-in-input` en `unknown`
   toestaat. Er komen geen extra velden in de export.

## Herstelronde E1 - veldkeuze per eventsoort

Bevinding E1 (Lead-review 6321713308): de eindafrekening nam de eindtokens niet
over. `usagePatch` las alleen `total*`-velden, terwijl Cline 3.0.73
(`@cline/core` `translateRunFinished`) de cumulatieve eindstand in
`run_result.usage` onder `inputTokens`, `outputTokens`, `cacheReadTokens`,
`cacheWriteTokens` en `totalCost` zet. Een `complete`-record bevatte daardoor de
tokens van de laatste tussenstand en geen `cacheWrite`.

De veldkeuze staat nu expliciet per eventsoort vast:

| Eventsoort | Functie | Gelezen velden |
| --- | --- | --- |
| `agent_event` `usage` | `usagePatch` | alleen `totalInputTokens`, `totalOutputTokens`, `totalCacheReadTokens`, `totalCacheWriteTokens`, `totalCost`; de delta's `inputTokens`, `outputTokens` en `cost` worden nooit gelezen |
| `run_result.usage` | `finalUsagePatch` | alleen `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalCost`; de `total*`-velden worden nooit gelezen |

Aanvullend:

- De twee mappings staan als `USAGE_EVENT_TOKEN_FIELDS` en
  `RUN_RESULT_TOKEN_FIELDS` in de module en zijn geëxporteerd. Een regressie
  controleert dat geen veldnaam in beide voorkomt.
- `translateRunFinished` laat een cache-teller die nul is weg. In de
  eindafrekening betekent ontbreken daarom nul en niet "houd de tussenstand".
- `hasFinalMeasurement` eist beide cumulatieve eindtellers (`inputTokens` en
  `outputTokens`). Een `run_result` zonder `usage`, met alleen een bedrag of met
  een andere vorm blijft `partial`, behoudt de laatste tussenstand en levert
  geen eindafrekening op. Zo kan een `complete`-record tussen- en eindtokens
  niet mengen.
- Beperking: een toekomstige Cline-versie die de eindstand weer onder `total*`
  rapporteert, geldt als "geen eindmeting" (`partial`) in plaats van
  stilzwijgend met oude tokens als `complete` te worden geëxporteerd. Dat is een
  bewuste, eerlijke begrenzing en geen automatische fallback.

## Bewijs (developer evidence, geen onafhankelijke acceptatie)

Uitgevoerd in `menucard-local-runner` op Node 22:

```text
node --check runner.next.cjs                  -> syntax OK
node --check runner.next.test.cjs             -> syntax OK
node --test runner.test.cjs runner.next.test.cjs
                                              -> 19 tests, 19 pass, 0 fail
node --test runner.test.cjs                   -> 10 tests, 10 pass, 0 fail
node --test runner.next.test.cjs              -> 9 tests, 9 pass, 0 fail
RUNNER_MODULE=./runner.cjs node --test runner.next.test.cjs
                                              -> 9 tests, 0 pass, 9 fail
git diff --no-index runner.cjs runner.next.cjs
                                              -> 185 insertions, 22 deletions
```

E1-reproductie met de echte exportfuncties (twee `usage`-events met delta's en
totalen, daarna de exacte `run_result.usage`-vorm van de Lead-review):

```json
{
  "completeness": "complete",
  "run": {
    "completeness": "complete",
    "tokens": { "input": 1200, "output": 120, "cacheRead": 900, "cacheAccounting": "unknown", "cacheWrite": 0 },
    "amount": 0.12,
    "currency": "USD"
  }
}
```

De regressies dekken: cumulatieve tussenstanden zonder dubbeltelling, delta's die
nooit een totaal of bedrag worden, de eindafrekening (`partial` versus
`complete`), de eindtokens inclusief `cacheWrite: 0` in plaats van de laatste
tussenstand, een ontbrekende eindmeting die `partial` blijft en de tussenstand
houdt, de vaste veldmapping per eventsoort, een corrupt bestand met byte-gelijke
back-up, een blijvende en een tijdelijke schrijf-lock (`EPERM`), een tijdelijke
lees-lock (`EBUSY`), een onleesbaar bestand (`EACCES`) en de begrensde
waarschuwing zonder rondefout.

De baseline tegen de live runner faalt 9/9 op de expliciete exportnaad: de live
module exporteert `recordUsage`, `usagePatch`, `finalUsagePatch`,
`usageCompleteness`, `recordUsageSafely` en `usageWarningText` niet, dus dezelfde
regressies kunnen daar niet slagen. Dat is een faalbewijs op API-niveau, niet op
gedragsniveau; de gedragsdefecten (delta boven totaal, geen scheiding, geen
back-up, geen retry, eindmeting met de verkeerde velden) zijn zichtbaar in de
diff.

De tests schrijven uitsluitend naar tijdelijke mappen. De bestaande
`usage-export.json` is niet door deze tests gewijzigd; de live dispatcher
schrijft dat bestand tijdens de nog lopende ronde.

## Resterende stappen

- De Lead herhaalt de E1-reproductie met de echte functies op de nieuwe hash
  `e090c4b0…`, controleert de DevDashboardTower-adapter (`readUsage`), vergelijkt
  de diff met `recovery/usage-export-fix-20261021/runner.cjs.live-before`
  (`68c04c52…`) en zet `runner.next.cjs` pas in wanneer geen developer en geen
  dispatcher actief zijn. Daarna precies één dispatcher herstarten en in een
  echte ronde controleren dat de tussenstand cumulatief oploopt en dat de
  eindafrekening de eindtokens bevat.
- De Lead controleert dat de DevDashboardTower-adapter (`readUsage`) de export
  accepteert. Die adapteracceptatie is hier niet uitgevoerd.
- Niet gedaan: live runner vervangen, dispatcher starten/stoppen, slot
  verwijderen, merge, publicatie of productiewijziging.
