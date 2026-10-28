'use client'

// PLATFORM-06 — minimal internal sign-in. Uses Supabase Auth in the
// browser strictly for session/login (src/lib/supabaseBrowser.js) — it
// never queries data directly; that always goes through
// /api/internal/v1/... with the resulting session's access_token.
//
// #62 (contract criterion 3): after signing in the visitor goes to the
// section with the most real open work, and to Dekking when there is none.
// resolveLandingAfterSignIn applies the one tested rule
// (src/lib/internalNav.js) through the same read-only endpoints the shell
// uses. An account without a usable role, or a failed lookup, keeps the
// existing /internal status page instead of an invented destination.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { resolveLandingAfterSignIn } from '@/src/lib/internalLandingClient'

export default function InternalLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const supabase = getSupabaseBrowser()
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        // De reden komt van Supabase en blijft staan; alleen de inleiding is
        // Nederlands (BE-37, criterium 5).
        setError(`Inloggen lukte niet. ${signInError.message}`)
        return
      }
      const href = await resolveLandingAfterSignIn(data && data.session && data.session.access_token)
      // No visible module (or a failed lookup): the existing status page.
      router.replace(href || '/internal')
    } catch (err) {
      setError(`Inloggen lukte niet. ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main
      style={{
        maxWidth: 360,
        margin: '80px auto',
        padding: '0 20px',
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--text-primary)',
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Inloggen (intern)</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <input
          type="email"
          placeholder="E-mailadres"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
          }}
        />
        <input
          type="password"
          placeholder="Wachtwoord"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
          }}
        />
        {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent-fill)',
            color: 'var(--on-accent-fill)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {loading ? 'Bezig met inloggen…' : 'Inloggen'}
        </button>
      </form>
    </main>
  )
}
