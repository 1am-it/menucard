// BE-69 (#172, uitkomst 1 en 2) — de vorm van de twee publieke tekstpagina's
// /privacy en /colofon.
//
// Eén component voor beide pagina's: ze hebben dezelfde opbouw (gedeelde kop,
// één smalle kolom tekst en de footer) en dezelfde opmaak als /voor-restaurants.
// De tekst zelf komt altijd uit src/lib/legalCopy.js; dit bestand voegt geen
// woorden toe. De pagina's eromheen zijn kleine Server Components met alleen
// hun eigen metadata.
//
// Alleen de gedeelde kop (PublicHeaderActions) is client-JS, net als op
// /voor-restaurants. Geen afbeeldingen, geen 'use client' in dit bestand.

import Link from 'next/link'
import PublicFooter from '@/src/components/PublicFooter'
import PublicHeaderActions from '@/src/components/PublicHeaderActions'
import Wordmark from '@/src/components/Wordmark'
import './legal-document.css'

// Een blok uit legalCopy: een alinea (met of zonder link) of een lijst.
function LegalBlock({ block }) {
  if (block.type === 'list') {
    return (
      <ul className="legal-list">
        {block.items.map((item) => (
          <li className="legal-list-item" key={item}>
            {item}
          </li>
        ))}
      </ul>
    )
  }

  // De zin staat letterlijk in legalCopy; alleen het genoemde woord wordt een
  // link, zodat "Lees onze privacyverklaring." ook echt naar /privacy gaat.
  const link = block.link;
  const index = link ? block.text.indexOf(link.text) : -1;
  if (index >= 0) {
    return (
      <p className="legal-paragraph">
        {block.text.slice(0, index)}
        <Link className="legal-link" href={link.href}>
          {link.text}
        </Link>
        {block.text.slice(index + link.text.length)}
      </p>
    )
  }

  return <p className="legal-paragraph">{block.text}</p>
}

export default function LegalDocument({ document }) {
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          {/* Hetzelfde navigatielandmark als de andere publieke pagina's: het
              woordmerk is de weg terug naar de site (ops/browser/lib/a11y-audit.js). */}
          <nav className="legal-nav" aria-label="Naar de site">
            <Wordmark />
          </nav>
          <div className="header-right">
            <PublicHeaderActions />
          </div>
        </div>
      </header>

      <main className="legal-main">
        <article className="legal-column">
          <h1 className="legal-title">{document.title}</h1>
          {document.updated ? <p className="legal-updated">{document.updated}</p> : null}
          {document.intro ? <p className="legal-intro">{document.intro}</p> : null}
          {document.sections.map((section) => (
            <section className="legal-section" key={section.id} aria-labelledby={`legal-${section.id}`}>
              <h2 className="legal-section-title" id={`legal-${section.id}`}>
                {section.heading}
              </h2>
              {section.blocks.map((block, index) => (
                <LegalBlock block={block} key={`${section.id}-${index}`} />
              ))}
            </section>
          ))}
        </article>
      </main>

      <PublicFooter />
    </>
  )
}
