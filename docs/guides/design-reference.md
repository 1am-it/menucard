# Design Reference

The intended BredaEats direction is a fast, lightweight, text-first interface.

Primary design assets live in:

`docs/mockups/`

Start with:

- `docs/mockups/README.md`
- `docs/mockups/homepage-v1.png`
- `docs/mockups/search-results-v1.png`
- `docs/mockups/restaurant-menu-v1.png`

## Visual direction

- no hero photography
- no dish photography in discovery
- strong typography
- generous whitespace
- subtle borders
- compact filter chips
- lightweight icons
- restrained motion
- mobile-first layout

## Information hierarchy

Discovery should emphasize:

1. dish name
2. price
3. restaurant
4. short description
5. dietary tags
6. distance/open status
7. clear menu/reservation actions

Restaurant branding should remain secondary during search and discovery.

## Theming

The mockups above show the light palette, which is the primary/default
design direction going forward. The original dark theme is preserved as a
fully supported, user-selectable alternative — not deprecated — via a
Light/Dark/System toggle in the header (`src/components/ThemeToggle.js`).
Anyone who doesn't touch the toggle keeps seeing dark, unchanged.

Both palettes are implemented through one shared set of CSS custom
properties in `app/globals.css` (see
`planning/specs/tickets/theme-design-tokens.md` for the full token list and
`planning/decisions/006-theme-token-system-implemented-early.md` for why
this was built before the pages that visually depend on it, e.g. the
homepage, were restyled). New UI work should reference these tokens
(`var(--text-primary)`, `var(--border)`, `var(--green)`, etc.) rather than
hardcoded colors, so it works correctly in both themes automatically.
