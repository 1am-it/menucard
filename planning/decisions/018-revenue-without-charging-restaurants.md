# Decision 018 — Revenue without charging restaurants (proposal)

## Status

Proposal (2026-10-28), drafted by the Delivery Lead at the product owner's
request. Fixed by the owner: **restaurant owners pay nothing**. The order of
revenue models and the first step still need an owner decision. Nothing is
built from this note until then, except the anonymous counters in step 0,
which belong to the dish sharing ticket.

## Context

Menucard is a neutral, dish-first menu guide: real dishes, real prices, no
photos, no tracking, fast on slow connections. The owner asked whether dish
sharing and the saved list (BE-44, mockup
https://claude.ai/artifact/JWaRewzvehJnmsnW4NxfgT) can lead to revenue, on the
condition that it costs restaurant owners nothing.

Sharing and saving do not earn money themselves. They are the growth engine:
every shared link brings a new person straight to a dish, without marketing
spend. They also produce the only demand signal a restaurant cannot get
elsewhere: which dishes people save and send to each other.

## Revenue options that cost restaurants nothing

| # | Who pays | What for | Fit with the product | Main risk |
| --- | --- | --- | --- | --- |
| 1 | City marketing, the city's business fund, tourism | A neutral, complete "where to eat" guide for the city, its visitors and its own campaigns | High: local and neutral, helps all restaurants equally | Depends on budgets and on good relations; slow to start |
| 2 | Subsidies (innovation, regional economy, digitisation of hospitality) | Building the multi-city data platform | High, for the platform track | One-off money; application work |
| 3 | Reservation platforms the restaurant **already** uses (affiliate fee per seated guest) | Bringing guests to a booking | Medium-high: follows the user's own choice | The platform charges the restaurant per guest as it already does; Menucard may only link to the restaurant's **own** booking route, never add a new paid one |
| 4 | Market research, suppliers, wholesalers, media | Aggregated, anonymous trends: price per dish type, per neighbourhood, per city, over time | Medium: needs several cities and history | Must never identify a person; must not become a ranking for sale |
| 5 | Users, voluntarily | A "support us" contribution, without any paid feature | Low revenue, but no conflict | Small amounts |

## Explicitly rejected

- **Paid placement or higher ranking.** That destroys trust in a neutral menu
  guide, the core of the product.
- **Advertising and tracking.** Heavier pages, cookies and personal data: against
  the product's performance and privacy principles.
- **Charging restaurants, now or later**, including "premium" profiles,
  insights or daily specials. Claiming a profile, updating the menu, the daily
  special and the anonymous insights remain free for every restaurant.

## Proposed order

0. **Now, with BE-44:** count anonymously per dish how often it is shared,
   saved and how often a reservation link is clicked. Only aggregated
   counters: no user identity, no cookies, no personal data. This creates the
   evidence for every option above.
1. **After a few months of counts:** an offer to Breda city marketing and the
   business fund, built on real numbers (option 1), plus subsidy research
   (option 2).
2. **Reservation affiliate** (option 3), only with platforms a restaurant
   already uses and only on its own booking route.
3. **Data products** (option 4) when there is a second city and at least a year
   of history.

Give restaurants their own insight ("your Poussin was shared 34 times this
month") **for free**. It makes claiming a profile attractive, improves the
data, and supports options 1 and 4 without costing restaurants anything.

## Decision needed from the owner

1. Agree with the rejected list and with the free insights for restaurants.
2. Choose the first step after the counters: city partnership (advice) or
   reservation affiliate.
