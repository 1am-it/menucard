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

// Resolves the effective theme before first paint, so there is no flash of
// the wrong theme. No stored preference (first visit, or storage cleared)
// resolves to 'dark' — matching the app's pre-THEME appearance exactly, not
// to OS preference. Only an explicit 'system' choice hands control to the
// prefers-color-scheme media query in app/globals.css. See
// planning/decisions/006-theme-token-system.md.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('bredaeats_theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}else if(t==='system'){document.documentElement.removeAttribute('data-theme');}else{document.documentElement.setAttribute('data-theme','dark');localStorage.setItem('bredaeats_theme','dark');}}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`

export default function RootLayout({ children }) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
