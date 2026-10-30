'use client'

// BE-57 (#139, deel 1) — de beacon op /restaurant/<id> en /menu/<id>.
//
// Rendert niets. Na het laden (in een effect, dus na de eerste verf) gaat één
// anoniem aantal naar POST /api/v1/bekeken. De pagina wacht daar nooit op:
// src/lib/restaurantViews.js gebruikt `sendBeacon` (of `fetch` met keepalive),
// telt hooguit één keer per pagina en per sessie, en verstuurt niets bij "Do Not
// Track" of "Global Privacy Control". Zonder migratie (0024) geeft de route geen
// fout; er wordt dan alleen niets opgeslagen.
//
// De beslissingen staan in de geteste module; dit component doet niets anders
// dan hem op het juiste moment en met de echte browserobjecten aanroepen.
// Het importeert bewust alleen de browsercode (viewBeacon.js): de serverkant
// blijft uit het client-bundel.

import { useEffect } from 'react'
import { scheduleRestaurantView } from '@/src/lib/viewBeacon'

function sessionStore() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch (error) {
    // Geblokkeerde opslag: de pagina-Set in de lib voorkomt alsnog dubbel
    // tellen binnen deze pagina.
    return null
  }
}

export default function ViewBeacon({ restaurantId }) {
  useEffect(() => {
    if (!restaurantId) return
    scheduleRestaurantView({
      restaurantId,
      navigator: typeof navigator === 'undefined' ? null : navigator,
      window: typeof window === 'undefined' ? null : window,
      storage: sessionStore(),
    })
  }, [restaurantId])

  return null
}
