// BE-59 (#146, punt 3) — de footerlink onderaan de publieke pagina's.
//
// "Voor restaurants · Inloggen" gaat naar de ene ingang /inloggen. Er is geen
// sessiecheck en geen rolherkenning nodig: de link staat er voor iedereen, ook
// voor een gast. Bewust geen 'use client': er is hier niets interactiefs, dus
// dit is alleen een klein stukje markup in de pagina's die het al laden. De
// opmaak staat in het eigen bestand ernaast (BE-52).

import Link from 'next/link'
import './public-footer.css'

// Dezelfde bestemmingen als de gedeelde bronnen: /inloggen is LOGIN_PAGE_HREF in
// src/lib/loginEntry.js en /voor-restaurants is FOR_RESTAURANTS_HREF in
// src/lib/forRestaurantsCopy.js (beide getest in
// src/components/PublicFooter.test.js). Hier letterlijke waarden, zodat een gast
// die deze pagina's laadt geen enkel extra module meeneemt voor twee links.
const LOGIN_HREF = '/inloggen'
const RESTAURANTS_HREF = '/voor-restaurants'

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer-inner">
        {/* BE-64 (#156, punt 5): "Voor restaurants" in de footer gaat nu naar de
            eigen pagina; het tweede deel blijft de ene ingang /inloggen. Beide
            links laden niet vooruit (BE-59 deel 3): zonder prefetch={false}
            haalde Next.js /inloggen al op zodra de link in de buurt van het
            venster kwam, gemeten in ops/browser/run-be59-load-size-check.js. */}
        <Link className="public-footer-link" href={RESTAURANTS_HREF} prefetch={false}>
          Voor restaurants
        </Link>
        <span className="public-footer-sep" aria-hidden="true">
          ·
        </span>
        <Link className="public-footer-link" href={LOGIN_HREF} prefetch={false}>
          Inloggen
        </Link>
      </div>
    </footer>
  )
}

