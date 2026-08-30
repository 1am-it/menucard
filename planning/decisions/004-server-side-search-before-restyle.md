# Decision — Server-side Search Before Homepage/Menu Restyle

## Status

Accepted

## Context

The BE-01 audit found that the entire restaurants/menus dataset is currently
shipped to every client route via direct JSON import. Building the new
homepage (BE-04) or restaurant menu (BE-05) UI against this static data would
mean building against a temporary interface that has to change shape again
once server-side search (BE-02b) lands — doubling the work and risking UI
assumptions that don't hold once real pagination and query-based fetching are
in place.

## Decision

Server-side search / data access (BE-02b) must be live before BE-04
(homepage shift) or BE-05 (restaurant menu restyle) begins.

## Consequences

- Ticket order is: BE-02a → BE-02b → BE-02c → BE-03 → BE-06 → BE-04 → BE-07 →
  BE-05 → THEME → BE-08. See [[migration-plan]].
- BE-03 and BE-06 (the core dish-search experience and its filters) are
  proven against the real server-side layer before the homepage is rebuilt
  around them.
- Slightly delays visible homepage progress in exchange for not having to
  rebuild it against a second data interface later.

## Rejected alternative

Build homepage/menu UI in parallel against the static JSON with a planned
later swap to server-side data.

Reason: this is exactly the kind of temporary-interface risk the audit
flagged under "data loading strategy" — it invites rework and makes it hard
to tell whether a later regression came from the UI change or the data-layer
swap.
