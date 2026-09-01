// PLATFORM-07 — noindex for /claim/* pages. Not an internal/admin surface
// (any authenticated user can reach it), but per-restaurant claim URLs
// have no SEO value and shouldn't accumulate in search results. Belt-and-
// suspenders alongside public/robots.txt's `Disallow: /claim/`.
export const metadata = {
  robots: { index: false, follow: false },
}

export default function ClaimLayout({ children }) {
  return children
}
