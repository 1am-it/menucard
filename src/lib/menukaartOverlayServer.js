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

import { snelAanpassenHandlers } from '@/src/lib/snelAanpassenRouteDeps'
import { leesPubliekeOverlay, legeOverlay } from '@/src/lib/menukaartOverlay'

/** De overlay van één restaurant; nooit een fout naar de pagina. */
export async function laadPubliekeOverlay(restaurantId) {
  const id = String(restaurantId === undefined || restaurantId === null ? '' : restaurantId).trim()
  if (!id) return legeOverlay()
  try {
    const request = new Request(
      `http://internal.invalid/api/v1/menukaart/overlay?restaurant=${encodeURIComponent(id)}`,
    )
    return leesPubliekeOverlay(await snelAanpassenHandlers.publiekeOverlay(request))
  } catch (error) {
    return legeOverlay()
  }
}
