// BE-44 (#105, criterium 4) — de voorvertoningsafbeelding (1200 × 630) van een
// gedeeld lijstje, in dezelfde indeling D als de afbeelding van één gerecht:
// dezelfde ronde kaart, dezelfde kleuren uit src/lib/shareTheme.js, hetzelfde
// "om"-blokje rechtsonder.
//
// Inhoud (artboard "Lijstje · licht/donker"): "<n> gerechten om uit te kiezen"
// bovenaan, daaronder per regel het gerecht, het restaurant en de prijs. Meer
// dan vier regels past niet leesbaar; de rest wordt geteld ("+ n meer").
//
// Alleen de id's komen uit de link; de namen, restaurants en prijzen komen uit
// de echte menukaarten, precies zoals de pagina zelf. Onbekende id's worden
// overgeslagen. Geen foto, geen nieuwe dependency, cachebaar.

import { ImageResponse } from 'next/og'
import menusData from '@/data/menus.json'
import restaurantsData from '@/data/restaurants.json'
import { oneLineDescription } from '@/src/lib/dishShare'
import { LIST_PARAM, decodeListParam, listImageRows, listImageTitle, resolveListDishes } from '@/src/lib/dishList'
import { shareThemeFor } from '@/src/lib/shareTheme'
import ShareCard from '@/app/_share/ShareCard'
import { loadShareBoldFonts, SHARE_BOLD_FAMILY } from '@/app/_share/fonts'

export const runtime = 'nodejs'

const IMAGE_SIZE = { width: 1200, height: 630 }

function notFound(message) {
  return new Response(message, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(request) {
  const url = new URL(request.url)
  const { ids } = decodeListParam(url.searchParams.get(LIST_PARAM))
  const { dishes } = resolveListDishes({ ids, menus: menusData, restaurants: restaurantsData })
  if (dishes.length === 0) return notFound('Geen geldig lijstje')

  const colors = shareThemeFor(url.searchParams.get('stand'))
  const { rows, more } = listImageRows(dishes)
  const fonts = await loadShareBoldFonts()

  return new ImageResponse(
    (
      <ShareCard colors={colors}>
        <div
          style={{
            display: 'flex',
            fontSize: '52px',
            lineHeight: 1.1,
            fontFamily: SHARE_BOLD_FAMILY,
            fontWeight: 700,
            color: colors.textPrimary,
          }}
        >
          {listImageTitle(dishes.length)}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: '18px' }}>
          {rows.map((entry) => (
            <div
              key={entry.id}
              style={{ display: 'flex', alignItems: 'center', gap: '20px', marginTop: '20px' }}
            >
              <div
                style={{
                  display: 'flex',
                  flexGrow: 1,
                  fontFamily: SHARE_BOLD_FAMILY,
                  fontSize: '34px',
                  fontWeight: 700,
                  color: colors.textPrimary,
                }}
              >
                {oneLineDescription(entry.name, 32)}
              </div>
              <div
                style={{
                  display: 'flex',
                  maxWidth: '300px',
                  fontSize: '26px',
                  color: colors.textSecondary,
                }}
              >
                {oneLineDescription(entry.restaurant, 24)}
              </div>
              <div
                style={{
                  display: 'flex',
                  padding: '6px 20px',
                  borderRadius: '14px',
                  background: colors.priceBg,
                  color: colors.priceText,
                  fontFamily: SHARE_BOLD_FAMILY,
                  fontSize: '30px',
                  fontWeight: 700,
                }}
              >
                {entry.price}
              </div>
            </div>
          ))}
        </div>

        {more > 0 ? (
          <div style={{ display: 'flex', marginTop: '18px', fontSize: '26px', color: colors.textSecondary }}>
            + {more} meer
          </div>
        ) : null}
      </ShareCard>
    ),
    {
      ...IMAGE_SIZE,
      fonts,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  )
}
