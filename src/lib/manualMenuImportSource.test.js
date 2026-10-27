'use strict';

// #59 fase 2 — bronlezing van de handmatige import, met een fake fetch.
// Geen netwerk: dezelfde veilige route wordt ingevoerd, de regels zijn hier
// bewezen (robots, type, tekst, scan zonder tekst, hash).

const test = require('node:test');
const assert = require('node:assert/strict');

const { htmlToPlainText, pdfPageCount, readManualImportSource, readManualImportSources, MAX_SOURCES } = require('./manualMenuImportSource');
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

test('K4: een PDF zonder tekstlaag levert geen tekst en gaat als document mee', async () => {
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
  // BE-33 (#79, criterion 2): a scan PDF goes to the same model as a document.
  assert.match(source.limitation, /gaat als document naar de AI/i);
  assert.equal(typeof source.documentBase64, 'string');
  assert.ok(source.documentBase64.length > 0);
  assert.equal(source.imageRead, true);
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

// A real, tiny PNG (1x1). The reader must carry exactly these bytes.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(TINY_PNG, 'base64');

test('BE-33: een pagina met alleen menu-afbeeldingen levert die afbeeldingen, niet het logo of een andere site', async () => {
  const html = [
    '<html><body>',
    '<img src="/logo.png" alt="Logo">',
    '<img src="/sfeer-terras.jpg" alt="Ons terras">',
    '<img src="/img/menukaart-1.jpg" alt="Menukaart 1">',
    '<img src="/img/menukaart-2.png" alt="Menukaart 2">',
    '<img src="https://cdn.ander.example/menu-3.jpg" alt="Menukaart 3">',
    '</body></html>',
  ].join('\n');
  const requested = [];
  const source = await readManualImportSource({
    id: 'source-1',
    url: 'https://voorbeeld.example/menu',
    fetchImpl: async (url) => {
      requested.push(url);
      if (url === 'https://voorbeeld.example/menu') {
        return { finalUrl: url, contentType: 'text/html', bytes: Buffer.from(html) };
      }
      const mediaType = url.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return { finalUrl: url, contentType: mediaType, bytes: PNG_BYTES };
    },
    now: new Date('2026-10-27T12:00:00.000Z'),
  });
  assert.equal(source.kind, 'image');
  assert.equal(source.hasText, false);
  assert.equal(source.imageRead, true);
  assert.deepEqual(source.images.map((image) => image.url), [
    'https://voorbeeld.example/img/menukaart-1.jpg',
    'https://voorbeeld.example/img/menukaart-2.png',
  ]);
  assert.deepEqual(source.images.map((image) => image.mediaType), ['image/jpeg', 'image/png']);
  assert.equal(source.images[0].data, TINY_PNG);
  assert.deepEqual(source.images.map((image) => image.number), [1, 2]);
  // Only the page and the two menu images were fetched: no logo, no terrace,
  // no other website.
  assert.equal(requested.some((url) => url.includes('logo')), false);
  assert.equal(requested.some((url) => url.includes('sfeer')), false);
  assert.equal(requested.some((url) => url.includes('ander.example')), false);
});

test('BE-33: meer dan zes menu-afbeeldingen worden niet opgehaald en de bron zegt waarom', async () => {
  const html = Array.from({ length: 8 }, (_, index) => `<img src="/kaart-${index + 1}.jpg" alt="Menukaart ${index + 1}">`).join('');
  const requested = [];
  const source = await readManualImportSource({
    id: 'source-1',
    url: 'https://voorbeeld.example/menu',
    fetchImpl: async (url) => {
      requested.push(url);
      return { finalUrl: url, contentType: 'text/html', bytes: Buffer.from(html) };
    },
  });
  assert.equal(source.kind, 'image');
  assert.deepEqual(source.images, []);
  assert.equal(source.imageCandidates, 7, 'the overflow is counted, not silently cut');
  assert.match(source.limitation, /maximaal 6/);
  // Only the page itself was fetched: nothing above the limit goes out.
  assert.equal(requested.length, 1);
});

test('BE-33: het aantal paginas van een PDF wordt begrensd gelezen', async () => {
  const twoPages = Buffer.from(
    '%PDF-1.4\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n2 0 obj <</Type /Pages /Count 2 /Kids [3 0 R 4 0 R]>> endobj\n3 0 obj <</Type /Page /Parent 2 0 R>> endobj\n4 0 obj <</Type /Page /Parent 2 0 R>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF',
  );
  assert.equal(pdfPageCount(twoPages), 2);
  assert.equal(pdfPageCount(Buffer.from('%PDF-1.7\n1 0 obj <</Type /Pages /Count 12>> endobj\n%%EOF')), 12);
  assert.equal(pdfPageCount(Buffer.from('geen pdf')), null);
  assert.equal(pdfPageCount(null), null);

  const source = await readManualImportSource({
    id: 'source-1',
    url: 'https://voorbeeld.example/menukaart.pdf',
    fetchImpl: async (url) => ({ finalUrl: url, contentType: 'application/pdf', bytes: twoPages }),
  });
  assert.equal(source.pageCount, 2);
  assert.equal(source.imageRead, true);
  assert.equal(typeof source.documentBase64, 'string');
});
