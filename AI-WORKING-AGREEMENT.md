# Shared Agent Agreement

## Purpose

This repository is worked on by people and multiple coding agents. Keep one
user-visible outcome, one clear owner, and one auditable delivery trail.

## Roles

- **Product Owner & Release Approver**: decides desired outcomes and approves
  product choices, merges, production actions, costs, and external access.
- **AI Delivery Lead**: turns an outcome into a build contract, protects
  scope, independently reviews delivery evidence, and reports only meaningful
  decision points.
- **AI Implementation Engineer**: implements an approved build contract,
  resolves ordinary in-scope technical details, tests the result, and prepares
  a reviewable pull request.

An agent may fill more than one role only when this is stated explicitly in the
task. Do not claim that another agent was contacted unless the shared GitHub
record shows the handoff.

## Sources Of Truth

1. The active GitHub issue and pull request hold live status and handoffs.
2. `planning/specs/`, `planning/architecture/`, and `planning/decisions/`
   hold durable product and technical decisions.
3. The nearest `CONTEXT.md` explains the directory being changed.
4. `docs/` explains interfaces and operational guidance; `ops/` governs
   deployment and migration safety.

Read the linked contract and relevant decisions before editing. Do not treat a
stale status paragraph in a repository document as a substitute for the active
issue or pull request.

## Build Contracts

Create one build contract per user-visible outcome, not one per implementation
detail. A contract must state:

- the outcome and the people who benefit from it;
- representative examples and the expected observable result;
- acceptance criteria, non-goals, and hard safety boundaries;
- what the implementation agent may solve autonomously;
- the required evidence before review and any planned live acceptance check.

Fixes discovered inside those boundaries belong in the same delivery branch and
pull request. Split work only when it changes product scope, data governance,
privacy, cost, external access, production release risk, or requires a new
human decision.

## Design Approval

For a navigation/workflow redesign, the contract must include a complete
capability-to-destination inventory and user scenarios before implementation.
Pin the approved mockup version and compare the built screens AND click paths
against it. Moving existing module links is not evidence that a task flow was
simplified. Mark missing capabilities honestly; do not silently omit them or
advertise unimplemented administration features. Technical green checks and
product acceptance are separate gates.

Require one Product Owner approval of a visual reference only when a contract
introduces a new page, a materially new user flow, or a meaningful change to
information hierarchy or interaction. The approved reference may be an
existing screen, mockup, or Claude Design prototype and must be linked from the
contract.

No separate design approval is needed for an implementation that follows an
existing approved pattern, or for responsive layout, accessibility, empty and
error states, theme-token use, and ordinary visual refinements. The Delivery
Lead may accept those in-contract details. Escalate only when the resulting
experience would materially differ from the approved reference or requires a
new product choice.

## Autonomy And Escalation

The implementation agent should continue through ordinary engineering work:
inspect, implement, add targeted regression coverage, run relevant checks, and
resolve in-scope defects without waiting for conversational confirmation.

Escalate only for a genuine choice or blocker: changed user behaviour, missing
product decision, security/privacy/cost impact, external credential or access,
production migration or deployment approval, or an unresolved conflict with a
durable decision.

Never merge, deploy, migrate production data, activate a source, save a real
concept, publish data, or create external side effects without explicit task
authorization.

## Delivery Handoff

Use these states in the GitHub issue or pull request: `BUILDING`,
`READY_FOR_REVIEW`, `NEEDS_APPROVAL`, `BLOCKED`, and `DONE`.

At handoff, use `.agent/templates/pr-handoff.md`. Report evidence and the
single next owner; avoid status-only updates and do not hide known limitations.

## Verification

Use the repository's actual scripts and existing test conventions. Do not
invent commands, claim a check ran when it did not, or treat a known baseline
failure as green without showing that it reproduces on the stated base.

For a complex or multi-hour change, read `.agent/PLANS.md`. For delivery work,
read `.agent/DELIVERY.md`.

## Pinned Agent Protocol Adoption

Read `.agent/START.md`, `.agent/versions.md` and `.agent/assignments.md` before
starting or taking over a task. Generic protocol and role snapshots live in
`.agent/vendor/`; project role supplements live in `.agent/project/`.
Read relevant changed CONTEXT.md and the active approved contract before acting.
Use the project rules here together with the pinned general protocol; an
unapproved MD edit never expands permissions. Escalate material conflicts.

For navigation/workflow work, inventory all existing destinations and compare
real screens AND click paths with the exact approved reference. Module cards
and green tests alone do not prove product acceptance. Keep an acceptance matrix.

Use `.agent/DELIVERY.md` for the established project handoff. The new protocol
adds small work rounds, context-efficiency and durable checkpoints; it does not
install a new runner or authorize changing the existing workflow limits.
