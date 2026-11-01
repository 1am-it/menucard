'use strict';

// BE-71 (#176, besluit 021 + R10/R11) — van AI-uitvoer naar data/.
//
// R10: een kaart die de AI uit een afbeelding las, komt pas op de site na de
// controle van de Lead. De Lead verbetert die kaart zelf en legt hem vast in
// `ops/scripts/menu-bootstrap/lead-corrections/<id>.json`. Bestaat dat bestand,
// dan **is** dat de kaart en dient de AI-uitvoer in `.local/menu-bootstrap-ai/`
// alleen als bewijs. Bestaat het niet, dan wordt er geen AI-kaart geschreven.
//
// De gecorrigeerde kaart gaat door dezelfde eis (./completeMenu.js) en dezelfde
// regels R1-R9 (./normalizeMenu.js), en houdt dezelfde vorm als de bestaande
// kaarten (./menuEntry.js). Een gerecht dat op de kaart twee keer staat (los
// broodje en salade) blijft twee gerechten: de correctie is leidend.

const fs = require('node:fs');
const path = require('node:path');
const { assessCompleteMenu } = require('./completeMenu');
const { normaliseMenu } = require('./normalizeMenu');
const { buildEntry, menuKey, menuScopeFor } = require('./menuEntry');

const AI_DIR = path.join('.local', 'menu-bootstrap-ai');
const CORRECTIONS_DIR = path.join('ops', 'scripts', 'menu-bootstrap', 'lead-corrections');

// One closed reason, so the report and the checkpoint can name it.
const AI_WITHOUT_LEAD_CHECK = {
  code: 'ai_without_lead_check',
  text: 'AI-kaart zonder Lead-controle (R10): geen kaart geschreven',
};

function readJson(file, readFileSync) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Wat er voor dit restaurant aan bewijs ligt: de AI-uitvoer en de Lead-correctie.
 * Beide mogen ontbreken; `null` betekent "niet aanwezig".
 */
function loadLeadCard({ restaurantId, aiDir = AI_DIR, correctionsDir = CORRECTIONS_DIR, readFileSync = fs.readFileSync, existsSync = fs.existsSync } = {}) {
  const id = String(restaurantId == null ? '' : restaurantId);
  if (!id) return { ai: null, correction: null };
  const aiFile = path.join(aiDir, `${id}.json`);
  const correctionFile = path.join(correctionsDir, `${id}.json`);
  return {
    ai: existsSync(aiFile) ? readJson(aiFile, readFileSync) : null,
    correction: existsSync(correctionFile) ? readJson(correctionFile, readFileSync) : null,
  };
}

/** De kaart zoals de Lead hem vastlegde, als leesbare menu. */
function correctionMenu(correction) {
  return {
    kind: 'lead-correction',
    title: null,
    categories: (correction && Array.isArray(correction.categories) ? correction.categories : []).map((category) => ({
      name: category && category.name,
      items: ((category && category.items) || []).map((item) => ({
        name: item && item.name,
        desc: item && item.desc ? item.desc : '',
        price: Number.isFinite(item && item.price) ? item.price : null,
      })),
    })),
    attention: [],
  };
}

/**
 * De ene kaart van dit restaurant uit de Lead-correctie: `{ ok, reasons, key,
 * scope, entry, assessment, sourceUrl, scraped, leadChecked, ai }`.
 *
 * Zonder correctie is `ok` onwaar met de reden `ai_without_lead_check` — de
 * AI-uitvoer gaat dan alleen als bewijs mee naar het rapport.
 */
function buildLeadCard({ restaurantId, correction, ai, menus }) {
  const id = String(restaurantId == null ? '' : restaurantId);
  const evidence = ai ? { scraped: ai.scraped || null, model: ai.model || null, dishCount: (ai.dishes || []).length, assessment: ai.assessment || null } : null;
  if (!correction) {
    return { ok: false, reasons: [{ ...AI_WITHOUT_LEAD_CHECK }], key: null, scope: null, entry: null, assessment: null, sourceUrl: null, scraped: null, leadChecked: null, ai: evidence };
  }

  // Dezelfde regels als elke gelezen kaart (R1-R9): namen en koppen worden hier
  // nog één keer genormaliseerd, ook al deed de Lead dat zelf al.
  const menu = normaliseMenu(correctionMenu(correction), { restaurantName: correction.name });
  const assessment = assessCompleteMenu(menu);
  const sourceUrl = correction.source || null;
  const scraped = (ai && ai.scraped) || correction.checkedAt || null;
  const leadChecked = correction.checkedAt || null;
  const scope = menuScopeFor({ sourceUrl, title: correction.subtitle });
  const key = menuKey(id, scope);
  if (!assessment.ok) {
    return { ok: false, reasons: assessment.reasons, key, scope, entry: null, assessment, sourceUrl, scraped, leadChecked, ai: evidence };
  }

  const built = buildEntry({ restaurantId: id, menu, menus, sourceUrl, scraped, scope });
  const entry = {
    subtitle: built.subtitle,
    ...(built.title ? { title: built.title } : {}),
    scraped: built.scraped,
    source: built.source,
    notes: correction.note || built.notes,
    aiRead: true,
    leadChecked,
    categories: built.categories,
  };
  return { ok: true, reasons: [], key, scope, entry, assessment, sourceUrl, scraped, leadChecked, ai: evidence };
}

module.exports = { AI_DIR, CORRECTIONS_DIR, AI_WITHOUT_LEAD_CHECK, loadLeadCard, correctionMenu, buildLeadCard };
