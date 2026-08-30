# Spec — Lightweight Restaurant Menu

## Goal

Provide a clean universal representation of a restaurant menu without
image-heavy presentation.

## Example

# Con Fuego

Steakhouse · Grote Markt 24  
★ 4,7 · 600 m · Open tot 23:00

## Voorgerechten

Steak tartare — €16,50  
Carpaccio — €15,00

## Hoofdgerechten

Ribeye 300g — €34,50  
Entrecôte 250g — €29,50  
T-bone 500g — €39,50

[Reserveer]

## Requirements

- Text-first.
- Menu categories should be easy to scan.
- Dish names and prices are dominant.
- Descriptions may be shown when available.
- Dietary metadata should only be shown when reliable.
- Reservation CTA should be clearly visible.
- No requirement for dish images.

## Optional secondary information

- opening hours
- address
- cuisine
- distance
- restaurant website
- menu source / last updated timestamp

Only expose information that is actually available and trustworthy.
