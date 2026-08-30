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
    if (r.type === 'whatsapp' && r.whatsapp) {
      return [{ method: 'whatsapp', label: 'Reserveer via WhatsApp', href: buildWhatsAppLink(r.whatsapp, restaurant.name) }]
    }
    if (r.type === 'phone' && r.phone) {
      return [{ method: 'phone', label: 'Bel restaurant', href: `tel:${r.phone}` }]
    }
    if ((r.type === 'url' || r.type === 'website') && r.url) {
      return [{ method: 'website', label: 'Reserveer via website', href: r.url, external: true }]
    }
    // A confirmed "no reservation channel" (r.type === 'none', or a
    // confirmed type whose field is missing) means show nothing rather
    // than fall back to guessing.
    return []
  }

  // Unverified — the current state for every restaurant. Offer the real,
  // self-published channels we actually have data for, safest/least
  // presumptive first. Never drop WhatsApp just because it isn't
  // confirmed: removing it would cost an existing, working lead channel
  // with no evidence it doesn't work, only that it was never formally
  // confirmed — see planning/specs/tickets/be-07-reservation-routing.md.
  const actions = []
  if (r.url) actions.push({ method: 'website', label: 'Reserveer via website', href: r.url, external: true })
  if (r.whatsapp) actions.push({ method: 'whatsapp', label: 'Reserveer via WhatsApp', href: buildWhatsAppLink(r.whatsapp, restaurant.name) })
  if (r.phone) actions.push({ method: 'phone', label: 'Bel restaurant', href: `tel:${r.phone}` })
  return actions
}

export { buildWhatsAppLink }
