# Runner-overdracht - begrensd GitHub-herstel (#59)

Status: **developeropgeleverd inclusief herstelronde R2 (TDZ in het orderpad);
nog geen onafhankelijke review of ingebruikname**. Datum: 2026-10-22. Basis:
`1de84c09f0b372e4800fb9209886fdbc0350072a` (`feat/menu-extraction-59`, PR #60).
Opdrachten: Lead-reviews 6344569495 (K1-K6) en 6346259831 (R2, K1-K5);
eigenaarsbesluit issuecomment-6343978758. Dezelfde beperkte uitzondering als de
verbruiksexport, vastgelegd in [developerrol](../../.agent/project/developer.md).

De herziene runner staat **naast** de live runner buiten deze repository en is
hier alleen met hash en bewijs vastgelegd. Deze notitie verandert geen
productcode, provider, budget, orderselectie, writer-lock, herstelbeleid,
prompt of configuratie.

## Levering

| Bestand | SHA-256 | Opmerking |
| --- | --- | --- |
| `runner.next.cjs` | `f9291ec9f6491e5ea4c0ff86149ae0d0c252e1b936d1f666a3f6e4a51c6b1da1` | volledige herziene runner, 761 regels, inclusief K1-K6 en R2 |
| `runner.e2e.test.cjs` | `161ace2f00868c027e37c56592080509abd8798796b8749c946e04e35d2eabfd` | 5 end-to-end-regressies op het echte orderpad (R2) |
| `runner.handoff.test.cjs` | `62192bb796d460e33154f09f1aad570a4da18610b339fcacd06921732e08053a` | 12 gerichte regressies op K1-K6, **ongewijzigd** |
| `runner.next.test.cjs` | `decb29738aeffe3654602ae68e971eee7db8751717ec55f663c4874d2d310930` | bestaande verbruiksregressies, **ongewijzigd** |
| `runner.test.cjs` | `f2e7188643a1ed346646848dfdcf0d627edf2a4d4f4c2f36af56e7631e298749` | bestaande orderregressies, **ongewijzigd** |
| `runner.cjs` (live) | `e090c4b0bb90152a782eb9a99721701f8875441972da2325440f9284a60a12c8` | **niet gewijzigd** |

De mislukte tussenlevering van 22-10 16:02 UTC staat als
`5a8e30c1ffacd09b793698f7b6030d442fa1ae9434a3baf65ea7e325b1927cf5` in
`recovery/handoff-fix-20261022/runner.cjs.failed-tdz`; R2 herstelt die versie.
`runner.next.cjs` wijkt daarvan 60 regels toegevoegd en 35 verwijderd af. Tegen
de live runner is dat 372 regels toegevoegd en 40 verwijderd; die wijzigingen zijn
`saveJson` (injecteerbare `fs`), `command` (classificatiegegevens in het geheugen),
het overdrachtsblok, de `tick`-lus, de testsnaad en de exports.

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

## Herstelronde R2 - TDZ in het orderpad en end-to-end bewaking

Bevinding (Lead, 22-10 16:02 UTC): de ingezette build `5a8e30c1…` stopte bij de
eerste echte order met `Cannot access 'state' before initialization`. Oorzaak: in
`tick` declareerde `const state = { ... }` (het rondeverslag) een blokgebonden
`state` in hetzelfde `try`-blok waarin eerder `state.processed` werd gelezen. Die
binnenste binding schaduwde de buitenste momentopname en zat op het leesmoment
nog in de temporal dead zone. De bestaande tests dekten dit niet, omdat geen
enkele test `tick` met een echte order doorliep; de poorttest stopte vóór die
regel.

Herstel, beperkt tot het orderpad:

- Het rondeverslag heet nu `roundState`; de buitenste momentopname blijft
  `state`. Geen enkele regel orderselectie, writer-lock, provider, budget, prompt
  of configuratie is gewijzigd.
- `tick` heeft een expliciete testsnaad `deps` (`dispatcherIo`): `dir`, `gh`,
  `git`, `runAgent`, `api` en `now`. Zonder injectie is elk veld exact de
  bestaande productiefunctie en wijst `dir` naar de runnermap; `main()` geeft
  niets mee. De snijdt dus geen nieuwe configuratie, geen nieuwe provider en
  geen tweede writer-pad.
- `buildHandoff` krijgt `now: io.now`; in productie is dat dezelfde
  `() => new Date()`, in tests een vaste tijd.

Nieuwe regressies in `runner.e2e.test.cjs` (echte `state.json`,
`handoff-pending.json`, `handoff-history.json`, `last-handoff.md`, `writer.lock`
en `last-run.json` in een tijdelijke map; `gh`, `git` en de agent geïnjecteerd):

1. een nieuwe order doorloopt het volledige pad, publiceert de overdracht
   eenmalig en laat `state.json` op `awaiting_review` met de verbruikte orderkey;
2. een tijdelijke publicatiefout geeft `pending` (drie pogingen), de ronde blijft
   `awaiting_review`, en een herstart publiceert de opgeslagen tekst eenmalig
   zonder de developeropdracht opnieuw te starten;
3. een permanente fout (`HTTP 403`) wordt niet herhaald, blijft
   `failed_permanent` en verandert de developeruitkomst niet;
4. de duplicaatcontrole: een herstart met dezelfde ordercomment start geen
   tweede agentronde en levert geen tweede comment;
5. een onzekere publicatie (comment mogelijk geplaatst, markercontrole mislukt)
   blijft `pending` en wordt bij herstart op de markering geadopteerd
   (`recovered: true`) zonder nieuwe publicatiepoging.

Bewijs (developer evidence): `node --check` op beide bestanden exit 0; alle
suites tegen de herstelde runner 36/36 (10 + 9 + 12 + 5). Dezelfde suite tegen
een kopie met alleen de oude bloknaam teruggezet: de 31 bestaande tests blijven
groen en alle 5 nieuwe tests falen met exact
`Cannot access 'state' before initialization` - dat is de reproductie van de
praktijkfout en het bewijs dat de nieuwe tests die fout nu wél afvangen.
Volledige uitvoer, hashes en diff: `delivery/handoff-tdz-fix-20261022/` naast de
runner.

Bekende begrenzing (niet stilzwijgend opgelost): na een geslaagde
herstartpublicatie meldt `tick` daarna `waiting_for_order` (de order is immers
verbruikt) en blijft het rondeverslag in `state.json` de publicatiestand van die
eerste ronde (`pending`) houden. De publicatie zelf staat als `published` in
`handoff-history.json` en het bestand `handoff-pending.json` is weg; dat is het
leidende bewijs. Wie de live publicatiestand wil zien, kijkt dus in de
overdrachtshistorie, niet in `state.json`. Dat is bewust zo gelaten: het
rondeverslag vastleggen is geen live-statuskanaal en aanpassen zou verder gaan
dan deze opdracht.

## Bewijs (developer evidence, geen onafhankelijke acceptatie)

Onderstaande uitvoer is de eerste levering (K1-K6). R2 herhaalde alle suites op
de herstelde runner: 36/36, zie "Herstelronde R2" hierboven.

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

- De Lead controleert de diff (`delivery/handoff-tdz-fix-20261022/`) en de
  testuitvoer en zet `runner.next.cjs` pas in wanneer geen developer en geen
  dispatcher actief zijn, naast `runner.e2e.test.cjs` **en**
  `runner.handoff.test.cjs`. Daarna precies één dispatcher herstarten.
- De Lead herhaalt na de wissel één echte order: de ronde moet nu niet meer op de
  TDZ stoppen en de overdracht moet eenmalig op issue #59 verschijnen. Dat is
  praktijkacceptatie en hier niet uitgevoerd.
- De Lead beoordeelt in een gecontroleerde lokale ronde het echte gedrag:
  publicatie, een tijdelijke fout die `pending` wordt, een herstart die opnieuw
  publiceert, en de blokkade van een nieuwe order. Dat is praktijkacceptatie en
  hier niet uitgevoerd.
- De eerdere mislukte inzet is als feit vastgelegd, niet verdoezeld: build
  `5a8e30c1…` stopte op de TDZ, is teruggezet en R2 vervangt die build. De Lead
  bepaalt of de mislukte build als incident wordt gemeld.
- Niet gedaan: live runner vervangen, dispatcher starten/stoppen, echte
  publicatie, provider-, budget- of configuratiewijziging, merge of release.
- Begrenzing: de wachttijd- en pogingcyclus is per aanroep begrensd; in
  `--watch` probeert elke poll een nog openstaande overdracht opnieuw. Dat is
  bewust (K6) en levert door de markeringscontrole geen duplicaten op. Een
  publicatiefout die permanent is, blijft als `failed_permanent` in
  `handoff-history.json` staan met een waarschuwing in de ronde-status; die
  blokkeert volgens K6 geen nieuwe order en vraagt actie van de Lead.

