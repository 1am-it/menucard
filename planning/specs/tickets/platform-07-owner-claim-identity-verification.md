# PLATFORM-07 — Owner Claim and Identity Verification

## Depends on

`PLATFORM-05` (API), `PLATFORM-06` (queue, if claims route through review
rather than writing directly).

## Objective

Let a real restaurant owner claim their listing, prove they are who they
say, and then edit their own data with the highest trust tier.

## User story

As a restaurant owner, I want to claim my MenuCard listing and confirm my
own menu, hours, and reservation method, so customers see accurate
information without me having to go through a third party.

## Scope

- A claim flow: initiate a claim on a specific restaurant listing.
- Identity verification (e.g. business email domain match, or another
  concrete method chosen explicitly — not left implicit) before granting
  write access.
- Once verified, the owner can edit their own data through `PLATFORM-05`'s
  API with `owner` provenance and the highest confidence tier.
- Claim status (pending/verified) visible to the owner and to editors.

## Out of scope

- Public community contributions (`PLATFORM-08`).
- Claims on restaurants not yet in the dataset (new-restaurant onboarding is
  future scope, not covered here).
- Any payment/billing relationship with owners — purely a data-verification
  feature at this stage.

## Dependencies

Hard dependency on `PLATFORM-05`. Depends on `PLATFORM-06` only if claim
approval is designed to route through the moderation queue rather than
verifying automatically — this choice must be made explicit during this
ticket's own before-coding analysis, not assumed.

## Data model needs

Adds a claim/ownership record linking a verified identity to a restaurant;
owner edits use `PLATFORM-03`'s schema with `source: owner`.

## Moderation/verification needs

The identity verification step itself is this ticket's core requirement —
must be a real, non-trivial check, not merely "someone clicked a button."

## Risks

- Weak verification (e.g. anyone claiming to be the owner with no proof)
  allowing a non-owner to gain write access and highest-trust status — the
  verification method needs explicit scrutiny and sign-off before building
  the surrounding flow.
- Conflicting claims on the same listing need a defined resolution path, not
  silent last-write-wins.

## Acceptance criteria

- [ ] A claim requires a concrete, real verification step before granting
      write access.
- [ ] Verified owner edits carry `owner` provenance and highest confidence.
- [ ] Claim status is visible to the owner and to editors.
- [ ] Conflicting/duplicate claims on one listing are handled explicitly,
      not silently.

## Suggested order

Seventh ticket — first of the external-facing write wave.
