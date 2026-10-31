// BE-59 (#146, punt 4) en BE-63 (#155, ronde 4) — de ene ingang om in te
// loggen, /inloggen, volgens het op 31 oktober goedgekeurde ontwerp.
//
// Uitkomst 4 van het contract:
//   - bovenaan het accentlabel "Voor restaurants", de h1 "Inloggen bij je
//     restaurant" en de intro;
//   - het e-mailformulier direct op de pagina. Dat formulier is de bestaande
//     houder-inlog uit src/components/OwnerLoginCodeForm.js — dezelfde aanroep
//     om de code te versturen, dezelfde codestap en dezelfde foutmeldingen als
//     /mijn-restaurant/inloggen. De inloglogica zelf is niet veranderd;
//   - rechts (op mobiel eronder) het claimblok in --bg-elevated met drie
//     genummerde stappen en de omlijnde knop "Claim je restaurant";
//   - onderaan de zin voor bezoekers en de kleine team-inloglink.
//
// De teksten en paden staan in src/lib/loginEntry.js (één bron, getest). Een
// Server Component: alleen het formulier is client-JS.

import Link from 'next/link'
import { LOGIN_PAGE } from '@/src/lib/loginEntry'
import { LOGIN_PRIVACY_LINK } from '@/src/lib/legalCopy'
import OwnerLoginCodeForm from '@/src/components/OwnerLoginCodeForm'
import PublicHeaderActions from '@/src/components/PublicHeaderActions'
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
            <PublicHeaderActions />
          </div>
        </div>
      </header>

      <main className="inloggen-main">
        <div className="inloggen-columns">
          <section className="inloggen-login" aria-labelledby="inloggen-title">
            <p className="inloggen-eyebrow">{LOGIN_PAGE.eyebrow}</p>
            <h1 className="inloggen-title" id="inloggen-title">
              {LOGIN_PAGE.title}
            </h1>
            <p className="inloggen-intro">{LOGIN_PAGE.intro}</p>
            <div className="inloggen-form">
              <OwnerLoginCodeForm
                submitLabel={LOGIN_PAGE.submitLabel}
                showSignInHeading={false}
                headingLevel={2}
                emailHelp={LOGIN_PAGE.emailHelp}
              />
            </div>
            {/* BE-69 (uitkomst 3): naast de e-mailcode de verwijzing naar de
                privacyverklaring. De tekst en het pad staan in
                src/lib/legalCopy.js, zodat er geen tweede versie ontstaat. */}
            <p className="inloggen-privacy">
              <Link className="inloggen-privacy-link" href={LOGIN_PRIVACY_LINK.href}>
                {LOGIN_PRIVACY_LINK.label}
              </Link>
            </p>
          </section>

          <aside className="inloggen-claim" aria-labelledby="inloggen-claim-title">
            <h2 className="inloggen-claim-title" id="inloggen-claim-title">
              {LOGIN_PAGE.claim.title}
            </h2>
            <p className="inloggen-claim-body">{LOGIN_PAGE.claim.body}</p>
            <ol className="inloggen-steps">
              {LOGIN_PAGE.claim.steps.map((step, index) => (
                <li className="inloggen-step" key={step}>
                  <span className="inloggen-step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="inloggen-step-text">{step}</span>
                </li>
              ))}
            </ol>
            <Link className="inloggen-claim-action" href={LOGIN_PAGE.claim.actionHref}>
              {LOGIN_PAGE.claim.actionLabel}
            </Link>
          </aside>
        </div>

        <div className="inloggen-footer">
          <p className="inloggen-visitor">{LOGIN_PAGE.visitor}</p>
          <p className="inloggen-team">
            <Link className="inloggen-team-link" href={LOGIN_PAGE.teamHref}>
              {LOGIN_PAGE.teamLabel}
            </Link>
          </p>
        </div>
      </main>
    </>
  )
}

