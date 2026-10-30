// BE-46 (#106, criterium 4) — de stemlink /kies/<code>.
//
// De server leest de stemming alleen voor de voorvertoning (OG): "Kies mee: <n>
// gerechten", in de stijl van BE-44. De pagina zelf haalt de gegevens met
// GET /api/v1/kies/<code> (src/lib/kiesHandlers.js), zodat dezelfde route werkt
// zonder bouwtijddata en een browsercheck hem met een gestubde API kan draaien.
//
// Ontbreekt de migratie, dan is de telling onbekend en blijft de kop "Kies mee";
// de pagina toont dan "Samen kiezen is nog niet beschikbaar". Een ongeldige code
// is een 404 en nooit een gok.

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { siteBaseUrl } from '@/src/lib/dishShare'
import { isKiesCode, kiesHref, kiesImageHref, kiesMetadata } from '@/src/lib/kiesStemming'
import { kiesHandlers } from '@/src/lib/kiesRouteDeps'
import KiesView from './KiesView'

export const dynamic = 'force-dynamic'

/** Het aantal gerechten van een stemming, of 0 als dat (nog) niet lukt. */
async function stemmingCount(code) {
  try {
    const { status, body } = await kiesHandlers.readStemmingRequest(null, { code })
    if (status !== 200 || !body || !Array.isArray(body.dishes)) return 0
    return body.dishes.length
  } catch (error) {
    return 0
  }
}

export async function generateMetadata({ params }) {
  const { code } = await params
  if (!isKiesCode(code)) return {}
  const count = await stemmingCount(code)
  const headerList = await headers()
  const baseUrl = siteBaseUrl({
    envUrl: process.env.NEXT_PUBLIC_SITE_URL,
    host: headerList.get('host'),
    proto: headerList.get('x-forwarded-proto'),
  })
  return kiesMetadata({
    count,
    baseUrl,
    href: kiesHref(code),
    imageHref: kiesImageHref({ code }),
  })
}

export default async function KiesPage({ params }) {
  const { code } = await params
  if (!isKiesCode(code)) notFound()
  return <KiesView code={code} />
}
