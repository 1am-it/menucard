# Issue 53 - Prepared Developer Takeover

STATE: BUILDING (product task); developer started, rounds 1-3 delivered in
`checkpoints/issue-53-round-1.md`, `checkpoints/issue-53-round-2.md` and
`checkpoints/issue-53-round-3.md` (browser acceptance still open; not
READY_FOR_REVIEW).
CONTRACT: planning/specs/tickets/internal-task-flow-53.md
ROLE: developer (DeepSeek through Cline); Delivery Lead: ChatGPT/Codex.
ISSUE: https://github.com/1am-it/menucard/issues/53
PR: https://github.com/1am-it/menucard/pull/56 (existing draft; do not duplicate)
BRANCH: feat/compact-source-flow-53; base: main.

## Saved Starting Point

- Approved v3 source: f8b44abd64e8085737e5dad6b225eaf5aef1efc3.
- Main integrated for this preparation: fc12bbc6fcf1469fc0119152cbd6149aee44bf55.
- Original dirty Developer/1am-it/menucard checkout is not the workspace for
  this task and must remain untouched. Do not import its uncommitted files.
- This checkout has independent Git administration and no copied .env files.
- PR #58's short AGENTS entry and pinned packages are retained. Feature v3
  acceptance rules are retained in AI-WORKING-AGREEMENT.md and DELIVERY.md.
- Claude's automatic selection marker on #53 is not active. Workflow files
  are inherited unchanged from main. Check live runs and overlapping writers
  once before writing; never restart Claude as part of the takeover.
- Read current issue/PR head before continuing. The published preparation
  commit and check results belong in the issue/PR, not a self-referential SHA.

## First Focused Work Round

Outcome: staff see concrete pending tasks on Werkvoorraad instead of the
five module-navigation cards. Start with the capability/destination inventory
and task model already required by the approved contract; then implement this
first outcome with regression tests. Do not repeat a repository-wide audit.

Read .agent/START.md, assigned developer INPUT/OUTPUT, src/CONTEXT.md,
docs/CONTEXT.md, the contract, and docs/mockups/internal-task-flow-v3.html.
Inspect app/internal/workqueue/page.js and its existing loaders/role guards.
Record the existing destination for every capability before changing routing.

Use real available pending records, restaurant/task/reason and one permitted
next action pointing to the exact record. Preserve independent tasks, role
boundaries and honest empty/partial/error states. Never invent queue data.
Add focused tests for role filtering, record links and duplicate handling.
Save a small coherent tested checkpoint on this same branch before proceeding.

Later rounds in this same approved contract cover Beheer's four sections,
reachability of existing features and the shorter publication navigation.
Do not call the overall task READY_FOR_REVIEW after only the first round.

## Evidence And Boundaries

Run focused node:test files during work, then npm test and npm run build for
the final changed app. Compare actual screens AND click paths against v3,
including Beheer, roles, empty/error states and direct-record navigation.
Maintain an acceptance matrix. Report any missing preview access honestly;
do not copy credentials from the original checkout to make checks pass.

No migration, workflow edit, production action, source activation, publication,
merge, external access expansion, paid fallback or new scope. Navigation to
existing publication controls is not permission to publish. Respect existing
import limits, version/blocker checks, audit and idempotency safeguards.

Keep updates short at meaningful milestones. At each handoff record delivered
outcome, tests, saved commit/remote status, remaining work and next safe step.
Re-read changed context, not all vendor packages for every small action.
