'use strict';

// #59 fase 2 — bronlezing van de handmatige import, met een fake fetch.
// Geen netwerk: dezelfde veilige route wordt ingevoerd, de regels zijn hier
// bewezen (robots, type, tekst, scan zonder tekst, hash).

const test = require('node:test');
const assert = require('node:assert/strict');

const { htmlToPlainText, readManualImportSource, readManualImportSources, MAX_SOURCES } = require('./manualMenuImportSource');
const { sourceHashForText } = require('./manualMenuImportBundle');

test('K2: HTML wordt platte, gecodeerde tekst zonder scripts of opmaak', () => {
  const text = htmlToPlainText(
    '<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>Lunch</h1><p>Broodplank&nbsp;8,50</p><ul><li>Soep 5,50</li></ul></body></html>',
  );
  assert.match(text, /Lunch/);
  assert.match(text, /Broodplank 8,50/);
  assert.match(text, /Soep 5,50/);
  assert.equal(text.includes('alert(1)'), false);
  assert.equal(text.includes('.x{}'), false);
  assert.equal(text.includes('<'), false);
});

test('K2: een leesbare HTML-bron krijgt tekst en de hash van precies die tekst', async () => {
  const calls = [];
  const source = await readManualImportSource({
    id: 'source-1',
    url: 'https://voorbeeld.example/menu',
    robotsCheck: async () => ({ shouldFetchPage: true }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { finalUrl: url, contentType: 'text/html', bytes: Buffer.from('<h1>Lunch</h1><p>Broodplank 8,50</p>', 'utf8') };
    },
    now: new Date('2026-10-22T12:00:00.000Z'),
  });
  assert.equal(source.status, 'read');
  assert.equal(source.hasText, true);
  assert.equal(source.kind, 'html');
  assert.equal(source.fetchedAt, '2026-10-22T12:00:00.000Z');
  assert.equal(source.sha256, sourceHashForText(source.text));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.maxBytes > 0, true);
});

test('K2: robots.txt en een onbereikbare pagina worden eerlijk gemeld', async () => {
  const blocked = await readManualImportSource({
    id: 'source-1',
    url: 'https://voorbeeld.example/menu',
    robotsCheck: async () => ({ shouldFetchPage: false }),
    fetchImpl: async () => {
      throw new Error('must not fetch');
    },
  });
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.limitation, /robots\.txt/);
  assert.equal(blocked.text, '');
  const failed = await readManualImportSource({
    id: 'source-2',
    url: 'https://voorbeeld.example/menu',
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.hasText, false);
});

test('K4: een PDF zonder tekstlaag levert geen tekst en een expliciete beperking', async () => {
  const source = await readManualImportSource({
    id: 'source-1',
    url: 'https://voorbeeld.example/menu.pdf',
    fetchImpl: async () => ({ finalUrl: 'https://voorbeeld.example/menu.pdf', contentType: 'application/pdf', bytes: Buffer.from('%PDF-1.7 fictief') }),
    now: new Date('2026-10-22T12:00:00.000Z'),
  });
  assert.equal(source.kind, 'pdf');
  assert.equal(source.hasText, false);
  assert.equal(source.text, '');
  assert.match(source.sha256, /^[0-9a-f]{64}$/);
  assert.match(source.limitation, /voeg het bestand zelf toe/i);
});

test('K2: een onbekend contenttype wordt niet als menu gelezen', async () => {
  const source = await readManualImportSource({
    id: 'source-1',
    url: 'https://voorbeeld.example/menu.docx',
    fetchImpl: async () => ({ contentType: 'application/msword', bytes: Buffer.from('x') }),
  });
  assert.equal(source.status, 'failed');
  assert.equal(source.hasText, false);
});

test('K2: de set blijft begrensd tot vijf bronnen met vaste sourceId', async () => {
  const urls = Array.from({ length: 7 }, (_, index) => `https://voorbeeld.example/menu-${index + 1}`);
  const sources = await readManualImportSources({
    urls,
    fetchImpl: async (url) => ({ finalUrl: url, contentType: 'text/html', bytes: Buffer.from('<p>Gerecht 1,00</p>') }),
  });
  assert.equal(sources.length, MAX_SOURCES);
  assert.deepEqual(sources.map((source) => source.id), ['source-1', 'source-2', 'source-3', 'source-4', 'source-5']);
});
