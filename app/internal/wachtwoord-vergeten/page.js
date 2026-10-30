'use client'

// BE-48 (#112) — "Wachtwoord vergeten" for internal accounts.
//
// The visitor types the work address, receives an e-mail with a code (the
// release plan extends Supabase's "Reset Password" template with `{{ .Token }}`,
// so the existing link keeps working) and types that code here. The code is what
// actually starts the reset (`verifyOtp({ email, token, type: 'recovery' })`),
// which also works when the mail is opened on another device or when a virus
// scanner opens the link first.
//
// The answer to the first step is always the same neutral sentence, whether or
// not the address exists — no hint about an account. Only a real rate limit or a
// lost connection is named, because neither says anything about the address.
//
// After a valid code the visitor continues to the existing /internal/set-password
// page, which already knows how to set a new password for a recovery session.
// No new table, no new endpoint, no mail template change from this side.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { authErrorMessage, classifyAuthError } from '@/src/lib/authErrors'
import { activationValidationMessage, validateActivationForm } from '@/src/lib/activationFlow'

const NEUTRAL_NOTICE =
  'Als dit e-mailadres bij ons bekend is, ontvang je een e-mail met een code. ' +
  'Geen e-mail? Kijk in je spam of probeer het over een paar minuten opnieuw.'

export default function ForgotPasswordPage() {
  const router = useRouter()
  // 'email' | 'code'
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function sendCode() {
    const validation = validateActivationForm(email, 'voorlopig')
    if (!validation.valid && validation.reason === 'invalid-email') {
      setError(activationValidationMessage(validation.reason))
      return false
    }
    setError(null)
    try {
      const supabase = getSupabaseBrowser()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(validation.email)
      if (resetError) {
        // A rate limit or a lost connection says nothing about the address and
        // is worth naming; every other failure keeps the neutral answer.
        const reason = classifyAuthError(resetError)
        if (reason === 'rate-limited' || reason === 'network') {
          setNotice(null)
          setError(authErrorMessage(resetError, { context: 'email-code' }))
          return false
        }
      }
      setNotice(NEUTRAL_NOTICE)
      return true
    } catch (err) {
      const reason = classifyAuthError(err)
      if (reason === 'rate-limited' || reason === 'network') {
        setNotice(null)
        setError(authErrorMessage(err, { context: 'email-code' }))
        return false
      }
      // Anything else stays neutral: never reveal whether the address exists.
      setNotice(NEUTRAL_NOTICE)
      return true
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setBusy(true)
    const sent = await sendCode()
    setBusy(false)
    if (sent) setStep('code')
  }

  async function handleResend() {
    setBusy(true)
    await sendCode()
    setBusy(false)
  }


  async function handleCodeSubmit(e) {
    e.preventDefault()
    const validation = validateActivationForm(email, code)
    if (!validation.valid) {
      setError(activationValidationMessage(validation.reason))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const supabase = getSupabaseBrowser()
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: validation.email,
        token: validation.code,
        type: 'recovery',
      })
      if (verifyError) {
        setError(authErrorMessage(verifyError, { context: 'email-code' }))
        return
      }
      // The recovery session is in place: the existing page sets the password.
      router.replace('/internal/set-password')
    } catch (err) {
      setError(authErrorMessage(err, { context: 'email-code' }))
    } finally {
      setBusy(false)
    }
  }

  function handleOtherEmail() {
    setStep('email')
    setCode('')
    setNotice(null)
    setError(null)
  }

  return (
    <main className="auth-main">
      <div className="auth-card">
        <h1 className="auth-title">Wachtwoord vergeten</h1>
        {step === 'email' ? (
          <>
            <p className="auth-intro">
              Vul je werkmail in. Je ontvangt een e-mail met een code waarmee je een
              nieuw wachtwoord kiest.
            </p>
            <form className="auth-form" onSubmit={handleEmailSubmit} noValidate>
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
                  aria-describedby={error ? 'auth-error' : undefined}
                  required
                />
              </div>
              {error && (
                <p className="auth-error" id="auth-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? 'Bezig met versturen…' : 'Stuur mij een code'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="auth-intro">Vul de code uit de e-mail in.</p>
            {notice && (
              <p className="auth-notice" role="status">
                {notice}
              </p>
            )}
            <form className="auth-form" onSubmit={handleCodeSubmit} noValidate>
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
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={10}
                  aria-describedby={error ? 'auth-error' : undefined}
                />
              </div>
              {error && (
                <p className="auth-error" id="auth-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? 'Bezig met controleren…' : 'Doorgaan'}
              </button>
            </form>
            <div className="auth-actions">
              <button type="button" className="auth-secondary" onClick={handleResend} disabled={busy}>
                Nieuwe code sturen
              </button>
              <button type="button" className="auth-secondary" onClick={handleOtherEmail}>
                Ander e-mailadres
              </button>
            </div>
          </>
        )}
        <div className="auth-actions">
          <Link className="auth-link" href="/internal/login">
            Terug naar inloggen
          </Link>
        </div>
      </div>
    </main>
  )
}

