// BE-44 (#105, criterium 3) — de vaste indeling D van beide
// voorvertoningsafbeeldingen (1200 × 630): een ronde kaart in de kleuren van de
// app, met onderaan rechts het "om"-blokje en "onze menukaarten".
//
// Alleen de inhoud erboven verschilt: één gerecht (app/menu/[id]/share-image)
// of een lijstje (app/mijn-lijstje/share-image). Zo blijven kleuren, rand,
// hoeken en de voettekst op één plek staan en kunnen ze niet uit elkaar lopen.
//
// Geen foto en geen extra dependency: alles is tekst en vlakken, gerenderd door
// next/og. De maten volgen de goedgekeurde artboards (restaurant ±64 px,
// gerecht ±76 px, prijs ±46 px, beschrijving ±30 px).

import { SHARE_BOLD_FAMILY } from './fonts'

/** De ronde kaart met omlijsting; `children` is de inhoud erboven. */
export default function ShareCard({ colors, children }) {
  return (
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
        {children}

        <div style={{ display: 'flex', flexGrow: 1 }} />

        {/* Het "om"-blokje vóór de kleine regel rechtsonder, precies zoals op de
            artboards: de accenttegel met het monogram, geen bitmap. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '46px',
              height: '46px',
              borderRadius: '13px',
              background: colors.logo,
              color: colors.logoText,
              fontFamily: SHARE_BOLD_FAMILY,
              fontSize: '25px',
              fontWeight: 700,
              letterSpacing: '-0.03em',
            }}
          >
            om
          </div>
          <div style={{ display: 'flex', fontSize: '22px', color: colors.textSecondary }}>
            onze menukaarten
          </div>
        </div>
      </div>
    </div>
  )
}
