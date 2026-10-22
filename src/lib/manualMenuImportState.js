'use strict';

// #59 fase 2 — herstelronde na Lead-review 6350337273 (K1).
//
// De handmatige AI-import bewaarde bundel, rapport en beslissingen in een
// `new Map()` op moduleniveau. Op Vercel is elke route een eigen
// serverless-functie (en zelfs één functie kan meerdere instanties hebben), dus
// gedeeld geheugen bestaat daar niet: stap 3 gaf een 404 omdat de import in een
// andere instantie niet bestond.
//
// Daarom is de stroom nu toestandsloos aan de serverkant. Na elke stap geeft de
// server één **ondertekend en versleuteld toestandstoken** terug; de client
// stuurt dat bij de volgende stap mee. Eigenschappen:
//
//   - AES-256-GCM (authenticated encryption): een gewijzigd token wordt
//     geweigerd, niet gelezen;
//   - de sleutel komt met HKDF-SHA256 uit het bestaande servergeheim
//     `SUPABASE_SERVICE_ROLE_KEY`, met een eigen info-label. Er is geen nieuw
//     geheim, geen nieuwe env-variabele en de sleutel gaat nooit naar de client;
//   - het token bevat de vervaltijd, de gebruikers-ID, het restaurant en de
//     bundel-/importhash. De server controleert die waarden bij het openen;
//   - de grootte is begrensd; te groot is een gewone melding met een nieuwe
//     prompt, geen stille afkapping;
//   - het token hoort alleen in het geheugen van de pagina, niet in
//     `localStorage`.
//
// Dit bestand is server-only (node:crypto), doet geen netwerkoproep en schrijft
// niets. Er is geen migratie en geen nieuwe tabel.

const { createCipheriv, createDecipheriv, hkdfSync, randomBytes } = require('node:crypto');

const STATE_TOKEN_PREFIX = 'mmis1';
const STATE_KEY_INFO = 'menucard/manual-menu-import/state/v1';
const STATE_KEY_SALT = 'menucard/manual-menu-import/state/salt/v1';
const STATE_AAD = Buffer.from('menucard:manual-menu-import:state:v1', 'utf8');
const DEFAULT_STATE_TTL_MS = 30 * 60 * 1000;
// Bovengrens voor het hele token. De brontekst in de bundel is al begrensd
// (400 000 tekens samen) en het gevalideerde rapport past daar ruim bij; alles
// daarboven is geen normale stap en krijgt een gewone melding.
const MAX_STATE_TOKEN_CHARS = 4 * 1024 * 1024;
const MIN_SECRET_LENGTH = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;

const STATE_MESSAGES = {
  state_config_missing:
    'De import is op deze server niet geconfigureerd: de sleutel voor de tussenstap ontbreekt.',
  state_invalid: 'Deze stap hoort niet bij een geldige import. Maak opnieuw een prompt.',
  state_expired: 'Deze stap is verlopen. Maak opnieuw een prompt.',
  state_other_user: 'Deze stap hoort niet bij jouw sessie. Maak opnieuw een prompt.',
  state_too_large: 'Deze stap is te groot om te bewaren. Maak opnieuw een prompt met minder of kleinere bronnen.',
  state_mismatch: 'Deze stap hoort bij een andere import. Maak opnieuw een prompt.',
};

class ManualImportStateError extends Error {
  constructor(code, message) {
    super(message || STATE_MESSAGES[code] || STATE_MESSAGES.state_invalid);
    this.name = 'ManualImportStateError';
    this.code = STATE_MESSAGES[code] ? code : 'state_invalid';
  }
}

function stateMessage(code) {
  return STATE_MESSAGES[code] || STATE_MESSAGES.state_invalid;
}

/**
 * HKDF-SHA256 uit het bestaande servergeheim. Een leeg of te kort geheim is
 * een configuratiefout met een concrete melding, geen stille sleutel.
 */
function deriveStateKey(secret) {
  if (typeof secret !== 'string' || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new ManualImportStateError('state_config_missing');
  }
  const key = hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from(STATE_KEY_SALT, 'utf8'),
    Buffer.from(STATE_KEY_INFO, 'utf8'),
    KEY_BYTES,
  );
  return Buffer.from(key);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function assertStateShape(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new ManualImportStateError('state_invalid');
  }
  if (!isNonEmptyString(state.userId)) throw new ManualImportStateError('state_invalid');
  if (!isNonEmptyString(state.restaurantId)) throw new ManualImportStateError('state_invalid');
  const bundle = state.bundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new ManualImportStateError('state_invalid');
  if (!isNonEmptyString(bundle.bundleHash)) throw new ManualImportStateError('state_invalid');
  if (bundle.actorUserId !== state.userId || bundle.restaurantId !== state.restaurantId) {
    throw new ManualImportStateError('state_invalid');
  }
  if (state.report !== null && state.report !== undefined) {
    if (typeof state.report !== 'object' || Array.isArray(state.report)) throw new ManualImportStateError('state_invalid');
    if (!isNonEmptyString(state.report.importId)) throw new ManualImportStateError('state_invalid');
    if (state.report.bundleHash !== bundle.bundleHash) throw new ManualImportStateError('state_invalid');
  }
  if (state.decisions !== undefined && state.decisions !== null && !Array.isArray(state.decisions)) {
    throw new ManualImportStateError('state_invalid');
  }
  if (state.followUps !== undefined && state.followUps !== null) {
    if (typeof state.followUps !== 'object' || Array.isArray(state.followUps)) throw new ManualImportStateError('state_invalid');
  }
}

/**
 * AES-256-GCM met een willekeurige IV per token. Het AAD bindt het token aan
 * deze versie en deze toepassing, zodat een token van een andere route of een
 * ander formaat nooit als geldige stap doorgaat.
 */
function encryptState(key, payload) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(STATE_AAD);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [STATE_TOKEN_PREFIX, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}

function decryptState(key, token) {
  const parts = String(token).split('.');
  if (parts.length !== 4) throw new ManualImportStateError('state_invalid');
  const [prefix, ivPart, cipherPart, tagPart] = parts;
  if (prefix !== STATE_TOKEN_PREFIX) throw new ManualImportStateError('state_invalid');
  const iv = Buffer.from(ivPart, 'base64url');
  const ciphertext = Buffer.from(cipherPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new ManualImportStateError('state_invalid');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(STATE_AAD);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Authenticatiefout: het token is gewijzigd of niet van deze server.
    throw new ManualImportStateError('state_invalid');
  }
}

/**
 * De cipher die de handlers injecteren. `now` is injecteerbaar zodat verlopen
 * tokens met een test te bewijzen zijn; de productie gebruikt de echte klok.
 */
function createManualImportStateCipher({
  secret,
  now = () => new Date(),
  ttlMs = DEFAULT_STATE_TTL_MS,
  maxTokenChars = MAX_STATE_TOKEN_CHARS,
} = {}) {
  let cachedKey = null;

  function key() {
    if (!cachedKey) cachedKey = deriveStateKey(secret);
    return cachedKey;
  }

  function currentMs() {
    const value = now();
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
  }

  function seal(state) {
    assertStateShape(state);
    const issuedMs = currentMs();
    if (!Number.isFinite(issuedMs)) throw new ManualImportStateError('state_invalid');
    const envelope = {
      v: 1,
      iat: new Date(issuedMs).toISOString(),
      exp: issuedMs + ttlMs,
      userId: state.userId,
      restaurantId: state.restaurantId,
      bundleHash: state.bundle.bundleHash,
      importId: state.report && state.report.importId ? state.report.importId : null,
      state: {
        userId: state.userId,
        restaurantId: state.restaurantId,
        bundle: state.bundle,
        report: state.report || null,
        decisions: Array.isArray(state.decisions) ? state.decisions : [],
        followUps: state.followUps && typeof state.followUps === 'object' ? state.followUps : {},
        followUpTotal: Number.isInteger(state.followUpTotal) ? state.followUpTotal : 0,
      },
    };
    const token = encryptState(key(), JSON.stringify(envelope));
    if (token.length > maxTokenChars) throw new ManualImportStateError('state_too_large');
    return { token, expiresAt: new Date(envelope.exp).toISOString(), issuedAt: envelope.iat };
  }

  function open(token) {
    if (typeof token !== 'string' || token.trim() === '') {
      return { ok: false, code: 'state_invalid', message: STATE_MESSAGES.state_invalid };
    }
    if (token.length > maxTokenChars) {
      return { ok: false, code: 'state_too_large', message: STATE_MESSAGES.state_too_large };
    }
    let envelope;
    try {
      envelope = JSON.parse(decryptState(key(), token));
    } catch (err) {
      const code = err instanceof ManualImportStateError ? err.code : 'state_invalid';
      return { ok: false, code, message: stateMessage(code) };
    }
    if (!envelope || typeof envelope !== 'object' || envelope.v !== 1) {
      return { ok: false, code: 'state_invalid', message: STATE_MESSAGES.state_invalid };
    }
    const expiresMs = Number(envelope.exp);
    const nowMs = currentMs();
    if (!Number.isFinite(expiresMs) || !Number.isFinite(nowMs)) {
      return { ok: false, code: 'state_invalid', message: STATE_MESSAGES.state_invalid };
    }
    if (expiresMs <= nowMs) {
      return { ok: false, code: 'state_expired', message: STATE_MESSAGES.state_expired };
    }
    const state = envelope.state;
    try {
      assertStateShape(state);
    } catch {
      return { ok: false, code: 'state_invalid', message: STATE_MESSAGES.state_invalid };
    }
    // De kernwaarden staan zowel in de envelop als in de versleutelde staat;
    // ze moeten exact overeenkomen, anders is het token niet consistent.
    if (envelope.userId !== state.userId || envelope.restaurantId !== state.restaurantId) {
      return { ok: false, code: 'state_invalid', message: STATE_MESSAGES.state_invalid };
    }
    if (envelope.bundleHash !== state.bundle.bundleHash) {
      return { ok: false, code: 'state_invalid', message: STATE_MESSAGES.state_invalid };
    }
    const importId = state.report && state.report.importId ? state.report.importId : null;
    if ((envelope.importId || null) !== importId) {
      return { ok: false, code: 'state_invalid', message: STATE_MESSAGES.state_invalid };
    }
    return { ok: true, state, expiresAt: new Date(expiresMs).toISOString() };
  }

  return { seal, open };
}

module.exports = {
  STATE_TOKEN_PREFIX,
  STATE_KEY_INFO,
  STATE_KEY_SALT,
  DEFAULT_STATE_TTL_MS,
  MAX_STATE_TOKEN_CHARS,
  MIN_SECRET_LENGTH,
  STATE_MESSAGES,
  ManualImportStateError,
  stateMessage,
  deriveStateKey,
  createManualImportStateCipher,
};

