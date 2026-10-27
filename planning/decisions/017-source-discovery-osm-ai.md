# Decision 017 — Source discovery may use OpenStreetMap and AI (proposals only)

## Status

Accepted (2026-10-27, product owner: "alles akkoord"). Amends the *Find* step of
decision 016. Implemented by BE-32 (#75).

## Context

Decision 016 limits *Find* to the restaurant's own host: no external sources, no
OCR, no AI. Finding a website and a menu link for every restaurant is now manual
work that does not scale beyond Breda.

## Decision

1. *Find* may use, in this order: OpenStreetMap (open data, server-side, cached;
   attribution "© OpenStreetMap-bijdragers"); the existing same-host discovery; an AI
   choice among pages of the **same** host, with a verbatim quote as evidence; and,
   only when no website is known, AI web search with cited sources. Delivery and
   booking platforms are never accepted as a restaurant's source.
2. Every result is a **proposal** with its provenance stored. A human confirms it;
   nothing is added, activated or published automatically (016 §2–3 unchanged).
3. AI calls count against the existing monthly budget (1000 cents) and the existing
   daily limits; no new paid service.
4. Only business information is stored; no personal data.
5. Restaurants found in OpenStreetMap but not in our data appear as "Nieuw gevonden"
   suggestions; adding one goes through the normal "Restaurant of menu toevoegen" flow.
