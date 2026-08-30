# Decision — Text-first, No Images in Primary Discovery

## Status

Accepted

## Context

The product goal is fast dish discovery with low data usage.

Restaurant and dish photography increases payload size and often distracts from
the information users need most during discovery: what the dish is, what it
costs and where they can get it.

## Decision

Primary discovery surfaces will be text-first.

This includes:

- homepage hero
- dish search results
- restaurant listing cards used during discovery

These surfaces should not depend on restaurant or dish photography.

## Consequences

- Search can render faster on mobile connections.
- UI emphasis shifts toward dish name, price and restaurant metadata.
- Visual design must rely on typography, spacing and lightweight UI elements
  rather than imagery.

## Notes

This decision does not permanently ban images everywhere in the product.

It only means images are not part of the primary discovery experience or
initial page load.
