// BE-44 (#105, criterium 3) — de voorvertoningsafbeelding (1200 × 630) van één
// gedeeld gerecht, in indeling D van het goedgekeurde ontwerp: een ronde kaart
// met het restaurant groot bovenaan, het adres, het gerecht met de prijs in een
// vlak, één regel beschrijving en "onze menukaarten" klein rechtsonder met het
// "om"-blokje ervoor.
//
// Kleuren: src/lib/shareTheme.js (de waarden van app/globals.css, met een test
// die ze vergelijkt). De stand komt uit `?stand=licht|donker` in de gedeelde
// link; `?stand=` verandert alleen deze afbeelding, nooit de pagina zelf.
//
// Maten: de artboards "Definitief · licht/donker" (restaurant ±64 px, gerecht
// ±76 px, prijs ±46 px, beschrijving ±30 px). Restaurant en gerecht staan vet:
// daarvoor laadt deze route één bold font (app/_share/fonts.js); op de gewone
// pagina's komt dat bestand nooit mee.
//
// Geen foto, geen nieuwe dependency: next/og (ImageResponse) zit al in Next.
// De afbeelding mag gecachet worden (contract criterium 3).

import { ImageResponse } from 'next/og'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'
import { resolveDishTarget } from '@/src/lib/dishDeepLink'
import { dishSharePrice, oneLineDescription } from '@/src/lib/dishShare'
import { shareThemeFor } from '@/src/lib/shareTheme'
import ShareCard from '@/app/_share/ShareCard'
import { loadShareBoldFonts, SHARE_BOLD_FAMILY } from '@/app/_share/fonts'

export const runtime = 'nodejs'

const IMAGE_SIZE = { width: 1200, height: 630 }

function notFound(message) {
  return new Response(message, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(request, { params }) {
  const { id } = await params
  const url = new URL(request.url)
  const menu = menusData[id]
  if (!menu) return notFound('Onbekende menukaart')

  const target = resolveDishTarget(
    url.searchParams.get('dish'),
    url.searchParams.get('name'),
    url.searchParams.get('cat'),
    id,
    menu.categories,
  )
  if (!target) return notFound('Geen geldig gerecht')

  const category = menu.categories[target.catIdx]
  const item = category.items[target.itemIdx]
  const restaurant = restaurantsData[id.split('-')[0]] || {}
  const colors = shareThemeFor(url.searchParams.get('stand'))
  const restaurantName = restaurant.name || menu.name || 'Onze Menukaarten'
  const address = restaurant.address || ''
  const dishName = oneLineDescription(item.name, 40)
  const description = oneLineDescription(item.desc, 70)
  const price = dishSharePrice(item)
  const fonts = await loadShareBoldFonts()

  return new ImageResponse(
    (
      <ShareCard colors={colors}>
        <div
          style={{
            display: 'flex',
            fontSize: '64px',
            lineHeight: 1.05,
            fontFamily: SHARE_BOLD_FAMILY,
            fontWeight: 700,
            color: colors.textPrimary,
          }}
        >
          {restaurantName}
        </div>
        {address ? (
          <div style={{ display: 'flex', marginTop: '14px', fontSize: '30px', color: colors.textSecondary }}>
            {address}
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', marginTop: '40px', gap: '24px' }}>
          <div
            style={{
              display: 'flex',
              maxWidth: '780px',
              fontSize: '76px',
              lineHeight: 1.05,
              fontFamily: SHARE_BOLD_FAMILY,
              fontWeight: 700,
              color: colors.textPrimary,
            }}
          >
            {dishName}
          </div>
          <div
            style={{
              display: 'flex',
              padding: '10px 28px',
              borderRadius: '18px',
              background: colors.priceBg,
              color: colors.priceText,
              fontFamily: SHARE_BOLD_FAMILY,
              fontSize: '46px',
              fontWeight: 700,
            }}
          >
            {price}
          </div>
        </div>

        {description ? (
          <div style={{ display: 'flex', marginTop: '20px', fontSize: '30px', lineHeight: 1.3, color: colors.textSecondary }}>
            {description}
          </div>
        ) : null}
      </ShareCard>
    ),
    {
      ...IMAGE_SIZE,
      fonts,
      headers: {
        // De afbeelding mag gecachet worden (contract criterium 3).
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  )
}
