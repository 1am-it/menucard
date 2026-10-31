'use client'

// BE-55 stap B (#135) — het blok "Vandaag" op de restaurant- en menupagina.
//
// Haalt alleen het aanbod van dít ene restaurant op via de publieke GET
// (/api/v1/daghap/publiek) en toont niets als er geen aanbod is. Er gaat hier
// geen volledige lijst naartoe: één verzoek, één restaurant, alleen de velden
// voor de weergave (zie PUBLIEK_KOLOMMEN in src/lib/daghapHandlers.js).
//
// De meldknop is anoniem: de browser maakt één willekeurig kenmerk
// (localStorage) en stuurt alleen dat mee. Geen account, geen IP-adres, geen
// persoonsgegevens; de server telt per apparaat één melding en zet het aanbod na
// drie meldingen op in_controle.
//
// Opmaak staat in ./daghap-vandaag.css (BE-52); globals.css blijft ongemoeid.

import { useEffect, useState } from 'react'
import DishShareButton from '@/src/components/DishShareButton'
import { FORM_MESSAGES, GANG_KORT, LABEL_LABELS, herhaalKort, verloopTekst } from '@/src/lib/daghapFormulier'
import './daghap-vandaag.css'

const APPARAAT_KEY = 'daghap-apparaat'
const APPARAAT_PATROON = /^[A-Za-z0-9_-]{16,64}$/

/** Een willekeurig kenmerk van 24 tekens, één keer per browser bewaard. */
export function apparaatKenmerk(storage) {
  try {
    const bewaard = storage && storage.getItem(APPARAAT_KEY)
    if (bewaard && APPARAAT_PATROON.test(bewaard)) return bewaard
  } catch (error) {
    // localStorage kan geweigerd zijn; dan werkt melden zonder bewaard kenmerk.
  }
  const bytes = new Uint8Array(12)
  const bron = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null
  if (bron) {
    bron.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  const waarde = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  try {
    if (storage) storage.setItem(APPARAAT_KEY, waarde)
  } catch (error) {
    // Niet bewaard is ook goed: binnen deze pagina telt hij hoe dan ook één keer.
  }
  return waarde
}

function apparaat() {
  if (typeof window === 'undefined') return ''
  try {
    return apparaatKenmerk(window.localStorage)
  } catch (error) {
    return apparaatKenmerk(null)
  }
}

export default function DaghapVandaag({ restaurantId }) {
  const [aanbod, setAanbod] = useState([])
  const [meldingen, setMeldingen] = useState({})
  const [bezig, setBezig] = useState(null)

  useEffect(() => {
    if (!restaurantId) return undefined
    let cancelled = false
    fetch(`/api/v1/daghap/publiek?restaurant_id=${encodeURIComponent(restaurantId)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { aanbod: [] }))
      .then((body) => {
        if (cancelled) return
        setAanbod(Array.isArray(body && body.aanbod) ? body.aanbod : [])
      })
      .catch(() => {
        // Geen aanbod is hier hetzelfde als geen blok: de pagina blijft werken.
        if (!cancelled) setAanbod([])
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  async function meld(item) {
    setBezig(item.id)
    try {
      const res = await fetch(`/api/v1/daghap/${encodeURIComponent(item.id)}/meld`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apparaat: apparaat() }),
      })
      const body = await res.json().catch(() => ({}))
      setMeldingen((huidig) => ({
        ...huidig,
        [item.id]: res.ok
          ? (body.alGemeld ? FORM_MESSAGES.reportAlready : FORM_MESSAGES.reportConfirm)
          : (body.message || FORM_MESSAGES.reportFailed),
      }))
    } catch (error) {
      setMeldingen((huidig) => ({ ...huidig, [item.id]: FORM_MESSAGES.reportFailed }))
    } finally {
      setBezig(null)
    }
  }

  if (aanbod.length === 0) return null

  return (
    <section className="daghap-vandaag" aria-labelledby="daghap-vandaag-title">
      <h2 className="daghap-vandaag-title" id="daghap-vandaag-title">
        {FORM_MESSAGES.vandaagTitle}
      </h2>
      <ul className="daghap-vandaag-list">
        {aanbod.map((item) => {
          const seizoen = item.soort === 'seizoensgerecht'
          // BE-67: het dagmenu per gang, met beide prijzen; een uitverkocht
          // aanbod blijft in de lijst staan, grijs en doorgestreept.
          const dagmenu = item.soort === 'dagmenu'
          const gangen = Array.isArray(item.gangen) ? item.gangen : []
          const uitverkocht = item.uitverkocht === true
          const herhaal = herhaalKort({ herhaalWeekdagen: item.herhaalWeekdagen })
          const melding = meldingen[item.id]
          // De bestaande bewaar- en deelknop werken met een gerecht-entry; een
          // daghap krijgt er een met precies de velden die die knoppen gebruiken.
          // BE-67 (ronde 3): de id is tegelijk de aanbodsleutel van de
          // tellerroute (`daghap-<restaurant>-<aanbod>`, zie
          // src/lib/daghapAanbod.js), zodat Bewaren en Delen ook in
          // daghap_gebeurtenissen tellen. Beide knoppen gebruiken precies deze
          // id; geen tweede vorm ernaast.
          const entry = {
            id: `daghap-${restaurantId}-${item.id}`,
            name: item.naam,
            price: item.prijs,
            href: `/restaurant/${encodeURIComponent(restaurantId)}`,
          }
          return (
            <li
              className={`daghap-vandaag-card${uitverkocht ? ' daghap-vandaag-card--uitverkocht' : ''}`}
              key={item.id}
            >
              <div className="daghap-vandaag-head">
                <h3 className={`daghap-vandaag-name${uitverkocht ? ' daghap-vandaag-name--uitverkocht' : ''}`}>
                  {item.naam}
                </h3>
                {uitverkocht ? (
                  <span className="daghap-vandaag-badge">{FORM_MESSAGES.uitverkochtBadge}</span>
                ) : (
                  !dagmenu && <span className="daghap-vandaag-price">{item.prijs}</span>
                )}
              </div>
              {dagmenu && gangen.length > 0 && (
                <ul className="daghap-vandaag-gangen">
                  {gangen.map((gang) => (
                    <li className={`daghap-vandaag-gang daghap-vandaag-gang--${gang.gang}`} key={gang.gang}>
                      <span className="daghap-vandaag-gang-label">{GANG_KORT[gang.gang] || gang.gang}</span>
                      <span className="daghap-vandaag-gang-naam">{gang.naam}</span>
                    </li>
                  ))}
                </ul>
              )}
              {dagmenu && (
                <ul className="daghap-vandaag-prijzen">
                  <li className="daghap-vandaag-chip">{FORM_MESSAGES.prijs2Chip} {item.prijs}</li>
                  {item.prijs3 ? (
                    <li className="daghap-vandaag-chip">{FORM_MESSAGES.prijs3Chip} {item.prijs3}</li>
                  ) : null}
                </ul>
              )}
              {herhaal && <p className="daghap-vandaag-herhaal">{herhaal}</p>}
              {item.beschrijving && <p className="daghap-vandaag-desc">{item.beschrijving}</p>}
              {Array.isArray(item.labels) && item.labels.length > 0 && (
                <ul className="daghap-vandaag-labels">
                  {item.labels.map((label) => (
                    <li className="daghap-vandaag-label" key={label}>
                      {LABEL_LABELS[label] || label}
                    </li>
                  ))}
                </ul>
              )}
              {seizoen && (
                <p className="daghap-vandaag-season">
                  {FORM_MESSAGES.vandaagSeason} · {verloopTekst({ soort: item.soort, verlooptOp: item.verlooptOp })}
                </p>
              )}
              <div className="daghap-vandaag-actions">
                {/* BE-55 (issue 135, herstel na review deel 2) — DishShareButton
                    rendert zelf de bewaarknop zodra hij een `entry` krijgt.
                    Een losse DishSaveButton ernaast gaf twee bladwijzers;
                    daarom staat hier alleen de deelknop, net als op de
                    gerechtkaart (MenuItem). */}
                <DishShareButton
                  entry={entry}
                  name={item.naam}
                  title={item.naam}
                  href={entry.href}
                  dishKey={entry.id}
                />
              </div>
              <div className="daghap-vandaag-report">
                <button
                  type="button"
                  className="daghap-vandaag-report-button"
                  onClick={() => meld(item)}
                  disabled={bezig === item.id}
                >
                  {bezig === item.id ? FORM_MESSAGES.busy : FORM_MESSAGES.report}
                </button>
                {melding && (
                  <p className="daghap-vandaag-report-note" role="status">
                    {melding}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
