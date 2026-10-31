'use strict';

// BE-60 (#150) — het themabewijs bij een opname.
//
// Een bestandsnaam met "-light" of "-dark" bewijst niets: in de eerste levering
// van BE-60 heette een opname "390-light" terwijl de pagina donker stond. Daarom
// leest elke opname eerst drie dingen uit de pagina zelf, zoals BE-46 deel 2 en
// BE-57 dat doen:
//
//  - `data-theme` op <html>;
//  - welke themaknop de app zelf actief noemt (aria-pressed/`active` in
//    ThemeToggle, src/components/ThemeToggle.js);
//  - de helderheid van de token `--bg` (licht > 200, donker < 80).
//
// Het thema zelf wordt gezet met een klik op die knop, niet met een los
// attribuut of een schrijfactie in de opslag: alleen de app bepaalt het thema.
//
// De paginazijde levert alleen metingen; het oordeel valt hier in Node, zodat
// `themeOk` te testen is zonder browser (theme-proof.test.js).

const THEME_LABELS = { light: 'Licht', dark: 'Donker' };

// De grenzen uit de review: licht is helder, donker is donker. Ruim genoeg om
// een bijna-witte of bijna-zwarte token te onderscheiden, streng genoeg om een
// verwisseld thema te laten falen (#FFFFFF = 255, #1F2328 = 35).
const THEME_LUMINANCE = { light: { above: 200 }, dark: { below: 80 } };

/** Eén hex- of rgb()-kleur naar [r, g, b]; null als het geen kleur is. */
function parseColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16));
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part) && part >= 0 && part <= 255)) return parts;
  }
  return null;
}

/** De helderheid van een kleur, 0-255, zoals de review die bedoelt. */
function luminanceOf(value) {
  const rgb = parseColor(value);
  if (!rgb) return null;
  return Math.round(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
}

/**
 * Het pagina-script dat de drie metingen doet. Het zet niets: het leest alleen.
 * `--bg` komt van <html> (daar staan de tokens), de achtergrond van de body
 * dient als terugval wanneer de token niet leesbaar is.
 */
function themeProofScript() {
  return `(() => {
    const root = document.documentElement;
    const buttons = [...document.querySelectorAll('.theme-btn')];
    const active = buttons
      .filter((button) => button.getAttribute('aria-pressed') === 'true' || button.classList.contains('active'))
      .map((button) => (button.textContent || '').trim());
    return {
      attr: root.getAttribute('data-theme'),
      bg: (getComputedStyle(root).getPropertyValue('--bg') || '').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      active,
      buttons: buttons.map((button) => (button.textContent || '').trim()),
    };
  })()`;
}

/** Het script dat de themaknop van de app zelf indrukt; 'missing' als hij er niet is. */
function clickThemeScript(label) {
  return `(() => {
    const target = [...document.querySelectorAll('.theme-btn')]
      .find((button) => (button.textContent || '').trim() === ${JSON.stringify(label)});
    if (!target) return 'missing';
    target.click();
    return 'clicked';
  })()`;
}

/** De ruwe meting als bewijs: met de berekende helderheid en zijn bron erbij. */
function themeProofValue(raw) {
  const proof = raw && typeof raw === 'object' ? raw : {};
  const bg = typeof proof.bg === 'string' ? proof.bg : '';
  const bodyBg = typeof proof.bodyBg === 'string' ? proof.bodyBg : '';
  const fromToken = luminanceOf(bg);
  const fromBody = luminanceOf(bodyBg);
  return {
    attr: typeof proof.attr === 'string' ? proof.attr : null,
    active: Array.isArray(proof.active) ? proof.active : [],
    buttons: Array.isArray(proof.buttons) ? proof.buttons : [],
    bg,
    bodyBg,
    luminance: fromToken === null ? fromBody : fromToken,
    source: fromToken === null && fromBody !== null ? 'body' : '--bg',
  };
}

/** Het bewijs moet kloppen: attribuut, precies één actieve knop én de helderheid. */
function themeOk(proof, want) {
  if (!proof || !THEME_LABELS[want]) return false;
  const label = THEME_LABELS[want];
  if (proof.attr !== want) return false;
  if (!Array.isArray(proof.active) || proof.active.length !== 1 || proof.active[0] !== label) return false;
  if (!Number.isFinite(proof.luminance)) return false;
  return want === 'light'
    ? proof.luminance > THEME_LUMINANCE.light.above
    : proof.luminance < THEME_LUMINANCE.dark.below;
}

module.exports = {
  THEME_LABELS,
  THEME_LUMINANCE,
  parseColor,
  luminanceOf,
  themeProofScript,
  clickThemeScript,
  themeProofValue,
  themeOk,
};
