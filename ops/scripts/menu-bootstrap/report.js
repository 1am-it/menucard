'use strict';

// BE-71 (#176, besluit 021 §2) — the report next to the json: per restaurant
// the card URL, html or pdf, the number of dishes and how many of them carry a
// price, and passed or skipped with the reason. For the four cards that already
// existed (scraped 2026-03-25) the differences against that March card: new
// dishes, dishes that disappeared and dishes whose price changed.
//
// Pure: it only formats what the engine measured.

const { REASON_TEXT } = require('./completeMenu');

function priceOf(item) {
  return Number.isFinite(item && item.priceValue) ? item.priceValue : Number.isFinite(item && item.price) ? item.price : null;
}

function dishMap(entry) {
  const map = new Map();
  for (const category of (entry && entry.categories) || []) {
    for (const item of category.items || []) {
      const key = `${String(category.name || '').trim().toLowerCase()}|${String(item.name || '').trim().toLowerCase()}`;
      map.set(key, { name: item.name, category: category.name, price: priceOf(item) });
    }
  }
  return map;
}

/** New, disappeared and re-priced dishes of a fresh card against the old one. */
function compareCards(previousEntry, freshEntry) {
  const before = dishMap(previousEntry);
  const after = dishMap(freshEntry);
  const added = [];
  const removed = [];
  const repriced = [];
  for (const [key, dish] of after) if (!before.has(key)) added.push({ name: dish.name, category: dish.category, price: dish.price });
  for (const [key, dish] of before) if (!after.has(key)) removed.push({ name: dish.name, category: dish.category, price: dish.price });
  for (const [key, dish] of after) {
    const old = before.get(key);
    if (old && old.price !== dish.price) repriced.push({ name: dish.name, category: dish.category, was: old.price, now: dish.price });
  }
  return { added, removed, repriced };
}

function existingEntriesFor(menus, restaurantId) {
  const out = {};
  for (const [key, value] of Object.entries(menus || {})) if (key.startsWith(`${restaurantId}-`)) out[key] = value;
  return out;
}

/**
 * Builds the report document. `results` are the engine records; `previousMenus`
 * is the data/menus.json as it was before this run (the four March cards).
 */
function buildReport({ results, previousMenus, scraped, generatedAt }) {
  const restaurants = results.map((result) => {
    const previous = existingEntriesFor(previousMenus, result.restaurantId);
    const hadCard = Object.keys(previous).length > 0;
    const row = {
      id: result.restaurantId,
      name: result.name,
      website: result.website,
      status: result.status,
      menuUrl: result.sourceUrl,
      kind: result.kind,
      dishCount: result.dishCount,
      pricedCount: result.pricedCount,
      pageCount: result.pageCount,
      reasons: result.reasons,
      // What the engine actually tried: per candidate the URL, html or pdf, the
      // dish count and the reader's own refusal. That is the input for the round
      // that improves the readers or the discovery.
      candidates: result.candidates || [],
      hadCard,
      previousKeys: Object.keys(previous),
      // R6: a card that went to the site without its doubtful dishes, with the
      // reason per omitted dish. Empty for a complete card.
      incomplete: result.incomplete === true,
      omittedCount: (result.omitted || []).length,
      omitted: result.omitted || [],
      // R10/R11: the evidence behind a card the Lead checked, and the date of
      // that check. A restaurant whose AI output has no correction is skipped
      // with the reason and shows its evidence here.
      aiEvidence: result.aiEvidence || null,
      leadChecked: result.leadChecked || null,
    };
    // A difference is only meaningful against a card that was fetched on an
    // earlier day: a re-run on the same day would compare the card with itself.
    const olderCard = Object.values(previous).some((entry) => entry && typeof entry.scraped === 'string' && entry.scraped < (scraped || ''));
    if (hadCard && olderCard && result.entry && result.status === 'done') {
      const diffs = {};
      for (const [key, entry] of Object.entries(previous)) diffs[key] = compareCards(entry, result.entry);
      row.diff = diffs;
    }
    return row;
  });

  const groups = {};
  for (const row of restaurants) {
    if (row.status === 'done') continue;
    const code = (row.reasons[0] && row.reasons[0].code) || 'unknown';
    const text = REASON_TEXT[code] || (row.reasons[0] && row.reasons[0].text) || code;
    groups[text] = (groups[text] || 0) + 1;
  }

  return {
    issue: '#176 (BE-71)',
    decision: 'planning/decisions/021-breda-menu-bootstrap.md',
    scraped: scraped || null,
    generatedAt: generatedAt || null,
    totals: {
      restaurants: restaurants.length,
      done: restaurants.filter((r) => r.status === 'done').length,
      skipped: restaurants.filter((r) => r.status === 'skipped').length,
      blocked: restaurants.filter((r) => r.status === 'blocked').length,
    },
    groups,
    restaurants,
  };
}


function euro(value) {
  return Number.isFinite(value) ? `€ ${value.toFixed(2).replace('.', ',')}` : '—';
}

function statusText(row) {
  if (row.status === 'done') return row.incomplete ? 'geslaagd (R6: zonder de twijfelgevallen)' : 'geslaagd';
  const reasons = row.reasons.map((reason) => reason.text + (reason.detail ? ` (${reason.detail})` : ''));
  return `${row.status === 'blocked' ? 'geblokkeerd' : 'overgeslagen'}: ${reasons.join('; ') || 'onbekende reden'}`;
}

/** The markdown report (docs/menu-bootstrap-report.md). */
function renderMarkdown(report) {
  const lines = [];
  lines.push('# Startvulling menukaarten Breda — rapport');
  lines.push('');
  lines.push('Eenmalige vulling volgens besluit 021 (BE-71, #176). Alleen de eigen websites van de');
  lines.push('25 restaurants in `data/restaurants.json`, alleen de bestaande deterministische lezers,');
  lines.push('geen AI en geen betaalde dienst.');
  lines.push('');
  lines.push(`- Ophaaldatum: ${report.scraped || '—'}`);
  lines.push(`- Gegenereerd: ${report.generatedAt || '—'}`);
  lines.push(`- Geslaagd: ${report.totals.done} · overgeslagen: ${report.totals.skipped} · geblokkeerd: ${report.totals.blocked} (van ${report.totals.restaurants})`);
  lines.push('');
  lines.push('## Redenen, gegroepeerd');
  lines.push('');
  const groupEntries = Object.entries(report.groups);
  if (groupEntries.length === 0) lines.push('Geen overgeslagen restaurants.');
  for (const [text, count] of groupEntries.sort((a, b) => b[1] - a[1])) lines.push(`- ${text}: ${count}`);
  lines.push('');
  lines.push('## Per restaurant');
  lines.push('');
  lines.push('| # | Restaurant | Kaart | Vorm | Gerechten | Met prijs | Uitkomst |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.restaurants) {
    lines.push(`| ${row.id} | ${row.name} | ${row.menuUrl || '—'} | ${row.kind || '—'} | ${row.dishCount || 0} | ${row.pricedCount || 0} | ${statusText(row)} |`);
  }
  lines.push('');
  const incompleteCards = report.restaurants.filter((row) => row.incomplete && row.omittedCount > 0);
  if (incompleteCards.length > 0) {
    lines.push('## Kaarten met weggelaten gerechten (R6)');
    lines.push('');
    lines.push('Een kaart waarvan minstens 90% van de gerechten aan de eis voldoet, staat zonder de');
    lines.push('twijfelgevallen op de site. De site zegt dan: "Niet alle gerechten staan erop · bekijk de');
    lines.push('volledige kaart bij het restaurant", met een link naar de bron hieronder. Elk weggelaten');
    lines.push('gerecht staat met zijn reden in dit rapport.');
    lines.push('');
    for (const row of incompleteCards) {
      lines.push(`### ${row.name} (${row.id}) — ${row.omittedCount} van ${row.dishCount + row.omittedCount} weggelaten`);
      lines.push('');
      lines.push(`- Kaart: ${row.menuUrl || '—'}`);
      lines.push(`- Op de site: ${row.dishCount} gerechten, waarvan ${row.pricedCount} met prijs`);
      for (const dish of row.omitted) lines.push(`- weggelaten: ${dish.name} (${dish.category || 'zonder categorie'}): ${dish.text}`);
      lines.push('');
    }
  }
  const compared = report.restaurants.filter((row) => row.diff);
  if (compared.length === 0) {
    lines.push('## Verschillen met de kaarten van 25 maart 2026');
    lines.push('');
    lines.push('Geen van de bestaande kaarten is vervangen, dus er zijn geen nieuwe, verdwenen of');
    lines.push('anders geprijsde gerechten te melden. De vier kaarten van maart (1, 6, 19, 23) staan');
    lines.push('ongewijzigd in `data/menus.json`; hun verse lezing staat met reden in de tabel hierboven.');
    lines.push('');
  }
  if (compared.length > 0) {
    lines.push('## Verschillen met de kaarten van 25 maart 2026');
    lines.push('');
    for (const row of compared) {
      lines.push(`### ${row.name} (${row.id})`);
      lines.push('');
      for (const [key, diff] of Object.entries(row.diff)) {
        lines.push(`- \`${key}\`: nieuw ${diff.added.length}, weg ${diff.removed.length}, andere prijs ${diff.repriced.length}`);
        for (const dish of diff.added.slice(0, 10)) lines.push(`  - nieuw: ${dish.name} (${dish.category}) ${euro(dish.price)}`);
        for (const dish of diff.removed.slice(0, 10)) lines.push(`  - weg: ${dish.name} (${dish.category}) ${euro(dish.price)}`);
        for (const dish of diff.repriced.slice(0, 10)) lines.push(`  - andere prijs: ${dish.name} ${euro(dish.was)} → ${euro(dish.now)}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { buildReport, renderMarkdown, compareCards, existingEntriesFor };
