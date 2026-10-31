// BE-59 (#146, punt 3) — de footerlink onderaan de publieke pagina's.
//
// "Voor restaurants · Inloggen" gaat naar de ene ingang /inloggen. Er is geen
// sessiecheck en geen rolherkenning nodig: de link staat er voor iedereen, ook
// voor een gast. Bewust geen 'use client': er is hier niets interactiefs, dus
// dit is alleen een klein stukje markup in de pagina's die het al laden. De
// opmaak staat in het eigen bestand ernaast (BE-52).

import Link from 'next/link'
import './public-footer.css'

// Dezelfde bestemming als LOGIN_PAGE_HREF in src/lib/loginEntry.js (getest in
// src/components/PublicFooter.test.js). Hier een letterlijke waarde, zodat een
// gast die deze pagina's laadt geen enkel extra module meeneemt voor één link.
const LOGIN_HREF = '/inloggen'

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer-inner">
        <Link className="public-footer-link" href={LOGIN_HREF}>
          Voor restaurants · Inloggen
        </Link>
      </div>
    </footer>
  )
}
