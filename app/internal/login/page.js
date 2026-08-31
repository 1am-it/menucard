'use client'

// PLATFORM-06 — minimal internal sign-in. Uses Supabase Auth in the
// browser strictly for session/login (src/lib/supabaseBrowser.js) — it
// never queries data directly; that always goes through
// /api/internal/v1/... with the resulting session's access_token.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'

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
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        setError(signInError.message)
        return
      }
      router.push('/internal/moderation')
    } catch (err) {
      setError(err.message)
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
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Internal sign-in</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <input
          type="email"
          placeholder="Email"
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
          placeholder="Password"
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
            background: 'var(--green)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
