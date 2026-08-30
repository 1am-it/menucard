# Decision — Theme Token System Implemented Ahead of Sequenced Order

## Status

Accepted

## Context

[[005-decouple-theming-from-dish-first]] sequenced the THEME ticket after
BE-06, BE-04, BE-07 and BE-05, reasoning that flipping the shipped pages from
dark to light at the same time as structural/functional changes would
conflate two independent regression surfaces. That reasoning assumed THEME's
scope was a one-way visual redesign: introduce tokens, then repaint the
already-restructured pages light.

When THEME was actually specified and implemented, its scope was narrower and
different in kind:

- A complete design-token layer replacing every hardcoded color in
  `app/globals.css` and in inline `style={{...}}` props across
  `app/page.js`, `app/restaurant/[id]/page.js`, `app/menu/[id]/page.js` and
  `app/nvwa/[id]/page.js`.
- **Both** a light and a dark palette defined simultaneously, not a one-way
  flip.
- A user-facing Light/Dark/System toggle (`src/components/ThemeToggle.js`),
  persisted per browser.
- No change to any page's structure, copy, routing, search behaviour,
  ranking, filters, reservation logic, or data loading. Every page renders
  exactly the same DOM/JSX as before; only which CSS custom property values
  are active changed.
- The dark palette was made the default for anyone with no stored
  preference, matching the app's exact pre-THEME appearance.

## Decision

Because this scope does not carry the specific risk decision 005 was
guarding against — there is no structural change for a visual change to be
confused with, since no page was restructured — THEME was implemented now,
ahead of BE-06/BE-04/BE-07/BE-05, at explicit user direction.

## Consequences

- The remaining functional tickets (BE-06, BE-04, BE-07, BE-05, BE-08) are
  unaffected and still proceed in the order set by
  [[004-server-side-search-before-restyle]] and `planning/CONTEXT.md`.
- BE-04's homepage work and BE-05's menu restyle now inherit a working,
  comprehensive token system instead of hardcoded colors. They should extend
  or adjust existing tokens rather than reintroducing literal color values.
- Nothing changes for a visitor who never touches the toggle — dark remains
  the default, preserving current behaviour exactly.
- Decision 005's underlying principle still holds for anything that *does*
  restructure a page: if a future ticket wants to change layout/spacing/copy
  and also wants to change how that page uses the theme tokens, those two
  kinds of change should still land as separable diffs.

## Note on residual risk

Two known gaps remain, tracked rather than silently resolved:

- A handful of near-duplicate legacy color literals were intentionally
  consolidated onto a single shared token during tokenization (e.g. several
  slightly different dark greys all became `--border` or `--bg-hover`). This
  is a deliberate, low-risk simplification, not an oversight — see the THEME
  ticket spec for the specific consolidations.
- Contrast for the light palette was calculated rigorously for the
  highest-traffic pairings (accent-on-background, button-label-on-accent)
  and adjusted by the same darkening heuristic for the remaining
  decorative/status tokens (tags, warning, danger, allergy accent) without
  recomputing an exact ratio for every one. A full WCAG audit was not
  performed.
