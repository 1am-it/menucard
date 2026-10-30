'use client'

// BE-47 (#111) — "Mijn restaurant": het eigen overzicht van een houder.
//
// Deze pagina beslist niets zelf. Ze haalt alleen op wat het contract noemt —
// `GET /api/internal/v1/me` (de owner-rijen met `restaurant_id`) en
// `GET /api/claims/mine` (de eigen claims) — en laat daarna
// src/lib/ownerRestaurantOverview.js bepalen wat er staat. Namen en links komen
// uit de statische index die de serverpagina meegeeft (data/restaurants.json en
// data/menus.json blijven server-side).
//
// Zonder sessie gaat de bezoeker naar /mijn-restaurant/inloggen. Een
// internal/editor-account wordt naar /internal/login gestuurd (BE-48 se tweede
// stap), nooit stilzwijgend naar dit scherm. Uitloggen en "Account verwijderen"
// staan onderaan; de verwijdering zelf verloopt via de serverroute en is daar
// getest.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { MESSAGES } from '@/src/lib/authErrors'
import {
  CLAIM_SEARCH_HREF,
  INTERNAL_LOGIN_HREF,
  OWNER_ACCESS_MESSAGES,
  OWNER_LOGIN_HREF,
  resolveOwnerEntry,
} from '@/src/lib/ownerAccess'
import { OWNER_OVERVIEW_MESSAGES, buildOwnerOverview } from '@/src/lib/ownerRestaurantOverview'
import ThemeToggle from '@/src/components/ThemeToggle'
// BE-52 (#128): de eigen opmaak van deze pagina staat naast de pagina.
import './mijn-restaurant.css'

import Wordmark from '@/src/components/Wordmark'
import OwnerAccountDeletion from './OwnerAccountDeletion'

export default function OwnerDashboard({ restaurantIndex }) {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    try {
      getSupabaseBrowser()
        .auth.getSession()
        .then(({ data }) => {
          if (cancelled) return
          if (!data.session) {
            router.replace(OWNER_LOGIN_HREF)
            return
          }
          setSession(data.session)
        })
    } catch (err) {
      if (!cancelled) setError(MESSAGES.generic)
    }
    return () => {
      cancelled = true
    }
  }, [router])

  const load = useCallback(
    async (accessToken) => {
      setError(null)
      try {
        const headers = { Authorization: `Bearer ${accessToken}` }
        const [meRes, claimsRes] = await Promise.all([
          fetch('/api/internal/v1/me', { headers, cache: 'no-store' }),
          fetch('/api/claims/mine', { headers, cache: 'no-store' }),
        ])

        // 401 = the session is gone: back to the owner sign-in page.
        if (meRes.status === 401 || claimsRes.status === 401) {
          try {
            await getSupabaseBrowser().auth.signOut()
          } catch (err) {
            // best effort
          }
          router.replace(OWNER_LOGIN_HREF)
          return
        }
        // 403 = an internal/editor account without its second step: that account
        // belongs on /internal/login, never here.
        if (meRes.status === 403) {
          router.replace(INTERNAL_LOGIN_HREF)
          return
        }

        const me = await meRes.json().catch(() => ({}))
        if (!meRes.ok) {
          setError(MESSAGES.generic)
          return
        }
        const roles = Array.isArray(me.roles) ? me.roles : []
        const entry = resolveOwnerEntry(roles)
        if (entry.href === INTERNAL_LOGIN_HREF) {
          router.replace(entry.href)
          return
        }

        const claimsBody = await claimsRes.json().catch(() => ({}))
        if (!claimsRes.ok) {
          setError(MESSAGES.generic)
          return
        }
        const claims = Array.isArray(claimsBody.claims) ? claimsBody.claims : []
        setOverview(buildOwnerOverview({ roles, claims, restaurants: restaurantIndex }))
      } catch (err) {
        setError(MESSAGES.generic)
      }
    },
    [restaurantIndex, router],
  )

  useEffect(() => {
    if (!session) return
    load(session.access_token)
  }, [session, load])

  async function signOut() {
    try {
      await getSupabaseBrowser().auth.signOut()
    } catch (err) {
      // best effort
    }
    router.replace(OWNER_LOGIN_HREF)
  }


  const statusChip = (status, label) => (
    <span className={`owner-status owner-status--${status}`}>{label}</span>
  )

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Wordmark />
          <div className="header-right">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="owner-main">
        {!overview && !error && (
          <p className="owner-note" role="status">
            Bezig met laden…
          </p>
        )}

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        {overview && (
          <>
            <h1 className="owner-title">{overview.heading}</h1>
            <p className="owner-intro">{overview.intro}</p>

            <section className="owner-section" aria-labelledby="owner-restaurants-title">
              <h2 className="owner-section-title" id="owner-restaurants-title">
                Je restaurant
              </h2>
              {overview.restaurants.length === 0 ? (
                <p className="owner-note">
                  {OWNER_OVERVIEW_MESSAGES.noRestaurants} {OWNER_OVERVIEW_MESSAGES.noRestaurantsHelp}{' '}
                  <Link className="owner-link" href={CLAIM_SEARCH_HREF}>
                    {OWNER_ACCESS_MESSAGES.claimRouteLabel}
                  </Link>
                </p>
              ) : (
                <ul className="owner-list">
                  {overview.restaurants.map((restaurant) => (
                    <li className="owner-card" key={restaurant.id}>
                      <div className="owner-card-head">
                        <h3 className="owner-restaurant-name">{restaurant.name || restaurant.id}</h3>
                        {statusChip(restaurant.status, restaurant.statusLabel)}
                      </div>
                      {restaurant.unknownLabel && <p className="owner-note">{restaurant.unknownLabel}</p>}
                      <p className="owner-note">{restaurant.note}</p>
                      <div className="owner-links">
                        {restaurant.restaurantHref && (
                          <Link className="owner-link" href={restaurant.restaurantHref}>
                            {OWNER_OVERVIEW_MESSAGES.restaurantLink}
                          </Link>
                        )}
                        {restaurant.menuHref && (
                          <Link className="owner-link" href={restaurant.menuHref}>
                            {OWNER_OVERVIEW_MESSAGES.menuLink}
                          </Link>
                        )}
                        {restaurant.known && !restaurant.menuHref && (
                          <span className="owner-note">{OWNER_OVERVIEW_MESSAGES.noMenuLink}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="owner-section" aria-labelledby="owner-claims-title">
              <h2 className="owner-section-title" id="owner-claims-title">
                Je claims
              </h2>
              {overview.claims.length === 0 ? (
                <p className="owner-note">{overview.claimsNote}</p>
              ) : (
                <ul className="owner-list">
                  {overview.claims.map((claim) => (
                    <li className="owner-card" key={claim.id || `${claim.restaurantId}:${claim.status}`}>
                      <div className="owner-card-head">
                        <h3 className="owner-restaurant-name">
                          {claim.name || claim.restaurantId || OWNER_OVERVIEW_MESSAGES.unknownRestaurant}
                        </h3>
                        {statusChip(claim.status, claim.statusLabel)}
                      </div>
                      {claim.unknownLabel && <p className="owner-note">{claim.unknownLabel}</p>}
                      <p className="owner-note">{claim.note}</p>
                      {(claim.submittedOn || claim.decidedOn) && (
                        <p className="owner-note">
                          {claim.submittedOn ? `Ingediend op ${claim.submittedOn}.` : null}{' '}
                          {claim.decidedOn ? `Beoordeeld op ${claim.decidedOn}.` : null}
                        </p>
                      )}
                      <div className="owner-links">
                        {claim.restaurantHref && (
                          <Link className="owner-link" href={claim.restaurantHref}>
                            {OWNER_OVERVIEW_MESSAGES.restaurantLink}
                          </Link>
                        )}
                        {claim.retryHref && (
                          <Link className="owner-link" href={claim.retryHref}>
                            {claim.retryLabel}
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="owner-actions">
              <button type="button" className="auth-secondary" onClick={signOut}>
                {OWNER_OVERVIEW_MESSAGES.signOut}
              </button>
            </div>

            <OwnerAccountDeletion
              session={session}
              onDeleted={() => router.replace(`${OWNER_LOGIN_HREF}?verwijderd=1`)}
            />
          </>
        )}
      </main>
    </>
  )
}
