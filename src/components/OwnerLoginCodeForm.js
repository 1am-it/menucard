'use client'

// BE-63 (#155, ronde 4) — de ENE bron van de houder-inlog met e-mailcode.
//
// De logica stond tot ronde 4 in app/mijn-restaurant/inloggen/OwnerLoginView.js.
// Sinds /inloggen hetzelfde formulier direct op de pagina toont (uitkomst 4 van
// het contract), staan de stappen hier één keer: het e-mailadres (of, achter de
// sms-vlag, het telefoonnummer), de code van zes cijfers en dezelfde neutrale
// melding en foutvertaling. Beide pagina's gebruiken dit component; er is geen
// tweede kopie van de flow.
//
// De inloglogica zelf is ongewijzigd (BE-47/BE-48): src/lib/claimEmailCodeFlow.js
// doet `signInWithOtp({ shouldCreateUser: false })` en `verifyOtp({ type:
// 'email' })`, src/lib/authErrors.js vertaalt fouten en src/lib/ownerAccess.js
// bepaalt waar de bezoeker verdergaat. Dit component roept die modules alleen
// aan en toont het resultaat.
//
// Props (klein gehouden, zodat beide pagina's dezelfde flow delen):
//   - submitLabel: tekst op de knop van de eerste stap;
//   - showSignInHeading: toont dit component zijn eigen titel en uitleg, of
//     staat de titel al op de pagina (zoals op /inloggen);
//   - headingLevel: 1 op /mijn-restaurant/inloggen, 2 op /inloggen (één h1 per
//     pagina);
//   - emailHelp: één regel onder het formulier, bijvoorbeeld de uitleg welk
//     adres je gebruikt.
//
// BE-66 (#162) — wat er in de eerste lading zit en wat pas bij het versturen:
// dit component is de kleine, statische helft (velden, teksten, knoppen,
// validatie op leeg). De Supabase-client en de inloglogica komen pas binnen bij
// een tik op "Stuur mij een inlogcode" of "Inloggen", via
// src/lib/ownerLoginClient.js. Daardoor zit @supabase/supabase-js niet meer in de
// eerste lading van /inloggen (177 kB → zie de meting in de checkpoint) en
// verandert er aan de flow zelf niets. Zolang de logica laadt, staat de knop op
// "Bezig…" (uitgeschakeld, met aria-busy).
//
// Een al ingelogde houder hoeft hier niets extra's te doen: deze pagina stuurt
// niemand bij het laden door (dat deed BE-63 al niet) en de goedkope
// sessiesleutel-helper in de gedeelde kop (src/lib/accountSession.js) regelt het
// accountmenu. Er komt dus geen volledige client in de eerste lading.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { isSmsLoginEnabled } from '@/src/lib/ownerSmsLogin'
import { MESSAGES } from '@/src/lib/authErrors'
import { INTERNAL_LOGIN_HREF, OWNER_ACCESS_MESSAGES, resolveOwnerEntry } from '@/src/lib/ownerAccess'

// Zonder Supabase-configuratie (bijvoorbeeld een lokale build zonder
// .env.local) blijft het scherm eerlijk staan in plaats van eindeloos te wachten.
const CONFIG_ERROR_TEXT =
  'Inloggen is in deze omgeving niet geconfigureerd. Probeer het later opnieuw of open deze pagina op de echte site.'

export default function OwnerLoginCodeForm({
  submitLabel = 'Stuur code',
  showSignInHeading = true,
  headingLevel = 1,
  emailHelp = null,
}) {
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
  // BE-66: null = niets bezig; 'laden' = de logica en de client komen binnen;
  // 'versturen' / 'controleren' = de bestaande Supabase-aanroep loopt.
  const [phase, setPhase] = useState(null)
  const busy = phase !== null

  const effectiveChannel = smsEnabled && channel === 'sms' ? 'sms' : 'email'
  // Eén h1 per pagina: /inloggen heeft zijn eigen titel al in de server-HTML.
  const Heading = headingLevel === 1 ? 'h1' : 'h2'

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
    setPhase('laden')
    try {
      // BE-66: pas nu, bij het versturen, komen de client en de logica binnen.
      const login = await import('@/src/lib/ownerLoginClient')
      setPhase('versturen')
      const result = await login.sendOwnerSignInCode({
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
      setPhase(null)
    }
  }

  async function handleVerifyCode(event) {
    if (event) event.preventDefault()
    setError(null)
    setPhase('laden')
    try {
      const login = await import('@/src/lib/ownerLoginClient')
      setPhase('controleren')
      const result = await login.confirmOwnerSignInCode({
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
      setPhase(null)
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
    <>
      {!codeSent && (
        <>
          {showSignInHeading && (
            <>
              <Heading className="auth-title">{OWNER_ACCESS_MESSAGES.signInTitle}</Heading>
              <p className="auth-intro">{OWNER_ACCESS_MESSAGES.signInIntro}</p>
            </>
          )}

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
            <button
              type="submit"
              className="auth-submit"
              disabled={busy}
              aria-busy={busy ? 'true' : undefined}
            >
              {phase === 'laden' ? 'Bezig…' : phase === 'versturen' ? 'Bezig met versturen…' : submitLabel}
            </button>
          </form>
          {emailHelp ? <p className="auth-help">{emailHelp}</p> : null}
        </>
      )}

      {codeSent && (
        <>
          <Heading className="auth-title">{OWNER_ACCESS_MESSAGES.codeTitle}</Heading>
          <p className="auth-intro">
            {effectiveChannel === 'sms' ? 'Vul de zes cijfers in uit de sms.' : 'Vul de zes cijfers in uit de e-mail.'}
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
            <button
              type="submit"
              className="auth-submit"
              disabled={busy}
              aria-busy={busy ? 'true' : undefined}
            >
              {phase === 'laden' ? 'Bezig…' : phase === 'controleren' ? 'Bezig met controleren…' : 'Inloggen'}
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
            Geen code ontvangen? Kijk in je spam of stuur een nieuwe code. Zonder koppeling aan een restaurant kun je
            hier niet inloggen.
          </p>
        </>
      )}
    </>
  )
}
