# AI Delivery Protocol

## Pinned General Protocol

Project entry and ownership: `AGENTS.md`, `.agent/START.md`,
`.agent/assignments.md`. Exact upstream versions and snapshot hashes are in
`.agent/versions.md`. Read the relevant project role supplement and pinned
general delivery/checkpoint protocol before taking over a task.
The project handoff below remains the output format; add actual saved/remote
commit, stop reason and next safe step where needed. This documentation does
not install automatic checkpoint capture/restart or alter workflow limits.

## Goal

Deliver complete, reviewable user outcomes with minimal interruption to the
Product Owner. GitHub issues and pull requests are the shared, auditable relay
between agents; they are not a claim of direct model-to-model communication.

## Role Boundaries

| Role | Owns | Does not decide alone |
| --- | --- | --- |
| Product Owner & Release Approver | Outcome, priority, product trade-offs, release approval | Routine implementation detail |
| AI Delivery Lead | Build contract, scope, independent review, acceptance gate | Product policy, production release, or external access without approval |
| AI Product Designer | Mockup or prototype that expresses the approved direction | Final product choice or implementation release |
| AI Implementation Engineer | Design and code inside the contract, tests, PR evidence | Changes outside the contract or irreversible actions |

Assigned executors and autonomy: see `AI-WORKING-AGREEMENT.md` (owner decision
2026-10-24) and `.agent/assignments.md`. In short: Claude Code is the AI
Delivery Lead and may make simple changes itself; DeepSeek via the local Cline
runner does regular development through bounded orders in the format of
`.agent/templates/developer-order.md`; Codex has no default role.

## Evidence Categories

Every claim in a checkpoint, review or handoff names its category:

| Category | Meaning |
| --- | --- |
| Developer evidence | The developer's own tests, builds and screenshots |
| Independent check | Repeated or assessed by the Delivery Lead |
| Fixture evidence | Simulated, intercepted or fictional data/services |
| Real practical acceptance | The real app with real auth/DB/services and the real user flow |

One category never substitutes for another. Fixture or developer evidence is
not reported as real acceptance. "Busy"/BUILDING needs fresh execution
evidence; an old running record is not progress. DONE only when the agreed
acceptance in the contract is demonstrably met.

## Lifecycle

### 1. Shape

The Delivery Lead converts the requested outcome into one build contract. Use
`.agent/templates/build-contract.md` as the format. Include a small set of
representative examples, especially real failure shapes expressed as fictional
fixtures when possible.

The Product Owner approves the contract once. A separate approval is not
needed for normal implementation decisions already allowed by that contract.

### Design Gate

A design gate is required only for a new page, materially new user flow, or
meaningful information-hierarchy or interaction change. The Product Owner
approves one visual reference: an existing screen, a mockup, or a Claude
Design prototype. Link that reference from the contract.

The AI Product Designer and Delivery Lead may finish normal responsive,
accessibility, empty/error-state, theme-token, and small visual details within
that approved direction. Existing screens that use an established pattern do
not need a separate design gate. Escalate only if the built experience would
materially differ from the approved reference or needs a new product choice.

### 2. Build

The Implementation Engineer first synchronizes with the current base and
reads the contract, linked decisions, nearest `CONTEXT.md`, and affected code.
It then works continuously within the defined scope.

New defects that violate an acceptance criterion are fixed in the same branch.
Do not open a chain of micro-PRs merely because a test, fixture, or generic
edge case was discovered while delivering the agreed outcome.

### 3. Verify

Before handoff, run the smallest relevant checks that prove the contract:

- focused regression tests for each changed behaviour;
- relevant existing suite and build checks;
- a visual check when UI behaviour changed;
- a planned staging or live acceptance check only when the contract calls for
  it and authorization/access exists.

A production result is not claimed from local or fixture evidence alone.

### 4. Review And Release

The Delivery Lead reviews the diff against the build contract and calls out
risks, missing evidence, or out-of-scope changes. A green PR alone is not an
authorization for migration, source activation, export, or publication. Merges
are delegated to the Lead after its own review (owner decision 2026-10-30).

The Product Owner receives a notification only when there is a real decision,
a protected-environment approval, a production acceptance action, or
a blocker that cannot be resolved within the contract.

### 5. Close

After the planned acceptance evidence is collected, record the outcome and any
known limitation in the issue or PR. Turn a durable rule into a decision,
guide, or regression case instead of relying on chat memory.

## Handoff Format

Use exactly this structure in the final PR comment or report:

```text
STATE: READY_FOR_REVIEW | NEEDS_APPROVAL | BLOCKED | DONE
CONTRACT: #<issue-number or path>
DELIVERED: <short outcome-oriented summary>
EVIDENCE: <tests, build, visual or live evidence>
DESIGN: <not required | matches approved reference>
OUT OF SCOPE: <none or explicit list>
DECISION NEEDED: <none or one concrete choice>
NEXT OWNER: <role>
```

Keep it short. Do not repeat every command or narrate unchanged polling.


## Controlled GitHub Builder

`.github/workflows/claude-build.yml` is the optional implementation relay.
It starts only when a repository owner, member, or collaborator begins an
issue comment with `@claude-build`. The issue must already contain an
approved build contract.

The workflow uses the repository secret `CLAUDE_CODE_OAUTH_TOKEN`, generated
from the Product Owner's Claude subscription. Do not add `ANTHROPIC_API_KEY`,
automatic API-credit reload, or any other paid credential to this workflow
without a new Product Owner decision.

One repository-wide build may run at a time. It has a time and turn limit and
may prepare only one pull request. It never merges, dispatches or approves
workflows, deploys, migrates production data, activates sources, publishes
data, or changes external credentials. A failed or exhausted subscription run
is reported as a normal handoff; it must not silently switch to paid API use.
