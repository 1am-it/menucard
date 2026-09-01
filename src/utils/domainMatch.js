// PLATFORM-07 — domain-match evidence for owner claims.
//
// Deliberately simple, per the ticket's explicit instruction: normalize
// case and a leading "www." on both sides, then compare exactly — no
// subdomain-suffix matching or other cleverness. This is advisory
// evidence for a human editor, never a substitute for review and never
// used to auto-approve anything.

function normalizeDomain(hostname) {
  return (hostname || '').toLowerCase().replace(/^www\./, '')
}

export function computeDomainMatch(email, websiteUrl) {
  const emailDomain = normalizeDomain((email || '').split('@')[1])
  if (!emailDomain) return false

  let websiteDomain = ''
  try {
    websiteDomain = normalizeDomain(new URL(websiteUrl).hostname)
  } catch {
    return false
  }
  if (!websiteDomain) return false

  return emailDomain === websiteDomain
}
