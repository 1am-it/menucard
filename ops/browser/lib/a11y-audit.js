'use strict';

// BE-51 (#121) — meetkern voor de toegankelijkheidscheck van de publieke
// pagina's (ops/browser/run-a11y-public-check.js).
//
// Dit bestand doet zelf niets met een browser: het levert
//   1. het kleur- en contrastrekenwerk (WCAG 2.2 AA) als gewone functies, zodat
//      `node --test` de wiskunde kan controleren zonder browser, en
//   2. de audit die in de pagina draait. Die audit wordt als broncode naar de
//      browser gestuurd (`inPageAuditSource`), en gebruikt exact dezelfde
//      functies: geen tweede implementatie die stil kan afwijken.
//
// Geen dependency: alleen wat de bestaande browser-runtime al biedt.

// ── Kleur- en contrastrekenwerk ─────────────────────────────────────────────

/**
 * Leest een CSS-kleur zoals `getComputedStyle` hem teruggeeft (`rgb()`,
 * `rgba()`, `color(srgb …)`, hex, `transparent`). Geeft `null` bij iets wat we
 * niet kunnen meten; de check meldt dat dan als `onmeetbaar` in plaats van het
 * stil over te slaan.
 */
function parseColor(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if (text === '') return null;
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const parts = digits.split('').map((digit) => parseInt(digit + digit, 16));
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: digits.length === 4 ? parts[3] / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
        a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const functional = /^(rgba?|color)\(([^)]*)\)$/.exec(text);
  if (!functional) return null;
  const unitScale = functional[1] === 'color' ? 1 : 255;
  const tokens = functional[2]
    .replace(/^srgb\s+/, '')
    .split(/[\s,/]+/)
    .filter(Boolean);
  if (tokens.length < 3) return null;

  const channels = tokens.slice(0, 3).map((token) => {
    const numeric = parseFloat(token);
    if (Number.isNaN(numeric)) return 0;
    const scaled = token.includes('%') ? (numeric / 100) * unitScale : numeric;
    return unitScale === 1 ? scaled * 255 : scaled;
  });

  const alphaToken = tokens[3];
  let alpha = 1;
  if (alphaToken !== undefined) {
    const numeric = parseFloat(alphaToken);
    if (!Number.isNaN(numeric)) alpha = alphaToken.includes('%') ? numeric / 100 : numeric;
  }

  return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
}

/** De WCAG-formule voor één sRGB-kanaal (0–255 in, 0–1 uit). */
function srgbChannel(value) {
  const channel = Math.min(255, Math.max(0, value)) / 255;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Relatieve luminantie volgens WCAG 2.2. */
function relativeLuminance(colour) {
  const parsed = colour && colour.r !== undefined ? colour : parseColor(colour);
  if (!parsed) return null;
  return 0.2126 * srgbChannel(parsed.r) + 0.7152 * srgbChannel(parsed.g) + 0.0722 * srgbChannel(parsed.b);
}

/**
 * Legt een halftransparante laag op een onderlaag. Zonder onderlaag geldt wit
 * als papier — dat is wat een browser ook doet.
 */
function compositeColor(top, bottom) {
  if (!top) return bottom || null;
  const alpha = top.a === undefined ? 1 : Math.min(1, Math.max(0, top.a));
  if (alpha >= 1) return { r: top.r, g: top.g, b: top.b, a: 1 };
  const base = bottom || { r: 255, g: 255, b: 255, a: 1 };
  return {
    r: top.r * alpha + base.r * (1 - alpha),
    g: top.g * alpha + base.g * (1 - alpha),
    b: top.b * alpha + base.b * (1 - alpha),
    a: 1,
  };
}

/** Contrastverhouding tussen twee kleuren (1–21). */
function contrastRatio(foreground, background) {
  const fg = foreground && foreground.r !== undefined ? foreground : parseColor(foreground);
  const bg = background && background.r !== undefined ? background : parseColor(background);
  if (!fg || !bg) return null;
  const a = relativeLuminance(compositeColor(fg, bg));
  const b = relativeLuminance(bg);
  if (a === null || b === null) return null;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG "grote tekst": ≥ 24 px, of ≥ 18,66 px én vet (≥ 700). Alleen daar mag
 * 3:1 gelden; alle andere tekst houdt 4,5:1.
 */
function isLargeText(fontSizePx, fontWeight) {
  const size = Number(fontSizePx);
  const weight = Number(fontWeight) || 400;
  if (!Number.isFinite(size)) return false;
  if (size >= 24) return true;
  // 14pt = 18,66 px: de gangbare afronding van de WCAG-grens voor vet.
  return size >= 18.66 && weight >= 700;
}

/** De eis die bij deze tekst hoort: 4,5:1, of 3:1 voor grote tekst. */
function requiredContrast(fontSizePx, fontWeight) {
  return isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;
}

/**
 * Eén contrastmeting: tekstkleur tegen de gemeten achtergrond, met de eis die
 * bij die tekstgrootte hoort. `ratio` is op twee decimalen afgerond voor het
 * bewijs; `passed` gebruikt de onafgeronde waarde.
 */
function contrastResult(measurement) {
  const input = measurement || {};
  const fg = parseColor(input.foreground);
  const bg = parseColor(input.background);
  const required = requiredContrast(input.fontSizePx, input.fontWeight);
  const large = isLargeText(input.fontSizePx, input.fontWeight);
  if (!fg || !bg) return { ratio: null, required, large, passed: false, reason: 'onmeetbaar' };
  const accurate = contrastRatio(fg, bg);
  if (accurate === null) return { ratio: null, required, large, passed: false, reason: 'onmeetbaar' };
  const passed = accurate + 1e-9 >= required;
  return {
    ratio: Math.round(accurate * 100) / 100,
    required,
    large,
    passed,
    reason: passed ? null : 'contrast-te-laag',
  };
}

/**
 * Groepeert fouten die in wezen hetzelfde zijn (zelfde criterium, zelfde reden,
 * zelfde elementbeschrijving), zodat een groot menu met 138 dezelfde knoppen
 * één regel oplevert met een aantal. Het eerste voorbeeld blijft bewaard.
 */
function groupFailures(entries, limit = 60) {
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    // De check-regels dragen `passed`; de foutregels uit de audit dragen alleen
    // een criterium en een reden. Alleen een expliciet geslaagde regel valt af.
    if (!entry || entry.passed === true) continue;
    const key = `${entry.criterion}|${entry.reason || ''}|${entry.name || ''}`;
    const found = groups.get(key);
    if (found) {
      found.count += 1;
      continue;
    }
    groups.set(key, {
      criterion: entry.criterion,
      reason: entry.reason || null,
      name: entry.name || null,
      detail: entry.detail === undefined ? null : entry.detail,
      count: 1,
    });
  }
  const list = [...groups.values()].sort(
    (a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))
  );
  return {
    total: list.reduce((sum, group) => sum + group.count, 0),
    groups: list.length,
    entries: list.slice(0, limit),
    truncated: list.length > limit,
  };
}

// ── DOM-hulpjes (draaien in de pagina) ──────────────────────────────────────

/**
 * Een korte, stabiele beschrijving van een element voor het bewijs:
 * `button.share-settings-btn`, `a.lijst-row-link`. Geen volledige CSS-pad; het
 * gaat om herkenbaarheid, niet om een selector die jaren later nog klopt.
 */
function describeElement(element) {
  if (!element || !element.tagName) return '?';
  let out = element.tagName.toLowerCase();
  if (element.id) out += `#${element.id}`;
  const classes = typeof element.className === 'string'
    ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
    : [];
  if (classes.length > 0) out += `.${classes.join('.')}`;
  // Zonder eigen id of class is `span` niet te herleiden; de ouder erbij maakt
  // het bewijs bruikbaar zonder een volledige CSS-pad te bewaren.
  if (classes.length === 0 && !element.id && element.parentElement && element.parentElement.tagName) {
    const parent = element.parentElement;
    const parentClasses = typeof parent.className === 'string'
      ? parent.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      : [];
    out += `@${parent.tagName.toLowerCase()}${parentClasses.length ? `.${parentClasses.join('.')}` : ''}`;
  }
  return out;
}

/**
 * Ligt het element in een vaste laag (de zwevende menubalk onderin, een sticky
 * balk)? Zo'n laag schuift over de pagina heen; een link erin is geen doel dat
 * "te dicht op een ander doel" staat. Zonder deze wandeling telde alleen een
 * element met `position: fixed` zelf en werden de links *in* de balk als buur
 * van de kaart eronder gemeld (BE-70, /alle-restaurants op 390 px).
 */
function insideFixedLayer(element) {
  let node = element;
  let diepte = 0;
  while (node && node.nodeType === 1 && diepte < 8) {
    const style = window.getComputedStyle(node);
    if (style.position === 'fixed' || style.position === 'sticky') return true;
    node = node.parentElement;
    diepte += 1;
  }
  return false;
}

/** Zichtbaar zoals een gebruiker het ziet: geen `display:none`, geen 0×0. */
function isVisible(element) {
  if (!element || !element.getClientRects) return false;
  // De ontwikkel-overlay van Next.js is geen onderdeel van het product en
  // staat alleen in `next dev` in de weg; buiten deze check bestaat hij niet.
  if (element.closest && element.closest('nextjs-portal')) return false;
  if (element.getClientRects().length === 0) return false;
  let node = element;
  while (node && node.nodeType === 1) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (Number(style.opacity) === 0) return false;
    node = node.parentElement;
  }
  return true;
}

/** Het product van de opacity van het element en al zijn voorouders. */
function effectiveOpacity(element) {
  let value = 1;
  let node = element;
  while (node && node.nodeType === 1) {
    const style = window.getComputedStyle(node);
    const own = Number(style.opacity);
    if (Number.isFinite(own)) value *= own;
    node = node.parentElement;
  }
  return value;
}

/** Staat het element (of een voorouder) op `aria-hidden="true"`? */
function hiddenFromAssistiveTech(element) {
  let node = element;
  while (node && node.nodeType === 1) {
    if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Is dit element bewust onzichtbaar (de "visueel verborgen"-techniek)? Zulke
 * tekst is 1 × 1 px of staat op left: -9999px: die telt niet als afgekapte of
 * buiten beeld gevallen tekst, en contrast zegt er niets over.
 */
function isVisuallyHiddenBox(element) {
  if (!element || !element.getBoundingClientRect) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return true;
  return rect.right < -999 || rect.left < -999;
}

/** Alleen de eigen tekst van dit element (geen tekst uit kinderen). */
function ownText(element) {
  if (!element || !element.childNodes) return '';
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) text += node.nodeValue;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * De tekst die een schermlezer van dit element leest: alles behalve wat
 * `aria-hidden` is en behalve formulierbediening zelf.
 */
function accessibleTextOf(element) {
  if (!element) return '';
  if (element.nodeType === 3) return element.nodeValue;
  if (element.nodeType !== 1) return '';
  if (element.getAttribute && element.getAttribute('aria-hidden') === 'true') return '';
  const tag = element.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return '';
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return '';
  let text = '';
  for (const child of element.childNodes) text += accessibleTextOf(child);
  return text.replace(/\s+/g, ' ').trim();
}

/** Het label dat bij een formulierveld hoort (`for=`, omhullende `label`). */
function labelTextFor(element) {
  if (!element) return '';
  if (element.id) {
    let found = null;
    try {
      found = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    } catch (error) {
      found = null;
    }
    if (found) {
      const text = accessibleTextOf(found);
      if (text) return text;
    }
  }
  const wrapper = element.closest ? element.closest('label') : null;
  if (wrapper) return accessibleTextOf(wrapper);
  const grouped = element.closest ? element.closest('fieldset') : null;
  if (grouped) {
    const legend = grouped.querySelector('legend');
    if (legend) return accessibleTextOf(legend);
  }
  return '';
}

/**
 * De toegankelijke naam volgens de gewone volgorde: `aria-labelledby`,
 * `aria-label`, het gekoppelde label, `alt`, de zichtbare tekst, `title`.
 */
function accessibleName(element) {
  if (!element) return '';
  const labelledBy = element.getAttribute ? element.getAttribute('aria-labelledby') : null;
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const target = document.getElementById(id);
        return target ? accessibleTextOf(target) : '';
      })
      .join(' ')
      .trim();
    if (text) return text;
  }
  const ariaLabel = element.getAttribute ? element.getAttribute('aria-label') : null;
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
    const fromLabel = labelTextFor(element);
    if (fromLabel) return fromLabel;
  }
  if (element.tagName === 'IMG') {
    const alt = element.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
  }
  const text = accessibleTextOf(element);
  if (text) return text;
  const title = element.getAttribute ? element.getAttribute('title') : null;
  if (title && title.trim()) return title.trim();
  return '';
}

/**
 * De achtergronden waar deze tekst op kan liggen, van boven naar beneden
 * samengesteld tot dekkende kleuren. Een gradient levert meer dan één
 * kandidaat: de check neemt dan de ongunstigste, zodat een tekst die op één
 * kleurverloop net te licht is niet goedgekeurd wordt.
 */
function backgroundCandidates(element) {
  const stack = [];
  let node = element;
  while (node && node.nodeType === 1) {
    const style = window.getComputedStyle(node);
    const image = style.backgroundImage;
    if (image && image !== 'none') {
      const stops = image.match(/rgba?\([^)]*\)/g) || [];
      const colours = stops.map(parseColor).filter(Boolean);
      if (colours.length > 0) stack.push({ colours });
    }
    const colour = parseColor(style.backgroundColor);
    if (colour && colour.a > 0) {
      stack.push({ colours: [colour] });
      if (colour.a >= 1) break;
    }
    node = node.parentElement;
  }

  let bases = [{ r: 255, g: 255, b: 255, a: 1 }];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const layer = stack[index];
    const next = [];
    for (const base of bases) {
      for (const colour of layer.colours) next.push(compositeColor(colour, base));
    }
    bases = next.slice(0, 12);
  }

  const unique = [];
  const seen = new Set();
  for (const base of bases) {
    const key = `${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(base);
  }
  return unique;
}

/** Is dit element met Tab te bereiken? */
function isTabbable(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.disabled) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  if (element.tagName === 'INPUT' && element.getAttribute('type') === 'hidden') return false;
  if (!isVisible(element)) return false;
  const tabindex = element.getAttribute('tabindex');
  if (tabindex !== null) {
    const value = Number(tabindex);
    if (!Number.isFinite(value) || value < 0) return false;
  } else if (!/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(element.tagName)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.visibility === 'hidden') return false;
  return true;
}

/** Alle met Tab bereikbare elementen, in DOM-volgorde. */
function tabbables(root) {
  const selector = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';
  return Array.from((root || document).querySelectorAll(selector)).filter(isTabbable);
}

/**
 * De stijlkenmerken die een focusring kunnen maken. We vergelijken de stand
 * mét en zónder focus op precies hetzelfde element (en op zijn voorouders: een
 * `:focus-within`-ring op de container is ook een zichtbare focus).
 */
function focusStyleSnapshot(element) {
  const style = window.getComputedStyle(element);
  return {
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    outlineColour: style.outlineColor,
    outlineOffset: style.outlineOffset,
    boxShadow: style.boxShadow,
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    textDecorationLine: style.textDecorationLine,
    color: style.color,
  };
}

/** De keten van het element en zijn voorouders, met hun stijl op dit moment. */
function focusStyleChain(element) {
  const chain = [];
  let node = element;
  for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth += 1) {
    chain.push({ selector: describeElement(node), snapshot: focusStyleSnapshot(node) });
    node = node.parentElement;
  }
  return chain;
}

/**
 * Welke zichtbare aanwijzing ontstaat er door de focus? Een ring, schaduw,
 * rand, vlak of onderstreping telt; alleen een andere tekstkleur niet, want
 * die is te zwak om als focuspunt te dienen (design-reference.md, "Keyboard
 * and focus").
 */
function focusIndicator(before, after) {
  const changes = [];
  const outlineWidth = parseFloat(after.outlineWidth) || 0;
  if (after.outlineStyle !== 'none' && outlineWidth > 0 && (before.outlineStyle !== after.outlineStyle || parseFloat(before.outlineWidth) !== outlineWidth || before.outlineColour !== after.outlineColour)) {
    changes.push('outline');
  }
  if (before.boxShadow !== after.boxShadow) changes.push('box-shadow');
  if (before.backgroundColor !== after.backgroundColor) changes.push('achtergrond');
  if (before.borderColor !== after.borderColor || before.borderWidth !== after.borderWidth) changes.push('rand');
  if (before.textDecorationLine !== after.textDecorationLine) changes.push('onderstreping');
  if (before.color !== after.color) changes.push('tekstkleur');
  const strong = changes.filter((change) => change !== 'tekstkleur');
  return { changes, strong, visible: strong.length > 0 };
}

/** Bevat de naam minstens één letter of cijfer (`×` alleen is geen naam)? */
function hasMeaningfulCharacters(name) {
  return /[\p{L}\p{N}]/u.test(String(name || ''));
}

/**
 * Alle kandidaten voor de tab-volgorde in DOM-volgorde, ook de onzichtbare.
 * De positie in deze lijst is de volgorde-index: die blijft bruikbaar als React
 * een stuk opnieuw tekent en een element vervangt.
 */
function tabCandidates() {
  return Array.from(
    document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]')
  );
}

// ── De audit die in de pagina draait ────────────────────────────────────────

/** Een samengestelde kleur terug naar `rgb()`/`rgba()` voor het bewijs. */
function cssColour(colour) {
  if (!colour) return null;
  const round = (value) => Math.round(value * 100) / 100;
  if (colour.a !== undefined && colour.a < 1) {
    return `rgba(${round(colour.r)}, ${round(colour.g)}, ${round(colour.b)}, ${round(colour.a)})`;
  }
  return `rgb(${round(colour.r)}, ${round(colour.g)}, ${round(colour.b)})`;
}

function intersects(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Een tikdoel zonder de rechthoek: alleen wat het bewijs nodig heeft. */
function compactTarget(target) {
  return {
    selector: target.selector,
    name: target.name,
    tag: target.tag,
    type: target.type || null,
    width: target.width,
    height: target.height,
    midSized: target.midSized,
    spacingOk: target.spacingOk,
    neighbour: target.neighbour || null,
    inlineInText: target.inlineInText,
  };
}

const INTERACTIVE_SELECTOR = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [contenteditable="true"]';
const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TITLE: 1, HEAD: 1, OPTION: 1, OPTGROUP: 1 };

/**
 * Meet één pagina: contrast van alle zichtbare tekst, de namen en tikdoelen van
 * alle bediening, koppen, landmarks, taal en formulierlabels. De uitspraak
 * (goed/fout) doet de Node-kant (`checksFromAudit`), zodat dezelfde meting ook
 * met vaste cijfers getest kan worden.
 */
function auditPage(options) {
  const opts = options || {};
  const MIN_TARGET = opts.minTarget || 44;
  const MID_TARGET = opts.midTarget || 24;
  const MAX_RECORDS = opts.maxRecords || 400;

  const elements = document.body ? Array.from(document.body.querySelectorAll('*')) : [];
  const texts = { measured: 0, minRatio: null, failures: [], unmeasurable: 0 };
  const interactive = [];
  const formfields = [];
  const targets = [];

  for (const element of elements) {
    if (SKIP_TAGS[element.tagName]) continue;
    if (!isVisible(element)) continue;
    const style = window.getComputedStyle(element);

    // Contrast: alleen elementen met eigen tekst krijgen een meting.
    const text = ownText(element);
    if (text && !hiddenFromAssistiveTech(element) && !isVisuallyHiddenBox(element)) {
      if (effectiveOpacity(element) < 0.99) {
        texts.unmeasurable += 1;
      } else {
        const fontSizePx = parseFloat(style.fontSize);
        const fontWeight = Number(style.fontWeight) || 400;
        let worst = null;
        for (const background of backgroundCandidates(element)) {
          const measured = contrastResult({
            foreground: style.color,
            background: cssColour(background),
            fontSizePx,
            fontWeight,
          });
          measured.background = cssColour(background);
          if (worst === null) worst = measured;
          else if (worst.ratio === null && measured.ratio !== null) worst = measured;
          else if (worst.ratio !== null && measured.ratio !== null && measured.ratio < worst.ratio) worst = measured;
        }
        texts.measured += 1;
        if (worst && worst.ratio !== null && (texts.minRatio === null || worst.ratio < texts.minRatio)) {
          texts.minRatio = worst.ratio;
        }
        if (worst && worst.passed === false) {
          texts.failures.push({
            selector: describeElement(element),
            text: text.slice(0, 70),
            foreground: style.color,
            background: worst.background,
            fontSizePx,
            fontWeight,
            ratio: worst.ratio,
            required: worst.required,
            reason: worst.reason,
          });
        }
      }
    }

    // Bediening: naam, tikdoel en de inline-uitzondering van WCAG 2.2.
    if (element.matches(INTERACTIVE_SELECTOR)) {
      const name = accessibleName(element);
      const rect = element.getBoundingClientRect();
      let inlineInText = false;
      if (element.tagName === 'A') {
        const parent = element.parentElement;
        const own = (element.textContent || '').trim();
        const around = parent ? (parent.textContent || '').trim() : own;
        inlineInText = style.display === 'inline' && own.length > 0 && around.length > own.length + 2;
      }
      const record = {
        selector: describeElement(element),
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type') || null,
        name,
        symbolOnly: name.length > 0 && !hasMeaningfulCharacters(name),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        inlineInText,
        fixed: insideFixedLayer(element),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      };
      interactive.push(record);
      targets.push(record);

      if (/^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) {
        const type = (element.getAttribute('type') || '').toLowerCase();
        if (!['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) {
          formfields.push({
            selector: describeElement(element),
            type: type || element.tagName.toLowerCase(),
            name,
            labelled: Boolean(name),
          });
        }
      }
    }
  }

  return auditSummary({ texts, interactive, targets, formfields, MIN_TARGET, MID_TARGET, MAX_RECORDS });
}

/**
 * Het tweede deel van de meting: ruimte rond kleine tikdoelen, koppen,
 * landmarks en de taal van het document. Apart gehouden zodat `auditPage`
 * leesbaar blijft.
 */
function auditSummary(input) {
  const MIN_TARGET = input.MIN_TARGET;
  const MID_TARGET = input.MID_TARGET;
  const MAX_RECORDS = input.MAX_RECORDS;
  const targets = input.targets;

  for (const target of targets) {
    const small = target.width < MIN_TARGET || target.height < MIN_TARGET;
    target.midSized = target.width >= MID_TARGET && target.height >= MID_TARGET;
    if (!small || target.fixed) {
      // Een vast element (de zwevende menubalk) is geen doel dat te dicht op
      // iets staat: het ligt als laag over de pagina en schuift mee bij het
      // scrollen.
      target.spacingOk = true;
      continue;
    }
    const inflated = {
      left: target.rect.left - 12,
      top: target.rect.top - 12,
      right: target.rect.right + 12,
      bottom: target.rect.bottom + 12,
    };
    let neighbour = null;
    for (const other of targets) {
      if (other === target || other.fixed) continue;
      const a = target.rect;
      const b = other.rect;
      const inside = b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom;
      const wraps = a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
      if (inside || wraps) continue;
      if (intersects(inflated, b)) {
        neighbour = other.selector;
        break;
      }
    }
    target.spacingOk = neighbour === null;
    target.neighbour = neighbour;
  }

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .filter((heading) => isVisible(heading))
    .map((heading) => ({ level: Number(heading.tagName.slice(1)), text: ownText(heading).slice(0, 70) }));

  const countVisible = (selector) => Array.from(document.querySelectorAll(selector)).filter(isVisible).length;

  return {
    url: window.location.pathname + window.location.search,
    title: document.title,
    lang: document.documentElement.getAttribute('lang'),
    theme: document.documentElement.getAttribute('data-theme'),
    contrast: {
      measured: input.texts.measured,
      unmeasurable: input.texts.unmeasurable,
      minRatio: input.texts.minRatio,
      failures: input.texts.failures.slice(0, MAX_RECORDS),
      failureTotal: input.texts.failures.length,
    },
    interactive: input.interactive.slice(0, MAX_RECORDS).map(compactTarget),
    interactiveTotal: input.interactive.length,
    targets: targets.slice(0, MAX_RECORDS).map(compactTarget),
    targetsTotal: targets.length,
    formfields: input.formfields,
    headings,
    landmarks: {
      main: countVisible('main, [role="main"]'),
      nav: countVisible('nav, [role="navigation"]'),
      header: countVisible('header'),
      footer: countVisible('footer'),
    },
  };
}

/**
 * 200% tekst, zoals de browserinstelling "tekst alleen vergroten" hem toepast:
 * elk element houdt zijn eigen lettergrootte, maar tweemaal zo groot.
 *
 * Eerst álle berekende groottes lezen en pas daarna zetten: anders erft een
 * kind de al verdubbelde grootte van zijn ouder en wordt 200% in werkelijkheid
 * 400%, 800% enzovoort.
 */
function scaleText(factor) {
  const elements = Array.from(document.querySelectorAll('body, body *'));
  const sizes = elements.map((element) => parseFloat(window.getComputedStyle(element).fontSize));
  let changed = 0;
  elements.forEach((element, index) => {
    const size = sizes[index];
    if (!Number.isFinite(size) || size <= 0) return;
    element.style.setProperty('font-size', `${size * factor}px`, 'important');
    changed += 1;
  });
  return changed;
}

/**
 * Ligt dit element in een eigen horizontaal scrollvlak (een strook chips of
 * categorieën)? Zo'n strook scrollt zelf en duwt de pagina niet breder; dat is
 * een bewuste vorm, dus telt hij niet als reflow-fout maar wordt hij apart
 * geteld.
 */
function insideHorizontalScroller(element) {
  let node = element.parentElement;
  while (node && node.nodeType === 1) {
    const style = window.getComputedStyle(node);
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Reflow-meting in de stand van dit moment (het venster is dan 320 px en de
 * tekst staat op 200%): horizontale scroll, elementen die buiten beeld vallen
 * en tekst die is afgekapt.
 */
function reflowAudit(options) {
  const opts = options || {};
  const MAX = opts.maxRecords || 40;
  const root = document.documentElement;
  const width = root.clientWidth;
  const rootScrollWidth = root.scrollWidth;
  const bodyScrollWidth = document.body ? document.body.scrollWidth : 0;
  const scrollWidth = Math.max(rootScrollWidth, bodyScrollWidth);

  const offenders = [];
  const offenderRoots = new Set();
  const clipped = [];
  const ellipsis = [];
  const overflowing = [];
  let scrollStrips = 0;

  for (const element of Array.from(document.querySelectorAll('body *'))) {
    if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') continue;
    if (!isVisible(element)) continue;
    if (isVisuallyHiddenBox(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right > width + 1 || rect.left < -1) {
      if (insideHorizontalScroller(element)) {
        // Een eigen scrollstrook (chips, categorieën): telt apart, is geen
        // pagina-overloop.
        scrollStrips += 1;
        continue;
      }
      // Alleen de buitenste boosdoener telt: een kind van een te breed element
      // is geen tweede fout. Zo blijft het bewijs leesbaar en de reparatie
      // gericht.
      if (!(element.parentElement && offenderRoots.has(element.parentElement))) {
        offenderRoots.add(element);
        const style = window.getComputedStyle(element);
        offenders.push({
          selector: describeElement(element),
          parent: element.parentElement ? describeElement(element.parentElement) : null,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          display: style.display,
          whiteSpace: style.whiteSpace,
          minWidth: style.minWidth,
          overflowX: style.overflowX,
        });
      }
    }
    const text = ownText(element);
    if (!text) continue;
    const style = window.getComputedStyle(element);
    // Inhoud die zijn eigen vlak te breed maakt zonder eigen scrollvlak: dit is
    // de bron van pagina-overloop die je aan de buitenkant niet ziet.
    if (style.overflowX === 'visible' && element.scrollWidth > element.clientWidth + 1) {
      overflowing.push({
        selector: describeElement(element),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      });
    }
    const hiddenX = style.overflowX === 'hidden' || style.overflowX === 'clip';
    const hiddenY = style.overflowY === 'hidden' || style.overflowY === 'clip';
    const cutX = hiddenX && element.scrollWidth > element.clientWidth + 1;
    const cutY = hiddenY && element.scrollHeight > element.clientHeight + 1;
    if (style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 1) {
      ellipsis.push({ selector: describeElement(element), text: text.slice(0, 50) });
      continue;
    }
    if (cutX || cutY) {
      clipped.push({
        selector: describeElement(element),
        text: text.slice(0, 50),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      });
    }
  }

  return {
    viewportWidth: width,
    scrollWidth,
    rootScrollWidth,
    bodyScrollWidth,
    overflowX: scrollWidth - width,
    offenders: offenders.slice(0, MAX),
    offenderTotal: offenders.length,
    scrollStrips,
    clipped: clipped.slice(0, MAX),
    clippedTotal: clipped.length,
    ellipsis: ellipsis.slice(0, MAX),
    ellipsisTotal: ellipsis.length,
    overflowing: overflowing.slice(0, MAX),
    overflowingTotal: overflowing.length,
  };
}

/**
 * Beweging onder `prefers-reduced-motion: reduce` (die voorkeur staat dan aan):
 * welke animaties en transformaties lopen er nog, en scrolt de pagina nog
 * vloeiend?
 */
function motionAudit(options) {
  const opts = options || {};
  const MAX = opts.maxRecords || 40;
  const animations = [];
  const transitions = [];
  for (const element of Array.from(document.querySelectorAll('body *'))) {
    if (!isVisible(element)) continue;
    const style = window.getComputedStyle(element);
    const name = style.animationName;
    const duration = Math.max(...String(style.animationDuration).split(',').map((value) => parseFloat(value) || 0));
    if (name && name !== 'none' && duration > 0.05) {
      animations.push({ selector: describeElement(element), name, duration });
    }
    const properties = String(style.transitionProperty).split(',').map((value) => value.trim());
    const durations = String(style.transitionDuration).split(',').map((value) => parseFloat(value) || 0);
    for (let index = 0; index < properties.length; index += 1) {
      const property = properties[index];
      if (property !== 'transform' && property !== 'all') continue;
      const own = durations[index] === undefined ? durations[0] || 0 : durations[index];
      if (own > 0.05) {
        transitions.push({ selector: describeElement(element), property, duration: own });
        break;
      }
    }
  }
  return {
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    scrollBehaviour: window.getComputedStyle(document.documentElement).scrollBehavior,
    animations: animations.slice(0, MAX),
    animationTotal: animations.length,
    transitions: transitions.slice(0, MAX),
    transitionTotal: transitions.length,
  };
}

// ── Toetsenbordpad: voorbereiden, één Tab, en de stand van een dialoog ──────

/**
 * Zet de tab-route klaar. De ontwikkel-overlay van Next.js gaat op `inert`, zodat
 * die in `next dev` niet in de tab-volgorde staat — hij hoort niet bij het
 * product. De ruststand van elk element wordt niet vooraf bewaard maar per stop
 * gemeten (zie `readFocusStep`), want React kan een lijst tussentijds opnieuw
 * tekenen en dan is een vooraf vastgelegde knoop niet meer dezelfde.
 */
function prepareFocusWalk(options) {
  const opts = options || {};
  for (const overlay of document.querySelectorAll('nextjs-portal')) {
    overlay.setAttribute('inert', '');
  }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const scope = opts.scope === 'dialog' ? document.querySelector('[role="dialog"]') : null;
  const nodes = tabbables(scope || document);
  return {
    total: nodes.length,
    items: nodes.map((element, index) => ({ index, selector: describeElement(element), name: accessibleName(element) })),
  };
}

/**
 * Eén tabstap: welk element heeft nu de focus, en is die focus zichtbaar?
 * De zichtbaarheid wordt gemeten door het element even los te laten en de
 * stijl van precies dat element opnieuw te lezen; daarna krijgt het de focus
 * terug zodat de volgende Tab gewoon verdergaat.
 */
function readFocusStep() {
  const element = document.activeElement;
  if (!element || element === document.body || element === document.documentElement) {
    return { done: true, inPage: false, index: null };
  }
  const candidates = tabCandidates();
  const index = candidates.indexOf(element);
  const selector = describeElement(element);
  const name = accessibleName(element);
  const rect = element.getBoundingClientRect();
  const focused = focusStyleChain(element);
  let indicator = null;
  try {
    element.blur();
    const rest = focusStyleChain(element);
    indicator = focusIndicator(rest[0].snapshot, focused[0].snapshot);
    if (!indicator.visible) {
      // De ring kan ook op de container staan (`:focus-within`).
      for (let depth = 1; depth < focused.length; depth += 1) {
        const ancestor = focusIndicator(rest[depth].snapshot, focused[depth].snapshot);
        if (ancestor.visible) {
          indicator = { ...ancestor, via: focused[depth].selector };
          break;
        }
      }
    }
    element.focus({ preventScroll: true });
  } catch (error) {
    indicator = null;
  }
  return {
    done: false,
    inPage: index >= 0,
    index: index >= 0 ? index : null,
    selector,
    name,
    tag: element.tagName,
    rect: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    indicator,
  };
}

/** De stand van het open deelvenster: focus binnen, en heeft het een naam? */
function dialogAudit() {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return { open: false };
  const active = document.activeElement;
  return {
    open: true,
    inside: Boolean(active) && dialog.contains(active),
    active: active ? describeElement(active) : null,
    activeName: active ? accessibleName(active) : null,
    focusables: tabbables(dialog).length,
    ariaModal: dialog.getAttribute('aria-modal'),
    name: accessibleName(dialog),
    labelledBy: dialog.getAttribute('aria-labelledby'),
    visible: isVisible(dialog),
  };
}

/** Welk element heeft nu de focus (bijvoorbeeld na het sluiten van een blad)? */
function activeElementAudit() {
  const active = document.activeElement;
  if (!active) return { tag: null, selector: null, name: null };
  return {
    tag: active.tagName,
    selector: describeElement(active),
    name: accessibleName(active),
    expanded: active.getAttribute ? active.getAttribute('aria-expanded') : null,
  };
}



// ── De uitspraak: van meting naar check ────────────────────────────────────

/**
 * Beoordeelt één paginameting voor één thema. Levert twee dingen:
 * - `checks`: één regel per criterium, met het aantal metingen erbij;
 * - `errors`: de concrete fouten, met een voorbeeld — de aanroeper groepeert
 *   ze met `groupFailures`, zodat 138 dezelfde knoppen één regel opleveren.
 */
function checksFromAudit(pageName, theme, data, options) {
  const opts = options || {};
  const minTarget = opts.minTarget || 44;
  const midTarget = opts.midTarget || 24;
  const prefix = `${pageName} (${theme})`;
  const checks = [];
  const errors = [];
  const add = (criterion, label, passed, detail) => {
    checks.push({
      criterion,
      name: `${prefix} · ${label}`,
      passed: Boolean(passed),
      detail: detail === undefined || detail === null ? null : String(detail),
    });
  };
  const fail = (criterion, reason, name, detail) => {
    errors.push({ criterion, reason, name, detail: detail === undefined ? null : String(detail) });
  };

  const input = data || {};

  // 1. Contrast van tekst tegen de gemeten achtergrond.
  const contrast = input.contrast || { measured: 0, failureTotal: 0, failures: [], minRatio: null };
  add(
    'contrast',
    `contrast: ${contrast.measured} teksten gemeten tegen de echte achtergrond`,
    contrast.measured > 0 && contrast.failureTotal === 0,
    `zwakste ${contrast.minRatio === null ? 'n.v.t.' : `${contrast.minRatio}:1`}, ${contrast.failureTotal} onder de eis, ${contrast.unmeasurable || 0} onmeetbaar (opacity)`
  );
  for (const entry of contrast.failures || []) {
    fail(
      'contrast',
      entry.reason || 'contrast-te-laag',
      entry.selector,
      `${entry.ratio === null ? 'onmeetbaar' : `${entry.ratio}:1`} < ${entry.required}:1 · "${entry.text}" · ${entry.foreground} op ${entry.background} · ${entry.fontSizePx}px/${entry.fontWeight}`
    );
  }

  // 2. Toegankelijke naam van elk bedieningselement.
  const interactive = input.interactive || [];
  const unnamed = interactive.filter((entry) => !entry.name || String(entry.name).trim() === '');
  const symbolic = interactive.filter((entry) => entry.name && entry.symbolOnly);
  add(
    'naam',
    `naam: ${interactive.length} bedieningselementen`,
    unnamed.length === 0 && symbolic.length === 0,
    `${unnamed.length} zonder naam, ${symbolic.length} met alleen een symbool`
  );
  for (const entry of unnamed) fail('naam', 'geen-naam', entry.selector, `<${entry.tag}> zonder toegankelijke naam`);
  for (const entry of symbolic) fail('naam', 'alleen-symbool', entry.selector, `naam "${entry.name}" bevat geen letter of cijfer`);

  // 3. Tikdoelen: 44 px, of 24 px met genoeg ruimte (WCAG 2.2 AA).
  const targets = input.targets || [];
  const small = targets.filter((entry) => Number(entry.width) < minTarget || Number(entry.height) < minTarget);
  const tooSmall = small.filter((entry) => {
    if (entry.inlineInText) return false;
    const midSized = Number(entry.width) >= midTarget && Number(entry.height) >= midTarget;
    return !(midSized && entry.spacingOk);
  });
  add(
    'tikdoel',
    `tikdoel: ${targets.length} doelen, ${small.length} onder ${minTarget} px`,
    tooSmall.length === 0,
    `${tooSmall.length} te klein of te dicht op een ander doel`
  );
  for (const entry of tooSmall) {
    fail(
      'tikdoel',
      entry.midSized ? 'te-dicht-op-elkaar' : 'te-klein',
      entry.selector,
      `${entry.width}×${entry.height} px · "${entry.name}"${entry.neighbour ? ` · naast ${entry.neighbour}` : ''}`
    );
  }

  // 4. Koppen: één h1, en geen niveau overgeslagen.
  const headings = input.headings || [];
  const h1Count = headings.filter((heading) => heading.level === 1).length;
  const jumps = [];
  let previous = 0;
  for (const heading of headings) {
    if (previous > 0 && heading.level > previous + 1) {
      jumps.push(`h${previous} → h${heading.level} bij "${heading.text}"`);
    }
    previous = heading.level;
  }
  add('koppen', `koppen: één h1 bij ${headings.length} koppen`, h1Count === 1, h1Count === 1 ? `h1: "${(headings.find((h) => h.level === 1) || {}).text || ''}"` : `gevonden ${h1Count} h1`);
  if (h1Count !== 1) fail('koppen', 'aantal-h1', 'document', `verwacht 1 h1, gevonden ${h1Count}`);
  add('koppen', 'koppen: geen niveau overgeslagen', jumps.length === 0, jumps.join('; ') || null);
  for (const jump of jumps) fail('koppen', 'niveau-overgeslagen', 'document', jump);

  // 5. Landmarks en taal.
  const landmarks = input.landmarks || {};
  add(
    'landmarks',
    `landmarks: ${landmarks.main || 0} main, ${landmarks.nav || 0} nav`,
    landmarks.main === 1 && (landmarks.nav || 0) >= 1,
    `main ${landmarks.main || 0} (verwacht 1), nav ${landmarks.nav || 0} (verwacht ≥ 1)`
  );
  if (landmarks.main !== 1) fail('landmarks', 'main', 'document', `main ${landmarks.main || 0}×`);
  if ((landmarks.nav || 0) < 1) fail('landmarks', 'nav', 'document', 'geen nav-landmark');

  const lang = String(input.lang || '');
  add('taal', `taal: lang="${input.lang}"`, /^nl(-|$)/i.test(lang), input.lang === 'nl' ? null : 'verwacht lang="nl"');
  if (!/^nl(-|$)/i.test(lang)) fail('taal', 'lang', 'html', `lang="${input.lang}"`);

  // 6. Formuliervelden met een label.
  const formfields = input.formfields || [];
  const unlabelled = formfields.filter((field) => !field.labelled);
  add(
    'formulier',
    `formulier: ${formfields.length} velden met een label`,
    unlabelled.length === 0,
    `${unlabelled.length} zonder label`
  );
  for (const field of unlabelled) fail('formulier', 'geen-label', field.selector, `${field.type}-veld zonder label`);

  return { checks, errors };
}

/**
 * Beoordeelt het toetsenbordpad: elke Tabstap moet een zichtbare focus hebben
 * en de volgorde moet de DOM-volgorde zijn. Boven de limiet is het een
 * steekproef — dat staat er dan ook bij, in plaats van te doen alsof alles is
 * doorgelopen.
 */
function checksFromFocusWalk(pageName, theme, walk, options) {
  const opts = options || {};
  const limit = opts.maxTabs || 60;
  const prefix = `${pageName} (${theme})`;
  const checks = [];
  const errors = [];
  const input = walk || { total: 0, steps: [], items: [] };
  const steps = Array.isArray(input.steps) ? input.steps : [];

  const withoutFocus = steps.filter((step) => !step.indicator || step.indicator.visible !== true);
  checks.push({
    criterion: 'focus',
    name: `${prefix} · focus: ${steps.length} tabstappen, ${withoutFocus.length} zonder zichtbare focus`,
    passed: steps.length > 0 && withoutFocus.length === 0,
    detail: withoutFocus.length === 0 ? null : withoutFocus.map((step) => step.selector).join(', '),
  });
  for (const step of withoutFocus) {
    const changes = step.indicator ? step.indicator.changes.join('+') || 'geen' : 'geen vergelijking';
    errors.push({
      criterion: 'focus',
      reason: 'geen-zichtbare-focus',
      name: step.selector,
      detail: `${step.name || 'zonder naam'} · verandering: ${changes}`,
    });
  }

  const outOfOrder = [];
  let last = -1;
  for (const step of steps) {
    if (typeof step.index !== 'number') continue;
    if (step.index <= last) outOfOrder.push(step.selector);
    last = step.index;
  }
  const reached = new Set(steps.filter((step) => typeof step.index === 'number').map((step) => step.index)).size;
  const expected = Math.min(Number(input.total) || 0, limit);
  const complete = (Number(input.total) || 0) <= limit;
  checks.push({
    criterion: 'toetsenbord',
    name: `${prefix} · toetsenbord: ${reached}/${input.total || 0} bereikt in DOM-volgorde${complete ? '' : ` (steekproef, eerste ${limit})`}`,
    passed: outOfOrder.length === 0 && reached >= expected && expected > 0,
    detail: `${reached} van ${input.total || 0} bereikt, ${outOfOrder.length} buiten volgorde`,
  });
  for (const selector of outOfOrder) {
    errors.push({ criterion: 'toetsenbord', reason: 'volgorde', name: selector, detail: 'focus sprong terug in de DOM-volgorde' });
  }
  if (reached < expected) {
    errors.push({
      criterion: 'toetsenbord',
      reason: 'niet-bereikt',
      name: 'document',
      detail: `${reached} van de eerste ${expected} elementen bereikt`,
    });
  }

  return { checks, errors };
}

/** Beoordeelt de reflow-meting (320 px breed, 200% tekst). */
function checksFromReflow(pageName, theme, data) {
  const prefix = `${pageName} (${theme})`;
  const input = data || {};
  const checks = [];
  const errors = [];
  const overflow = Number(input.overflowX) || 0;

  checks.push({
    criterion: 'reflow',
    name: `${prefix} · reflow: geen horizontale scroll bij ${input.viewportWidth || 0} px`,
    passed: overflow <= 1,
    detail: `scrollWidth ${input.scrollWidth || 0} px (html ${input.rootScrollWidth || 0}, body ${input.bodyScrollWidth || 0}), ${input.offenderTotal || 0} elementen voorbij de rand, ${input.scrollStrips || 0} in een eigen scrollstrook, inhoud te breed in: ${(input.overflowing || []).slice(0, 3).map((entry) => `${entry.selector} (${entry.scrollWidth}/${entry.clientWidth})`).join(', ') || 'geen'}`,
  });
  if (overflow > 1) {
    errors.push({ criterion: 'reflow', reason: 'horizontale-scroll', name: 'document', detail: `${overflow} px te breed` });
  }
  for (const offender of input.offenders || []) {
    errors.push({
      criterion: 'reflow',
      reason: 'buiten-beeld',
      name: offender.selector,
      detail: `links ${offender.left}, rechts ${offender.right}, breed ${offender.width} in ouder ${offender.parent || '?'} (${offender.display}, nowrap ${offender.whiteSpace}, min-width ${offender.minWidth}, overflow-x ${offender.overflowX})`,
    });
  }

  checks.push({
    criterion: 'reflow',
    name: `${prefix} · reflow: geen afgekapte tekst`,
    passed: (input.clippedTotal || 0) === 0,
    detail: `${input.clippedTotal || 0} afgekapt, ${input.ellipsisTotal || 0} met ellipsis (bewust, zie rapport)`,
  });
  for (const entry of input.clipped || []) {
    errors.push({
      criterion: 'reflow',
      reason: 'tekst-afgekapt',
      name: entry.selector,
      detail: `"${entry.text}" · ${entry.scrollWidth}px in ${entry.clientWidth}px breed`,
    });
  }

  return { checks, errors };
}

/** Beoordeelt of beweging gerespecteerd wordt onder `prefers-reduced-motion`. */
function checksFromMotion(pageName, theme, data) {
  const prefix = `${pageName} (${theme})`;
  const input = data || {};
  const checks = [];
  const errors = [];
  const animations = Number(input.animationTotal) || 0;
  const transitions = Number(input.transitionTotal) || 0;
  const smooth = input.scrollBehaviour === 'smooth';

  checks.push({
    criterion: 'beweging',
    name: `${prefix} · beweging: prefers-reduced-motion gerespecteerd`,
    passed: input.prefersReducedMotion === true && animations === 0 && transitions === 0 && !smooth,
    detail: `reduce ${input.prefersReducedMotion === true ? 'actief' : 'niet actief'}, ${animations} animaties, ${transitions} transformtransities, scroll-behavior ${input.scrollBehaviour}`,
  });
  for (const entry of input.animations || []) {
    errors.push({ criterion: 'beweging', reason: 'animatie', name: entry.selector, detail: `${entry.name} ${entry.duration}s` });
  }
  for (const entry of input.transitions || []) {
    errors.push({ criterion: 'beweging', reason: 'transitie', name: entry.selector, detail: `${entry.property} ${entry.duration}s` });
  }
  if (smooth) {
    errors.push({ criterion: 'beweging', reason: 'vloeiend-scrollen', name: 'html', detail: 'scroll-behavior: smooth' });
  }
  if (input.prefersReducedMotion !== true) {
    errors.push({ criterion: 'beweging', reason: 'voorkeur-niet-actief', name: 'document', detail: 'de check kon prefers-reduced-motion niet aanzetten' });
  }

  return { checks, errors };
}

/** Beoordeelt het deelvenster: focus erin, een naam, en focus terug bij Esc. */
function checksFromDialog(pageName, theme, result) {
  const prefix = `${pageName} (${theme})`;
  const input = result || {};
  const checks = [];
  const errors = [];
  const trapped = input.trapped === true;
  const restored = input.restored === true;

  checks.push({
    criterion: 'dialoog',
    name: `${prefix} · dialoog: focus erin, vastgehouden en teruggegeven`,
    passed: input.open === true && input.inside === true && trapped && restored,
    detail: `open ${input.open === true}, focus binnen ${input.inside === true}, vastgehouden ${trapped}, terug ${restored}`,
  });
  if (input.open !== true) errors.push({ criterion: 'dialoog', reason: 'niet-open', name: 'document', detail: 'geen [role="dialog"] gevonden' });
  if (input.inside !== true) errors.push({ criterion: 'dialoog', reason: 'focus-niet-binnen', name: input.active || 'document', detail: 'focus bleef buiten het venster' });
  if (!trapped) errors.push({ criterion: 'dialoog', reason: 'focus-ontsnapt', name: input.active || 'document', detail: 'Tab verliet het venster' });
  if (!restored) errors.push({ criterion: 'dialoog', reason: 'focus-niet-terug', name: input.afterClose || 'document', detail: 'focus keerde niet terug naar de opener' });

  checks.push({
    criterion: 'dialoog',
    name: `${prefix} · dialoog: heeft een naam en aria-modal`,
    passed: Boolean((input.name && String(input.name).trim()) || input.labelledBy) && input.ariaModal === 'true',
    detail: `naam "${input.name || input.labelledBy || ''}", aria-modal ${input.ariaModal}`,
  });
  if (!((input.name && String(input.name).trim()) || input.labelledBy)) {
    errors.push({ criterion: 'dialoog', reason: 'geen-naam', name: '[role=dialog]', detail: 'geen aria-label of aria-labelledby' });
  }
  if (input.ariaModal !== 'true') {
    errors.push({ criterion: 'dialoog', reason: 'geen-aria-modal', name: '[role=dialog]', detail: `aria-modal ${input.ariaModal}` });
  }

  return { checks, errors };
}

// ── Naar de pagina sturen ──────────────────────────────────────────────────

// Alles wat de audit in de pagina nodig heeft. De volgorde maakt niet uit (het
// zijn functiedeclaraties), maar elke gebruikte functie moet erin staan: de
// bron gaat als tekst naar de browser en heeft daar geen `require`.
const PAGE_HELPERS = [
  parseColor,
  srgbChannel,
  relativeLuminance,
  compositeColor,
  contrastRatio,
  isLargeText,
  requiredContrast,
  contrastResult,
  describeElement,
  insideFixedLayer,
  isVisible,
  isVisuallyHiddenBox,
  insideHorizontalScroller,
  effectiveOpacity,
  hiddenFromAssistiveTech,
  ownText,
  accessibleTextOf,
  labelTextFor,
  accessibleName,
  hasMeaningfulCharacters,
  backgroundCandidates,
  isTabbable,
  tabbables,
  tabCandidates,
  focusStyleSnapshot,
  focusStyleChain,
  focusIndicator,
  cssColour,
  intersects,
  compactTarget,
  auditSummary,
];

const PAGE_CONSTANTS = { INTERACTIVE_SELECTOR, SKIP_TAGS };

const PAGE_FUNCTIONS = {
  auditPage,
  reflowAudit,
  motionAudit,
  scaleText,
  prepareFocusWalk,
  readFocusStep,
  dialogAudit,
  activeElementAudit,
  // Ook los aanroepbaar: zo kan een test bewijzen dat de bron in de browser
  // dezelfde uitkomst geeft als de Node-functie.
  contrastResult,
  focusIndicator,
};

/**
 * De bron die `Runtime.evaluate` uitvoert: de constanten, de hulpjes en één
 * aanroep. Zo gebruikt de browser exact dezelfde functies als `node --test`, en
 * bestaat het contrastrekenwerk maar één keer.
 */
function inPageSource(name, args) {
  const fn = PAGE_FUNCTIONS[name];
  if (!fn) throw new Error(`unknown_in_page_function: ${name}`);
  const helpers = PAGE_HELPERS.map((helper) => helper.toString()).join('\n\n');
  const constants = Object.entries(PAGE_CONSTANTS)
    .map(([key, value]) => `const ${key} = ${JSON.stringify(value)};`)
    .join('\n');
  const callArgs = (Array.isArray(args) ? args : [])
    .map((arg) => JSON.stringify(arg === undefined ? null : arg))
    .join(', ');
  return `(() => {\n${constants}\n\n${helpers}\n\nreturn (${fn.toString()})(${callArgs});\n})()`;
}

module.exports = {
  parseColor,
  srgbChannel,
  relativeLuminance,
  compositeColor,
  contrastRatio,
  isLargeText,
  requiredContrast,
  contrastResult,
  groupFailures,
  checksFromAudit,
  checksFromFocusWalk,
  checksFromReflow,
  checksFromMotion,
  checksFromDialog,
  inPageSource,
};
