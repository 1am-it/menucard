'use client'

// PLATFORM-07 — public claim flow. Uses Supabase Auth in the browser
// strictly for magic-link sign-in/session lookup (src/lib/supabaseBrowser.js)
// — never for direct data access. All claim data goes through
// /api/claims/* with the resulting session's access_token, exactly like
// the internal moderation UI does for /api/internal/v1/....

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import ThemeToggle from '@/src/components/ThemeToggle'
import ShareSettingsButton from '@/src/components/ShareSettingsButton'
import Wordmark from '@/src/components/Wordmark'
import Emoji from '@/src/components/Emoji'
import MobileTabBar from '@/src/components/MobileTabBar'

const STATUS_LABEL = {
  pending: 'In afwachting van beoordeling',
  approved: 'Goedgekeurd — je bent geverifieerd als eigenaar',
  rejected: 'Afgewezen',
}

export default function ClaimView({ restaurantId, restaurant }) {
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [email, setEmail] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [claim, setClaim] = useState(undefined) // undefined = loading, null = none yet
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  // Zonder Supabase-configuratie (bijvoorbeeld een lokale build zonder
  // .env.local) blijft de pagina eerlijk staan in plaats van eindeloos
  // "Laden…" te tonen. Geen credential, geen netwerkcall en geen nieuwe
  // configuratie: alleen een nette melding.
  const [configError, setConfigError] = useState(false)

  useEffect(() => {
    try {
      const supabase = getSupabaseBrowser()
      supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    } catch {
      setConfigError(true)
      setSession(null)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    fetch(`/api/claims/mine?restaurantId=${encodeURIComponent(restaurantId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => setClaim(data.claims?.[0] || null))
      .catch(() => setClaim(null))
  }, [session, restaurantId])

  async function sendMagicLink(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const supabase = getSupabaseBrowser()
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.href : undefined },
      })
      if (signInError) {
        setError(signInError.message)
        return
      }
      setLinkSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function submitClaim() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId }),
      })
      const data = await res.json()
      if (!res.ok && !data.alreadyExists) {
        setError(data.error || 'Aanvraag mislukt')
        return
      }
      setClaim(data.claim)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Wordmark />
          <div className="header-right">
            <ThemeToggle />
            <ShareSettingsButton />
            {restaurant && (
              <Link href={`/restaurant/${restaurantId}`} className="back-btn">← {restaurant.name}</Link>
            )}
          </div>
        </div>
      </header>

      <main className="claim-page">
        <section className="claim-card" aria-labelledby="claim-title">
          <h1 className="claim-title" id="claim-title">
            Claim dit restaurant <Emoji glyph="🔑" />
          </h1>

          {!restaurant ? (
            <>
              <p className="claim-note">Restaurant niet gevonden.</p>
              <p><Link href="/" className="claim-link">← Terug naar overzicht</Link></p>
            </>
          ) : (
            <>
              <p className="claim-restaurant">
                <Emoji glyph="🍽️" /> {restaurant.name}
              </p>

              {session === undefined && <p className="claim-note">Laden…</p>}

              {configError && (
                <p className="claim-note">
                  Inloggen is in deze omgeving niet geconfigureerd. Probeer het later opnieuw of open deze pagina op de echte site.
                </p>
              )}

              {session === null && !linkSent && !configError && (
                <form onSubmit={sendMagicLink} className="claim-form">
                  <p className="claim-note">
                    Vul je zakelijke e-mailadres in. We sturen een inlogkoppeling — daarmee bevestig je dat je toegang hebt
                    tot dit e-mailadres.
                  </p>
                  <input
                    type="email"
                    className="claim-input"
                    placeholder="jij@jouwrestaurant.nl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  {error && <div className="claim-error">{error}</div>}
                  <button type="submit" disabled={loading} className="claim-submit">
                    <Emoji glyph="📧" /> {loading ? 'Bezig…' : 'Stuur inlogkoppeling'}
                  </button>
                </form>
              )}

              {session === null && linkSent && (
                <p className="claim-note">
                  Check je inbox en klik op de koppeling om verder te gaan met je claim.
                </p>
              )}

              {session && claim === undefined && <p className="claim-note">Claimstatus laden…</p>}

              {session && claim === null && (
                <div className="claim-form">
                  <p className="claim-note">
                    Ingelogd als {session.user?.email}. Klik hieronder om een claim in te dienen voor &quot;{restaurant.name}&quot;. Een
                    medewerker beoordeelt je aanvraag.
                  </p>
                  {error && <div className="claim-error">{error}</div>}
                  <button onClick={submitClaim} disabled={loading} className="claim-submit">
                    <Emoji glyph="✅" /> {loading ? 'Bezig…' : 'Dien claim in'}
                  </button>
                </div>
              )}

              {session && claim && (
                <div className="claim-status">
                  <strong><Emoji glyph="📋" /> {STATUS_LABEL[claim.status] || claim.status}</strong>
                  <div className="claim-note">
                    Ingediend op {new Date(claim.created_at).toLocaleDateString('nl-NL')}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <MobileTabBar />
    </>
  )
}
