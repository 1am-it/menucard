// BE-56 (#137, punt 4) — /sitemap.xml.
//
// De regels staan in src/lib/seo.js (testbaar met `node --test`); dit bestand is
// alleen de Next.js-ingang en levert de bestaande statische gegevens aan: de
// restaurants uit data/restaurants.json en de menukaarten uit data/menus.json.
// Zonder geldige NEXT_PUBLIC_SITE_URL is de sitemap leeg (src/lib/siteUrl.js).

import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'
import { isIndexable, sitemapEntries } from '@/src/lib/seo'
import { siteUrl } from '@/src/lib/siteUrl'

export default function sitemap() {
  if (!isIndexable(process.env.NEXT_PUBLIC_SITE_INDEXABLE)) return []
  return sitemapEntries({
    siteUrl: siteUrl(),
    restaurants: Object.keys(restaurantsData),
    menus: Object.keys(menusData),
  })
}
