// BE-44 (#105, criterium 3) — het app-icoon voor "zet op het beginscherm":
// 180 × 180, scherp, met het bestaande "om"-beeldmerk uit app/icon.svg.
//
// Het beeldmerk staat als vector in src/lib/shareTheme.js (APP_ICON_SVG) en
// wordt hier als SVG-data-URI gerenderd; src/lib/shareTheme.test.js bewijst dat
// die constante exact gelijk is aan app/icon.svg, dus er is één bron. iOS lust
// geen SVG als apple-touch-icon, daarom levert deze route een PNG van 180 × 180.

import { ImageResponse } from 'next/og'
import { APP_ICON_SVG } from '@/src/lib/shareTheme'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(APP_ICON_SVG, 'utf8').toString('base64')}`
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUri} width={180} height={180} />
      </div>
    ),
    { ...size },
  )
}
