// BE-56 (#137, punt 3) — /robots.txt.
//
// De regels staan in src/lib/seo.js (testbaar met `node --test`); dit bestand is
// alleen de Next.js-ingang. De sitemap-regel verschijnt alleen als er een
// geldige NEXT_PUBLIC_SITE_URL is (src/lib/siteUrl.js): zonder eigen domein
// wijst de regel nergens naar.

import { closedRobotsMetadata, isIndexable, robotsMetadata } from '@/src/lib/seo'
import { siteUrl } from '@/src/lib/siteUrl'

export default function robots() {
  if (!isIndexable(process.env.NEXT_PUBLIC_SITE_INDEXABLE)) return closedRobotsMetadata()
  return robotsMetadata({ siteUrl: siteUrl() })
}
