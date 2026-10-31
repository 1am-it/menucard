// BE-59 (#146, punt 4) — de enige ingang om in te loggen, /inloggen.
//
// Een korte uitleg en twee duidelijke keuzes (mockup schermen 4 en 5): een
// restaurant, of het team van de menukaarten. Beide links gaan naar de
// bestaande inlogpagina's; deze pagina voegt geen eigen inloglogica, geen
// sessiecheck en geen rolherkenning toe (src/lib/loginEntry.js is de enige
// bron voor de keuzes en is daar getest). Wie nog geen account heeft, claimt
// eerst zijn restaurant.
//
// Een Server Component: er is hier niets interactiefs, dus geen client-JS
// nodig. De opmaak staat in het eigen bestand ernaast (BE-52).

import Link from 'next/link'
import { CLAIM_LINK, LOGIN_CHOICES, LOGIN_INTRO } from '@/src/lib/loginEntry'
import AccountMenuButton from '@/src/components/AccountMenuButton'
import ThemeToggle from '@/src/components/ThemeToggle'
import Wordmark from '@/src/components/Wordmark'
import './inloggen.css'

export const metadata = {
  title: 'Inloggen · BredaEats',
}

export default function InloggenPage() {
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          {/* BE-59 deel 3: de publieke pagina's hebben een navigatielandmark
              (ops/browser/lib/a11y-audit.js, BE-51). /inloggen had er geen: het
              woordmerk is de enige echte weg terug naar de site, dus die link
              staat hier in een eigen <nav> met een naam. De opmaak blijft
              gelijk; zonder deze nav faalde de toegankelijkheidscheck op een
              ontbrekend nav-landmark. */}
          <nav className="inloggen-nav" aria-label="Naar de site">
            <Wordmark />
          </nav>
          <div className="header-right">
            <ThemeToggle />
            <AccountMenuButton />
          </div>
        </div>
      </header>

      <main className="inloggen-main">
        <h1 className="inloggen-title">Inloggen</h1>
        <p className="inloggen-intro">{LOGIN_INTRO}</p>

        <ul className="inloggen-choices">
          {LOGIN_CHOICES.map((choice) => (
            <li key={choice.id}>
              <Link className="inloggen-choice" href={choice.href}>
                <span className="inloggen-choice-main">
                  <span className="inloggen-choice-label">{choice.label}</span>
                  <span className="inloggen-choice-detail">{choice.detail}</span>
                </span>
                <span className="inloggen-choice-hint">{choice.hint}</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="inloggen-claim">
          <Link className="inloggen-claim-link" href={CLAIM_LINK.href}>
            {CLAIM_LINK.label}
          </Link>
        </p>
      </main>
    </>
  )
}
