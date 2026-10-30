// BE-47 (#111) — noindex voor /mijn-restaurant. Net als /claim/* is dit geen
// interne beheeromgeving maar wel een persoonlijke pagina: geen SEO-waarde en
// niets dat in zoekresultaten hoort te staan. Belt-and-suspenders naast
// public/robots.txt.
export const metadata = {
  robots: { index: false, follow: false },
}

export default function MijnRestaurantLayout({ children }) {
  return children
}
