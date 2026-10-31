// BE-60 (#150) — de overlay voor de zoekresultaten, server-side.
//
// De zoekroute (/api/search) haalt hier de goedgekeurde wijzigingen op van
// precies de restaurants die in het resultaat te zien zijn — nooit de hele
// tabel. Dat gebeurt met dezelfde functie als BE-58
// (laadPubliekeOverlay in src/lib/menukaartOverlayServer.js): één kleine,
// gecachte opvraag per restaurant, in de Data Cache van Next.js onder de tag
// van dat restaurant (src/lib/menukaartVerversen.js). Een goedkeuring of
// bevestiging ververst die tag al met revalidateTag, dus een zoekopdracht
// kost geen extra databasebelasting en toont meteen de nieuwe prijs.
//
// Ontbreekt de migratie of de configuratie (503), dan komt er niets terug en
// blijven de statische prijzen staan, zonder fout in de zoekresultaten.

import { laadPubliekeOverlay } from '@/src/lib/menukaartOverlayServer'

/** Alleen echte, ontdubbelde restaurant-id's; dezelfde vorm als de handler eist. */
function schoneIds(restaurantIds) {
  const ids = []
  const gezien = new Set()
  for (const waarde of Array.isArray(restaurantIds) ? restaurantIds : []) {
    const id = String(waarde === undefined || waarde === null ? '' : waarde).trim()
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || gezien.has(id)) continue
    gezien.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * restaurantId → wijzigingen, voor precies deze restaurants. Restaurants
 * zonder wijzigingen staan er niet in, zodat er niets te herhalen valt.
 */
export async function laadZoekOverlay(restaurantIds) {
  const ids = schoneIds(restaurantIds)
  if (ids.length === 0) return {}
  const paren = await Promise.all(ids.map(async (id) => {
    try {
      const overlay = await laadPubliekeOverlay(id)
      const wijzigingen = Array.isArray(overlay && overlay.wijzigingen) ? overlay.wijzigingen : []
      return [id, wijzigingen]
    } catch (error) {
      return [id, []]
    }
  }))
  return Object.fromEntries(paren.filter(([, wijzigingen]) => wijzigingen.length > 0))
}
