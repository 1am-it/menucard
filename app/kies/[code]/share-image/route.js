// BE-46 (#106, criterium 4) — de voorvertoningsafbeelding (1200 × 630) van een
// stemlink, in dezelfde indeling D als de afbeelding van een lijstje (BE-44):
// dezelfde ronde kaart, dezelfde kleuren uit src/lib/shareTheme.js.
//
// Inhoud: "Kies mee: <n> gerechten" bovenaan, daaronder per regel het gerecht,
// het restaurant en de prijs — hooguit vier regels, de rest wordt geteld.
// Alleen de code komt uit de link; de gerechten komen uit de echte data, via
// dezelfde uitlezing als de pagina (src/lib/kiesHandlers.js).
//
// Zonder de migratie bestaat er geen stemming en dus geen afbeelding: 404.
// Geen foto, geen nieuwe dependency, cachebaar.

import { ImageResponse } from 'next/og'
import { oneLineDescription } from '@/src/lib/dishShare'
import { kiesImageTitle } from '@/src/lib/kiesStemming'
import { kiesHandlers } from '@/src/lib/kiesRouteDeps'
import { shareThemeFor } from '@/src/lib/shareTheme'
import ShareCard from '@/app/_share/ShareCard'
import { loadShareBoldFonts, SHARE_BOLD_FAMILY } from '@/app/_share/fonts'

export const runtime = 'nodejs'

const IMAGE_SIZE = { width: 1200, height: 630 }
const MAX_ROWS = 4

function notFound(message) {
  return new Response(message, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(request, { params }) {
  const { code } = await params
  const url = new URL(request.url)

  let dishes = []
  try {
    const { status, body } = await kiesHandlers.readStemmingRequest(null, { code })
    if (status !== 200 || !body || !Array.isArray(body.dishes)) return notFound('Geen geldige stemlink')
    dishes = body.dishes
  } catch (error) {
    return notFound('Geen geldige stemlink')
  }
  if (dishes.length === 0) return notFound('Geen geldige stemlink')

  const colors = shareThemeFor(url.searchParams.get('stand'))
  const rows = dishes.slice(0, MAX_ROWS)
  const more = Math.max(dishes.length - MAX_ROWS, 0)
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
          {kiesImageTitle(dishes.length)}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: '18px' }}>
          {rows.map((entry) => (
            <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '20px', marginTop: '20px' }}>
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
              <div style={{ display: 'flex', maxWidth: '300px', fontSize: '26px', color: colors.textSecondary }}>
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
