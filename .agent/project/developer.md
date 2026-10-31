# Menucard - Developer Supplement

Read vendor/ai-developer, project work rules, affected CONTEXT.md, actual code
and the approved contract. Preserve app/, src/, data/, supabase/ and ops/
layout; no reorganization merely to match a template.

The developer is DeepSeek via the approved local Cline runner, working only
from the latest order and Lead review on the issue/PR named in that order.
Responsibilities: implement, test, repair in-contract defects in the same
branch, and deliver verifiable checkpoints (HEAD, tests run, evidence category,
remaining gaps, next step). Own checks are developer evidence, not independent
review or real acceptance. Report a genuine blocker with its exact cause
instead of guessing around it. The developer never edits the runner itself.

Verify the actual checkout and package.json before running scripts. The project
targets Node 22.x. After build, verify the PDF.js packaging check described in
ops/CONTEXT.md when the changed runtime requires it. Docs-only changes need
link, scope and snapshot checks; do not claim an app build ran if it did not.
Real menu/source/concept writes need the explicit relevant environment
authorization; no automatic production use. Never switch to a paid API without
approval.

A round stops after roughly 40 minutes (finishReason `aborted`), often without
a checkpoint. Plan for about 35 minutes, commit and push after every step, and
report actual preservation.

## Zuinig werken binnen een ronde (Lead-besluit 2026-10-28, eigenaar akkoord)

Elke regel die een commando teruggeeft, gaat bij elke volgende stap opnieuw mee
naar het model. Een ronde van BE-41 las daardoor 61,7 miljoen tokens in 294
stappen en stopte met `aborted`. Daarom, in elke ronde:

1. **Commit en push na elke commit** (`git push origin HEAD`). Een afgebroken
   ronde of een netwerkfout kost dan niets. De runner pusht aan het eind ook
   zelf, maar vertrouw daar niet op.
2. **Stille tests.** Tijdens het werk alleen de tests van de bestanden die je
   aanpast, bijvoorbeeld `node --test src/lib/<bestand>.test.js`. De volledige
   set één keer aan het eind, stil: `node --test --test-reporter=dot "src/**/*.test.js" "app/**/*.test.js" "ops/**/*.test.js"`
   (`npm run test:stil`). Die geeft alleen punten en de details van falende
   tests. Voor de aantallen: dezelfde opdracht zonder `--test-reporter=dot`, met
   `2>&1 | tail -12`.
3. **Nooit een bewijsbestand helemaal lezen.** Van `ops/browser/evidence/*.json`
   alleen de samenvatting, bijvoorbeeld:
   `node -e "const e=require('./ops/browser/evidence/<bestand>.json');console.log(e.passed,e.error,(e.checks||[]).length)"`.
4. **Eerst zoeken, dan gericht lezen.** Gebruik `grep -n` en lees daarna alleen
   het relevante regelbereik. Lees geen bestand van meer dan ±300 regels in zijn
   geheel. Dat geldt zeker voor `ops/browser/run-*-browser-check.js`.
5. **Lange uitvoer inkorten.** Een build, een browsercheck of een log altijd met
   `2>&1 | tail -30`, tenzij je een fout zoekt. Zoek dan met `grep`.
6. **Eén scenario per ronde.** Elke browsercheck met meerdere scenario's leest
   `--alleen=<naam>[,<naam>]` en `--lijst` (BE-43, #101): tijdens het werk
   `--alleen`, aan het eind één volledige run. Een gefilterde run schrijft naar
   een eigen, gitignored bewijsbestand en noemt zijn keuze in `filter: [...]`;
   alleen de volledige run vervangt het bewijs dat bij de levering hoort.
7. **Lees een ongewijzigd bestand niet opnieuw.** Wat je al gelezen hebt, staat
   nog in het gesprek. Lees alleen opnieuw na een eigen wijziging of een merge.
8. **Bewerk gericht.** Vervang alleen de regels die veranderen; schrijf een
   bestaand bestand nooit opnieuw helemaal uit. Dat kost veel uitvoertokens, het
   duurste soort, en geeft kans op onbedoelde wijzigingen.
9. **Geen lange uitleg tussendoor.** Werk en commit; de uitleg hoort kort in de
   commitboodschap en de checkpoint aan het eind.
10. **Nooit `git worktree add` voor metingen of builds.** Een worktree die naar
    `node_modules` wijst, wist bij het opruimen de hele `node_modules` van de
    runner. Dat is twee keer gebeurd, op 30 en 31 okt. Meet een basis in je
    eigen werkkopie:
    - `git stash -u`;
    - `git checkout <base>`;
    - bouwen met `NEXT_DIST_DIR=.next-base`;
    - terug naar je branch en `git stash pop`;
    - bouwen met `NEXT_DIST_DIR=.next-head`;
    - beide mappen verwijderen.

    Controleer aan het eind dat `node_modules/next/package.json` bestaat.

## Paginagebonden CSS (BE-52, Lead-besluit 30 okt)

Elk ticket zette zijn opmaak onderaan `app/globals.css`; dat bestand groeide
naar 6591 regels en parallelle PR's botsten bij elke merge. Daarom:

- Nieuwe opmaak voor één pagina of één component staat in een eigen
  CSS-bestand naast die code, geïmporteerd door die pagina of component.
- `app/globals.css` is alleen voor tokens, thema's, de basis en echt gedeelde
  onderdelen. Een blok dat ook gedeelde klassen raakt, blijft daar.
- Kleuren altijd via de bestaande tokens. Geen CSS-modules en geen nieuwe
  klassennamen voor bestaande blokken.
- De bewaker `app/globals-css.test.js` faalt als `app/globals.css` meer dan 40
  regels groeit boven het vastgezette aantal (5806) of als een verplaatst
  klasseblok ergens anders opduikt. Verhoog dat aantal alleen bewust, met een
  reden in de commit — niet stilzwijgend met een nieuw blok onderaan.

Bij een merge: voeg geen tweede stijlblok onderaan `globals.css` toe, maar
los het op in het bestand dat al bij die pagina hoort.
