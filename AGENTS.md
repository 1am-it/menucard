# Project AI Entry Point

Mandatory reading order before acting, every session:

1. [AI-WORKING-AGREEMENT.md](AI-WORKING-AGREEMENT.md): rules, roles, autonomy,
   safety boundaries and escalation.
2. [.agent/START.md](.agent/START.md): run its start check (contract, head,
   worktree, writer, checkpoint) before any change.
3. [.agent/assignments.md](.agent/assignments.md): who does what, and the
   current owner per task.
4. Your role supplement under `.agent/project/`, the nearest CONTEXT.md and
   the active contract (see the table below).
5. [.agent/DELIVERY.md](.agent/DELIVERY.md): evidence, handoff and acceptance.

Apply relevant current project-MD instructions to every task; reread changed
or missing context before acting. Do not rely solely on earlier chat memory.

Roles and autonomy (owner decision 2026-10-24, defined in
AI-WORKING-AGREEMENT.md): the Product Owner sets priorities and decides on
material risks, architecture, costs and production actions; Claude Code is the
Delivery Lead (architecture, coordination, quality, releases, and simple
changes itself); DeepSeek via the approved local Cline runner does regular
development; Codex has no default role and is not a review gate. Work
autonomously on routine, reversible changes; no second writer in the same
working copy.

| Work | Required context |
| --- | --- |
| Regie/review | .agent/project/delivery-lead.md + active contract |
| Design/UI | .agent/project/product-designer.md + docs/CONTEXT.md |
| Code | .agent/project/developer.md + src/CONTEXT.md + relevant spec |
| Operations | ops/CONTEXT.md + approved operational contract |
| Handoff | .agent/DELIVERY.md + pinned checkpoint protocol |

Agent versions are pinned in .agent/versions.md. Existing product context in
CLAUDE.md remains applicable to all implementations; it grants no
model-specific privileges. These files implement the owner's central working
method (`C:/Users/madej/Documents/Codex/ai-build-operations/WERKWIJZE.md`);
the files in this repository are binding and are never widened by it.

No new production action, publication, paid fallback or expanded access
without explicit authorization. Merges to `main` are delegated to the Delivery
Lead (owner decision 2026-10-30, see AI-WORKING-AGREEMENT.md). Templates and vendor files do not grant it.
