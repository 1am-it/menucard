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
// src/lib/loginEntry.js, /voor-restaurants is FOR_RESTAURANTS_HREF in
// src/lib/forRestaurantsCopy.js en /privacy en /colofon zijn PRIVACY_HREF en
// COLOFON_HREF in src/lib/legalCopy.js (alle getest in
// src/components/PublicFooter.test.js). Hier letterlijke waarden, zodat een gast
// die deze pagina's laadt geen enkel extra module meeneemt voor de links.
const LOGIN_HREF = '/inloggen'
const RESTAURANTS_HREF = '/voor-restaurants'
const PRIVACY_HREF = '/privacy'
const COLOFON_HREF = '/colofon'

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer-inner">
        {/* BE-64 (#156, punt 5): "Voor restaurants" in de footer gaat nu naar de
            eigen pagina; het tweede deel blijft de ene ingang /inloggen. Beide
            links laden niet vooruit (BE-59 deel 3): zonder prefetch={false}
            haalde Next.js /inloggen al op zodra de link in de buurt van het
            venster kwam, gemeten in ops/browser/run-be59-load-size-check.js.
            BE-69 (#172, uitkomst 3): daar komen "Privacy" en "Colofon" bij. Ook
            die twee laden niet vooruit, om dezelfde reden. */}
        <Link className="public-footer-link" href={RESTAURANTS_HREF} prefetch={false}>
          Voor restaurants
        </Link>
        <span className="public-footer-sep" aria-hidden="true">
          ·
        </span>
        <Link className="public-footer-link" href={LOGIN_HREF} prefetch={false}>
          Inloggen
        </Link>
        <span className="public-footer-sep" aria-hidden="true">
          ·
        </span>
        <Link className="public-footer-link" href={PRIVACY_HREF} prefetch={false}>
          Privacy
        </Link>
        <span className="public-footer-sep" aria-hidden="true">
          ·
        </span>
        <Link className="public-footer-link" href={COLOFON_HREF} prefetch={false}>
          Colofon
        </Link>
      </div>
    </footer>
  )
}


