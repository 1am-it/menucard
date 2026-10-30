'use client'

// BE-48 (#112) — internal sign-in with a real second step.
//
// Screen 1 asks for the password. What comes next is decided by the tested
// logic in src/lib/internalMfaFlow.js, never guessed here:
//   - an account that still has to link an authenticator app gets the QR code
//     and the manual key (`mfa.enroll({ factorType: 'totp' })`);
//   - an account with a verified app gets "Code uit je app"
//     (`mfa.challenge` + `mfa.verify`);
//   - an account that is already `aal2`, or an owner-only account that does not
//     need the second step (BE-47 / #111), goes straight on.
// Only after a valid second step does the visitor continue to the same landing
// place as before (`resolveLandingAfterSignIn`).
//
// The server enforces the same rule (src/lib/internalAuth.js): a browser that
// skips this screen still gets 403 "Tweede inlogstap vereist" on every
// /api/internal/... call.
//
// "Dit apparaat 30 dagen onthouden" is deliberately not offered: Supabase has
// no safe, supported way to remember a device for a number of days.
//
// Every failure is Dutch through src/lib/authErrors.js; Supabase's own
// `error.message` is never shown. All fields have a real <label>, the code
// field is numeric with `autocomplete="one-time-code"`, errors sit in
// role="alert" and every control is at least 44 px (app/globals.css).

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { resolveLandingAfterSignIn } from '@/src/lib/internalLandingClient'
import { authErrorMessage } from '@/src/lib/authErrors'
import {
  decideMfaStep,
  genericMessage,
  readAccessToken,
  readAssuranceLevels,
  readSecondFactorRequirement,
  readVerifiedFactorId,
  startChallenge,
  startEnrollment,
  verifyCode,
} from '@/src/lib/internalMfaFlow'

export default function InternalLoginPage() {
  const router = useRouter()
  // 'credentials' | 'enroll' | 'challenge'
  const [step, setStep] = useState('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [enrollment, setEnrollment] = useState(null)
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function goToLanding(accessToken) {
    const href = await resolveLandingAfterSignIn(accessToken)
    // No visible module (or a failed lookup): the existing status page.
    router.replace(href || '/internal')
  }

  async function openChallenge(supabase, factorId) {
    const challenge = await startChallenge(supabase.auth, factorId)
    if (!challenge.ok) {
      setError(challenge.message)
      return
    }
    setPending({ factorId, challengeId: challenge.challengeId })
    setCode('')
    setStep('challenge')
  }

  async function openEnrollment(supabase) {
    const enroll = await startEnrollment(supabase.auth)
    if (!enroll.ok) {
      setError(enroll.message)
      return
    }
    setEnrollment({ qrCode: enroll.qrCode, secret: enroll.secret })
    // The visitor proves the app works immediately, with a code from it, but the
    // QR and the manual key stay on screen while they do.
    const challenge = await startChallenge(supabase.auth, enroll.factorId)
    if (!challenge.ok) {
      setError(challenge.message)
      return
    }
    setPending({ factorId: enroll.factorId, challengeId: challenge.challengeId })
    setCode('')
    setStep('enroll')
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const supabase = getSupabaseBrowser()
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        setError(authErrorMessage(signInError, { context: 'signin' }))
        return
      }
      const accessToken = (data && data.session && data.session.access_token) || null
      const assurance = await readAssuranceLevels(supabase.auth)
      const factorId = await readVerifiedFactorId(
        supabase.auth,
        data && data.user && data.user.factors,
        data && data.session && data.session.user && data.session.user.factors,
      )

      // Only ask the roles endpoint when the levels alone cannot answer it.
      let secondFactorRequired = null
      if (assurance.currentLevel !== 'aal2' && assurance.nextLevel !== 'aal2') {
        const requirement = await readSecondFactorRequirement({ accessToken })
        secondFactorRequired = requirement.required
      }

      const decision = decideMfaStep({
        currentLevel: assurance.currentLevel,
        nextLevel: assurance.nextLevel,
        factorId,
        secondFactorRequired,
      })

      if (decision.step === 'done') {
        await goToLanding(accessToken)
        return
      }
      if (decision.step === 'challenge') {
        await openChallenge(supabase, decision.factorId)
        return
      }
      if (decision.step === 'enroll') {
        await openEnrollment(supabase)
        return
      }
      // 'unavailable': Supabase reports a factor whose id cannot be read.
      setError(genericMessage())
    } catch (err) {
      setError(authErrorMessage(err, { context: 'signin' }))
    } finally {
      setBusy(false)
    }
  }

  async function handleCodeSubmit(e) {
    e.preventDefault()
    if (!pending) return
    setError(null)
    setBusy(true)
    try {
      const supabase = getSupabaseBrowser()
      const result = await verifyCode(supabase.auth, {
        factorId: pending.factorId,
        challengeId: pending.challengeId,
        code,
      })
      if (!result.ok) {
        setError(result.message)
        // A challenge is single-use: quietly start a new one so the next attempt
        // is not refused because of the previous one.
        const retry = await startChallenge(supabase.auth, pending.factorId)
        if (retry.ok) setPending({ factorId: pending.factorId, challengeId: retry.challengeId })
        setCode('')
        return
      }
      const token = await readAccessToken(supabase.auth)
      await goToLanding(token)
    } catch (err) {
      setError(authErrorMessage(err, { context: 'totp' }))
    } finally {
      setBusy(false)
    }
  }

  async function handleRestart() {
    setStep('credentials')
    setPending(null)
    setEnrollment(null)
    setCode('')
    setError(null)
    setPassword('')
    try {
      await getSupabaseBrowser().auth.signOut()
    } catch (err) {
      // Signing out is best-effort; the screens stay safe either way.
    }
  }

  const codeField = (
    <div className="auth-field">
      <label className="auth-label" htmlFor="auth-code">
        Code uit je app
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
        maxLength={6}
        aria-describedby={error ? 'auth-error' : undefined}
      />
    </div>
  )

  const errorAlert = error ? (
    <p className="auth-error" id="auth-error" role="alert">
      {error}
    </p>
  ) : null

  return (
    <main className="auth-main">
      <div className="auth-card">
        {step === 'credentials' && (
          <>
            <h1 className="auth-title">Inloggen (intern)</h1>
            <p className="auth-intro">
              Log in met je werkmail en je wachtwoord. Daarna vraag je een code uit je
              authenticator-app.
            </p>
            <form className="auth-form" onSubmit={handlePasswordSubmit} noValidate>
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
              <div className="auth-field">
                <label className="auth-label" htmlFor="auth-password">
                  Wachtwoord
                </label>
                <div className="auth-input-row">
                  <input
                    id="auth-password"
                    className="auth-input"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    aria-describedby={error ? 'auth-error' : undefined}
                    required
                  />
                  <button
                    type="button"
                    className="auth-toggle"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? 'Verberg' : 'Toon'}
                  </button>
                </div>
              </div>
              {errorAlert}
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? 'Bezig met inloggen…' : 'Inloggen'}
              </button>
            </form>
            <div className="auth-actions">
              <Link className="auth-link" href="/internal/wachtwoord-vergeten">
                Wachtwoord vergeten?
              </Link>
            </div>
          </>
        )}
        {step === 'enroll' && (
          <>
            <h1 className="auth-title">Beveilig je account met een app</h1>
            <p className="auth-intro">
              Scan deze QR-code met een authenticator-app, bijvoorbeeld Google
              Authenticator, 1Password of Microsoft Authenticator. Vul daarna de code in
              die de app laat zien.
            </p>
            {enrollment && enrollment.qrCode && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="auth-qr"
                src={enrollment.qrCode}
                alt="QR-code om je authenticator-app te koppelen"
                width={180}
                height={180}
              />
            )}
            {enrollment && enrollment.secret && (
              <div className="auth-field">
                <span className="auth-label" id="auth-secret-label">
                  Lukt scannen niet? Vul deze sleutel handmatig in
                </span>
                <code className="auth-secret" aria-labelledby="auth-secret-label">
                  {enrollment.secret}
                </code>
              </div>
            )}
            <p className="auth-help">
              Koppel de app daarna ook op een tweede apparaat, zodat je altijd een code
              kunt maken.
            </p>
            <form className="auth-form" onSubmit={handleCodeSubmit} noValidate>
              {codeField}
              {errorAlert}
              <button type="submit" className="auth-submit" disabled={busy || !pending}>
                {busy ? 'Bezig met controleren…' : 'Code controleren'}
              </button>
            </form>
            <div className="auth-actions">
              <button type="button" className="auth-secondary" onClick={handleRestart}>
                Opnieuw beginnen
              </button>
            </div>
          </>
        )}

        {step === 'challenge' && (
          <>
            <h1 className="auth-title">Code uit je app</h1>
            <p className="auth-intro">Vul de 6 cijfers in uit je authenticator-app.</p>
            <form className="auth-form" onSubmit={handleCodeSubmit} noValidate>
              {codeField}
              {errorAlert}
              <button type="submit" className="auth-submit" disabled={busy || !pending}>
                {busy ? 'Bezig met controleren…' : 'Doorgaan'}
              </button>
            </form>
            <div className="auth-actions">
              <button type="button" className="auth-secondary" onClick={handleRestart}>
                Ander account
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
