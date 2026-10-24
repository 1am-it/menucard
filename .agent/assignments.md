# Role Assignments

| Role ID | General package | Project supplement |
| --- | --- | --- |
| delivery-lead | .agent/vendor/ai-delivery-lead/ | .agent/project/delivery-lead.md |
| product-designer | .agent/vendor/ai-product-designer/ | .agent/project/product-designer.md |
| developer | .agent/vendor/ai-developer/ | .agent/project/developer.md |

Resolve package paths from the project root. The role ID, not the model name,
selects the package and supplement. Do not infer a package from an AI brand.

Human Product Owner & Release Approver: repository owner/user.
AI Delivery Lead: Claude Code for Menucard #59 / PR #60 and the read-only #53
follow-up, by explicit owner handover on 2026-10-20 (PR #60 comment
6297254612). Codex is not an additional review gate. Since 2026-10-24 the Lead
also owns releases and may make simple changes itself; roles and autonomy are
defined in `AI-WORKING-AGREEMENT.md`.
AI Implementation Engineer: DeepSeek via the existing local Cline runner for
#59, for regular development (owner-approved existing prepaid; this runner
approval does not by itself approve app-side AI, which has its own owner
decisions in BE-21).
Claude Code remains the implementation engineer for the separate #53 / PR #56
assignment. Verify the actual runner status before assuming an active session.
AI Product Designer: a specifically assigned designer using approved project
references; Claude Design may be the tool, not an autonomous release approver.

| Task | Delivery Lead | Developer | Current owner / status |
| --- | --- | --- | --- |
| #59 / PR #60 menu extraction | Claude Code | DeepSeek, local Cline runner (`menucard-local-runner`) | Claude Code: content complete and accepted locally (BE-21, 2026-10-24); release in progress (migration-only PR #61 for 0020, then PR #60); runner active, waiting for orders |
| #53 / PR #56 compact intake flow | Claude Code (read-only follow-up) | Claude Code (separate branch) | Open/draft; real browser acceptance outstanding |

The table records the owner at the time of the last edit; the live GitHub
thread and the start check in `.agent/START.md` decide the actual state.

Role ownership is per task, not an unconditional perpetual grant.
No DeepSeek app integration, paid fallback or additional access is configured
here; DeepSeek developer use is limited to the local #59 runner.
Another model can take over only with an explicit handoff, appropriate tools
and any required provider/access/cost approval. One writer per overlapping task.

The Delivery Lead authored this docs-only adoption. That is not an independent
review of its own changes; record the reviewer and remaining pilot checks in
the adoption PR. No authority to merge is conferred by this file.
