# Menucard - Developer Supplement

Read vendor/ai-developer, project work rules, affected CONTEXT.md, actual code
and the approved contract. Preserve app/, src/, data/, supabase/ and ops/
layout; no reorganization merely to match a template.

For #59 the developer is DeepSeek via the approved local Cline runner, working
only from the latest order and Lead review. Responsibilities: implement, test,
repair in-contract defects in the same branch, and deliver verifiable
checkpoints (HEAD, tests run, evidence category, remaining gaps, next step).
Own checks are developer evidence, not independent review or real acceptance.
Report a genuine blocker with its exact cause instead of guessing around it.

### Limited runner exception: usage export (owner decision 2026-10-21, #59 issuecomment-6320004560)

Normally the developer does not edit the dispatcher. One bounded exception is
approved, via the Menucard track only: repair the usage export in
`C:\Users\madej\Documents\Codex\menucard-local-runner\runner.cjs`, limited to
(1) correct running totals without double-counting cumulative usage events and
with incomplete measurements marked partial; (2) strict separation between the
developer outcome and the export status, so a corrupt or locked export never
classifies a successful round as blocked or failed; (3) keeping the existing
export on write errors, without silent overwrite or data loss; (4) targeted
regressions for running totals, final settlement, corrupt files and locking.
The developer delivers the revised runner **next to** the live one (for example
`runner.next.cjs` plus test files) and never edits the live `runner.cjs` while a
dispatcher may run. The Lead reviews the diff and swaps the file only when no
developer or dispatcher is active. No change to provider, budget, order
selection, writer lock, recovery policy or product code; no unrelated work.
DevDashboardTower remains a read-only consumer of Menucard sources.

From package.json on the adoption base: npm test, npm run test:menu-structure,
npm run benchmark:menu-structure and npm run build exist. Verify the actual
checkout before execution. The project targets Node 22.x. Use targeted tests
during rounds and the required full/integration checks before acceptance.
After build, verify the PDF.js packaging check described in ops/CONTEXT.md
when the changed runtime requires it. Docs-only changes need link, scope and
snapshot checks; do not claim an app build ran if it did not.

Keep #53 in existing PR #56; follow its approved v3 reference and preserve the
preview-acceptance fixes already on that branch. Do not edit that branch from
this separate protocol adoption task. Real menu/source/concept writes need
the explicit relevant environment authorization; no automatic production use.

The existing runner has a time/turn limit. This protocol does not raise it,
resume it, or install a checkpoint hook. Save meaningful authorized work early
and report actual preservation. Never switch to a paid API without approval.

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
