'use client'

// BE-54 (#133) — "Claim je restaurant": eerst zoeken, dan pas claimen.
//
// De pagina haalt dezelfde gegevens als /alle-restaurants (GET /api/restaurants
// in pagina's van 50, herhaald tot `hasMore` false is) en zoekt daarna met
// src/lib/claimSearch.js, dat dezelfde velden en rangorde gebruikt als de
// bestaande zoeklogica in src/services/restaurantIndex.js. Er komt dus geen
// nieuwe API, geen database en geen extra download bij: dit is precies wat
// /alle-restaurants al ophaalt.
//
// Tijdens het typen filtert de al geladen lijst, dus zonder netwerk per toets.
// Per regel staan alleen naam, adres en buurt plus de knop naar de bestaande
// claimroute /claim/[id]; of een restaurant al geclaimd is, blijft daar
// (privacy, contractpunt 5). De opmaak staat in claimen.css naast deze pagina
// (BE-52); app/globals.css blijft ongemoeid.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import MobileTabBar from '@/src/components/MobileTabBar'
import PrimaryNav from '@/src/components/PrimaryNav'
import ThemeToggle from '@/src/components/ThemeToggle'
import Wordmark from '@/src/components/Wordmark'
import {
  CLAIM_SEARCH_MESSAGES,
  claimResultRows,
  claimResultStatus,
  contactMailto,
  countClaimMatches,
  normalizeClaimQuery,
} from '@/src/lib/claimSearch'
import './claimen.css'

const PAGE_LIMIT = 50
const MAX_PAGES = 20

const STEPS = [
  { title: 'Zoek je restaurant', text: 'Vul (een deel van) de naam, de straat of de buurt in.' },
  { title: 'Kies je restaurant', text: 'Klopt het? Klik dan op "Dit is mijn restaurant".' },
  {
    title: 'Bevestig met je e-mailadres',
    text: 'Je krijgt een code van zes cijfers. Daarna beheer je de menukaart van je restaurant.',
  },
]

export default function ClaimSearchPage() {
  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [inputValue, setInputValue] = useState('')

  // Zonder NEXT_PUBLIC_CONTACT_EMAIL is er geen link en geen verzonnen adres.
  const mailto = contactMailto(process.env.NEXT_PUBLIC_CONTACT_EMAIL)

  useEffect(() => {
    let cancelled = false

    async function loadRestaurants() {
      try {
        let all = []
        let cursor = 0
        let pages = 0

        while (pages < MAX_PAGES) {
          const params = new URLSearchParams()
          if (cursor) params.set('cursor', String(cursor))
          params.set('limit', String(PAGE_LIMIT))

          const res = await fetch(`/api/restaurants?${params.toString()}`)
          if (!res.ok) throw new Error(`Request failed (${res.status})`)
          const data = await res.json()
          if (cancelled) return

          all = all.concat(Array.isArray(data.results) ? data.results : [])
          pages += 1

          if (!data.hasMore || data.nextCursor == null) break
          cursor = data.nextCursor
        }

        if (cancelled) return
        setRestaurants(all)
      } catch (e) {
        if (cancelled) return
        setError(CLAIM_SEARCH_MESSAGES.loadError)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadRestaurants()
    return () => {
      cancelled = true
    }
  }, [])

  const query = normalizeClaimQuery(inputValue)
  const rows = useMemo(
    () => claimResultRows(restaurants, query).filter((row) => row.restaurantId),
    [restaurants, query],
  )
  const matched = useMemo(() => countClaimMatches(restaurants, query), [restaurants, query])
  const statusText = claimResultStatus(query, { matched, shown: rows.length })
  const searched = query.length >= 2
  const nothingFound = searched && !loading && !error && rows.length === 0

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Wordmark />
          <div className="header-right">
            <PrimaryNav />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="claimen-main">
        <h1 className="claimen-title">Welk restaurant is van jou?</h1>
        <p className="claimen-intro">
          Zoek je restaurant en claim het. We laten alleen de naam, het adres en de buurt zien.
        </p>

        <form className="claimen-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <label className="claimen-label" htmlFor="claimen-q">
            {CLAIM_SEARCH_MESSAGES.label}
          </label>
          <input
            id="claimen-q"
            className="claimen-input"
            type="search"
            name="q"
            autoComplete="off"
            placeholder={CLAIM_SEARCH_MESSAGES.placeholder}
            aria-describedby="claimen-hint claimen-status"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
          <p className="claimen-hint" id="claimen-hint">
            {CLAIM_SEARCH_MESSAGES.hint}
          </p>
        </form>

        <p className="claimen-status" id="claimen-status" role="status">
          {error ? CLAIM_SEARCH_MESSAGES.loadError : loading ? CLAIM_SEARCH_MESSAGES.loading : statusText}
        </p>

        {rows.length > 0 && (
          <ul className="claimen-results">
            {rows.map((row) => (
              <li className="claimen-result" key={row.restaurantId}>
                <div className="claimen-result-text">
                  <h2 className="claimen-result-name">{row.name}</h2>
                  {row.detail && <p className="claimen-result-detail">{row.detail}</p>}
                </div>
                <Link className="claimen-result-button" href={row.claimHref}>
                  {row.claimLabel}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {nothingFound && (
          <div className="claimen-empty">
            <h2 className="claimen-empty-title">Niets gevonden</h2>
            <p className="claimen-empty-text">{CLAIM_SEARCH_MESSAGES.emptyHelp}</p>
            <p className="claimen-empty-text">
              Staat je restaurant er niet bij?{' '}
              {mailto ? (
                <a className="claimen-contact" href={mailto}>
                  {CLAIM_SEARCH_MESSAGES.contactLabel}
                </a>
              ) : (
                'Laat het ons weten.'
              )}
            </p>
          </div>
        )}

        <section className="claimen-how" aria-labelledby="claimen-how-title">
          <h2 className="claimen-how-title" id="claimen-how-title">
            {CLAIM_SEARCH_MESSAGES.howTitle}
          </h2>
          <ol className="claimen-steps">
            {STEPS.map((step) => (
              <li className="claimen-step" key={step.title}>
                <h3 className="claimen-step-title">{step.title}</h3>
                <p className="claimen-step-text">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <MobileTabBar />
    </>
  )
}
