# Execution Plans

Use an execution plan for a complex feature, cross-cutting refactor, migration,
or any change likely to span more than one focused work session. A plan is a
delivery aid, not a replacement for the build contract.

## When A Plan Is Required

Create or update a plan when the work changes more than one subsystem, has a
release dependency, introduces a new data contract, or needs staged evidence.
Do not create a plan for a contained bug fix with clear acceptance criteria.

## Required Sections

```markdown
# <Outcome>

## Contract
- GitHub issue:
- User-visible outcome:
- Non-goals:
- Hard boundaries:

## Current State
- Relevant code and decisions:
- Known risks:

## Delivery Steps
1. ...

## Verification
- Focused tests:
- Existing suites:
- Visual or live acceptance:

## Release Gate
- Required approval:
- Rollback or safe failure behaviour:
```

Keep the plan current as facts change. Do not create a new plan just to record
routine progress; update the existing one and keep live status in GitHub.
