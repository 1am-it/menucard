'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDirectPdfAnalysis } = require('./sourceAnalysisPipeline');

// Same programmatic PDF fixture builder used by pdfMenuStructuring.test.js and
// restaurantSourceAnalysis.test.js (necessary duplication for self-contained
// fixtures, an existing project precedent).
function buildTestPdf({ contentStream, mediaBox = [0, 0, 300, 600] }) {
  const pageObjNums = [3];
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [${mediaBox.join(' ')}] /Contents 4 0 R >>`,
    4: `<< /Length ${Buffer.byteLength(contentStream)} >>\nstream\n${contentStream}\nendstream`,
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  let pdf = '%PDF-1.4\n';
  const offsets = new Array(6).fill(null);
  for (const num of [1, 2, 3, 4, 5]) {
    offsets[num] = Buffer.byteLength(pdf);
    pdf += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let num = 1; num <= 5; num += 1) pdf += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function textAt(x, y, text) {
  return `1 0 0 1 ${x} ${y} Tm (${text.replace(/([()\\])/g, '\\$1')}) Tj`;
}

test('REGRESSION (review P1): a direct PDF reaches the same provider-neutral chain with its bounded text', async () => {
  const content = [
    'BT /F1 12 Tf',
    textAt(20, 100, '// FICTIEVE DRANKEN'),
    textAt(20, 80, 'Fictieve Koffie'),
    textAt(90, 80, '3.5'),
    textAt(20, 60, 'Fictieve Koffie'),
    textAt(90, 60, '3.5'),
    'ET',
  ].join('\n');
  let received;
  const analysis = await buildDirectPdfAnalysis({
    pdfBytes: buildTestPdf({ contentStream: content }),
    sourceUrl: 'https://fictief.example/menu.pdf',
    structuredExtraction: async (input) => {
      received = input;
      return { enabled: true, ok: false, reason: 'provider_unavailable' };
    },
  });
  assert.equal(analysis.menuContexts.length, 1);
  assert.equal(analysis.menuContexts[0].sourceId, 'source-1');
  assert.equal(analysis.sourceInventory[0].itemCount, 2);
  assert.equal(received.sources.length, 1);
  assert.match(received.sources[0].text, /Pagina 1/);
  assert.match(received.sources[0].text, /Fictieve Koffie 3\.5/);
  assert.equal(Object.prototype.hasOwnProperty.call(analysis.unknownMenuContexts[0], 'text'), false);
  assert.doesNotMatch(JSON.stringify(analysis.unknownMenuContexts), /Pagina 1/);
  assert.doesNotMatch(JSON.stringify(analysis.extractionResult), /Pagina 1/);
  assert.equal(analysis.aiExtraction.reason, 'provider_unavailable');
  assert.equal(analysis.extractionResult.ai.ok, false);
  assert.equal(analysis.extractionResult.ai.reason, 'provider_unavailable');
});

test('a direct PDF without recognizable dishes still hands its text to the adapter and reports zero items', async () => {
  const content = ['BT /F1 12 Tf', textAt(20, 100, 'Welkom in ons restaurant'), 'ET'].join('\n');
  let received;
  const analysis = await buildDirectPdfAnalysis({
    pdfBytes: buildTestPdf({ contentStream: content }),
    sourceUrl: 'https://fictief.example/scan.pdf',
    structuredExtraction: async (input) => {
      received = input;
      return { enabled: true, ok: false, reason: 'provider_unavailable' };
    },
  });
  assert.deepEqual(analysis.menuContexts, []);
  assert.equal(received.sources[0].status, 'read');
  assert.match(received.sources[0].text, /Welkom in ons restaurant/);
  assert.equal(analysis.extractionResult.status, 'candidate_without_items');
  assert.ok(analysis.limitations.some((line) => line.includes('geen betrouwbaar herkenbare gerechten')));
});
