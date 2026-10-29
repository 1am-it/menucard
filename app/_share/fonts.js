// BE-44 (#105, criterium 3) — het ene vetje voor de voorvertoningsafbeeldingen.
//
// `ImageResponse` (next/og, satori) brengt standaard alleen één regulier font
// mee. De goedgekeurde artboards ("Definitief · licht/donker") zetten de
// restaurantnaam en de gerechtnaam vet; daarvoor is één bold bestand genoeg.
//
// - Bron: Noto Sans Bold (SIL Open Font License 1.1), hetzelfde lettertype als
//   het reguliere font dat next/og al meebrengt;
// - teruggebracht tot Latijn + de tekens die de menukaarten echt gebruiken
//   (accenten, ·, …, €), zie assets/fonts/README.md;
// - de licentie staat ernaast in assets/fonts/OFL.txt;
// - geen npm-dependency en nooit op een gewone pagina: alleen deze twee
//   og:image-routes lezen het bestand.
//
// Het bestand wordt één keer per proces gelezen en daarna gedeeld. Een leesfout
// wordt niet gecachet: de volgende aanvraag probeert het opnieuw.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** De familienaam die de og:image-routes gebruiken voor vet. */
export const SHARE_BOLD_FAMILY = 'Share Bold'

/** Het fontbestand, vanuit de projectroot (zoals next/og het voorbeeld doet). */
export function shareBoldFontPath() {
  return path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Bold-latin.ttf')
}

let cached = null

/** De `fonts`-lijst voor `new ImageResponse(...)`. */
export async function loadShareBoldFonts() {
  if (!cached) {
    cached = readFile(shareBoldFontPath())
      .then((data) => [{ name: SHARE_BOLD_FAMILY, data, weight: 700, style: 'normal' }])
      .catch((error) => {
        cached = null
        throw error
      })
  }
  return cached
}
