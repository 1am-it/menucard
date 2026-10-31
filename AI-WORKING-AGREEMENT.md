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

### Current Assignment Of Roles (owner decision 2026-10-24)

This section is the single source for roles and autonomy; other project files
refer to it. It replaces the decisions of 2026-10-20 and 2026-10-21 ("the Lead
does not implement").

- **Product Owner**: the human owner. Sets priorities and decides only on
  material risks, important architecture choices, costs and production actions
  (production migrations, production configuration, new paid services or
  access). Merges to `main` are delegated to the Delivery Lead (owner decision
  2026-10-30, see below).
- **Delivery Lead**: Claude Code. Owns architecture, coordination, quality
  assurance and releases. May itself make simple code, configuration, test,
  tooling and procedure changes (for example release preparation, small fixes,
  documentation and instruction updates) without a developer order.
- **Developer**: DeepSeek via the approved local Cline runner. Owns regular
  development: new functionality, larger code changes and bug fixes, delivered
  through bounded orders (`.agent/templates/developer-order.md`).
- **Codex**: no default role and no mandatory review gate.
- One writer per working copy: the Lead never writes in the developer's working
  copy while a developer round is active. The Lead does its own changes in a
  separate worktree or branch, or between rounds, so the developer keeps
  working undisturbed.

### Autonomy And Escalation (owner decision 2026-10-24)

1. Work as autonomously as possible; avoid approval moments that add nothing.
2. Do not ask permission for routine, reversible, low-risk changes.
3. Existing tests, CI/CD and GitHub checks are the default quality gate; the
   Lead still reviews developer deliveries independently.
4. Roles are flexible: progress and efficiency matter more than rigid role
   boundaries. The Lead handles a small change itself rather than interrupting
   the developer; larger work goes to the developer.
5. Escalate to the Product Owner only for material risks, irreversible
   actions, production actions, costs, or choices that need the owner's
   judgement. Present such a choice once, as a short numbered list with a
   recommendation.
6. Automate recurring release and development steps where that is sensible.
7. Keep the Product Owner briefly informed of results, blockers and decisions;
   no extensive progress reports unless needed.

### Working Rules

1. Ordinary engineering inside the approved scope continues without asking
   again.
2. The Lead arranges missing test conditions within the mandate and keeps one
   named current owner per open task; responsibility never falls between agents.
3. A new project inherits no project-bound budget, access or production
   permission from another project.
4. "Busy"/BUILDING requires fresh execution evidence (live process, new
   progress, new commit or output). An old status or role assignment is not
   enough.
5. Label evidence as developer evidence, independent check, fixture evidence or
   real practical acceptance; one never substitutes for another
   (see `.agent/DELIVERY.md`).
6. DONE only when the agreed acceptance has demonstrably been met.
7. No speculative build rounds and no extra review layers.
8. Never work around a security or permission refusal (other tools, agents,
   modified prompts or broad allow rules). Report the exact refused action and
   the minimal legitimate step the Product Owner can take.

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

Merging to `main` is delegated to the Delivery Lead (owner decision
2026-10-30: "je mag alles mergen; wij bespreken toch alles van tevoren"). The
Lead merges only PRs it has reviewed against their contract, with green tests
and build and no conflict with main. Other production actions stay with the
owner unless explicitly delegated: dispatching or approving the production
migration workflow, Vercel and Supabase settings, secrets, domains, and the
launch.

Apart from those merges, never deploy, migrate production data, activate a source, save a real
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

## Zelfstandig Doorwerken Tot Afronding

Claude Code en DeepSeek voeren de volledige goedgekeurde bouw-, test-,
herstel- en reviewcyclus zelfstandig uit tot de acceptatiecriteria aantoonbaar
zijn gehaald, of een echte externe blokkade verdere uitvoering verhindert.

- DeepSeek herstelt concrete in-scope bevindingen en levert bewijs.
- Claude beoordeelt het checkpoint en geeft waar nodig direct een concrete
  vervolgopdracht. De Product Owner is geen doorgeefluik tussen agents.
- Een checkpoint, overdracht of groene deelsuite is geen reden om te stoppen
  wanneer nog veilig uitvoerbaar werk binnen het contract resteert.
- De volgende eigenaar neemt de overdracht expliciet op. De Lead controleert
  daadwerkelijke opname en verse voortgang; alleen een verzonden opdracht telt niet.
- Wachten op een developer betekent niet dat de Lead niets doet: resterende
  acceptatie en testvoorwaarden voorbereiden waar dat veilig parallel kan.
- Eén schrijver per werkkopie. Geen dubbele start, blinde herhaling, speculatieve
  verbeteringen of heropening van gesloten bevindingen zonder nieuw bewijs.
- Geen nieuw productakkoord vragen voor al goedgekeurde gewone engineering.
- Wel stoppen bij ontbrekende noodzakelijke toegang, onzekere veiligheid of een
  nieuwe materiële scope-, kosten-, privacy- of productiebeslissing.
- Bij stilgevallen uitvoering: onderzoek veilig, behoud werk en meld de echte
  blokkade. Presenteer stilstand nooit als voortgang.
- DONE betekent bewezen contractacceptatie, niet alleen "developer klaar".

Deze afspraak verleent geen onbeperkt budget, nieuwe toegang of toestemming om
beveiligingsgrenzen te omzeilen. Claim geen continue achtergrondactiviteit als
de gebruikte uitvoering die niet daadwerkelijk ondersteunt.
