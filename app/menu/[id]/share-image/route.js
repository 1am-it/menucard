// BE-44 (#105, criterium 3) — de voorvertoningsafbeelding (1200 × 630) van één
// gedeeld gerecht, in indeling D van het goedgekeurde ontwerp: een ronde kaart
// met het restaurant groot bovenaan, het adres, het gerecht met de prijs in een
// vlak, één regel beschrijving en "onze menukaarten" klein rechtsonder.
//
// De kleuren komen uit src/lib/shareTheme.js (de waarden van app/globals.css,
// met een test die ze vergelijkt): licht met de okeren omlijsting, donker met
// de antraciete. De stand komt uit `?stand=licht|donker` in de gedeelde link;
// `?stand=` verandert alleen deze afbeelding, nooit de pagina zelf.
//
// Geen foto, geen nieuwe dependency: next/og (ImageResponse) zit al in Next.
// De afbeelding mag gecachet worden (contract criterium 3).

import { ImageResponse } from 'next/og'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'
import { resolveDishTarget } from '@/src/lib/dishDeepLink'
import { dishSharePrice, oneLineDescription } from '@/src/lib/dishShare'
import { shareThemeFor } from '@/src/lib/shareTheme'

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

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: colors.frame,
          padding: '42px',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: colors.card,
            border: `3px solid ${colors.border}`,
            borderRadius: '40px',
            padding: '54px 60px',
          }}
        >
          <div style={{ display: 'flex', fontSize: '62px', lineHeight: 1.1, fontWeight: 700, color: colors.textPrimary }}>
            {restaurantName}
          </div>
          {address ? (
            <div style={{ display: 'flex', marginTop: '14px', fontSize: '30px', color: colors.textSecondary }}>
              {address}
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', marginTop: '46px' }}>
            <div style={{ display: 'flex', fontSize: '48px', fontWeight: 700, color: colors.textPrimary }}>
              {dishName}
            </div>
            <div
              style={{
                display: 'flex',
                marginLeft: '22px',
                padding: '10px 26px',
                borderRadius: '999px',
                background: colors.priceBg,
                color: colors.priceText,
                fontSize: '32px',
                fontWeight: 700,
              }}
            >
              {price}
            </div>
          </div>

          {description ? (
            <div style={{ display: 'flex', marginTop: '22px', fontSize: '28px', lineHeight: 1.35, color: colors.textSecondary }}>
              {description}
            </div>
          ) : null}

          <div style={{ display: 'flex', flexGrow: 1 }} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '22px', color: colors.textSecondary }}>
            onze menukaarten
          </div>
        </div>
      </div>
    ),
    {
      ...IMAGE_SIZE,
      headers: {
        // De afbeelding mag gecachet worden (contract criterium 3).
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  )
}
