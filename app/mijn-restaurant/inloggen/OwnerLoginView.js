// BE-47 (#111) — inloggen voor restauranthouders op /mijn-restaurant/inloggen.
// BE-63 (#155, ronde 4): de flow zelf staat sinds deze ronde in één gedeelde
// component, src/components/OwnerLoginCodeForm.js, omdat /inloggen hetzelfde
// formulier direct op de pagina toont. Deze route blijft gewoon werken en toont
// dezelfde stappen, meldingen en fouten; alleen de twee links eronder staan
// hier.
//
// Eén code van zes cijfers, geen wachtwoord, geen authenticator, geen Google of
// Apple (eigenaarsbesluit 30 okt). De flow zelf staat in de gedeelde, geteste
// module src/lib/claimEmailCodeFlow.js (BE-48), inclusief de neutrale melding en
// de Nederlandse foutvertaling uit src/lib/authErrors.js. De inloglogica zelf is
// in deze ronde niet veranderd.

import Link from 'next/link'
import OwnerLoginCodeForm from '@/src/components/OwnerLoginCodeForm'
import { CLAIM_SEARCH_HREF, INTERNAL_LOGIN_HREF, OWNER_ACCESS_MESSAGES } from '@/src/lib/ownerAccess'

export default function OwnerLoginView() {
  return (
    <main className="auth-main">
      <div className="auth-card">
        <OwnerLoginCodeForm />

        <div className="auth-actions">
          <Link className="auth-link" href={CLAIM_SEARCH_HREF}>
            {OWNER_ACCESS_MESSAGES.claimRouteLabel}
          </Link>
          <Link className="auth-link" href={INTERNAL_LOGIN_HREF}>
            Ik werk bij de redactie
          </Link>
        </div>
      </div>
    </main>
  )
}
