# Developer Order Template

Every Delivery Lead order to the #59 developer uses this structure, posted as
one PR review comment plus one runner order on the issue (runner protocol in
`.agent/START.md`). This order is the full handoff for the round.

```text
ROLES: Lead = Claude Code (order, review, acceptance, releases). Developer =
DeepSeek via the local runner (the code, tests and repairs of this order). The
Lead does not write in this working copy while the round is active.
BASE: <full, freshly verified HEAD>
CONTRACT: <issue/spec + Product Owner decision link>

OUTCOME: <what demonstrably works after this round, in plain language>

SCOPE:
1. <bounded item with repro or concrete trigger>
NOT IN SCOPE: <explicit>

ACCEPTANCE CRITERIA:
- <testable criterion per item>

SAFETY BOUNDARIES:
- <project permissions and prohibitions; no production, merge, publication,
  new paid service or security workaround>

REQUIRED EVIDENCE (developer evidence):
- targeted regressions per item, full `npm test`, `npm run build`
- normal commits, push only to this branch
- Dutch checkpoint with HEAD, tests, evidence category, remaining gaps

AFTER DELIVERY (Lead): independent check and real-practice acceptance
<which>; findings return as a new order.
```
