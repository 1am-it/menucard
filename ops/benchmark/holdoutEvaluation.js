'use strict';

// One source measurement for the #59 holdout/representative tooling. Moved
// out of probe-menu-extraction-holdout.js (#59 Delivery Lead review
// 6316295818) so the one-shot holdout evaluation and the later representative
// measurement use exactly the same code, fields and evidence audit. Pure of
// side effects: the caller supplies the safe fetch and the analysis pipeline.
// It never writes, confirms a source, saves a concept or publishes anything.

function itemCount(menu) {
  return (menu.categories || []).reduce((total, category) => total + ((category.items || []).length), 0);
}

function summarizeMenuContexts(analysis) {
  return (analysis.menuContexts || []).map((menu) => ({
    title: menu.title || null,
    sourceId: menu.sourceId || null,
    categoryCount: (menu.categories || []).length,
    itemCount: itemCount(menu),
    categories: (menu.categories || []).map((category) => ({
      name: category.name || null,
      path: category.path || [],
      sourcePath: category.sourcePath || null,
      uncertain: Boolean(category.uncertain),
      locator: category.locator || null,
      itemCount: (category.items || []).length,
    })),
  }));
}

function summarizeInventory(analysis) {
  return (analysis.sourceInventory || []).map((source) => ({
    url: source.url || null,
    kind: source.kind || null,
    status: source.status || null,
    pageCount: source.pageCount || null,
    wordCount: source.wordCount || null,
    itemCount: source.itemCount || null,
    contentHash: source.contentHash || null,
  }));
}

async function evaluateSource(entry, reference, { sha256, fetchWebsiteSafely, analyzeSourceUrl, maxBytes, summarizeEvidence, resultNote = 'first holdout observation' }) {
  const started = Date.now();
  const base = {
    id: entry.id,
    referenceId: entry.referenceId,
    label: entry.label || reference.label || null,
    class: entry.class || null,
    kind: reference.kind || null,
    url: reference.url,
    pinnedBytesSha256: reference.bytesSha256,
    captureStatus: reference.captureStatus,
    evaluatedAt: new Date().toISOString(),
  };
  if (reference.captureStatus !== 'captured') {
    const reason = `The approved entry URL did not yield a readable public source (${reference.error}${reference.httpStatus ? ` ${reference.httpStatus}` : ''}). No alternative URL or other location was substituted.`;
    return {
      ...base,
      status: 'blocked',
      completed: true,
      itemCount: 0,
      categoryCount: 0,
      menuCount: 0,
      blockedReason: reason,
      errors: reference.error || 'source_not_readable',
      result: reason,
      elapsedMs: Date.now() - started,
      limitations: [reference.note],
    };
  }

  let fetched;
  try {
    fetched = await fetchWebsiteSafely(reference.url, { encoding: 'buffer', maxBytes, timeoutMs: 15000 });
  } catch (error) {
    const reason = (error && error.reason) || (error && error.message) || 'fetch_failed';
    return {
      ...base,
      status: 'blocked',
      completed: true,
      itemCount: 0,
      categoryCount: 0,
      menuCount: 0,
      errors: reason,
      blockedReason: `The approved entry URL could not be read: ${reason}. No alternative URL or other location was substituted.`,
      result: `The approved entry URL could not be read: ${reason}.`,
      elapsedMs: Date.now() - started,
      limitations: ['No parser result is claimed for an unreadable source version.'],
    };
  }
  const bytesSha256 = sha256(fetched.bytes);
  const sourceVersionMatches = reference.bytesSha256 ? bytesSha256 === reference.bytesSha256 : null;

  const analysisResult = await analyzeSourceUrl(reference.url);
  if (!analysisResult.ok) {
    return {
      ...base,
      status: 'blocked',
      completed: true,
      bytesSha256,
      sourceVersionMatches,
      itemCount: 0,
      categoryCount: 0,
      menuCount: 0,
      analysisError: analysisResult.errorReason,
      errors: analysisResult.errorReason,
      blockedReason: `The real analysis pipeline refused the source: ${analysisResult.errorReason}.`,
      result: `The real analysis pipeline refused the source: ${analysisResult.errorReason}.`,
      elapsedMs: Date.now() - started,
      limitations: ['A refusal is recorded as a limitation, never as an empty successful menu.'],
    };
  }

  const analysis = analysisResult.analysis;
  const menus = summarizeMenuContexts(analysis);
  const evidence = summarizeEvidence(analysis.menuContexts);
  const itemTotal = menus.reduce((total, menu) => total + menu.itemCount, 0);
  const categoryTotal = menus.reduce((total, menu) => total + menu.categoryCount, 0);
  const limitations = (analysis.limitations || []).map((line) => String(line).slice(0, 500));
  return {
    ...base,
    status: 'executed_with_limitation',
    completed: true,
    bytesSha256,
    sourceVersionMatches,
    finalUrl: fetched.finalUrl,
    itemCount: itemTotal,
    categoryCount: categoryTotal,
    menuCount: menus.length,
    menus,
    priceStatus: evidence.priceStatus,
    evidence: {
      itemCount: evidence.itemCount,
      categoryCount: evidence.categoryCount,
      menuCount: evidence.menuCount,
      priceStatus: evidence.priceStatus,
      knownWithoutAmount: evidence.knownWithoutAmount,
      sourceIdPercent: evidence.evidence.sourceIdPercent,
      locatorPercent: evidence.evidence.locatorPercent,
      supportPercent: evidence.evidence.supportPercent,
      withSourceId: evidence.evidence.withSourceId,
      withLocator: evidence.evidence.withLocator,
      withSupport: evidence.evidence.withSupport,
      missingSourceId: evidence.evidence.missingSourceId,
      missingLocator: evidence.evidence.missingLocator,
      missingSupport: evidence.evidence.missingSupport,
    },
    sourceInventory: summarizeInventory(analysis),
    coverage: analysis.extractionResult ? analysis.extractionResult.coverage : null,
    attentionGroupCount: analysis.extractionResult ? (analysis.extractionResult.attentionGroups || []).length : 0,
    limitations,
    notes: (analysis.notes || []).map((line) => String(line).slice(0, 300)),
    result: itemTotal > 0
      ? `${itemTotal} items in ${categoryTotal} sections across ${menus.length} menu context(s). This is a ${resultNote}, not a complete-menu or accuracy claim.`
      : 'No items were extracted. The source is recorded as an honest limitation, not as a successful menu.',
    elapsedMs: Date.now() - started,
  };
}

module.exports = { summarizeMenuContexts, summarizeInventory, evaluateSource };

