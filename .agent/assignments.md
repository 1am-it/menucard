# Role Assignments

| Role ID | General package | Project supplement |
| --- | --- | --- |
| delivery-lead | .agent/vendor/ai-delivery-lead/ | .agent/project/delivery-lead.md |
| product-designer | .agent/vendor/ai-product-designer/ | .agent/project/product-designer.md |
| developer | .agent/vendor/ai-developer/ | .agent/project/developer.md |

Resolve package paths from the project root. The role ID, not the model name,
selects the package and supplement. Do not infer a package from an AI brand.

Human Product Owner & Release Approver: repository owner/user.
AI Delivery Lead: ChatGPT/Codex for the current coordination task.
AI Implementation Engineer: Claude Code for the existing #53 assignment;
verify the actual runner status before assuming an active session.
AI Product Designer: a specifically assigned designer using approved project
references; Claude Design may be the tool, not an autonomous release approver.

Role ownership is per task, not an unconditional perpetual grant.
No DeepSeek integration, paid fallback or additional access is configured here.
Another model can take over only with an explicit handoff, appropriate tools
and any required provider/access/cost approval. One writer per overlapping task.

The Delivery Lead authored this docs-only adoption. That is not an independent
review of its own changes; record the reviewer and remaining pilot checks in
the adoption PR. No authority to merge is conferred by this file.
