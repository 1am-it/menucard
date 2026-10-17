/** @type {import('next').NextConfig} */
const nextConfig = {
  // PDF.js must run through Node's native loader in server route handlers.
  serverExternalPackages: ['pdfjs-dist'],
  // The versioned extraction instruction is read server-side at runtime; keep
  // it in the traced output of both analysis routes instead of relying on a
  // developer's machine path or an untracked working-tree file.
  outputFileTracingIncludes: {
    '/api/internal/v1/restaurant-analysis-jobs/**': ['./MENU-EXTRACTION.md'],
    '/api/internal/v1/batch-analysis/**': ['./MENU-EXTRACTION.md'],
  },
}
module.exports = nextConfig
