// Shared noindex for every /internal/* route (PLATFORM-01, PLATFORM-06, and
// any future internal page) — a Server Component so 'use client' pages
// underneath (e.g. app/internal/login, app/internal/moderation) can still
// inherit this metadata, since client components can't export `metadata`
// themselves. Belt-and-suspenders alongside public/robots.txt's
// `Disallow: /internal/`.
export const metadata = {
  robots: { index: false, follow: false },
}

export default function InternalLayout({ children }) {
  return children
}
