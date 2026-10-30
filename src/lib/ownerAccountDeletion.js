'use strict';

// BE-47 (#111), criterium 4 — "Account verwijderen" voor een restauranthouder.
//
// Alleen de eigen gebruiker, en alleen met een verse code. De route is een dunne
// wikkel om deze module (app/api/mijn-restaurant/account-verwijderen/route.js);
// alle beslissingen staan hier, zodat `node --test` ze met een fictieve client
// kan bewijzen.
//
// Hoe de verse code werkt — en waarom niet met `reauthenticate()`:
//   `supabase.auth.reauthenticate()` stuurt een *nonce*, en die nonce kan
//   Supabase alleen accepteren als `updateUser({ nonce })`; er is geen endpoint
//   waarmee een serverroute die nonce kan controleren (zie
//   node_modules/@supabase/auth-js, GoTrueClient.reauthenticate: het antwoord is
//   `{ user: null, session: null }`). Een code accepteren die niemand kan
//   verifiëren zou elk zestal cijfers goedkeuren — precies wat een gevoelige
//   actie niet mag. Daarom vraagt het scherm een gewone inlogcode aan
//   (`signInWithOtp({ email, options: { shouldCreateUser: false } })`, dezelfde
//   geteste flow als bij het inloggen) en verifieert *deze route* die code zelf
//   met de admin-client. Sterker dan de client: de code wordt nooit vertrouwd
//   omdat de browser hem goedkeurde.
//
// Verder, bewust:
//   - het e-mailadres komt uit de gecontroleerde sessie, nooit uit de body;
//   - de te verwijderen gebruiker is altijd de gebruiker van die sessie, nooit
//     een id uit het verzoek;
//   - de code moet bij díe gebruiker horen (anders 403);
//   - fouten worden Nederlands vertaald en nooit als Supabase-tekst getoond.

const { authErrorMessage } = require('./authErrors');
const { validateCode } = require('./claimEmailCodeFlow');

const DELETION_MESSAGES = Object.freeze({
  notSignedIn: 'Log opnieuw in en probeer het daarna nog een keer.',
  codeRejected: 'Deze code is ongeldig of verlopen. Vraag een nieuwe code aan.',
  otherUser: 'Deze code hoort niet bij je eigen account. Vraag een nieuwe code aan.',
  noEmail: 'Dit account heeft geen e-mailadres waarmee we de code kunnen controleren.',
  blocked: 'Je account kan nu niet worden verwijderd. Neem contact op met de redactie.',
  failed: 'Je account kon niet worden verwijderd. Probeer het opnieuw.',
  deleted: 'Je account is verwijderd. Je bent uitgelogd.',
  notConfigured: 'Account verwijderen is in deze omgeving niet geconfigureerd.',
});

/** The bearer token of the request, or `null` — never a token from the body. */
function readBearerToken(request) {
  if (!request || !request.headers || typeof request.headers.get !== 'function') return null;
  const header = request.headers.get('authorization');
  const value = typeof header === 'string' ? header.trim() : '';
  if (value.length < 8 || value.slice(0, 7).toLowerCase() !== 'bearer ') return null;
  const token = value.slice(7).trim();
  return token || null;
}

/**
 * A foreign-key violation means another table still refers to this account —
 * deleting it would break that record, so the account is kept and the visitor is
 * told to contact the redaction. Postgres reports it as `23503`.
 */
function isForeignKeyViolation(error) {
  if (!error) return false;
  if (typeof error.code === 'string' && error.code === '23503') return true;
  const message = typeof error.message === 'string' ? error.message : '';
  return /foreign key/i.test(message);
}

/**
 * The handler for `POST /api/mijn-restaurant/account-verwijderen`.
 * Returns `{ status, body }`; the route turns that into a `NextResponse`.
 */
function createAccountDeletionHandler(deps) {
  const getSupabase = deps && deps.getSupabase;
  if (typeof getSupabase !== 'function') {
    throw new TypeError('createAccountDeletionHandler needs a getSupabase function');
  }

  return async function deleteOwnAccount(request) {
    const token = readBearerToken(request);
    if (!token) return { status: 401, body: { error: DELETION_MESSAGES.notSignedIn } };

    let payload = null;
    try {
      payload = await request.json();
    } catch (error) {
      payload = null;
    }

    // The code is checked before anything is touched: an incomplete request never
    // reaches Supabase at all.
    const code = validateCode(payload && payload.code);
    if (!code.valid) return { status: 400, body: { error: code.message } };

    let supabase;
    try {
      supabase = getSupabase();
    } catch (error) {
      return { status: 500, body: { error: DELETION_MESSAGES.notConfigured } };
    }

    let user = null;
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data || !data.user) return { status: 401, body: { error: DELETION_MESSAGES.notSignedIn } };
      user = data.user;
    } catch (error) {
      return { status: 401, body: { error: DELETION_MESSAGES.notSignedIn } };
    }

    const userId = user.id;
    const email = typeof user.email === 'string' ? user.email.trim() : '';
    if (!userId) return { status: 401, body: { error: DELETION_MESSAGES.notSignedIn } };
    if (!email) return { status: 400, body: { error: DELETION_MESSAGES.noEmail } };

    let verified = null;
    try {
      verified = await supabase.auth.verifyOtp({ email, token: code.code, type: 'email' });
    } catch (error) {
      return { status: 400, body: { error: DELETION_MESSAGES.codeRejected } };
    }
    if (!verified || verified.error) {
      const translated = verified ? authErrorMessage(verified.error, { context: 'email-code' }) : null;
      return { status: 400, body: { error: translated || DELETION_MESSAGES.codeRejected } };
    }

    // The fresh code must belong to the session's own account. If it belongs to
    // someone else, nothing is deleted.
    const verifiedUserId = verified.data && verified.data.user ? verified.data.user.id : null;
    if (!verifiedUserId || verifiedUserId !== userId) {
      return { status: 403, body: { error: DELETION_MESSAGES.otherUser } };
    }

    const removed = await supabase.auth.admin.deleteUser(userId);
    if (removed && removed.error) {
      const blocked = isForeignKeyViolation(removed.error);
      return {
        status: blocked ? 409 : 500,
        body: { error: blocked ? DELETION_MESSAGES.blocked : DELETION_MESSAGES.failed },
      };
    }

    return { status: 200, body: { deleted: true, message: DELETION_MESSAGES.deleted } };
  };
}

module.exports = {
  DELETION_MESSAGES,
  createAccountDeletionHandler,
  isForeignKeyViolation,
  readBearerToken,
};

