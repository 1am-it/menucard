// Afscherming zolang de site nog niet publiek is. De regels staan in
// src/lib/siteAccess.js; dit is alleen de Next.js-ingang.

import { NextResponse } from 'next/server'
import { siteAccessDecision } from './src/lib/siteAccess'

export function middleware(request) {
  const decision = siteAccessDecision({
    pathname: request.nextUrl.pathname,
    authorization: request.headers.get('authorization'),
    password: process.env.SITE_ACCESS_PASSWORD,
    indexable: process.env.NEXT_PUBLIC_SITE_INDEXABLE,
  })

  const response = decision.allow
    ? NextResponse.next()
    : new NextResponse('Deze site is nog niet publiek.', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="onze menukaarten (nog niet publiek)", charset="UTF-8"' },
      })
  if (decision.noindex) response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
