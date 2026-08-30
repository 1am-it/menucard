# Decision — Evolve, Not Rewrite

## Status

Accepted

## Context

BredaEats already has working routing, restaurant data, filtering concepts and
reservation-related behaviour.

The redesign changes discovery flow and information hierarchy more than it
changes the entire product domain.

## Decision

We will evolve the existing application instead of rebuilding it from scratch.

## Consequences

- Existing working infrastructure should be reused where sensible.
- Migration work should be split into small reviewable tickets.
- Regressions are less likely than in a greenfield rewrite.
- Temporary coexistence between old and new flows is acceptable during
  migration.

## Rejected alternative

Full rewrite / separate v2 codebase.

Reason:

This adds unnecessary delivery risk, duplicates logic and invites regression in
already-working functionality.
