// BE-56 (#137, punt 5) — het vaste korte QR-adres /r/<id>.
//
// Een geprinte QR-code wijst hiernaar en nooit rechtstreeks naar de
// restaurantpagina: het id blijft, de naam en het adres kunnen veranderen. Deze
// pagina stuurt daarom tijdelijk door (307) naar /restaurant/<id>, zodat een
// latere verhuizing geen nieuwe drukwerk vraagt.
//
// Een optionele naam achter het id (/r/6-blossem) wordt genegeerd. Een onbekend
// id is een 404, geen gok en geen doorverwijzing naar de home. De regels staan
// in src/lib/qrRoute.js, met tests in src/lib/qrRoute.test.js.

import { notFound, redirect } from 'next/navigation'
import restaurantsData from '@/data/restaurants.json'
import { qrRestaurantTarget, restaurantHref } from '@/src/lib/qrRoute'

// Altijd de actuele gegevens en altijd een echte 307: een QR-code mag nooit
// een oude, ingebakken bestemming houden.
export const dynamic = 'force-dynamic'

export default async function QrPage({ params }) {
  const { id } = await params
  const target = qrRestaurantTarget({ id, restaurants: restaurantsData })
  if (!target) notFound()
  redirect(restaurantHref(target))
}
