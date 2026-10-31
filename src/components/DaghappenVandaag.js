'use client'

// BE-55 stap B, deel 4 (#135) — "Daghappen vandaag" op de home.
//
// Maximaal drie aanbiedingen in willekeurige volgorde (de server schudt), met
// per kaart de naam, de prijs, het restaurant en een link naar de
// restaurantpagina. "Alle" gaat naar de zoekresultaten met het filter
// "Vandaag" (`?vandaag=1`).
//
// De server rendert deze sectie bewust niet: het aanbod hangt van de klok af
// (zie app/page.js). Daarom haalt deze component het na het laden op bij
// /api/v1/daghap/vandaag, met een kleine lijst en nooit de hele tabel. Is er
// niets (of is de migratie er nog niet), dan verschijnt er geen sectie — geen
// lege kop en geen verzonnen gerecht.
//
// Opmaak staat in ./daghappen-vandaag.css (BE-52), kleuren via de tokens.

import { useEffect, useState } from 'react'
// BE-67: alleen de drie korte bezoekerslabels, niet het formulier of de
// meldingenlijst: de eerste lading van de home mag hooguit 1 KB groeien.
import { DAGHAP_PUBLIEK } from '@/src/lib/daghapPubliek'
import './daghappen-vandaag.css'

const API = '/api/v1/daghap/vandaag'
const ALLE_HREF = '/search?vandaag=1'

export default function DaghappenVandaag() {
  const [aanbod, setAanbod] = useState([])

  useEffect(() => {
    let actief = true
    fetch(API, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!actief || !body || !Array.isArray(body.aanbod)) return
        setAanbod(body.aanbod.slice(0, 3))
      })
      .catch(() => {
        if (actief) setAanbod([])
      })
    return () => {
      actief = false
    }
  }, [])

  if (aanbod.length === 0) return null

  return (
    <section className="daghappen-vandaag" aria-labelledby="daghappen-vandaag-titel">
      <div className="daghappen-vandaag-kop">
        <h2 id="daghappen-vandaag-titel" className="daghappen-vandaag-titel">
          Daghappen vandaag
        </h2>
        <a className="daghappen-vandaag-alle" href={ALLE_HREF}>
          Alle
        </a>
      </div>
      <ul className="daghappen-vandaag-lijst">
        {aanbod.map((rij) => {
          // BE-67, uitkomst 3 en 5: een uitverkocht aanbod blijft staan, grijs
          // en doorgestreept met de badge; een dagmenu toont beide prijzen.
          const uitverkocht = rij.uitverkocht === true
          const dagmenu = rij.soort === 'dagmenu'
          return (
            <li
              key={rij.id}
              className={`daghappen-vandaag-kaart${uitverkocht ? ' daghappen-vandaag-kaart--uitverkocht' : ''}`}
            >
              <a className="daghappen-vandaag-link" href={`/restaurant/${rij.restaurantId}`}>
                <span className={`daghappen-vandaag-naam${uitverkocht ? ' daghappen-vandaag-naam--uitverkocht' : ''}`}>
                  {rij.naam}
                </span>
                <span className="daghappen-vandaag-prijs">
                  {dagmenu && rij.prijs3
                    ? `${DAGHAP_PUBLIEK.prijs2} ${rij.prijs} · ${DAGHAP_PUBLIEK.prijs3} ${rij.prijs3}`
                    : rij.prijs}
                </span>
                <span className="daghappen-vandaag-label">{uitverkocht ? DAGHAP_PUBLIEK.uitverkocht : 'Vandaag'}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
