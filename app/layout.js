import './globals.css'

export const metadata = {
  title: 'BredaEats — Zie de menukaart vóór je reserveert',
  description: 'De slimste manier om uit eten te gaan in Breda. Blader door menukaarten van 25 restaurants, filter op ingrediënt, dag en maaltijdtype.',
  keywords: 'Breda restaurants, menukaart, eten Breda, lunch Breda, diner Breda',
  openGraph: {
    title: 'BredaEats',
    description: 'Zie de menukaart vóór je reserveert',
    locale: 'nl_NL',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  )
}
