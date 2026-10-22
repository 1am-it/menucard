# Runner-overdracht - begrensd GitHub-herstel (#59)

Status: **developeropgeleverd, nog geen onafhankelijke review of ingebruikname**.
Datum: 2026-10-22. Basis: `29c6c3dc145c8408dcd5ed95aa8567fe2c8cb608`
(`feat/menu-extraction-59`, PR #60). Opdracht: Lead-review 6344569495;
eigenaarsbesluit issuecomment-6343978758. Dezelfde beperkte uitzondering als de
verbruiksexport, vastgelegd in [developerrol](../../.agent/project/developer.md).

De herziene runner staat **naast** de live runner buiten deze repository en is
hier alleen met hash en bewijs vastgelegd. Deze notitie verandert geen
productcode, provider, budget, orderselectie, writer-lock, herstelbeleid buiten
K6, prompt of configuratie.

## Levering

| Bestand | SHA-256 | Opmerking |
| --- | --- | --- |
| `runner.next.cjs` | `5a8e30c1ffacd09b793698f7b6030d442fa1ae9434a3baf65ea7e325b1927cf5` | volledige herziene runner, 736 regels, inclusief K1-K6 |
| `runner.handoff.test.cjs` | `62192bb796d460e33154f09f1aad570a4da18610b339fcacd06921732e08053a` | 12 gerichte regressies op K1-K6 |
| `runner.next.test.cjs` | `decb29738aeffe3654602ae68e971eee7db8751717ec55f663c4874d2d310930` | bestaande verbruiksregressies, **ongewijzigd** |
| `runner.cjs` (live) | `e090c4b0bb90152a782eb9a99721701f8875441972da2325440f9284a60a12c8` | **niet gewijzigd** |

De bestaande verbruiksexport (regels 102-284 van de live runner) is ongewijzigd
overgenomen. De diff tegen de live runner is 323 regels toegevoegd en 16 regels
gewijzigd; die wijzigingen zijn `saveJson` (injecteerbare `fs`), `command`
(classificatiegegevens in het geheugen, geen uitvoer bewaard), het nieuwe
overdrachtsblok, de `tick`-lus en de exports.

## Uitvoering per eis

- **K1 - duurzaam vóór publicatie.** `buildHandoff` maakt één record met de
  developeruitkomst, het volledige checkpoint en de exacte publicatietekst.
  `persistHandoff` schrijft atomisch `last-handoff.md` (bestaand herstartbewijs)
  en `handoff-pending.json`. `publishHandoff` weigert zonder dat record
  (`HANDOFF_INVALID`) en schrijft vóór elke poging opnieuw de pogingstand weg.
- **K2 - gescheiden statussen.** Het record heeft `developerOutcome.status`
  (`completed`/`failed`, met exit, finishReason, head, remote-gelijkheid en
  dirty) en `publication.status` (`pending`/`published`/`failed_permanent`).
  `state.json` en `status.json` nemen de ronde-status uitsluitend uit de
  developer-exit (`awaiting_review`/`blocked`); een mislukte of openstaande
  publicatie voegt alleen `publication` en een `warning` toe.
- **K3 - begrensde retries.** Alleen `HTTP 408/429/5xx` en netwerkfouten
  (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `EPIPE`,
  `socket hang up`, rate limit, time-out) worden herhaald, met wachttijden van
  1, 5 en 15 seconden (maximaal vier pogingen). `HTTP 400/401/403/404/410/422`,
  `gh`-exitcode 4 (auth) en een ongeldig record zijn permanent en worden nooit
  herhaald. Een niet-classificeerbare fout wordt niet blind herhaald en ook niet
  permanent verklaard: de overdracht blijft `pending`.
- **K4 - geen duplicaten.** De publicatietekst bevat een unieke markering
  `<!-- menucard-local-handoff:v1 order=<ordercommentid> -->`. Vóór elke
  publicatie en na elke mislukte poging zoekt de runner die markering in de
  issuecomments. Bestaat de comment al, dan wordt de overdracht als
  `published` met `recovered: true` geboekt zonder nieuwe poging. Mislukt die
  controle zelf, dan wordt niet gepubliceerd: de overdracht blijft `pending` met
  `lastError.code = lookup_failed`, en de volgende start controleert eerst
  opnieuw. Zo kan een onzekere publicatie geen tweede comment opleveren.
- **K5 - geen tweede developerronde.** Publicatie werkt uitsluitend op het
  opgeslagen record (`publishHandoff` krijgt alleen de overdracht en de
  publicatie-io). Een afgerond record is terminaal; de developeropdracht wordt
  nooit opnieuw gestart en het checkpoint wordt niet herschreven.
- **K6 - pending blokkeert en hervat.** Na uitgeputte retries blijft
  `handoff-pending.json` staan en bevatten `status.json` en `state.json` een
  begrensde waarschuwing (`overdracht pending voor order #...; developeruitkomst
  blijft completed`). `tick` probeert een pending overdracht vóór elke
  orderkeuze te publiceren en retourneert `handoff_pending` zolang dat niet lukt;
  er wordt dan geen nieuwe order aangenomen. Een onleesbaar pending bestand
  (`handoff_unreadable`) blokkeert ook en blijft byte-gelijk bewaard. Een
  `--execute`-loze leesproef publiceert niets en meldt alleen de stand.

Een pending overdracht kan door de Lead worden afgesloten met een expliciete
markering als comment op issue #59, van `1am-it`, die **begint** met de regel
`<!-- menucard-local-handoff-assessed:v1 -->` gevolgd door een `json`-codeblok
met `{"order": <ordercommentid>, "assessment": "<korte reden>"}`. Dat sluit het
record als `failed_permanent` met `reviewedByLeadAt` en publiceert niets. Zonder
deze markering blijft de dispatcher bij een pending overdracht wachten; dat is de
bedoelde begrenzing, geen automatische zelfgoedkeuring.

## Bewijs (developer evidence, geen onafhankelijke acceptatie)

Uitgevoerd in `menucard-local-runner` op Node `v22.22.3`:

```text
node --check runner.next.cjs                  -> exit 0
node --check runner.handoff.test.cjs          -> exit 0
node --test runner.test.cjs runner.next.test.cjs runner.handoff.test.cjs
                                              -> 31 tests, 31 pass, 0 fail
RUNNER_MODULE=./runner.cjs node --test runner.handoff.test.cjs
                                              -> 12 tests, 0 pass, 12 fail
git diff --no-index --numstat runner.cjs runner.next.cjs
                                              -> 323 insertions, 16 deletions
```

De 12 nieuwe regressies dekken: duurzaam opslaan vóór de eerste poging en
weigeren zonder record; de developeruitkomst die niet meebeweegt met een
geslaagde of mislukte publicatie (beide richtingen); tijdelijke fouten met
oplopende wachttijd en de poginggrens; geen retry bij 401/403/404; een niet
classificeerbare fout die pending blijft; een onzekere publicatie die op de
markering wordt geadopteerd; een mislukte duplicaatcontrole die nooit een
tweede comment oplevert; het opgeslagen checkpoint en de exacte publicatietekst
die ongewijzigd blijven; een herstart die eerst publiceert; een leesproef die
niets publiceert; de expliciete Lead-beoordeling (en dat een markering van een
andere auteur of voor een andere order niet telt); een onleesbaar pending
bestand; een achtergebleven afgerond record; en de `tick`-poort die vóór
orderkeuze, git of werkruimtewijziging terugkeert.

De baseline tegen de live runner faalt 12/12 op de expliciete overdrachtsnaad:
de live module exporteert `buildHandoff`, `persistHandoff`, `publishHandoff`,
`resumePendingHandoff`, `handoffWarning`, `handoffMarker`, `handoffBlocksOrders`,
`handoffCommentExists`, `handoffAssessedByLead` en `publicationErrorVerdict`
niet. Dat is faalbewijs op API-niveau; de gedragsdefecten (geen duurzaam record,
publicatiefout die de ronde-uitkomst beïnvloedt, blinde of ontbrekende retries,
duplicaten, geen herstart) zijn zichtbaar in de diff.

Alle tests schrijven uitsluitend naar tijdelijke mappen. Er is deze ronde geen
echte GitHub-comment gepubliceerd, geen live runner vervangen en geen dispatcher
herstart. De bestaande `usage-export.json` en `last-handoff.md` in de
runnermap zijn niet door de tests gewijzigd.

## Resterende stappen

- De Lead controleert de diff en de testuitvoer en zet `runner.next.cjs` pas in
  wanneer geen developer en geen dispatcher actief zijn, naast
  `runner.handoff.test.cjs`. Daarna precies één dispatcher herstarten.
- De Lead beoordeelt in een gecontroleerde lokale ronde het echte gedrag:
  publicatie, een tijdelijke fout die `pending` wordt, een herstart die opnieuw
  publiceert, en de blokkade van een nieuwe order. Dat is praktijkacceptatie en
  hier niet uitgevoerd.
- Niet gedaan: live runner vervangen, dispatcher starten/stoppen, echte
  publicatie, provider-, budget- of configuratiewijziging, merge of release.
- Begrenzing: de wachttijd- en pogingcyclus is per aanroep begrensd; in
  `--watch` probeert elke poll een nog openstaande overdracht opnieuw. Dat is
  bewust (K6) en levert door de markeringscontrole geen duplicaten op. Een
  publicatiefout die permanent is, blijft als `failed_permanent` in
  `handoff-history.json` staan met een waarschuwing in de ronde-status; die
  blokkeert volgens K6 geen nieuwe order en vraagt actie van de Lead.

