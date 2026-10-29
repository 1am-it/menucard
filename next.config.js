/** @type {import('next').NextConfig} */
const nextConfig = {
  // PDF.js must run through Node's native loader in server route handlers.
  serverExternalPackages: ['pdfjs-dist'],
  // The versioned extraction instruction is read server-side at runtime; keep
  // it in the traced output of both analysis routes instead of relying on a
  // developer's machine path or an untracked working-tree file.
  // BE-44 (#105) — de og:image-routes lezen één bold font uit assets/fonts
  // (next/og brengt zelf alleen regular mee). Deze include houdt dat bestand in
  // de getraceerde output van precies die twee routes; geen stylesheet en geen
  // gewone pagina verwijst ernaar.
  outputFileTracingIncludes: {
    '/api/internal/v1/restaurant-analysis-jobs/**': ['./MENU-EXTRACTION.md'],
    '/api/internal/v1/batch-analysis/**': ['./MENU-EXTRACTION.md'],
    // #59 / BE-21 "Lees met AI": route B reads the same pinned instruction.
    '/api/internal/v1/menu-ai-import/**': ['./MENU-EXTRACTION.md'],
    '/menu/**': ['./assets/fonts/**'],
    '/mijn-lijstje/**': ['./assets/fonts/**'],
  },
  // BE-31 (#74) — one visible address for "Bronnen beoordelen". The technical
  // names (API routes, tables, ids) stay unchanged; only these two old page
  // addresses move. `permanent: true` answers with a 308 and Next keeps the
  // query string, so an existing `?batch=<id>` deeplink still resolves (the new
  // page selects that batch task from it).
  async redirects() {
    return [
      {
        source: '/internal/source-triage/batch',
        destination: '/internal/bronnen',
        permanent: true,
      },
      {
        source: '/internal/source-triage',
        destination: '/internal/bronnen',
        permanent: true,
      },
    ]
  },
}
module.exports = nextConfig
