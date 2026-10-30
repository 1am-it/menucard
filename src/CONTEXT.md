# Source Context

This directory contains implementation code for BredaEats.

## Working rule

Before changing code, read the related planning specs and architecture notes.

Prefer adapting existing components, services and utilities over creating
parallel implementations.

## Priorities

- keep existing functionality working
- support incremental migration
- keep bundle size small
- avoid image-heavy UI patterns
- keep search and pricing data central to the experience

## Opmaak (CSS), BE-52

Nieuwe opmaak voor één pagina of één component hoort naast die code, niet
onderaan een verzamelbestand. Concreet:

- Zet het in een eigen CSS-bestand naast de pagina of component
  (`app/kies/kies.css`, `app/internal/tellers/tellers.css`,
  `app/mijn-restaurant/mijn-restaurant.css`,
  `src/components/kies-start.css`) en importeer het daar waar de klassen
  gebruikt worden.
- `app/globals.css` is alleen voor tokens, thema's, de basis (reset, thema,
  scrollbar, focus) en echt gedeelde onderdelen die meerdere pagina's zonder
  eigen component gebruiken. Een blok dat ook gedeelde klassen raakt, blijft
  daar.
- Kleuren komen altijd uit de bestaande tokens (`--text-primary`,
  `--accent-surface`, `--surface-soft`, ...). Geen hex-, `rgb()`- of
  `hsl()`-waarden in nieuwe opmaak.
- Geen CSS-modules: gewone `.css`-bestanden, dezelfde klassennamen.

De bewaker `app/globals-css.test.js` faalt als `app/globals.css` meer dan 40
regels groeit boven het vastgezette aantal, als een verplaatst klasseblok
ergens anders opduikt, of als een stylesheet niet geïmporteerd wordt. Dat
aantal verhoog je alleen bewust, met een reden in de commit.
