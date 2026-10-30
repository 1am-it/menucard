// BE-58 deel 2 (#143) — de publieke overlay ophalen, server-side.
//
// De publieke pagina's (/menu/[id] en /restaurant/[id]) hebben de goedgekeurde
// wijzigingen en het bevestigingslabel nodig. Die worden hier op de server
// opgehaald via dezelfde handler en dezelfde regels als de publieke API, en
// daarna op de statische kaart gelegd (src/lib/menukaartOverlay.js).
//
// Bewust géén clientfetch: de eerste laadgrootte van de publieke pagina's mag
// hooguit 1 KB groeien, en zo komt er geen regel JavaScript bij. Alleen het
// restaurant van de getoonde pagina wordt opgehaald, nooit de hele tabel.
// Ontbreekt de migratie of de configuratie (503), dan tonen de pagina's gewoon
// de statische kaart: een storing hier maakt de menukaart nooit stuk.

import { unstable_cache } from 'next/cache'
import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'
import { leesPubliekeOverlay, legeOverlay } from '@/src/lib/menukaartOverlay'
import { overlayTag } from '@/src/lib/menukaartVerversen'

// BE-58 deel 3 (#143, Lead-besluit 31 okt): de overlay komt uit de Data Cache
// van Next.js, niet uit een nieuwe Supabase-vraag bij elk bezoek. Een
// goedkeuring of bevestiging ververst de tag van dat restaurant meteen
// (src/lib/menukaartVerversen.js); deze 3600 seconden is het vangnet als die
// verversing ooit mislukt.
const OVERLAY_CACHE_SECONDS = 3600

/** De overlay van één restaurant via de eigen publieke handler. */
async function haalPubliekeOverlay(id) {
  try {
    const request = new Request(
      `http://internal.invalid/api/v1/menukaart/overlay?restaurant=${encodeURIComponent(id)}`,
    )
    return leesPubliekeOverlay(await snelAanpassenHandlers.publiekeOverlay(request))
  } catch (error) {
    return legeOverlay()
  }
}

// Eén gecachte functie per restaurant, zodat de tag van precies dat restaurant
// verversbaar is en nooit de overlay van een ander restaurant meegaat.
const cachePerRestaurant = new Map()

function overlayUitCache(id) {
  let gecached = cachePerRestaurant.get(id)
  if (!gecached) {
    const tag = overlayTag(id)
    gecached = unstable_cache(() => haalPubliekeOverlay(id), ['menukaart-publieke-overlay', id], {
      revalidate: OVERLAY_CACHE_SECONDS,
      tags: tag ? [tag] : [],
    })
    cachePerRestaurant.set(id, gecached)
  }
  return gecached()
}

/** De overlay van één restaurant; nooit een fout naar de pagina. */
export async function laadPubliekeOverlay(restaurantId) {
  const id = String(restaurantId === undefined || restaurantId === null ? '' : restaurantId).trim()
  if (!id) return legeOverlay()
  try {
    return await overlayUitCache(id)
  } catch (error) {
    return legeOverlay()
  }
}
