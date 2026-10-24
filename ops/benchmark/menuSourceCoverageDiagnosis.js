'use strict';

// X5 of the Delivery Lead order 6382189724 (variant 1): the offline diagnosis
// of the comparison engine on the pinned captures and the literal AI answers of
// live run 2 (ops/benchmark/output/ai-probe-raw/).
//
// Diagnosis only. It reads the answers and the captures, counts the priced
// source lines that no accepted dish covers, and reports per source. It never
// changes a reference, a counting rule, the measurement code, the ledger or any
// product data, and it makes no provider call.
//
// No file, network or database access here: the ops script loads the bytes.

const { compareCaptureWithConcept, pricedLinesOfSource } = require('../../src/lib/menuSourceCoverage');

const DIAGNOSIS_VERSION = 'menu-source-coverage-diagnosis/v1';
const RAW_FILE_PATTERN = /^([a-z0-9][a-z0-9._-]*)-r(\d+)-c(\d+)-call(\d+)-([0-9a-f]{12})\.json\.txt$/i;

/** The raw answer files of one run, grouped per source, in a stable order. */
function rawAnswerFiles(files, { run = 2 } = {}) {
  const grouped = new Map();
  for (const name of Array.isArray(files) ? files : []) {
    const match = RAW_FILE_PATTERN.exec(String(name));
    if (!match) continue;
    if (Number(match[2]) !== run) continue;
    const sourceId = match[1].toLowerCase();
    if (!grouped.has(sourceId)) grouped.set(sourceId, []);
    grouped.get(sourceId).push({
      file: name,
      sourceId,
      run: Number(match[2]),
      chunk: Number(match[3]),
      call: Number(match[4]),
    });
  }
  for (const list of grouped.values()) list.sort((a, b) => a.call - b.call || a.chunk - b.chunk || a.file.localeCompare(b.file));
  return grouped;
}

/** Parses the literal answers; an unreadable answer is reported, not skipped. */
function parseAnswers(entries) {
  const answers = [];
  const problems = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    let value;
    try {
      value = JSON.parse(entry.text);
    } catch {
      problems.push({ file: entry.file, reason: 'invalid_json' });
      continue;
    }
    if (!value || typeof value !== 'object' || !Array.isArray(value.menus)) {
      problems.push({ file: entry.file, reason: 'no_menus' });
      continue;
    }
    answers.push({ file: entry.file, value });
  }
  return { answers, problems };
}

/** Every menu and every rejected passage of the answers, in file order. */
function answerConcept(answers) {
  const menus = [];
  const rejected = [];
  for (const answer of Array.isArray(answers) ? answers : []) {
    for (const menu of Array.isArray(answer.value.menus) ? answer.value.menus : []) menus.push(menu);
    for (const entry of Array.isArray(answer.value.rejected) ? answer.value.rejected : []) rejected.push(entry);
  }
  return { menus, rejected };
}

/**
 * One source: how many priced source lines the captures print, how many an
 * accepted dish covers, and which lines stay uncovered (bounded examples).
 */
function diagnoseSource({ sourceId, label, captureStatus, blockedReason, captures, answers, problems, limit = 20 } = {}) {
  const usable = (Array.isArray(captures) ? captures : []).filter((capture) => typeof capture.text === 'string' && capture.text.trim() !== '');
  const records = usable.flatMap((capture) => pricedLinesOfSource(capture));
  const pricedLines = records.length;
  // Z1 (Lead order 6382953597): how many of those priced lines are a name line
  // plus the price on its own line, and how many print a price without a name.
  const pairedLines = records.filter((record) => record.paired === true).length;
  const looseLines = records.filter((record) => record.loose === true).length;
  const concept = answerConcept(answers);
  const comparison = compareCaptureWithConcept({
    sources: usable,
    menus: concept.menus,
    rejected: concept.rejected,
    limit,
  });
  return {
    sourceId,
    label: label || sourceId,
    captureStatus: captureStatus || (usable.length > 0 ? 'captured' : 'blocked'),
    blockedReason: blockedReason || null,
    capturesRead: usable.length,
    pricedLines,
    pairedLines,
    looseLines,
    // An honest distinction: a capture whose text holds no price token cannot
    // say anything about missing dishes. That is not a green result.
    note: comparison.available && pricedLines === 0 ? 'de capture bevat geen prijsregels; niets te vergelijken' : null,
    acceptedItems: concept.menus.reduce(
      (sum, menu) => sum + (Array.isArray(menu.categories) ? menu.categories.reduce((n, category) => n + (Array.isArray(category.items) ? category.items.length : 0), 0) : 0),
      0,
    ),
    rejectedPassages: concept.rejected.length,
    comparison: {
      available: comparison.available,
      reason: comparison.reason,
      coveredLines: comparison.available ? Math.max(0, pricedLines - comparison.total) : null,
      uncoveredLines: comparison.available ? comparison.total : null,
      examples: comparison.lines.map((line) => ({
        id: line.id,
        text: line.text,
        priceText: line.priceText,
        section: line.section,
      })),
    },
    answerFiles: (Array.isArray(answers) ? answers : []).map((answer) => answer.file),
    unreadableAnswers: Array.isArray(problems) ? problems : [],
  };
}

module.exports = {
  DIAGNOSIS_VERSION,
  RAW_FILE_PATTERN,
  rawAnswerFiles,
  parseAnswers,
  answerConcept,
  diagnoseSource,
};
