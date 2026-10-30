// BE-46 (#106, criterium 2) — de stem van één stemmer.
//
// POST   `{ stemmer, roepnaam, dishKey, lekker }`: één stem, geweigerd na de
//        sluitingstijd (409), boven 50 stemmers (409) en bij een gerecht dat
//        niet in de stemming zit (400). Een nieuwe stem op hetzelfde gerecht
//        vervangt de vorige (uniek op stemming, stemmer, gerecht).
// DELETE `{ stemmer }` (of `?stemmer=`): de laatste stem van die stemmer
//        ongedaan, zolang de stemming open is.
//
// `stemmer` is het willekeurige kenmerk uit de browser van de stemmer zelf
// (localStorage), nooit een IP-adres, user agent of account. De logica staat in
// src/lib/kiesHandlers.js; de route doet niets anders dan antwoorden.

import { NextResponse } from 'next/server'
import { kiesHandlers } from '@/src/lib/kiesRouteDeps'

export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
}

export async function POST(request, { params }) {
  const { code } = await params
  const { status, body } = await kiesHandlers.vote(request, { code })
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function DELETE(request, { params }) {
  const { code } = await params
  const { status, body } = await kiesHandlers.undoVote(request, { code })
  return NextResponse.json(body, { status, headers: NO_STORE })
}
