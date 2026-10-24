'use strict';

// #59 Delivery Lead review 6316295818 — content signals and markup-less menus.
//
// Two production failures are pinned here:
//  1. A hijacked restaurant page (injected gambling/spam text, sometimes
//     hidden) must never yield accepted "dishes". Real dishes on the same page
//     stay readable; a page whose accepted items are themselves spam is
//     refused with `content_not_menu_suspected`.
//  2. A printed menu without any price markup (`NAME 25` + description in one
//     paragraph, or `NAME, €7,50` inside a bold title) is read with a locator,
//     while bare prose and bare priced name lists stay refused.
//
// Fictional HTML only (RFC 2606 .invalid/.example); no site is fetched.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHtmlMenuStructure, spamSignals } = require('./htmlMenuStructure');

function items(result) {
  return (result.sections || []).flatMap((section) => section.items);
}

const SPAM_BLOCK = `
  <div style="position:absolute;z-index:-9999;opacity:0;height:1px;overflow:hidden">
    <h2>Spiloplevelsen hos Unibet i Danmark</h2>
    <p>Unibet har længe været en af de mest fremtrædende aktører på det danske marked for pengespil og sportsvæddemål.</p>
    <p>Besøg casino og få en bonus på 25 kroner.</p>
    <h2>Sportwetten und Casino im Vergleich</h2>
    <p>Die besten Sportwetten und Casino-Spiele mit hoher Quote und fairer Auszahlung.</p>
  </div>`;

test('a hidden injected spam block is not read, while the real menu on the same page stays intact', () => {
  const html = `<html><body>
    <h2>Lunch</h2>
    <ul>
      <li>Fictieve tomatensoep <span>€ 6,50</span></li>
      <li>Fictief broodje kaas <span>€ 7,50</span></li>
      <li>Fictieve salade <span>€ 9,00</span></li>
    </ul>
    ${SPAM_BLOCK}
  </body></html>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result).map((item) => item.name), ['Fictieve tomatensoep', 'Fictief broodje kaas', 'Fictieve salade']);
  assert.ok(result.stats.injectedBlocksSkipped >= 1);
  assert.equal(items(result).some((item) => spamSignals(item.name).size > 0), false);
});

test('a visible hijacked block with prices never becomes a menu (content_not_menu_suspected)', () => {
  const html = `<html><body><main>
    <h1>Fictief Restaurant</h1>
    <h2>Welkom</h2>
    <div>
      <p><span><br>WELKOMSTBONUS 25<br></span><span>Speel nu bij Unibet casino en ontvang bonus</span></p>
      <p><span><br>GRATIS SPINS 50<br></span><span>Casino promotie met 50 free spins</span></p>
      <p><span><br>STORTINGSBONUS 100<br></span><span>Speel bij het online casino met hoge odds</span></p>
    </div>
  </main></body></html>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'unparsed');
  assert.equal(result.reason, 'content_not_menu_suspected');
  assert.deepEqual(result.sections, []);
  assert.equal(result.stats.counted, 0);
  assert.ok(Array.isArray(result.stats.contentSuspicion.signals));
  assert.ok(result.stats.contentSuspicion.signals.includes('casino'));
});

test('a printed menu with plain NAME + price lines and a description line is read, with a locator', () => {
  const html = `<h2>Diner</h2>
    <div class="et_pb_text_inner">
      <p><span><br>NOORDZEE KRAB 25<br></span><span>Jamaicaanse peper, coulis van krab</span></p>
      <p>&nbsp;</p>
      <p><span>KINGFISH 28<br></span><span>Crème van bokking, passievrucht</span></p>
      <p>&nbsp;</p>
      <p><span>RUNDERHAAS 38<br></span><span>Truffelstoof, cantharel, doperwt</span></p>
    </div>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result).map((item) => [item.name, item.amountMinorUnits]), [
    ['NOORDZEE KRAB', 2500],
    ['KINGFISH', 2800],
    ['RUNDERHAAS', 3800],
  ]);
  for (const item of items(result)) {
    assert.ok(item.evidence.locator.includes('p['), item.evidence.locator);
    assert.ok(item.evidence.quote.includes(String(item.amountMinorUnits / 100)), item.evidence.quote);
  }
});

test('a bold title that ends in its own price is a dish, not an ambiguous block', () => {
  const html = `<h2>Koude voorgerechten</h2>
    <p><strong>Stokbroodje kruidenboter, €6,00 <span>V</span></strong><br>Warm brood met huisgemaakte kruidenboter</p>
    <p><strong>Salata Maghreb, €8,00 <span>V</span></strong><br>Een frisse Marokkaanse salade</p>
    <p><strong>Salata Arabia, €9,00 <span>V</span></strong><br>Een zoete salade met feta en dadels</p>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result).map((item) => [item.name, item.amountMinorUnits]), [
    ['Stokbroodje kruidenboter', 600],
    ['Salata Maghreb', 800],
    ['Salata Arabia', 900],
  ]);
});

test('a run of bare priced names without any description stays refused', () => {
  const html = '<h2>Lunch</h2><p>Fictieve soep 7<br>Fictieve salade 13<br>Fictief broodje 8</p>';
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'unparsed');
});

test('a description line with a bare non-price number never replaces the dish price', () => {
  const html = `<h2>Lunch</h2>
    <p><strong>Fictieve soep, €7,50</strong><br>sinds 1998, elke dag vers</p>
    <p><strong>Fictieve salade, €9,50</strong><br>met brood</p>
    <p><strong>Fictief broodje, €6,00</strong><br>met kaas</p>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result).map((item) => [item.name, item.amountMinorUnits]), [
    ['Fictieve soep', 750],
    ['Fictieve salade', 950],
    ['Fictief broodje', 600],
  ]);
});

test('spamSignals is a generic vocabulary, never a domain match', () => {
  assert.deepEqual([...spamSignals('Bezoek Unibet casino')].sort(), ['casino', 'unibet']);
  assert.equal(spamSignals('Fictieve vis met citroen').size, 0);
  assert.equal(spamSignals('Onze zondagse lunch').size, 0);
});
