# BE-43 bewijs — één scenario van de browsercheck (#101)

Developer-evidence (eigen run, lokale checkout). Geen productie, geen echte data,
geen merge of publicatie.

## Commando's

```bash
node ops/browser/run-menu-review-browser-check.js --lijst
node ops/browser/run-menu-review-browser-check.js                       # volledig
node ops/browser/run-menu-review-browser-check.js --alleen=review       # gefilterd
node --test ops/browser/lib/scenario-filter.test.js ops/browser/scenarioFilterWiring.test.js
node --test "src/**/*.test.js" "app/**/*.test.js" "ops/**/*.test.js"   # npm run test:stil
```

## Volledige run tegenover één scenario

| run | scenario's | controles | duur | bewijs |
| --- | --- | --- | --- | --- |
| volledig (geen vlag) | 30 van 30 | 729/729 geslaagd, 0 fouten | 3 min 49 s (212,3 s in de scenario's) | `ops/browser/evidence/menu-review-browser-evidence.json`, `filter: null` |
| `--alleen=review` | 1 van 30 | 27/27 (24 scenariocontroles + 3 afsluitende controles) | 18 s (6,5 s in het scenario) | `ops/browser/evidence/menu-review-browser-evidence.filtered.json`, `filter: ["review"]` (gitignored) |

De volledige run houdt dezelfde 729 controles als vóór BE-43; alleen de uitvoer is
korter (één regel per scenario, details alleen bij een fout). De gefilterde run
heeft het volledige bewijsbestand niet aangeraakt (SHA-256 gelijk vóór en na).

## Na het samenvoegen van main met BE-41 (#99)

De tabel hierboven hoort bij de branch van vóór de samenvoeging. De Lead heeft
`main` (met BE-41, #99) in `feat/scenariofilter-101` gemerged; daarna is de
volledige run opnieuw gedaan op head `8d60472`:

| run | scenario's | controles | duur | bewijs |
| --- | --- | --- | --- | --- |
| volledig (geen vlag), head `8d60472` | 30 van 30 | 838/838 geslaagd, 0 fouten | 3 min 0 s (179,8 s; 169,2 s in de scenario's) | `ops/browser/evidence/menu-review-browser-evidence.json`, `filter: null`, `worktreeDirty: false` |
| `--alleen=concept-publication`, head `9c95b82` | 1 van 30 | 158/158 (155 scenariocontroles + 3 afsluitende controles) | 43,4 s (34,2 s in het scenario) | `ops/browser/evidence/menu-review-browser-evidence.filtered.json`, `filter: ["concept-publication"]` (gitignored) |

- Dezelfde 838 controles als BE-41 op `main` (commit `9a25a29`, 838/838), dus de
  samenvoeging heeft geen controle verloren: alle 237 unieke controlenamen van
  `main` zitten in de samengevoegde versie, inclusief de twee namen die BE-41
  toevoegde (`be41 keyboard: …`, `be41 detail: …`).
- `--lijst` noemt op de samengevoegde branch 30 scenario's, met daarin
  `concept-publication`: dat is het scenario waarin alle 66 controles met `be41`
  in de naam zitten, en die zijn in de volledige run groen.
- Het gefilterde bewijs is naar een eigen bestand geschreven; het volledige
  bewijsbestand is na die run ongewijzigd (`git status` schoon).
- Een onbekende naam stopt met exitcode 2 en de lijst van 30 geldige namen; er
  start dan niets.

## Andere checks met meer scenario's (elk minstens één scenario gedraaid)

| check | run | uitkomst |
| --- | --- | --- |
| `run-public-style-browser-check.js` | `--alleen=internal-login` | 2/2 |
| `run-internal-nav-browser-check.js` | `--alleen=counts` | 9/9 |
| `run-een-klik-browser-check.js` | `--alleen=rij` | 52/56 — 4 bestaande fouten, zie hieronder |
| `run-bronnen-browser-check.js` | `--alleen=scherm-3` | 24/24 |
| `run-beeld-lezen-browser-check.js` | `--alleen=rij-ai-aan` (1280, licht) | 9/10 — 1 bestaande fout, zie hieronder |
| `run-straks-browser-check.js` | `--alleen=moment-20-00-nu` | 22/22 |
| `run-klaar-voor-publicatie-browser-check.js` | volledig | 39/39 (lijst 33/33, detail 2/2) |

## Bestaande fout buiten BE-43 (niet gerepareerd, geen appwijziging toegestaan)

Deze ronde (na de samenvoeging) heeft alleen de menu-reviewcheck gedraaid; de
twee andere browserchecks hieronder zijn niet opnieuw gedraaid, dus dit restpunt
staat nog open en is niet stilzwijgend opgelost. De volledige menu-reviewrun
zelf is met 838/838 volledig groen.

De controles van BE-33/BE-34 die een knoptekst letterlijk vergelijken, zakken
sinds de CSS-wijziging van BE-42 (af5b0b5) op de emoji: `innerText` geeft
`"📷\nLees met AI (afbeelding)"` in plaats van `"📷 Lees met AI (afbeelding)"`.
Hetzelfde geldt voor `"✨\nVind bronnen (1)"`. Bewijs dat dit niet uit BE-43 komt:
dezelfde controle faalt op de BE-43-basis 5101e5b in een aparte worktree, met
dezelfde uitkomst (`rij (1280/light): de knop is "📷 Lees met AI (afbeelding)"`,
gevonden `"📷\nLees met AI (afbeelding)"`), en BE-43 raakt geen app- of
src-bestand. Dit is een BE-42-restpunt voor de Lead.

## Omgevingsincident en herstel

Tijdens het opruimen van een tijdelijke worktree met een directory-junction naar
`node_modules` is de inhoud van `node_modules` verwijderd. Herstel is lokaal en
volledig gedaan: dezelfde afhankelijkheidsboom uit een zusterclone met identieke
`package.json` en identieke `package-lock.json` (zelfde SHA-256), plus de zes
pakketten die daar ontbraken uit de registry volgens de `resolved`-URL en
`integrity` van de eigen lockfile. Daarna is de volledige testsuite weer groen.
Er is geen nieuwe afhankelijkheid toegevoegd en niets aan `package.json` of
`package-lock.json` gewijzigd.
