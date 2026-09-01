'use client'

// PLATFORM-07 — public claim flow. Uses Supabase Auth in the browser
// strictly for magic-link sign-in/session lookup (src/lib/supabaseBrowser.js)
// — never for direct data access. All claim data goes through
// /api/claims/* with the resulting session's access_token, exactly like
// the internal moderation UI does for /api/internal/v1/....

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'

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

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
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

  const box = {
    maxWidth: 420,
    margin: '80px auto',
    padding: '0 20px',
    fontFamily: 'system-ui, sans-serif',
    color: 'var(--text-primary)',
  }
  const inputStyle = {
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    width: '100%',
  }
  const buttonStyle = {
    padding: 10,
    borderRadius: 8,
    border: 'none',
    background: 'var(--green)',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  }

  if (!restaurant) {
    return (
      <main style={box}>
        <h1 style={{ fontSize: 20 }}>Restaurant niet gevonden</h1>
        <p>
          <Link href="/" style={{ color: 'var(--green)' }}>← Terug naar overzicht</Link>
        </p>
      </main>
    )
  }

  return (
    <main style={box}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Claim dit restaurant</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>{restaurant.name}</p>

      {session === undefined && <p style={{ color: 'var(--text-muted)' }}>Laden…</p>}

      {session === null && !linkSent && (
        <form onSubmit={sendMagicLink} style={{ display: 'grid', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Vul je zakelijke e-mailadres in. We sturen een inlogkoppeling — daarmee bevestig je dat je toegang hebt
            tot dit e-mailadres.
          </p>
          <input
            type="email"
            placeholder="jij@jouwrestaurant.nl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          <button type="submit" disabled={loading} style={buttonStyle}>
            {loading ? 'Bezig…' : 'Stuur inlogkoppeling'}
          </button>
        </form>
      )}

      {session === null && linkSent && (
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          Check je inbox en klik op de koppeling om verder te gaan met je claim.
        </p>
      )}

      {session && claim === undefined && <p style={{ color: 'var(--text-muted)' }}>Claimstatus laden…</p>}

      {session && claim === null && (
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Ingelogd als {session.user?.email}. Klik hieronder om een claim in te dienen voor "{restaurant.name}". Een
            medewerker beoordeelt je aanvraag.
          </p>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          <button onClick={submitClaim} disabled={loading} style={buttonStyle}>
            {loading ? 'Bezig…' : 'Dien claim in'}
          </button>
        </div>
      )}

      {session && claim && (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            fontSize: 14,
          }}
        >
          <strong>{STATUS_LABEL[claim.status] || claim.status}</strong>
          <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>
            Ingediend op {new Date(claim.created_at).toLocaleDateString('nl-NL')}
          </div>
        </div>
      )}
    </main>
  )
}
