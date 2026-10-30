'use client'

// BE-47 (#111) — inloggen voor restauranthouders op /mijn-restaurant/inloggen.
//
// Eén code van zes cijfers, geen wachtwoord, geen authenticator, geen Google of
// Apple (eigenaarsbesluit 30 okt). De flow zelf staat in de gedeelde, geteste
// module src/lib/claimEmailCodeFlow.js (BE-48), inclusief de neutrale melding en
// de Nederlandse foutvertaling uit src/lib/authErrors.js:
//   1. e-mailadres → `signInWithOtp({ email, options: { shouldCreateUser: false } })`;
//      een onbekend adres krijgt exact hetzelfde antwoord en maakt nooit een
//      account aan;
//   2. codescherm → `verifyOtp({ email, token, type: 'email' })`;
//   3. daarna bepaalt src/lib/ownerAccess.js waar de bezoeker verdergaat:
//      `internal`/`editor` naar /internal/login (die heeft de tweede stap uit
//      BE-48 nodig), iedereen anders naar /mijn-restaurant.
//
// Sms staat klaar maar uit (criterium 6): het telefoonveld bestaat alleen als
// NEXT_PUBLIC_OWNER_SMS_LOGIN=1, en de flowmodule weigert een sms zonder die
// vlag. Zonder de vlag is er dus nergens een telefoonveld.
//
// Toegankelijk (criterium 7): echte labels, `autocomplete="email"` en
// `"one-time-code"`, `inputmode="numeric"`, fouten in role="alert", knoppen van
// minimaal 44 px via de gedeelde authstijl, en alles met het toetsenbord te
// bedienen.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { isSmsLoginEnabled, requestOwnerSignInCode, verifyOwnerSignInCode } from '@/src/lib/claimEmailCodeFlow'
import { MESSAGES } from '@/src/lib/authErrors'
import { CLAIM_SEARCH_HREF, INTERNAL_LOGIN_HREF, OWNER_ACCESS_MESSAGES, resolveOwnerEntry } from '@/src/lib/ownerAccess'

// Zonder Supabase-configuratie (bijvoorbeeld een lokale build zonder
// .env.local) blijft het scherm eerlijk staan in plaats van eindeloos te wachten.
const CONFIG_ERROR_TEXT =
  'Inloggen is in deze omgeving niet geconfigureerd. Probeer het later opnieuw of open deze pagina op de echte site.'

// De route waarlangs iemand zonder account zich als houder kan aanmelden:
// sinds BE-54 (#133) het zoekscherm /mijn-restaurant/claimen, uit één bron in
// src/lib/ownerAccess.js zodat inloggen en het houderoverzicht dezelfde link
// houden.

export default function OwnerLoginView() {
  // Build-time flag: zonder NEXT_PUBLIC_OWNER_SMS_LOGIN=1 is dit false en
  // rendert er nergens een telefoonveld.
  const smsEnabled = isSmsLoginEnabled(process.env.NEXT_PUBLIC_OWNER_SMS_LOGIN)
  const router = useRouter()

  const [channel, setChannel] = useState('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const effectiveChannel = smsEnabled && channel === 'sms' ? 'sms' : 'email'

  async function lookupRoles(token) {
    const res = await fetch('/api/internal/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (res.status === 401) return { ok: false, message: OWNER_ACCESS_MESSAGES.sessionExpired }
    // 403 = een internal/editor-account dat zijn tweede stap nog niet deed. Dat is
    // geen fout in de houder-login: die bezoeker hoort op /internal/login.
    if (res.status === 403) return { ok: true, href: INTERNAL_LOGIN_HREF }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, message: MESSAGES.generic }
    return { ok: true, roles: Array.isArray(body.roles) ? body.roles : [] }
  }

  async function handleSendCode(event) {
    if (event) event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const supabase = getSupabaseBrowser()
      const result = await requestOwnerSignInCode(supabase.auth, {
        channel: effectiveChannel,
        email,
        phone,
        allowPhone: smsEnabled,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setNotice(result.notice)
      setCode('')
      setCodeSent(true)
    } catch (err) {
      setError(CONFIG_ERROR_TEXT)
    } finally {
      setBusy(false)
    }
  }

  async function handleVerifyCode(event) {
    if (event) event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const supabase = getSupabaseBrowser()
      const result = await verifyOwnerSignInCode(supabase.auth, {
        channel: effectiveChannel,
        email,
        phone,
        code,
        allowPhone: smsEnabled,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      const roles = await lookupRoles(result.session.access_token)
      if (!roles.ok) {
        setError(roles.message)
        return
      }
      router.replace(roles.href || resolveOwnerEntry(roles.roles).href)
    } catch (err) {
      setError(CONFIG_ERROR_TEXT)
    } finally {
      setBusy(false)
    }
  }

  function handleChangeAddress() {
    setCodeSent(false)
    setCode('')
    setNotice(null)
    setError(null)
  }

  const errorAlert = error ? (
    <p className="auth-error" id="owner-login-error" role="alert">
      {error}
    </p>
  ) : null

  const noticeAlert = notice ? (
    <p className="auth-notice" role="status">
      {notice}
    </p>
  ) : null

  return (
    <main className="auth-main">
      <div className="auth-card">
        {!codeSent && (
          <>
            <h1 className="auth-title">{OWNER_ACCESS_MESSAGES.signInTitle}</h1>
            <p className="auth-intro">{OWNER_ACCESS_MESSAGES.signInIntro}</p>

            {smsEnabled && (
              <div className="auth-actions" role="group" aria-label="Inloggen met">
                <button
                  type="button"
                  className="auth-toggle"
                  aria-pressed={effectiveChannel === 'email'}
                  onClick={() => setChannel('email')}
                >
                  E-mail
                </button>
                <button
                  type="button"
                  className="auth-toggle"
                  aria-pressed={effectiveChannel === 'sms'}
                  onClick={() => setChannel('sms')}
                >
                  Telefoon
                </button>
              </div>
            )}

            <form className="auth-form" onSubmit={handleSendCode} noValidate>
              {effectiveChannel === 'sms' ? (
                <div className="auth-field">
                  <label className="auth-label" htmlFor="owner-phone">
                    Telefoonnummer
                  </label>
                  <input
                    id="owner-phone"
                    className="auth-input"
                    type="tel"
                    name="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    inputMode="tel"
                    aria-describedby={error ? 'owner-login-error' : undefined}
                    aria-invalid={error ? 'true' : undefined}
                    required
                  />
                </div>
              ) : (
                <div className="auth-field">
                  <label className="auth-label" htmlFor="owner-email">
                    E-mailadres
                  </label>
                  <input
                    id="owner-email"
                    className="auth-input"
                    type="email"
                    name="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    aria-describedby={error ? 'owner-login-error' : undefined}
                    aria-invalid={error ? 'true' : undefined}
                    required
                  />
                </div>
              )}
              {errorAlert}
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? 'Bezig met versturen…' : 'Stuur code'}
              </button>
            </form>
          </>
        )}

        {codeSent && (
          <>
            <h1 className="auth-title">{OWNER_ACCESS_MESSAGES.codeTitle}</h1>
            <p className="auth-intro">
              {effectiveChannel === 'sms'
                ? 'Vul de zes cijfers in uit de sms.'
                : 'Vul de zes cijfers in uit de e-mail.'}
            </p>
            {noticeAlert}
            <form className="auth-form" onSubmit={handleVerifyCode} noValidate>
              <div className="auth-field">
                <label className="auth-label" htmlFor="owner-code">
                  {effectiveChannel === 'sms' ? 'Code uit de sms' : 'Code uit de e-mail'}
                </label>
                <input
                  id="owner-code"
                  className="auth-input auth-input--code"
                  type="text"
                  name="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  aria-describedby={error ? 'owner-login-error' : undefined}
                  aria-invalid={error ? 'true' : undefined}
                  required
                />
              </div>
              {errorAlert}
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? 'Bezig met controleren…' : 'Inloggen'}
              </button>
            </form>
            <div className="auth-actions">
              <button type="button" className="auth-secondary" onClick={handleSendCode} disabled={busy}>
                Nieuwe code sturen
              </button>
              <button type="button" className="auth-secondary" onClick={handleChangeAddress} disabled={busy}>
                {effectiveChannel === 'sms' ? 'Ander telefoonnummer' : 'Ander e-mailadres'}
              </button>
            </div>
            <p className="auth-help">
              Geen code ontvangen? Kijk in je spam of stuur een nieuwe code. Zonder koppeling aan een restaurant kun
              je hier niet inloggen.
            </p>
          </>
        )}

        <div className="auth-actions">
          <Link className="auth-link" href={CLAIM_SEARCH_HREF}>
            {OWNER_ACCESS_MESSAGES.claimRouteLabel}
          </Link>
          <Link className="auth-link" href={INTERNAL_LOGIN_HREF}>
            Ik werk bij de redactie
          </Link>
        </div>
      </div>
    </main>
  )
}
