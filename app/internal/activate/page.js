'use client'

// Scanner-resistant activation step for internal accounts — must be
// visited *before* /internal/set-password can ever see a real session.
//
// **Replaced 2026-09-05** (link-based → email+code flow): the earlier
// design — a link carrying `#token_hash=...&type=...`, verified only
// after a button click — was found live to still fail: a real reset
// link reached this page already invalid *before* the human could ever
// click "Account activeren." Whatever consumed it did so from more than
// a passive server-side GET (the token lived only in the URL fragment,
// which no server ever receives at all), meaning even a click-gated
// link is not safe against every real-world email-scanning behavior.
//
// This version removes the link/token from the email entirely. The
// email now contains only a plain, static, **tokenless** link to this
// exact page (safe to open any number of times, by anyone or anything,
// with zero effect) plus a separate, human-readable one-time code
// (`{{ .Token }}`) the person types in by hand, alongside their own
// email address. There is nothing on this page's URL for any automated
// visitor to consume — only `supabase.auth.verifyOtp({ email, token,
// type })`, called from this page's submit handler after a real,
// explicit click, can ever consume the code.
//
// `type` (`recovery` or `invite`) comes from a non-secret `?type=`
// query parameter on the fixed link each email template points at —
// never from free-form user input; there is no type selector in this
// form. No `redirect_to`/destination is ever read from the URL either —
// the only destination after a successful activation is hardcoded below
// to `/internal/set-password`.
//
// Grants no access of its own — exactly like /internal/set-password,
// this only establishes a session so that page's existing, unchanged
// flow can run; staff_roles/Data-inbox access is entirely unaffected.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import {
  resolveActivationType,
  validateActivationForm,
  activationValidationMessage,
  performActivation,
} from '@/src/lib/activationFlow'

export default function ActivatePage() {
  const router = useRouter()
  const [type, setType] = useState('recovery')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState(null)
  const [activationError, setActivationError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // Reading the query string is local and synchronous — no Supabase
    // client involved, no verification of any kind happens here.
    const search = typeof window !== 'undefined' ? window.location.search : ''
    setType(resolveActivationType(search))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setFieldError(null)
    setActivationError(null)

    const validation = validateActivationForm(email, code)
    if (!validation.valid) {
      setFieldError(activationValidationMessage(validation.reason))
      return
    }

    setSubmitting(true)
    let outcome
    try {
      const supabase = getSupabaseBrowser()
      outcome = await performActivation(supabase.auth, { email: validation.email, token: validation.code, type })
    } catch (err) {
      // getSupabaseBrowser() itself throwing (e.g. a browser/embedded
      // context that blocks storage access) must degrade the same safe
      // way here too, never crash this page.
      outcome = { ok: false, message: 'Deze code is ongeldig of verlopen. Vraag een nieuwe code aan.' }
    }
    setSubmitting(false)

    if (!outcome.ok) {
      setActivationError(outcome.message)
      return
    }

    router.replace('/internal/set-password')
  }

  return (
    <main className="auth-main">
      <div className="auth-card">
        <h1 className="auth-title">Je account activeren</h1>
        <p className="auth-intro">
          Vul het e-mailadres en de code in uit {type === 'invite' ? 'je uitnodiging' : 'de e-mail over je wachtwoord'}.
        </p>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-email">
              E-mailadres
            </label>
            <input
              id="auth-email"
              className="auth-input"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              aria-describedby={fieldError || activationError ? 'auth-error' : undefined}
              required
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-code">
              Code uit de e-mail
            </label>
            <input
              id="auth-code"
              className="auth-input auth-input--code"
              type="text"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              aria-describedby={fieldError || activationError ? 'auth-error' : undefined}
              required
            />
          </div>
          {(fieldError || activationError) && (
            <p className="auth-error" id="auth-error" role="alert">
              {fieldError || activationError}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? 'Bezig met activeren…' : 'Account activeren'}
          </button>
        </form>
      </div>
    </main>
  )
}
