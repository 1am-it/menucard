# assets/fonts

Eén bold font voor de voorvertoningsafbeeldingen van BE-44 (#105), gelezen door
`app/_share/fonts.js` en door niets anders. Op de gewone pagina's wordt het nooit
geladen: er staat geen `@font-face` en geen stylesheet naar dit bestand.

| Bestand | Wat |
| --- | --- |
| `NotoSans-Bold-latin.ttf` | Noto Sans Bold, subset Latijn (31,8 kB) |
| `OFL.txt` | De licentie van Noto Sans (SIL Open Font License 1.1) |

**Bron:** Noto Sans Bold, hetzelfde lettertype als het reguliere font dat
`next/og` al meebrengt (https://github.com/notofonts/latin-greek-cyrillic,
via https://fonts.google.com/noto/specimen/Noto+Sans).

**Subset:** teruggebracht met `fontTools.subset` tot
`U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2190-2193, U+2212,
U+2215, U+FEFF, U+FFFD` — genoeg voor de menukaarten (accenten, `·`, `…`, `€`)
en ruim onder de gevraagde 150 kB. De opdracht vroeg een subset van ≤ 150 kB;
daarom geen volledig Noto Sans (558 kB). Opnieuw subsetten:

```bash
python -m fontTools.subset NotoSans-Bold.ttf \
  --output-file=NotoSans-Bold-latin.ttf \
  --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD' \
  --layout-features='*' --no-hinting --desubroutinize
```

`src/lib/shareImageAssets.test.js` bewaakt de aanwezigheid, de grootte (≤ 150 kB)
en de licentie.
