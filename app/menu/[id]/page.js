// BE-08 — performance cleanup.
//
// Server Component: looks up just this one menu (+its restaurant) server-
// side so the full menus.json/restaurants.json dataset is never bundled to
// the client for this route. All interactivity (search, filters, category
// scroll-spy) lives in MenuView, which receives only the already-looked-up
// data as props.
//
// BE-44 (#105, criterium 3) — a shared dish link gets its own preview:
// og:title "<gerecht> · <prijs>", og:description with the restaurant, the
// address and one line of description, og:url, and the generated 1200 × 630
// card from this route's own share-image endpoint. Without a valid dish
// deep link this route keeps the app's general metadata exactly as before.

import { headers } from 'next/headers'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'
import { resolveDishTarget } from '@/src/lib/dishDeepLink'
import {
  dishShareHref,
  dishShareMetadata,
  dishSharePrice,
  shareImageHref,
  siteBaseUrl,
} from '@/src/lib/dishShare'
import MenuView from './MenuView'
import { overlayVoorMenu } from '@/src/lib/menukaartOverlay'
import { laadPubliekeOverlay } from '@/src/lib/menukaartOverlayServer'

function menuData(id) {
  const r = menusData[id] || null
  const baseId = id.split('-')[0]
  const restaurant = restaurantsData[baseId] || {}
  return { r, restaurant, baseId }
}

/**
 * The shared-dish preview. Everything here is delegated to src/lib/dishShare:
 * this function only supplies the real data. A missing or invalid dish link
 * returns `{}`, so the general metadata from app/layout.js stays in charge.
 */
export async function generateMetadata({ params, searchParams }) {
  const { id } = await params
  const query = (await searchParams) || {}
  const { r, restaurant } = menuData(id)
  if (!r) return {}

  const target = resolveDishTarget(query.dish, query.name, query.cat, id, r.categories)
  if (!target) return {}

  const category = r.categories[target.catIdx]
  const item = category.items[target.itemIdx]
  const dishId = `${id}-${target.catIdx}-${target.itemIdx}`
  const theme = query.stand
  const headerList = await headers()
  const baseUrl = siteBaseUrl({
    envUrl: process.env.NEXT_PUBLIC_SITE_URL,
    host: headerList.get('host'),
    proto: headerList.get('x-forwarded-proto'),
  })

  return dishShareMetadata({
    dishName: item.name,
    priceLabel: dishSharePrice(item),
    restaurantName: restaurant.name || r.name,
    address: restaurant.address,
    description: item.desc,
    baseUrl,
    href: dishShareHref({ menuLink: `/menu/${id}`, dishId, name: item.name, category: category.name, theme }),
    imageHref: shareImageHref({ menuId: id, dishId, name: item.name, category: category.name, theme }),
  })
}

export default async function MenuPage({ params }) {
  const { id } = await params
  const { r, restaurant } = menuData(id)
  const baseId = id.split('-')[0]
  const availableMeals = r
    ? ['lunch', 'diner', 'borrel', 'specialiteiten'].filter(m => menusData[`${baseId}-${m}`])
    : []

  // BE-58 deel 2 (#143): alleen de goedgekeurde wijzigingen van dít restaurant,
  // als overlay op de statische kaart. De statische data blijft ongewijzigd; is
  // er geen migratie of geen wijziging, dan is dit exact dezelfde kaart.
  const overlay = await laadPubliekeOverlay(baseId)
  const menu = r ? overlayVoorMenu(r, overlay, id) : r

  return (
    <MenuView
      id={id}
      r={menu}
      restaurant={restaurant}
      availableMeals={availableMeals}
      bevestiging={overlay.bevestiging}
    />
  )
}

