'use client'

// BE-47 (#111), criterium 4 — de gevoelige actie "Account verwijderen".
//
// Twee stappen, zoals het contract vraagt: eerst een nieuwe code, daarna pas
// verwijderen. Het scherm vraagt die code aan met dezelfde geteste flow als het
// inloggen (`requestOwnerSignInCode`, dus `shouldCreateUser: false`) en stuurt
// hem naar POST /api/mijn-restaurant/account-verwijderen. De route controleert de
// code zelf en verwijdert alleen de gebruiker van de meegestuurde sessie; dit
// scherm beslist dus niets en kan ook niets forceren.
//
// Waarom geen `supabase.auth.reauthenticate()`: die stuurt een nonce die alleen
// `updateUser({ nonce })` accepteert, en een serverroute kan die niet
// controleren — een gevoelige actie mag niet op een oncontroleerbaar zestal
// cijfers vertrouwen. De reden staat uitgebreid in src/lib/ownerAccountDeletion.js.

import { useState } from 'react'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { requestOwnerSignInCode } from '@/src/lib/claimEmailCodeFlow'
import { DELETION_MESSAGES } from '@/src/lib/ownerAccountDeletion'
import { MESSAGES } from '@/src/lib/authErrors'
import { OWNER_OVERVIEW_MESSAGES } from '@/src/lib/ownerRestaurantOverview'
// BE-52 (#128): de eigen opmaak van deze pagina staat naast de pagina.
import './mijn-restaurant.css'


const DELETE_ENDPOINT = '/api/mijn-restaurant/account-verwijderen'

const COPY = {
  intro: 'Na verwijderen is je account weg en word je uitgelogd. Je restaurantpagina blijft gewoon online.',
  confirm: 'Weet je het zeker? We sturen eerst een code van zes cijfers naar je e-mailadres.',
  stepTwo: 'Vul de code in. Daarna is je account verwijderd.',
  cancel: 'Annuleren',
  sendCode: 'Stuur code',
  confirmDelete: 'Verwijder mijn account',
  busy: 'Bezig…',
}

export default function OwnerAccountDeletion({ session, onDeleted }) {
  const [step, setStep] = useState('idle') // idle | confirm | code
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const email = session && session.user && typeof session.user.email === 'string' ? session.user.email : ''

  function reset() {
    setStep('idle')
    setCode('')
    setNotice(null)
    setError(null)
  }

  async function sendCode() {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const supabase = getSupabaseBrowser()
      const result = await requestOwnerSignInCode(supabase.auth, {
        channel: 'email',
        email,
        allowPhone: false,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setNotice(result.notice)
      setCode('')
      setStep('code')
    } catch (err) {
      setError(MESSAGES.generic)
    } finally {
      setBusy(false)
    }
  }

  async function deleteAccount(event) {
    if (event) event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(DELETE_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body && body.error ? body.error : DELETION_MESSAGES.failed)
        return
      }
      try {
        await getSupabaseBrowser().auth.signOut()
      } catch (err) {
        // The account is already gone; signing out locally is best effort.
      }
      if (typeof onDeleted === 'function') onDeleted()
    } catch (err) {
      setError(DELETION_MESSAGES.failed)
    } finally {
      setBusy(false)
    }
  }

  const errorAlert = error ? (
    <p className="auth-error" id="owner-delete-error" role="alert">
      {error}
    </p>
  ) : null

  const noticeAlert = notice ? (
    <p className="auth-notice" role="status">
      {notice}
    </p>
  ) : null

  return (
    <section className="owner-danger" aria-labelledby="owner-delete-title">
      <h2 className="owner-danger-title" id="owner-delete-title">
        {OWNER_OVERVIEW_MESSAGES.deleteAccount}
      </h2>
      <p className="owner-note">{COPY.intro}</p>

      {!email && <p className="owner-note">{DELETION_MESSAGES.noEmail}</p>}

      {email && step === 'idle' && (
        <div className="owner-actions">
          <button type="button" className="auth-secondary" onClick={() => setStep('confirm')}>
            {OWNER_OVERVIEW_MESSAGES.deleteAccount}
          </button>
        </div>
      )}

      {email && step === 'confirm' && (
        <>
          <p className="owner-note">{COPY.confirm}</p>
          {errorAlert}
          <div className="owner-actions">
            <button type="button" className="auth-secondary" onClick={sendCode} disabled={busy}>
              {busy ? COPY.busy : COPY.sendCode}
            </button>
            <button type="button" className="auth-secondary" onClick={reset} disabled={busy}>
              {COPY.cancel}
            </button>
          </div>
        </>
      )}

      {email && step === 'code' && (
        <>
          <p className="owner-note">{COPY.stepTwo}</p>
          {noticeAlert}
          <form className="auth-form" onSubmit={deleteAccount} noValidate>
            <div className="auth-field">
              <label className="auth-label" htmlFor="owner-delete-code">
                Code uit de e-mail
              </label>
              <input
                id="owner-delete-code"
                className="auth-input auth-input--code"
                type="text"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                aria-describedby={error ? 'owner-delete-error' : undefined}
                aria-invalid={error ? 'true' : undefined}
                required
              />
            </div>
            {errorAlert}
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? COPY.busy : COPY.confirmDelete}
            </button>
          </form>
          <div className="owner-actions">
            <button type="button" className="auth-secondary" onClick={sendCode} disabled={busy}>
              Nieuwe code sturen
            </button>
            <button type="button" className="auth-secondary" onClick={reset} disabled={busy}>
              {COPY.cancel}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
