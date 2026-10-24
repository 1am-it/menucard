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
