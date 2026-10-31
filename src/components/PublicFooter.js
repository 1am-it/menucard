'use client'

// BE-59 (#146, punt 3) — de footerlink onderaan de publieke pagina's.
//
// "Voor restaurants · Inloggen" gaat naar de ene ingang /inloggen. Er is geen
// sessiecheck en geen rolherkenning nodig: de link staat er voor iedereen, ook
// voor een gast. De opmaak staat in het eigen bestand ernaast (BE-52).

import Link from 'next/link'
import { LOGIN_PAGE_HREF } from '@/src/lib/loginEntry'
import './public-footer.css'

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer-inner">
        <Link className="public-footer-link" href={LOGIN_PAGE_HREF}>
          Voor restaurants · Inloggen
        </Link>
      </div>
    </footer>
  )
}
