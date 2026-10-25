# BE-28 frisse publieke stijl — goedgekeurde referentie (v1)

Bron: Claude Design-canvas "Onze Menukaarten – eigen gezicht v2", versie 14
(https://claude.ai/artifact/8VLxwWFHkffexpyLPyF5DD). Goedgekeurd door de eigenaar op
2026-10-25 ("Akkoord om dit te bouwen … zoals aangeleverd in de mockups"). Contract: #65.

De bestanden zijn de bron-HTML van de canvasborden (inline stijlen; het canvas-script
`support.js` ontbreekt hier, lees ze als opmaakreferentie). Alle namen en prijzen zijn fictief.

| Bestand | Rol |
|---|---|
| `home-licht.html` | Home, desktop, licht |
| `zoeken-390-licht.html` | Zoekresultaten, telefoon, licht |
| `home-antraciet.html` | Home, desktop, donker (antraciet) — knoppen volgen `donker-knop-wit-390.html` |
| `zoeken-390-antraciet.html` | Zoekresultaten, telefoon, donker — knoppen volgen `donker-knop-wit-390.html` |
| `donker-knop-wit-390.html` | **Leidend voor de knoppen in donker:** primaire knop, actieve chip en actief tabje wit (`#F2F3F4` / `#1F2328`), prijs als label met okergele tekst, logo-tegel okergeel |

## Vervolg BE-28b (#68): Alle restaurants

Goedgekeurd door de eigenaar op 2026-10-25 (canvas versie 17), inclusief de standaard sortering "Met menukaart eerst".

| Bestand | Rol |
|---|---|
| `alle-restaurants-desktop.html` | Alle restaurants, desktop; `dark` true = antraciet, false = licht (de lichte en donkere tokens staan in `renderVals`) |
| `alle-restaurants-desktop-licht.html` | Hetzelfde bord in licht (importeert het bord hierboven) |
| `alle-restaurants-390-antraciet.html` | Alle restaurants, telefoon, antraciet: compacte regels zonder menukaart |

Het adres van Wolfslaar staat als `[adres]` in de mockup; de echte pagina gebruikt de data.
