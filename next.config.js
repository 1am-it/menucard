/** @type {import('next').NextConfig} */
const nextConfig = {
  // PDF.js must run through Node's native loader in server route handlers.
  serverExternalPackages: ['pdfjs-dist'],
}
module.exports = nextConfig
