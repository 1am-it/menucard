// BE-44 (#105, criterium 4) — "Mijn lijstje" en het gedeelde lijstje.
//
// Twee gezichten op dezelfde pagina:
//   - zonder `?lijst=`: het eigen lijstje, uit localStorage (client, zie
//     MijnLijstjeView);
//   - met `?lijst=<id's>`: het lijstje van iemand anders. De id's worden hier op
//     de server opgezocht in de echte menukaarten. Wat niet (meer) bestaat wordt
//     stil overgeslagen en de pagina zegt hoeveel.
//
// De gedeelde link krijgt eigen metadata: og:title "<n> gerechten om uit te
// kiezen", og:description met de restaurants, og:url en de 1200 × 630-
// voorvertoning van het lijstje. Zonder `?lijst=` blijft de algemene metadata
// van app/layout.js staan (`{}`).
//
// Geen account, geen serveropslag: de id's staan in de URL, meer niet.

import { headers } from 'next/headers'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'
import { normalizeShareTheme, siteBaseUrl } from '@/src/lib/dishShare'
import {
  decodeListParam,
  listShareHref,
  listShareImageHref,
  listShareMetadata,
  resolveListDishes,
} from '@/src/lib/dishList'
import MijnLijstjeView from './MijnLijstjeView'

function resolveShared(query) {
  const decoded = decodeListParam(query.lijst)
  const resolved = resolveListDishes({
    ids: decoded.ids,
    menus: menusData,
    restaurants: restaurantsData,
  })
  return {
    shared: Boolean(query.lijst),
    dishes: resolved.dishes,
    skipped: decoded.skipped + resolved.skipped,
    stand: normalizeShareTheme(query.stand),
  }
}

export async function generateMetadata({ searchParams }) {
  const query = (await searchParams) || {}
  const { shared, dishes, stand } = resolveShared(query)
  if (!shared || dishes.length === 0) return {}

  const headerList = await headers()
  const baseUrl = siteBaseUrl({
    envUrl: process.env.NEXT_PUBLIC_SITE_URL,
    host: headerList.get('host'),
    proto: headerList.get('x-forwarded-proto'),
  })
  const values = dishes.map((dish) => dish.id)
  return listShareMetadata({
    count: dishes.length,
    entries: dishes,
    baseUrl,
    href: listShareHref({ values, theme: stand }),
    imageHref: listShareImageHref({ values, theme: stand }),
  })
}

export default async function MijnLijstjePage({ searchParams }) {
  const query = (await searchParams) || {}
  const { shared, dishes, skipped, stand } = resolveShared(query)

  return (
    <MijnLijstjeView
      shared={shared}
      sharedDishes={dishes}
      skipped={skipped}
      stand={stand}
    />
  )
}
