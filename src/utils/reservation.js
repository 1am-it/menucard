// BE-07 — Reservation routing.
//
// Single source of truth for "how does a user reserve at this restaurant".
// Reads the restaurant.reservation object added in BE-02a
// ({ type, whatsapp, url, phone, verified }).
//
// Every restaurant in the current dataset has verified: false — no
// reservation capability has actually been confirmed with any restaurant
// (see docs/api/dish-result-shape.md / planning/specs/tickets/be-02a-*.md).
// That is the case this module is built around, not an edge case: the
// "verified" branch below is correct and ready, but nothing currently
// exercises it.

function buildWhatsAppLink(phone, restaurantName) {
  const clean = (phone || '').replace(/[^0-9+]/g, '')
  const nl = clean.startsWith('0') ? '+31' + clean.slice(1) : clean
  const msg = encodeURIComponent(
    `Hoi ${restaurantName}, ik zag jullie via BredaEats en wil graag een tafel reserveren. Kunnen jullie mij terugbellen of reageren?`
  )
  return `https://wa.me/${nl.replace('+', '')}?text=${msg}`
}

// BE-09 — shared validity guards for the two data shapes used everywhere a
// restaurant offers a contact/reservation method. Neither guard is specific
// to any one restaurant's data; both exist because the source data has
// contained a literal placeholder string ("Via website") in a phone/
// WhatsApp field, which previously rendered as a broken tel:/wa.me link
// instead of being treated as "no valid number on file".

/**
 * True only for a value that, after normalizing common punctuation
 * (spaces, dashes, dots, parentheses), is a plausible phone number: just
 * digits with an optional leading "+", and a digit count in the range a
 * real phone number actually falls in. Rejects placeholders ("Via
 * website"), empty values, and implausibly short/long digit strings.
 */
export function isValidPhone(value) {
  if (!value || typeof value !== 'string') return false
  const normalized = value.trim().replace(/[\s\-().]/g, '')
  if (!/^\+?[0-9]+$/.test(normalized)) return false
  const digitCount = normalized.replace('+', '').length
  return digitCount >= 8 && digitCount <= 15
}

/** True only for a syntactically valid absolute http(s) URL. */
export function isValidUrl(value) {
  if (!value || typeof value !== 'string') return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Returns an ordered list of real reservation actions for a restaurant.
 * The first entry is the primary action; any others are secondary/
 * alternative ways to reach the restaurant. Never invents a method the
 * restaurant doesn't actually have data for, and never claims a specific
 * method is confirmed unless `reservation.verified` says so.
 *
 * @param {object} restaurant
 * @returns {{method:string, label:string, href:string, external?:boolean}[]}
 */
export function getReservationActions(restaurant) {
  const r = restaurant?.reservation || {}

  if (r.verified) {
    // Real confirmation exists — trust it exclusively. Never show a
    // method alongside it that wasn't confirmed.
    if (r.type === 'whatsapp' && isValidPhone(r.whatsapp)) {
      return [{ method: 'whatsapp', label: 'Reserveer via WhatsApp', href: buildWhatsAppLink(r.whatsapp, restaurant.name) }]
    }
    if (r.type === 'phone' && isValidPhone(r.phone)) {
      return [{ method: 'phone', label: 'Bel restaurant', href: `tel:${r.phone}` }]
    }
    if ((r.type === 'url' || r.type === 'website') && isValidUrl(r.url)) {
      return [{ method: 'website', label: 'Reserveer via website', href: r.url, external: true }]
    }
    // A confirmed "no reservation channel" (r.type === 'none', a confirmed
    // type whose field is missing, or a confirmed type whose field fails
    // validation — e.g. a placeholder string) means show nothing rather
    // than fall back to guessing or exposing a dead link.
    return []
  }

  // Unverified — the current state for every restaurant. Offer the real,
  // self-published channels we actually have valid data for, safest/least
  // presumptive first. Never drop WhatsApp just because it isn't
  // confirmed: removing it would cost an existing, working lead channel
  // with no evidence it doesn't work, only that it was never formally
  // confirmed — see planning/specs/tickets/be-07-reservation-routing.md.
  // A field that fails validation (empty, a placeholder, or malformed) is
  // treated as "not on file", same as if it were missing entirely.
  const actions = []
  if (isValidUrl(r.url)) actions.push({ method: 'website', label: 'Reserveer via website', href: r.url, external: true })
  if (isValidPhone(r.whatsapp)) actions.push({ method: 'whatsapp', label: 'Reserveer via WhatsApp', href: buildWhatsAppLink(r.whatsapp, restaurant.name) })
  if (isValidPhone(r.phone)) actions.push({ method: 'phone', label: 'Bel restaurant', href: `tel:${r.phone}` })
  return actions
}

export { buildWhatsAppLink }
