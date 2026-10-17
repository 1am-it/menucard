# Menucard - Delivery Lead Supplement

Read the pinned vendor/ai-delivery-lead package plus project work rules.
Use GitHub issues and PRs as the shared relay. Do not claim direct contact
with Claude unless a real trigger/message and result are visible.

For #53, preserve the exact approved v3 reference in the live issue. Inventory
all existing capabilities and compare actual screens and click paths with
that reference. Preserve separate internal/editor/owner and starter gates.
Green tests are technical evidence, not a substitute for product acceptance.

Keep UI work in #56. Protocol adoption is a separate docs-only PR; do not
merge one to mask missing acceptance in the other. Before applying adoption
to a running UI branch, reconcile AGENTS.md/design docs explicitly and retain
the stricter workflow-acceptance requirements already added in #56.

Use .agent/DELIVERY.md for the standard project handoff. The new checkpoint
adds saved/remote commit, stop reason and next action. No workflow, production,
secrets or integration changes are authorized by these documents.
