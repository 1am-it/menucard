# Start Or Resume Menucard

Project: `1am-it/menucard`. Resolve the project root from this repository,
not from a vendor role package or an assumed local machine path.

1. Read project AGENTS.md and AI-WORKING-AGREEMENT.md.
2. Read versions.md and assignments.md in this directory.
3. Read the pinned vendor/ai-working-agreement/AGENTS.md and its working
   agreement, then vendor/<assigned-role>/AGENTS.md, ROLE.md, INPUT.md and OUTPUT.md.
4. Read project/<assigned-role>.md, affected CONTEXT.md and referenced rules.
5. Read the live GitHub task and approved spec/design, not only an old checkpoint.
6. Run the mandatory start check below.
7. Report the role/task and next safe step briefly; act within that contract.

## Mandatory Start Check

Before any change, verify and report each item with fresh evidence:

1. **Contract**: the active contract and the latest Lead review/order are read
   and the planned work falls inside them.
2. **Head**: local HEAD, `origin` and the PR head are re-verified with the full
   SHA. Use only that freshly verified SHA in an order or handoff.
3. **Worktree**: clean, or every change is inspected and explained. Never
   discard work; preserve it (commit, branch or patch) before cleaning.
4. **Writer**: no live writer process and no writer lock. A lock is only
   removed after proving its process is gone; keep the evidence.
5. **Checkpoint**: the last checkpoint and what changed since are known. An old
   `running`/BUILDING status is not evidence of current activity.

If any item fails, stop changing files and resolve it or report it as a blocker.

## Task References

For #59 (menu extraction, PR #60) the developer is DeepSeek via the local
runner; orders follow the runner protocol in the issue thread. The Lead runs
acceptance in an isolated local environment as authorized in the PR thread.

For UI work on #53, use https://github.com/1am-it/menucard/issues/53 and its
existing PR #56. The Product Owner approved v3 on 2026-10-17; the exact
design/contract reference is commit f8b44abd64e8085737e5dad6b225eaf5aef1efc3
on that feature branch, not a file assumed to exist on main.
Do not create a second UI PR or broaden that task while adopting this protocol.
The docs-only adoption PR is independent and does not approve a UI release.

The active checkpoint belongs in the task's GitHub thread with a verified
commit and remote status. Do not hardcode a stale BUILDING label here.
Check actual workflow status; no implicit restart from a read-only monitor.

No automatic package refresh, model switch, credential change, new workflow,
production action or export-PR creation by this startup procedure.
