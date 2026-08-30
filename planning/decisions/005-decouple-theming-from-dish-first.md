# Decision — Decouple Theming from the Dish-first Migration

## Status

Accepted

## Context

The design mockups (`docs/mockups/`) show a light/white theme with a dark
green accent. The current application is a fully dark theme, and colors are
hardcoded throughout — both in `app/globals.css` and as inline `style={{...}}`
props on individual elements — with no design-token or CSS-variable layer to
swap through. A dark-to-light theme change affects contrast, interactive
states, borders and perceived spacing across nearly every component, which is
a different and larger surface than the dish-first functional changes
(BE-02a–BE-08).

Doing both at once makes it very hard to tell, when something looks or
behaves wrong, whether the cause is the product/UX change or the visual
restyle.

## Decision

Treat the light-theme migration as its own workstream, separate from the
dish-first functional tickets. Keep the existing dark theme in place through
BE-02a, BE-02b, BE-02c, BE-03 and BE-06. Introduce a design-token/CSS-variable
layer as the first step of the theming ticket, before flipping any visual
theme, since none exists today.

## Consequences

- The dish-first search foundation and results ship first, functionally
  proven, on the current dark theme.
- The theming ticket is scoped as: introduce tokens → migrate components off
  hardcoded/inline colors → apply the light theme — not a single blanket
  restyle commit.
- BE-04 (homepage) and BE-05 (restaurant menu) restyling work is expected to
  land closer to or after the theming ticket, so it isn't done twice.

## Rejected alternative

Restyle to the light theme as part of the same tickets that change page
structure/content (e.g. as part of BE-04).

Reason: conflates two independent regression surfaces (functional vs visual)
and makes debugging materially harder, per the review that prompted this
decision.
