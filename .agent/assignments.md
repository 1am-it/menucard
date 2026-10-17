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
AI Implementation Engineer for #53: DeepSeek through Cline, prepared for
user-started takeover in the isolated checkout. It is not running until the
user starts that task. ChatGPT/Codex performs only this handoff preparation.
Claude's automatic issue-selection marker is removed for the handoff; the
workflow configuration itself is unchanged. Verify live runs before writing.
AI Product Designer: a specifically assigned designer using approved project
references; Claude Design may be the tool, not an autonomous release approver.

Role ownership is per task, not an unconditional perpetual grant.
The user configured DeepSeek in their own Cline instance. This preparation
does not inspect its API key, verify its billing or configure another provider.
No additional integration, paid fallback or access is configured by these docs.
Another model can take over only with an explicit handoff, appropriate tools
and any required provider/access/cost approval. One writer per overlapping task.

The Delivery Lead authored this docs-only adoption. That is not an independent
review of its own changes; record the reviewer and remaining pilot checks in
the adoption PR. No authority to merge is conferred by this file.
