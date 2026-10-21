# Runner-verbruiksexport - beperkte herstelronde (#59)

Status: **developeropgeleverd, nog geen onafhankelijke review of ingebruikname**.
Datum: 2026-10-21. Basis: `1970a91ea53070a4874f5e9c712aead358efeac7`
(`feat/menu-extraction-59`, PR #60). Opdracht: Lead-review 6321467897;
eigenaarsbesluit issuecomment-6320004560; uitzondering vastgelegd in
[developerrol](../../.agent/project/developer.md).

De herziene runner staat **naast** de live runner buiten deze repository en is
hier alleen met hash en bewijs vastgelegd. Deze notitie verandert geen
productcode, provider, budget, ordervalidatie, writer-lock, git, prompt,
GitHub-afhandeling, herstelbeleid of configuratie.

## Levering

| Bestand | SHA-256 | Opmerking |
| --- | --- | --- |
| `runner.next.cjs` | `9ae1a5fce6be6e44916ef5c90440c88d7ef63643cd485dd94cd989cce90dd941` | volledige herziene runner, 388 regels |
| `runner.next.test.cjs` | `bab374a39397bd6e88a0b74b36285fd44f516173d8a7d1f4d900918ec2200ecd` | 6 gerichte regressies |
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

## Bewijs (developer evidence, geen onafhankelijke acceptatie)

Uitgevoerd in `menucard-local-runner` op Node 22:

```text
node --check runner.next.cjs                  -> syntax OK
node --check runner.next.test.cjs             -> syntax OK
node --test runner.test.cjs                   -> 10 tests, 10 pass, 0 fail
node --test runner.next.test.cjs              -> 6 tests, 6 pass, 0 fail
RUNNER_MODULE=./runner.cjs node --test runner.next.test.cjs
                                              -> 6 tests, 0 pass, 6 fail
git diff --no-index runner.cjs runner.next.cjs
                                              -> 143 insertions, 21 deletions
```

De regressies dekken: cumulatieve tussenstanden zonder dubbeltelling, de
eindafrekening (`partial` versus `complete`), een corrupt bestand met
byte-gelijke back-up, een blijvende en een tijdelijke schrijf-lock (`EPERM`),
een tijdelijke lees-lock (`EBUSY`), een onleesbaar bestand (`EACCES`) en de
begrensde waarschuwing zonder rondefout.

De baseline tegen de live runner faalt 6/6 op de expliciete exportnaad: de live
module exporteert `recordUsage`, `usagePatch`, `usageCompleteness`,
`recordUsageSafely` en `usageWarningText` niet, dus dezelfde regressies kunnen
daar niet slagen. Dat is een faalbewijs op API-niveau, niet op gedragsniveau;
de gedragsdefecten (delta boven totaal, geen scheiding, geen back-up, geen
retry) zijn zichtbaar in de diff.

De tests schrijven uitsluitend naar tijdelijke mappen. De bestaande
`usage-export.json` is niet door deze tests gewijzigd; de live dispatcher
schrijft dat bestand tijdens de nog lopende ronde.

## Resterende stappen

- De Lead vergelijkt de diff met
  `recovery/usage-export-fix-20261021/runner.cjs.live-before`
  (`68c04c52…`), zet `runner.next.cjs` in wanneer geen developer en geen
  dispatcher actief zijn, herstart precies één dispatcher en controleert in een
  echte ronde dat de tussenstand cumulatief oploopt.
- De Lead controleert dat de DevDashboardTower-adapter (`readUsage`) de export
  accepteert. Die adapteracceptatie is hier niet uitgevoerd.
- Niet gedaan: live runner vervangen, dispatcher starten/stoppen, slot
  verwijderen, merge, publicatie of productiewijziging.
