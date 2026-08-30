# THEME — Design Tokens / Light Theme Migration

## Depends on

BE-03 and BE-06 functionally stable (ideally BE-04 too — see
`planning/CONTEXT.md` sequencing note). Not blocked on BE-05/BE-07, which may
land before or interleave with this ticket by coordination.

## Goal

Migrate from the current fully-dark theme to the light theme in
`docs/mockups/`, per [[005-decouple-theming-from-dish-first]], without
conflating it with any functional change.

## Scope

- **Step 1 — introduce tokens.** No design-token/CSS-variable layer exists
  today; colors are hardcoded in `app/globals.css` and as inline
  `style={{...}}` props throughout the detail/menu/nvwa pages. Introduce CSS
  custom properties (or equivalent) for color, and migrate components to
  reference them, *before* changing any actual color value. This step alone
  should not change how the app looks.
- **Step 2 — apply the light theme.** Once tokens are in place, swap the
  token values to the light palette from the mockups and verify contrast,
  interactive states, and borders across every page.

## Out of scope

- Any structural/content/behavioural change — if a diff in this ticket
  touches component logic beyond className/style plumbing, it belongs in a
  different ticket.

## Key risk

Doing this simultaneously with any BE-0x functional ticket makes it
impossible to tell whether a regression is visual or behavioural. Keep this
ticket's diffs strictly visual.

## Acceptance criteria

- [ ] A token layer exists and is used consistently — no new hardcoded
      color values introduced going forward.
- [ ] Step 1 (token introduction) ships with no visible change, verified by
      a before/after screenshot comparison.
- [ ] Light theme matches the mockups' contrast, spacing and border
      treatment.
- [ ] No functional/behavioural diff is bundled into this ticket.
