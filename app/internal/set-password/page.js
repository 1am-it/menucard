'use client'

// The missing "accept invitation / reset password" step for internal
// accounts, flagged while preparing MARKET-05A's Data-inbox: /internal/login
// only ever supports signInWithPassword (see that file), and until now
// nothing in this app let a newly-invited or password-reset internal
// account actually set a usable password. Grants no access of its own —
// it only completes account setup so /internal/login can be used
// afterward, exactly like every other internal page.
//
// Reads the browser's Supabase Auth session (src/lib/supabaseBrowser.js)
// purely to detect a just-verified recovery/invite session — never calls
// any /api/internal/v1/... route, never touches staff_roles, never grants
// Data-inbox or any other internal-page access by itself.
//
// The actual decision logic (what state to show, password validation,
// mapping a Supabase error to a safe message) lives in
// src/lib/setPasswordFlow.js, which is plain, dependency-free, and
// directly unit-tested — this component only wires that logic to the
// Supabase client and the DOM.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import {
  parseHashParams,
  detectSessionViewState,
  validateNewPassword,
  passwordValidationMessage,
  resolveUpdatePasswordOutcome,
} from '@/src/lib/setPasswordFlow'

const REDIRECT_DELAY_MS = 2000

const inputStyle = {
  padding: 10,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
}

export default function SetPasswordPage() {
  const router = useRouter()
  // 'checking' | 'invalid' | 'ready' | 'success' — see
  // determineInitialViewState's own doc comment for the state machine.
  const [viewState, setViewState] = useState('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldError, setFieldError] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unsubscribe = () => {}

    // Found in production (2026-09-05): a real invitation link crashed
    // this page with Next.js's generic "a client-side exception has
    // occurred" — there was no error handling at all around the Supabase
    // client here, so any unexpected failure (e.g. a browser or embedded
    // context that blocks storage access — some email-link security
    // scanners open links in exactly such a sandboxed context) propagated
    // out of this effect and crashed the whole page. Both the
    // synchronous client-setup path (this try/catch) and the async
    // session check (detectSessionViewState's own internal try/catch,
    // src/lib/setPasswordFlow.js) now degrade to the existing, safe
    // 'invalid' state instead — never a hard crash.
    try {
      const supabase = getSupabaseBrowser()
      const hashParams = typeof window !== 'undefined' ? parseHashParams(window.location.hash) : {}

      detectSessionViewState(supabase.auth, hashParams).then((state) => {
        if (!cancelled) setViewState(state)
      })

      // detectSessionInUrl (the Supabase client's default) processes a
      // recovery/invite link asynchronously — this is the SDK-recommended
      // way to catch the resulting session however long that takes,
      // independent of the check above, which may resolve before that
      // processing finishes.
      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return
        if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
          setViewState('ready')
        }
      })
      unsubscribe = () => listener.subscription.unsubscribe()
    } catch (err) {
      setViewState('invalid')
    }

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setFieldError(null)
    setSubmitError(null)

    const validation = validateNewPassword(password, confirmPassword)
    if (!validation.valid) {
      setFieldError(passwordValidationMessage(validation.reason))
      return
    }

    setSubmitting(true)
    try {
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.updateUser({ password })
      const outcome = resolveUpdatePasswordOutcome(error)
      if (!outcome.ok) {
        setSubmitError(outcome.message)
        return
      }
      setViewState('success')
      setTimeout(() => {
        router.replace('/internal/login')
      }, REDIRECT_DELAY_MS)
    } catch (err) {
      setSubmitError(resolveUpdatePasswordOutcome(err).message)
    } finally {
      setSubmitting(false)
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
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Set your password</h1>

      {viewState === 'checking' && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Checking your invitation link…</p>
      )}

      {viewState === 'invalid' && (
        <div>
          <p style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 12 }}>
            This invitation or password reset link is invalid or has expired.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Please ask whoever manages internal accounts to send a new link.
          </p>
        </div>
      )}

      {viewState === 'ready' && (
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
            style={inputStyle}
          />
          {fieldError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{fieldError}</div>}
          {submitError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{submitError}</div>}
          <button
            type="submit"
            disabled={submitting}
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
            {submitting ? 'Setting password…' : 'Set password'}
          </button>
        </form>
      )}

      {viewState === 'success' && (
        <div>
          <p style={{ color: 'var(--green)', fontSize: 14, marginBottom: 12 }}>
            Your password has been set.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Redirecting you to sign in…{' '}
            <a href="/internal/login" style={{ color: 'var(--green)' }}>
              Click here if nothing happens.
            </a>
          </p>
        </div>
      )}
    </main>
  )
}
