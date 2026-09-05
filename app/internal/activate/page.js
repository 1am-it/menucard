'use client'

// Scanner-resistant activation step for internal accounts — must be
// visited *before* /internal/set-password can ever see a real session.
//
// Why this page exists, and why it works: see src/lib/activationFlow.js's
// own header comment for the full explanation (Supabase's default email
// link verifies a one-time token on a plain GET, which an automated
// email-link scanner can trigger before the real recipient ever clicks —
// this was observed live against this project's own invite links). The
// fix: the email link carries the token only in the URL fragment
// (`#token_hash=...&type=...`), which no server — not Supabase's, not
// this app's — ever receives; and loading this page performs no
// verification at all. Only an explicit button click calls
// `supabase.auth.verifyOtp()`, a POST no passive scanner can trigger.
//
// No `redirect_to` is ever read from the URL — the only destination
// after a successful activation is hardcoded below to
// `/internal/set-password`, never a URL-supplied value.
//
// Grants no access of its own — exactly like /internal/set-password,
// this only establishes a session so that page's existing, unchanged
// flow can run; staff_roles/Data-inbox access is entirely unaffected.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { parseActivationHash, performActivation } from '@/src/lib/activationFlow'

export default function ActivatePage() {
  const router = useRouter()
  // 'invalid' | 'ready' | 'activating' — see parseActivationHash's own
  // contract: reaching 'ready' never itself creates a session or calls
  // Supabase; only handleActivate's explicit click path does.
  const [viewState, setViewState] = useState('invalid')
  const [tokenHash, setTokenHash] = useState(null)
  const [type, setType] = useState(null)
  const [activationError, setActivationError] = useState(null)

  useEffect(() => {
    // Pure, local parsing only — parseActivationHash has no Supabase
    // client to call even if it wanted to. No verification happens here.
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    const result = parseActivationHash(hash)
    if (result.valid) {
      setTokenHash(result.tokenHash)
      setType(result.type)
      setViewState('ready')
    } else {
      setViewState('invalid')
    }
  }, [])

  async function handleActivate() {
    setActivationError(null)
    setViewState('activating')

    let outcome
    try {
      const supabase = getSupabaseBrowser()
      outcome = await performActivation(supabase.auth, { tokenHash, type })
    } catch (err) {
      // getSupabaseBrowser() itself throwing (e.g. a browser/embedded
      // context that blocks storage access — the same real-world failure
      // class already fixed on /internal/set-password) must degrade the
      // same safe way here too, never crash this page.
      outcome = { ok: false, message: 'This activation link is invalid or has expired. Please request a new one.' }
    }

    if (!outcome.ok) {
      setActivationError(outcome.message)
      setViewState('ready')
      return
    }

    router.replace('/internal/set-password')
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
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Activate your account</h1>

      {viewState === 'invalid' && (
        <div>
          <p style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 12 }}>
            This activation link is invalid or has expired.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Please ask whoever manages internal accounts to send a new link.
          </p>
        </div>
      )}

      {(viewState === 'ready' || viewState === 'activating') && (
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Click below to activate your account.
          </p>
          {activationError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{activationError}</div>}
          <button
            type="button"
            onClick={handleActivate}
            disabled={viewState === 'activating'}
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
            {viewState === 'activating' ? 'Activating…' : 'Activate account'}
          </button>
        </div>
      )}
    </main>
  )
}
