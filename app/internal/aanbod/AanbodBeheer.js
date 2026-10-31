'use client'

// BE-55 stap B, deel 4 (#135) — de lijst van de interne werkvoorraad.
//
// Eén regel per tegengehouden of gemeld aanbod, met de acties uit het contract:
// goedkeuren (weer online), verwijderen (offline, geschiedenis blijft) en het
// plaatsrecht van de houder afnemen of teruggeven. De knoppen doen één verzoek
// per klik en melden het resultaat in een live-regio; daarna wordt de lijst
// opnieuw geladen, zodat er nooit een verouderde status blijft staan.
//
// Toegankelijk: echte knoppen, een duidelijke naam per knop (welk aanbod, welk
// restaurant), geen icoon-only acties, en de statuszin staat in role="status".

import { useState } from 'react'

const API = '/api/internal/v1/daghap'

export default function AanbodBeheer({ data, loadError, token, onChanged }) {
  const [bezig, setBezig] = useState(null)
  const [melding, setMelding] = useState(null)
  const [fout, setFout] = useState(null)

  const aanbod = (data && data.aanbod) || []
  const plaatsrecht = (data && data.plaatsrecht) || []

  async function doe({ url, body, naam }) {
    setBezig(naam)
    setFout(null)
    setMelding(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const antwoord = await res.json().catch(() => ({}))
      if (!res.ok) setFout(antwoord.message || antwoord.error || 'De actie lukte niet.')
      else {
        setMelding(antwoord.bericht || 'Gelukt.')
        if (onChanged) await onChanged()
      }
    } catch (error) {
      setFout('De actie lukte niet. Probeer het opnieuw.')
    } finally {
      setBezig(null)
    }
  }

  return (
    <section className="aanbod-beheer" aria-labelledby="aanbod-beheer-titel">
      <header className="aanbod-beheer-kop">
        <h1 id="aanbod-beheer-titel" className="aanbod-beheer-titel">Aanbod in controle</h1>
        <p className="aanbod-beheer-uitleg">
          Daghappen en seizoensgerechten die de controle tegenhield of die gasten meldden.
          Goedkeuren zet het aanbod weer online; verwijderen haalt het offline en bewaart de
          geschiedenis.
        </p>
        {data && (
          <p className="aanbod-beheer-teller">
            {data.tegengehouden} tegengehouden · {data.gemeld} gemeld
          </p>
        )}
      </header>

      {loadError && <p className="aanbod-beheer-fout" role="alert">{loadError}</p>}
      <p className="aanbod-beheer-status" role="status" aria-live="polite">
        {melding || (fout ? fout : '')}
      </p>

      {data && aanbod.length === 0 && (
        <p className="aanbod-beheer-leeg">Er staat nu niets in controle.</p>
      )}


      {aanbod.length > 0 && (
        <ul className="aanbod-beheer-lijst">
          {aanbod.map((rij) => (
            <li key={rij.id} className="aanbod-beheer-rij">
              <div className="aanbod-beheer-gegevens">
                <p className="aanbod-beheer-naam">{rij.naam}</p>
                <p className="aanbod-beheer-meta">
                  {rij.soort === 'daghap' ? 'Daghap' : 'Seizoensgerecht'} · restaurant {rij.restaurantId} · {rij.prijs}
                </p>
                {rij.beschrijving && <p className="aanbod-beheer-beschrijving">{rij.beschrijving}</p>}
                <p className="aanbod-beheer-reden">
                  {rij.tegengehouden ? 'Tegengehouden' : 'Online'}
                  {rij.reden ? ` · ${rij.reden}` : ''}
                  {rij.meldingen > 0 ? ` · ${rij.meldingen} melding(en)` : ''}
                </p>
              </div>
              <div className="aanbod-beheer-acties">
                <button
                  type="button"
                  className="aanbod-beheer-knop"
                  onClick={() => doe({ url: `${API}/${rij.id}/goedkeuren`, naam: `goedkeuren-${rij.id}` })}
                  disabled={bezig === `goedkeuren-${rij.id}`}
                  aria-label={`Keur ${rij.naam} goed en zet het weer online`}
                >
                  Goedkeuren
                </button>
                <button
                  type="button"
                  className="aanbod-beheer-knop aanbod-beheer-knop-weg"
                  onClick={() => doe({ url: `${API}/${rij.id}/verwijderen`, naam: `verwijderen-${rij.id}` })}
                  disabled={bezig === `verwijderen-${rij.id}`}
                  aria-label={`Verwijder ${rij.naam} en haal het offline`}
                >
                  Verwijderen
                </button>
                {rij.houderId && (
                  <button
                    type="button"
                    className="aanbod-beheer-knop aanbod-beheer-knop-recht"
                    onClick={() => doe({
                      url: `${API}/plaatsrecht`,
                      body: { restaurant_id: rij.restaurantId, user_id: rij.houderId, actie: 'afnemen' },
                      naam: `recht-${rij.id}`,
                    })}
                    disabled={bezig === `recht-${rij.id}`}
                    aria-label={`Neem de houder van ${rij.naam} het plaatsrecht af`}
                  >
                    Plaatsrecht afnemen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}


      {plaatsrecht.length > 0 && (
        <section className="aanbod-beheer-rechten" aria-labelledby="aanbod-beheer-rechten-titel">
          <h2 id="aanbod-beheer-rechten-titel" className="aanbod-beheer-subtitel">Zonder plaatsrecht</h2>
          <ul className="aanbod-beheer-rechten-lijst">
            {plaatsrecht.map((rij) => (
              <li key={`${rij.restaurantId}-${rij.houderId}`} className="aanbod-beheer-rechten-rij">
                <span>Restaurant {rij.restaurantId} · houder {rij.houderId}</span>
                <button
                  type="button"
                  className="aanbod-beheer-knop"
                  onClick={() => doe({
                    url: `${API}/plaatsrecht`,
                    body: { restaurant_id: rij.restaurantId, user_id: rij.houderId, actie: 'teruggeven' },
                    naam: `terug-${rij.restaurantId}-${rij.houderId}`,
                  })}
                  disabled={bezig === `terug-${rij.restaurantId}-${rij.houderId}`}
                  aria-label={`Geef de houder van restaurant ${rij.restaurantId} het plaatsrecht terug`}
                >
                  Plaatsrecht teruggeven
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
