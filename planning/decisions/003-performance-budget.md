# Decision — Performance Budget

## Status

Accepted

## Context

BredaEats aims to compete on speed, clarity and low data usage.

Without explicit constraints, redesign work can gradually introduce heavy
assets, large dependencies and oversized client payloads.

## Decision

Performance is a product requirement and must be treated as a budgeted
constraint during implementation.

## Target budget

- <250 KB initial transferred data where realistically possible
- no restaurant or dish images on initial page load
- no full menu dataset shipped to the browser
- minimal client-side JavaScript
- no external font dependency when avoidable

## Consequences

- New dependencies require scrutiny.
- Search/data APIs should return only fields needed for the current view.
- Progressive loading, pagination and caching should be preferred.
- Maps and other heavy experiences should load only on demand.
