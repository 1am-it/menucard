# Menucard - Delivery Lead Supplement

Read the pinned vendor/ai-delivery-lead package plus project work rules.
Use GitHub issues and PRs as the shared relay. Do not claim direct contact
with another agent unless a real trigger/message and result are visible.

Claude Code is the Delivery Lead. Roles, autonomy and escalation are defined
once in `AI-WORKING-AGREEMENT.md` ("Current Assignment Of Roles" and "Autonomy
And Escalation", owner decision 2026-10-24). Responsibilities:

- architecture, coordination, quality assurance and releases;
- one executable developer order per outcome for regular development (PR
  comment + runner order), using only a freshly verified head;
- simple code, configuration, test, tooling and procedure changes done by the
  Lead itself, in a separate worktree/branch or between developer rounds, never
  in the developer's working copy while a round is active;
- monitor progress with fresh execution evidence, never an old status;
- arrange missing test conditions (local environment, fictional test data,
  access inside the mandate) instead of leaving them between agents;
- review developer evidence independently and label it per `.agent/DELIVERY.md`;
- close work demonstrably: DONE only after the agreed acceptance is met;
- prepare releases (for example migration-only release PRs) and guide the
  Product Owner through the production actions that remain theirs.

For #53, preserve the exact approved v3 reference in the live issue. Inventory
all existing capabilities and compare actual screens and click paths with
that reference. Preserve separate internal/editor/owner and starter gates.
Green tests are technical evidence, not a substitute for product acceptance.

Keep UI work in #56. Protocol adoption is a separate docs-only PR; do not
merge one to mask missing acceptance in the other. Before applying adoption
to a running UI branch, reconcile AGENTS.md/design docs explicitly and retain
the stricter workflow-acceptance requirements already added in #56.

## Owner agreements on ways of working (2026-10-29/30)

- **DeepSeek peak hours: ask first.** DeepSeek charges double in peak hours:
  Monday to Friday 01:00–04:00 and 06:00–10:00 UTC. That is 02–05 and 07–11
  Dutch winter time and 03–06 and 08–12 summer time. Source:
  api-docs.deepseek.com/quick_start/pricing. On 2026-10-30 84% of the spend fell
  in peak hours.
  - Before an order or marker would start a round in peak hours, or a round
    (about 35 minutes) would run into them, the Lead reports it. The owner then
    chooses: start now at the double price, or wait until off-peak, with the
    start time named.
  - Without a choice, the Lead waits.
  - Off-peak and at weekends, the Lead starts as usual.
  - For the real costs, use the DeepSeek CSV export. The runner usage export
    counts only at the off-peak price.
- **Merge-ready handover.** The owner only gets merge links for PRs that are
  conflict-free against the current main. The Lead first merges main into the
  branch, then builds and tests. After every owner merge, the Lead repeats
  this for the remaining PRs.
  - Release-preparation PRs, such as `DOCUMENTED_RELEASE_VERSIONS` in
    `production-db-migrate.yml`, come together with the migration PR.
  - Production approvals, such as `production-migrations`, stay with the owner.
    The Lead gives one link and the exact clicks.
- **No automatic status reports.** No recurring cron or Lead checks. The Lead
  checks the runners when the owner next writes, or when a background wait on
  a runner reports back.

Use .agent/DELIVERY.md for the standard project handoff. The new checkpoint
adds saved/remote commit, stop reason and next action. No workflow, production,
secrets or integration changes are authorized by these documents.
