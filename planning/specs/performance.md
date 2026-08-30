# Spec — Performance

## Goal

Make BredaEats noticeably faster and lighter than typical restaurant websites.

Performance is part of the product proposition.

## Target

Aim for:

- <250 KB initial transferred data where realistically possible
- fast first render on mobile
- minimal client-side JavaScript
- no food/restaurant images on initial page load
- no external fonts when avoidable
- no complete menu dataset shipped to the browser

These are targets, not reasons to compromise correctness.

## Requirements

### Images

Do not load restaurant or dish photography:

- in the hero
- during initial page load
- in search result listings

### Fonts

Prefer the system font stack.

Avoid Google Fonts or equivalent external font downloads unless a clear
product reason exists.

### Icons

Use small SVG icons.

Do not add a large icon dependency solely for a few icons if existing assets
can be reused.

### Data

Only fetch data required for the current page.

Search APIs should return limited fields and bounded result counts.

### Caching

Use caching for menu/search data where freshness requirements allow it.

### Maps

Do not load map libraries on initial page load.

Load map functionality only when the user explicitly opens a map/location
experience.

### JavaScript

Avoid large new dependencies.

Before adding a dependency, consider:

- browser APIs
- existing dependencies
- small utilities
- server-side implementation
