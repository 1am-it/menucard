# Decision — BE-ticket structure, progress tracking, and time-boxing

## Status

Accepted

## Context

`BE-*` tickets have grown steadily longer and more detailed (see
`be-14-fix-alle-restaurants-back-navigation.md`'s and
`be-16-uniform-restaurant-grouped-dish-search-results.md`'s own
post-deploy status/acceptance-criteria conventions), but until now each
ticket has invented its own heading order, its own way of recording which
of the many required steps (documentation, review, implementation,
review, commit, review, push, production check) have actually happened,
and its own sense of how much work a single documentation or
implementation pass should take before checking back in. That ad hoc
approach has already caused two concrete, repeated problems:

- A ticket's own status section has been found, more than once, still
  claiming "not started" long after the underlying work was implemented,
  reviewed, committed, pushed, and verified live — because no ticket
  carried a single, glanceable checklist of exactly which steps had
  genuinely happened.
- A single documentation or implementation session has, more than once,
  quietly grown from a small, bounded task into a much larger one without
  ever pausing to say so — because no ticket carried an upfront,
  falsifiable expectation of how long the next block of active work
  should take.

This decision fixes both, once, for every future `BE-*` ticket — the same
way `014-navigation-and-orientation-standard.md` fixed navigation
conventions once instead of per ticket.

## Decision

Every **new** `BE-*` ticket follows this structure:

- Exactly one `#` top-level heading for the whole ticket.
- Logical `##` sections below it, never skipping a heading level (no `##`
  followed directly by `####`).
- A `## Status` section, immediately followed by a `## Voortgang` section
  — status prose first, then the checklist that proves it.
- The `## Voortgang` section contains exactly this checklist, with the
  ticket's own number substituted in the heading line, and **only**
  genuinely verified steps checked:

```markdown
BE-<nummer> VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2a. Documentatiecommit lokaal gemaakt
- [ ] 2b. Documentatiecommit gepusht
- [ ] 3. Implementatie-readinessreview groen
- [ ] 4. Lokale productcode gebouwd en getest
- [ ] 5. Onafhankelijke pre-commitreview groen
- [ ] 6. Lokale codecommit gemaakt
- [ ] 7. Gecombineerde pre-pushreview groen
- [ ] 8. Code gepusht
- [ ] 9. Productiecontrole
```

- A step is checked `[x]` only once it has actually, verifiably happened
  — never automatically, never in advance, never because a later step
  succeeded. Checking step 9 does not retroactively justify checking step
  4 if step 4 itself was never independently confirmed.
- A step that genuinely does not apply to a given ticket (for example, a
  documentation-only ticket that never reaches step 4) stays unchecked
  with a short inline note explaining why, rather than being silently
  removed — the full nine-step shape stays visible so a reader can see
  what was deliberately skipped versus what simply hasn't happened yet.
  Only a later, explicit decision may remove a step from a specific
  ticket's own checklist entirely.
- Any final report produced for a `BE-*` ticket (a status update, a
  review, a completion summary) reproduces this same nine-step shape with
  its current checkboxes, plus the time estimate described below — never
  a paraphrase or a different shape.

### The seven-minute rule

Before starting any new block of active work on a `BE-*` ticket
(documentation, implementation, or review), make a realistic estimate of
the active working time it will take, including local checks, but
excluding time spent waiting on human approvals, external workflows, or
deploys.

- **7 minutes or less** — proceed independently.
- **More than 7 minutes** — do not make the change yet. Report the
  estimate, the reason, a safe way to split the work into a first bounded
  step and a follow-up, and wait for explicit permission before
  continuing.
- **A running estimate turns out to be wrong** — as soon as it becomes
  reasonably clear that the total will exceed 7 minutes, stop after the
  most recent safely completed step, make no further changes beyond it,
  and report the revised estimate in the same shape. Do not keep working
  past that point on the assumption the estimate will "even out."
- An estimate is a practical expectation, not a guarantee — state briefly
  why an estimate was uncertain or had to be revised when that happens.

## Scope

This decision governs **new** `BE-*` tickets from this point forward. It
does not require rewriting any existing ticket's heading order, adding
the `## Voortgang` checklist retroactively, or reformatting past status
updates. An existing ticket only adopts this structure if and when it is
next opened for substantive, unrelated work anyway — never as a standalone
cleanup pass across the whole ticket set.

## Consequences

- A reader can tell, at a glance, exactly which of the nine steps a
  `BE-*` ticket has actually completed, without reading its full prose
  history.
- A documentation or implementation session states its own expected size
  before starting, and is expected to say so — loudly — the moment that
  expectation turns out to be wrong, rather than silently growing.
- `PLATFORM-*` and `MARKET-*` tickets are not covered by this decision;
  they may adopt the same pattern later via their own explicit decision,
  but this one only binds `BE-*`.
