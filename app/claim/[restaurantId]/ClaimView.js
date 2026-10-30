'use client'

// PLATFORM-07 — public claim flow. Uses Supabase Auth in the browser
// strictly for signing in and looking up the session
// (src/lib/supabaseBrowser.js) — never for direct data access. All claim data
// goes through /api/claims/* with the resulting session's access_token, exactly
// like the internal moderation UI does for /api/internal/v1/....
//
// BE-48 (#112) — the claim signs in with a six-digit code from the e-mail:
//   1. the visitor enters the business e-mail address;
//   2. Supabase mails a code (`signInWithOtp`); the link in that mail keeps
//      working until the owner retires it (release plan, step 1);
//   3. the visitor enters the code (`verifyOtp({ email, token, type: 'email' })`)
//      — on this device or on another one, which is exactly what a magic link
//      cannot do reliably (a virus scanner may open the link first);
//   4. from there the claim is submitted exactly as before.
// "Nieuwe code sturen" asks for a fresh code and "Ander e-mailadres" returns to
// step 1. Every decision and every Supabase call lives in the tested
// src/lib/claimEmailCodeFlow.js; every failure is Dutch through
// src/lib/authErrors.js and Supabase's own `error.message` is never shown.
// Each field has a real <label>, the code field is numeric with
// `autocomplete="one-time-code"`, errors sit in role="alert" and every control
// uses the shared auth style (>= 44 px, theme tokens only).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { CLAIM_MESSAGES, requestEmailCode, verifyEmailCode } from '@/src/lib/claimEmailCodeFlow'
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

// Zonder Supabase-configuratie (bijvoorbeeld een lokale build zonder
// .env.local) blijft de pagina eerlijk staan in plaats van eindeloos
// "Laden…" te tonen. Geen credential, geen netwerkcall en geen nieuwe
// configuratie: alleen een nette melding.
const CONFIG_ERROR_TEXT =
  'Inloggen is in deze omgeving niet geconfigureerd. Probeer het later opnieuw of open deze pagina op de echte site.'

export default function ClaimView({ restaurantId, restaurant }) {
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  // The address the code went to; only set while the code screen is showing.
  const [codeSentTo, setCodeSentTo] = useState(null)
  const [notice, setNotice] = useState(null)
  const [claim, setClaim] = useState(undefined) // undefined = loading, null = none yet
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
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

  // The only place that touches Supabase auth. A build without configuration
  // throws exactly here, and only here.
  function browserAuth() {
    return getSupabaseBrowser().auth
  }

  // Steps 2 of the flow: ask for a code (first time or again).
  async function sendCode(isResend) {
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      const result = await requestEmailCode(browserAuth(), {
        email,
        redirectTo: typeof window === 'undefined' ? undefined : window.location.href,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setCodeSentTo(result.email)
      setCode('')
      if (isResend) setNotice(`We hebben een nieuwe code gestuurd naar ${result.email}.`)
    } catch (err) {
      // Only getSupabaseBrowser() can throw here; the flow itself never does.
      setConfigError(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault()
    await sendCode(false)
  }

  async function handleResendCode() {
    await sendCode(true)
  }

  function handleChangeEmail() {
    setError(null)
    setNotice(null)
    setCode('')
    setCodeSentTo(null)
  }

  // Step 3 of the flow: the code from the e-mail, on this device or another one.
  async function handleCodeSubmit(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      const result = await verifyEmailCode(browserAuth(), { email: codeSentTo || email, code })
      if (!result.ok) {
        setError(result.message)
        return
      }
      // Exactly the same session shape the magic link produced, so the claim
      // below is unchanged.
      setSession(result.session)
      setCode('')
    } catch (err) {
      setConfigError(true)
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
        // Our own API's error text is not visitor text: show Dutch, safe text.
        setError(CLAIM_MESSAGES.submitFailed)
        return
      }
      setClaim(data.claim)
    } catch (err) {
      setError(CLAIM_MESSAGES.submitFailed)
    } finally {
      setLoading(false)
    }
  }

  const errorAlert = error ? (
    <p className="auth-error" id="claim-error" role="alert">
      {error}
    </p>
  ) : null

  const noticeAlert = notice ? (
    <p className="auth-notice" role="status">
      {notice}
    </p>
  ) : null

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
                <p className="auth-error" id="claim-config-error" role="alert">
                  {CONFIG_ERROR_TEXT}
                </p>
              )}

              {session === null && !codeSentTo && !configError && (
                <div className="claim-step">
                  <p className="claim-note">
                    Vul je zakelijke e-mailadres in. Je krijgt een code van zes cijfers per e-mail; daarmee bewijs je
                    dat je toegang hebt tot dit e-mailadres.
                  </p>
                  <form onSubmit={handleEmailSubmit} className="auth-form" noValidate>
                    <div className="auth-field">
                      <label className="auth-label" htmlFor="claim-email">
                        E-mailadres
                      </label>
                      <input
                        id="claim-email"
                        className="auth-input"
                        type="email"
                        name="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        aria-describedby={error ? 'claim-error' : undefined}
                        aria-invalid={error ? 'true' : undefined}
                        required
                      />
                    </div>
                    {errorAlert}
                    <button type="submit" className="auth-submit" disabled={loading}>
                      {loading ? 'Bezig met versturen…' : 'Stuur code'}
                    </button>
                  </form>
                </div>
              )}

              {session === null && codeSentTo && !configError && (
                <div className="claim-step">
                  <p className="claim-note">
                    We hebben een code van zes cijfers gestuurd naar <strong>{codeSentTo}</strong>. Je kunt de mail op
                    dit apparaat openen of op een ander apparaat; de code werkt op beide.
                  </p>
                  {noticeAlert}
                  <form onSubmit={handleCodeSubmit} className="auth-form" noValidate>
                    <div className="auth-field">
                      <label className="auth-label" htmlFor="claim-code">
                        Code uit de e-mail
                      </label>
                      <input
                        id="claim-code"
                        className="auth-input auth-input--code"
                        type="text"
                        name="code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        maxLength={6}
                        aria-describedby={error ? 'claim-error' : undefined}
                        aria-invalid={error ? 'true' : undefined}
                        required
                      />
                    </div>
                    {errorAlert}
                    <button type="submit" className="auth-submit" disabled={loading}>
                      {loading ? 'Bezig met controleren…' : 'Code controleren'}
                    </button>
                  </form>
                  <div className="auth-actions">
                    <button
                      type="button"
                      className="auth-secondary"
                      onClick={handleResendCode}
                      disabled={loading}
                    >
                      Nieuwe code sturen
                    </button>
                    <button
                      type="button"
                      className="auth-secondary"
                      onClick={handleChangeEmail}
                      disabled={loading}
                    >
                      Ander e-mailadres
                    </button>
                  </div>
                  <p className="auth-help">
                    Geen code ontvangen? Kijk in je spam of stuur een nieuwe code. De koppeling in de e-mail werkt
                    voorlopig ook nog.
                  </p>
                </div>
              )}

              {session && claim === undefined && <p className="claim-note">Claimstatus laden…</p>}

              {session && claim === null && (
                <div className="claim-step">
                  <p className="claim-note">
                    Ingelogd als {session.user?.email}. Klik hieronder om een claim in te dienen voor &quot;{restaurant.name}&quot;. Een
                    medewerker beoordeelt je aanvraag.
                  </p>
                  {errorAlert}
                  <button type="button" onClick={submitClaim} disabled={loading} className="auth-submit">
                    {loading ? 'Bezig…' : 'Dien claim in'}
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
