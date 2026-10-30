'use client'

// BE-45 (#114) — /internal/tellers: de tellertabel in het interne beheer.
//
// Volgt hetzelfde patroon als elke andere interne pagina (src/lib/
// supabaseBrowser.js voor de sessie, /api/internal/v1/tellers voor de data,
// InternalNav bovenaan) — de browser praat nooit rechtstreeks met Supabase.
//
// Wat dit scherm toont (contract criterium 3, mockup goedgekeurd 29 okt):
//  - periodeknoppen (aria-pressed) voor vandaag, 7 en 30 dagen;
//  - drie totalen over de periode;
//  - op een breed scherm een tabel met sorteerbare kolommen (aria-sort), op een
//    telefoon dezelfde rijen als lijst met één sorteerkeuze;
//  - de gerechtnaam linkt naar de publieke gerechtpagina (de bestaande
//    BE-12-deeplink, die de API al meegeeft);
//  - de standaardsortering is Gedeeld, aflopend;
//  - een lege staat en een foutstaat ("Tellers zijn nu niet beschikbaar"), en
//    de pagina toont nooit een verzonnen 0 als de data ontbreekt.
//
// Alle rekenregels (periode, optellen, sorteren) staan in
// src/lib/dishCounterReport.js en zijn daar met `node --test` getest; deze
// pagina rendert alleen. Kleuren komen uitsluitend uit de tokens in
// app/globals.css, dus licht en donker werken automatisch.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
// BE-52 (#128): de eigen opmaak van deze pagina staat naast de pagina.
import './tellers.css'

import {
  COLUMNS,
  DEFAULT_PERIOD,
  DEFAULT_SORT,
  EMPTY_MESSAGE,
  PAGE_TITLE,
  PERIODS,
  PERIOD_GROUP_LABEL,
  SORT_LABEL,
  SORT_OPTIONS,
  TABLE_CAPTION,
  TOTALS_LABEL,
  TRUNCATED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  UNKNOWN_DISH_LABEL,
  nextSort,
  normalizePeriod,
  parseSortOption,
  periodLabel,
  sortOptionValue,
  sortRows,
} from '@/src/lib/dishCounterReport'

const ENDPOINT = '/api/internal/v1/tellers'

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('nl-NL') : '0'
}

function ariaSort(sort, kolom) {
  if (sort.kolom !== kolom) return 'none'
  return sort.richting === 'aflopend' ? 'descending' : 'ascending'
}

function sortArrow(sort, kolom) {
  if (sort.kolom !== kolom) return '↕'
  return sort.richting === 'aflopend' ? '↓' : '↑'
}

/** De gerechtnaam: een link naar de publieke pagina, of de sleutel als het
 * gerecht niet meer bestaat (met de eerlijke vermelding erbij). */
function DishName({ row }) {
  if (row.href) {
    return (
      <a className="tellers-dish-link" href={row.href}>
        {row.gerecht}
      </a>
    )
  }
  return (
    <span className="tellers-dish-unknown">
      <span className="tellers-dish-key">{row.gerecht}</span>
      <span className="tellers-dish-unknown-label">{UNKNOWN_DISH_LABEL}</span>
    </span>
  )
}

function Totals({ totalen }) {
  return (
    <dl className="tellers-totals" aria-label={TOTALS_LABEL}>
      {COLUMNS.filter((column) => column.numeric).map((column) => (
        <div className="tellers-total" key={column.id}>
          <dt className="tellers-total-label">{column.label}</dt>
          <dd className="tellers-total-value">{formatNumber(totalen && totalen[column.id])}</dd>
        </div>
      ))}
    </dl>
  )
}


export default function TellersPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [periode, setPeriode] = useState(DEFAULT_PERIOD)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState(DEFAULT_SORT)
  // Een trage oude reactie mag een nieuwere keuze nooit overschrijven.
  const requestRef = useRef(0)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/internal/login')
      } else {
        setSession(data.session)
      }
    })
  }, [router])

  const loadTellers = useCallback(async (token, wantedPeriode) => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${ENDPOINT}?periode=${encodeURIComponent(normalizePeriod(wantedPeriode))}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (requestRef.current !== requestId) return
      if (!res.ok) {
        // Ook een 403 of 503 wordt de nette foutstaat, nooit een lege tabel.
        setError((data && data.error) || UNAVAILABLE_MESSAGE)
        setReport(null)
        return
      }
      setReport(data)
    } catch (caught) {
      if (requestRef.current !== requestId) return
      setError(UNAVAILABLE_MESSAGE)
      setReport(null)
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) loadTellers(session.access_token, periode)
  }, [session, periode, loadTellers])

  const rijen = useMemo(() => sortRows((report && report.rijen) || [], sort), [report, sort])
  const aantalGerechten = (report && report.aantalGerechten) || 0

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main" style={{ color: 'var(--text-secondary)' }}>
          Bezig met laden…
        </main>
      </div>
    )
  }

  return (
    <div className="di-page">
      <main className="di-main">
        <InternalNav accessToken={session.access_token} />

        <div className="di-topbar">
          <h1 className="di-title">{PAGE_TITLE}</h1>
        </div>

        <div className="di-banner di-banner-info">
          <span>Anonieme totalen per gerecht. Alleen aantallen — geen namen, geen export.</span>
        </div>

        <div className="tellers-periods" role="group" aria-label={PERIOD_GROUP_LABEL}>
          {PERIODS.map((period) => (
            <button
              key={period.id}
              type="button"
              className="tellers-period"
              aria-pressed={periode === period.id}
              onClick={() => setPeriode(period.id)}
            >
              {period.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="di-banner di-banner-danger" role="alert">
            <span>{error}</span>
          </div>
        )}

        {!error && loading && !report && (
          <p className="tellers-status" role="status">
            Bezig met laden…
          </p>
        )}

        {!error && loading && report && (
          <p className="tellers-status" role="status">
            Bezig met bijwerken…
          </p>
        )}

        {!error && report && (
          <>
            <h2 className="tellers-section-title">Totalen · {periodLabel(report.periode || periode)}</h2>
            <Totals totalen={report.totalen} />

            {rijen.length === 0 ? (
              <p className="tellers-empty">{EMPTY_MESSAGE}</p>
            ) : (
              <>
                {aantalGerechten > rijen.length && <p className="tellers-note">{TRUNCATED_MESSAGE}</p>}

                <div className="tellers-table-wrap">
                  <table className="tellers-table">
                    <caption className="tellers-caption">{TABLE_CAPTION}</caption>
                    <thead>
                      <tr>
                        {COLUMNS.map((column) => (
                          <th
                            key={column.id}
                            scope="col"
                            aria-sort={ariaSort(sort, column.id)}
                            className={column.numeric ? 'tellers-col-number' : undefined}
                          >
                            <button
                              type="button"
                              className="tellers-sort"
                              onClick={() => setSort(nextSort(sort, column.id))}
                            >
                              <span>{column.label}</span>
                              <span aria-hidden="true" className="tellers-sort-arrow">
                                {sortArrow(sort, column.id)}
                              </span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rijen.map((row) => (
                        <tr key={row.dishKey}>
                          <td>
                            <DishName row={row} />
                          </td>
                          <td className="tellers-col-restaurant">{row.restaurant || '—'}</td>
                          <td className="tellers-col-number">{formatNumber(row.gedeeld)}</td>
                          <td className="tellers-col-number">{formatNumber(row.bewaard)}</td>
                          <td className="tellers-col-number">{formatNumber(row.reserveren)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="tellers-list">
                  <div className="tellers-sort-choice">
                    <label htmlFor="tellers-sort">{SORT_LABEL}</label>
                    <select
                      id="tellers-sort"
                      className="di-select"
                      value={sortOptionValue(sort)}
                      onChange={(event) => setSort(parseSortOption(event.target.value))}
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <ul className="tellers-cards">
                    {rijen.map((row) => (
                      <li className="tellers-card" key={row.dishKey}>
                        <div className="tellers-card-name">
                          <DishName row={row} />
                        </div>
                        <div className="tellers-card-restaurant">{row.restaurant || '—'}</div>
                        <dl className="tellers-card-numbers">
                          {COLUMNS.filter((column) => column.numeric).map((column) => (
                            <div key={column.id}>
                              <dt>{column.label}</dt>
                              <dd>{formatNumber(row[column.id])}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
