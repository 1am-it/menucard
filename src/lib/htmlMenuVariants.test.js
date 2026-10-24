'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractHtmlMenuStructure } = require('./htmlMenuStructure');

const panel = (id, label, body) => `
  <div class="menucard__item">
    <div class="menucard__header" role="button" aria-expanded="false" data-target="[san-id='${id}']">
      <span class="menucard__title">${label}</span>
    </div>
    <div class="menucard__panel" san-id="${id}">${body}</div>
  </div>`;

const html = `<html><body>
  <div class="cookie">
    <button role="button" aria-expanded="false" data-target="#cookie-panel">Cookie-instellingen</button>
    <div id="cookie-panel"><p>Wij gebruiken cookies<br>Functioneel en analytisch</p></div>
  </div>
  <h1>FICTIEVE SEIZOENSKAART</h1>
  <div class="menucard">
    ${panel('panel-1', 'BITES', `
      <div class="menucard__column"><h3>BITES</h3><ul>
        <li>Fictieve olijven <strong>4.5</strong></li>
        <li>Fictieve noten <strong>3.0</strong></li>
        <li>Fictieve kroepoek <strong>5.5</strong></li>
      </ul></div>
      <div class="menucard__column"><h3>BROOD</h3><ul>
        <li>Fictief focaccia <strong>8.0</strong></li>
        <li>Fictief desembrood <strong>6.5</strong></li>
      </ul></div>`)}
    ${panel('panel-2', 'DINNER', `
      <div class="menucard__column"><h3>VOOR</h3><p>
        Fictieve soep <strong>9.5</strong><br>
        Fictieve salade <strong>11.0</strong><br>
        Fictieve carpaccio <strong>13.5</strong>
      </p></div>
      <div class="menucard__column"><h3>BLOSSEM-ACHTIG MENU</h3><p>3 gangen <strong>57</strong> | 4 gangen <strong>66</strong> | 5 gangen <strong>76</strong></p></div>`)}
    ${panel('panel-3', 'LUNCH', `
      <div class="menucard__column"><h3>VOOR</h3><p>
        Fictieve tosti <strong>7.5</strong><br>
        Fictieve omelet <strong>8.5</strong><br>
        Fictieve quiche <strong>9.0</strong>
      </p></div>`)}
  </div>
</body></html>`;

test('accordion panel labels are menu variants, not decoration', () => {
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  const paths = result.sections.map((section) => section.path);
  assert.deepEqual(paths, [
    ['FICTIEVE SEIZOENSKAART', 'BITES'],
    ['FICTIEVE SEIZOENSKAART', 'BITES', 'BROOD'],
    ['FICTIEVE SEIZOENSKAART', 'DINNER', 'VOOR'],
    ['FICTIEVE SEIZOENSKAART', 'LUNCH', 'VOOR'],
  ]);
  // The same category name in two variants stays two separate sections.
  const lunch = result.sections.find((section) => section.path[1] === 'LUNCH');
  assert.deepEqual(lunch.items.map((item) => item.name), ['Fictieve tosti', 'Fictieve omelet', 'Fictieve quiche']);
  // One-decimal prices in a list with a price-only tail are real prices.
  const bites = result.sections.find((section) => section.path[1] === 'BITES' && section.path.length === 2);
  assert.deepEqual(bites.items.map((item) => item.amountMinorUnits), [450, 300, 550]);
});

test('a cookie button without a controlled panel is never a heading', () => {
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.equal(result.sections.some((section) => section.path.includes('Cookie-instellingen')), false);
});

test('alternative menu prices are reported as excluded content, never flattened into a dish', () => {
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  const dinnerItems = result.sections.filter((section) => section.path[1] === 'DINNER').flatMap((section) => section.items.map((item) => item.name));
  assert.deepEqual(dinnerItems, ['Fictieve soep', 'Fictieve salade', 'Fictieve carpaccio']);
  assert.deepEqual(result.excludedSections, [
    { path: ['FICTIEVE SEIZOENSKAART', 'DINNER', 'BLOSSEM-ACHTIG MENU'], unpricedLines: 1, reason: 'alternative_prices' },
  ]);
});
