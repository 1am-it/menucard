// BE-68 (#168) — /mijn-restaurant/qr: het QR-kaartje voor op tafel.
//
// Server Component, zelfde reden als /mijn-restaurant/aanbod: alleen de kleine
// statische index (naam en kaart-ids per restaurant) gaat naar de browser, nooit
// de volledige data/restaurants.json of data/menus.json. De sessie, de rollen
// (`GET /api/internal/v1/me`) en de keuzes staan client-side; alle beslissingen
// staan in src/lib/qrKaartje.js en zijn daar met `node --test` getest.
//
// De twee omgevingswaarden gaan als prop mee, net als op /menu/[id]: de
// site-URL bepaalt de absolute URL achter de QR-code en de indexeer-vlag bepaalt
// of de melding "nog niet live" er staat. De QR-bibliotheek zelf wordt pas in
// QrCode.js dynamisch geladen.

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'
import { buildOwnerRestaurantIndex } from '@/src/lib/ownerRestaurantIndex'
import QrKaartje from './QrKaartje'

export default function QrKaartjePage() {
  return (
    <QrKaartje
      restaurantIndex={buildOwnerRestaurantIndex(restaurantsData, menusData)}
      siteUrl={process.env.NEXT_PUBLIC_SITE_URL || ''}
      siteIndexable={process.env.NEXT_PUBLIC_SITE_INDEXABLE || ''}
    />
  )
}
