# Live-testing the internal API (`/api/internal/v1/...`)

How to get a real, authenticated session for an existing Supabase Auth test
account when live-verifying `PLATFORM-05`/`06`/07+ work — without asking
for a password each time.

## The problem

Every `/api/internal/v1/...` route requires a real Supabase Auth session
(`src/lib/internalAuth.js`). Access tokens expire in ~1 hour, so a fresh one
is needed for essentially every verification round. The straightforward way
— a password-grant `curl` call — needs the account's password each time:

```bash
curl -s -X POST '<SUPABASE_URL>/auth/v1/token?grant_type=password' \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<password>"}'
```

This works, but requires the account owner to run it and paste back an
`access_token` every single round — tedious, and means sharing a password
(even just by typing it locally) more often than necessary.

## The shortcut: mint a session with the service-role key, no password needed

Whoever already holds `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never
the browser) can generate a valid session for **any existing** Supabase
Auth user directly, using the admin API's magic-link mechanism purely as a
token-minting trick — no email is actually sent or needs to be clicked:

```js
const { createClient } = require('@supabase/supabase-js')

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function mintSession(email) {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link.data.properties.hashed_token
  // IMPORTANT: pass only { token_hash, type } - adding `email` here fails
  // with "Only the token_hash and type should be provided" on current SDKs.
  const verified = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  return { access_token: verified.data.session.access_token, user_id: verified.data.user.id }
}
```

This needs both `SUPABASE_SERVICE_ROLE_KEY` (to call `generateLink`) and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (to call `verifyOtp` — this step must run
against a non-admin client). Both are already required in `.env.local` for
`PLATFORM-05`/`06`. No password, no email delivery, no action from the
account owner.

## Limitation

This produces a fresh `access_token` (~1 hour, same as any session), not a
usable `refresh_token` for long-term reuse — `verifyOtp`'s session here is
meant to be consumed immediately, not persisted. For a verification round
that takes longer than an hour, mint again; it's free and requires nothing
from anyone.

## Injecting a session into a browser test (Playwright etc.)

To test `/internal/login`-gated pages (e.g. `/internal/moderation`) without
driving the actual login form, write the session into `localStorage` under
Supabase's default storage key (`sb-<project-ref>-auth-token`, where
`<project-ref>` is the subdomain of `SUPABASE_URL`) **before** navigating,
e.g. via Playwright's `page.addInitScript()`. The stored object must
include `expires_at` (a Unix-seconds timestamp — decode it from the JWT's
own `exp` claim) and a minimal `user` object (`id`, `aud: 'authenticated'`,
`role: 'authenticated'`, `email`) — a bare `{ access_token, user: {} }`
is silently rejected by the client's session-recovery check and redirects
back to `/internal/login` with no visible error.

## Security note

None of this exposes the service-role key to a browser or to the test
account itself — it stays server-side, exactly as `src/lib/supabaseAdmin.js`
already requires. This is a testing convenience for whoever already has
legitimate service-role access, not a new access path.
