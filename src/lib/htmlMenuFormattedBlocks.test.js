'use strict';

// formatted_block — repeated dish blocks in a p/div: a bold title anchor,
// an optional description over one or more lines, and one plain-text end
// price. Fictional local HTML only; no website is fetched.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHtmlMenuStructure } = require('./htmlMenuStructure');
const { validateMenuExtraction } = require('./menuExtractionContract');

function items(result) {
  return result.sections.flatMap((s) => s.items.map((i) => [s.path.join(' / '), i.name, i.description, i.amountMinorUnits, i.currency, i.evidence.pattern]));
}
function rejected(result) {
  return result.rejected.map((r) => r.reason);
}

test('title, description and end price on the same line, several blocks in one paragraph', () => {
  const html = `<h1>Fictief Eetcafé</h1><h2>Lunch</h2>
    <p><strong>Fictieve tomatensoep</strong> basilicum, room 7,50<br>
       <strong>Fictief broodje kroket</strong> twee kroketten, mosterd € 9,50<br>
       <strong>Fictieve salade</strong> geitenkaas, honing, walnoot 14,50</p>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(validateMenuExtraction(result), []);
  assert.deepEqual(items(result), [
    ['Fictief Eetcafé / Lunch', 'Fictieve tomatensoep', 'basilicum, room', 750, null, 'formatted_block'],
    ['Fictief Eetcafé / Lunch', 'Fictief broodje kroket', 'twee kroketten, mosterd', 950, 'EUR', 'formatted_block'],
    ['Fictief Eetcafé / Lunch', 'Fictieve salade', 'geitenkaas, honing, walnoot', 1450, null, 'formatted_block'],
  ]);
});

test('title, description and price on separate <br> lines; a bare whole number is the end price only inside such a block', () => {
  const html = `<h2>Diner</h2>
    <div><b>Fictieve runderstoof</b><br>langzaam gegaard<br>met seizoensgroenten<br>25<br><br>
         <b>Fictieve zeebaars</b><br>beurre blanc<br>27,50<br><br>
         <b>Fictieve risotto</b><br>paddenstoelen, parmezaan<br>19</div>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result), [
    ['Diner', 'Fictieve runderstoof', 'langzaam gegaard met seizoensgroenten', 2500, null, 'formatted_block'],
    ['Diner', 'Fictieve zeebaars', 'beurre blanc', 2750, null, 'formatted_block'],
    ['Diner', 'Fictieve risotto', 'paddenstoelen, parmezaan', 1900, null, 'formatted_block'],
  ]);
});

test('one block per paragraph counts when its run of sibling paragraphs repeats the structure', () => {
  const html = `<h2>Kerstmenu</h2>
    <p><strong>Fictief voorgerecht</strong><br>gerookte zalm<br>12,50</p>
    <p><strong>Fictief hoofdgerecht</strong><br>hertenstoof<br>28</p>
    <p><strong>Fictief nagerecht</strong><br>chocolade<br>9,50</p>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result).map((i) => [i[1], i[3]]), [['Fictief voorgerecht', 1250], ['Fictief hoofdgerecht', 2800], ['Fictief nagerecht', 950]]);
});

test('several prices, a price range, a supplement, an arrangement, a time and a price that is not at the end are rejected, never read as dishes', () => {
  const html = `<h2>Lunch</h2>
    <p><strong>Fictieve soep</strong> pompoen 7,50<br>
       <strong>Fictieve wijn</strong> glas 5,50 fles 27,50<br>
       <strong>Fictieve pizza</strong> klein of groot 12 / 16<br>
       <strong>Fictieve friet</strong><br>+ mayonaise 1,50<br>4,50<br>
       <strong>Fictief lunchmenu</strong> 3-gangen arrangement 45<br>
       <strong>Fictieve keuken</strong> open tot 22<br>
       <strong>Fictieve taart</strong> 6,50 per punt met room<br>
       <strong>Fictieve salade</strong> geitenkaas 13,50<br>
       <strong>Fictief broodje</strong> oude kaas 8,50</p>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result).map((i) => i[1]), ['Fictieve soep', 'Fictieve salade', 'Fictief broodje']);
  assert.deepEqual(rejected(result).sort(), ['ambiguous_structure', 'ambiguous_structure', 'ambiguous_structure', 'clock_time', 'modifier', 'service_unit'].sort());
});

test('opening hours, reservations and events under their own heading never become dishes', () => {
  const html = `<h2>Openingstijden</h2>
    <p><strong>Maandag</strong> gesloten<br><strong>Dinsdag</strong> 12.00 - 22.00<br><strong>Woensdag</strong> 12.00 - 22.00</p>
    <h2>Reserveren</h2>
    <p><strong>Groepen</strong> vanaf 8 personen 25<br><strong>Feesten</strong> op aanvraag 30</p>
    <h2>Menu</h2>
    <p><strong>Fictieve soep</strong> 7,50<br><strong>Fictieve salade</strong> 13,50<br><strong>Fictief broodje</strong> 8,50</p>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result).map((i) => [i[0], i[1]]), [['Menu', 'Fictieve soep'], ['Menu', 'Fictieve salade'], ['Menu', 'Fictief broodje']]);
  assert.ok(rejected(result).every((r) => r === 'non_menu_section' || r === 'clock_time'), JSON.stringify(rejected(result)));
});

test('fail closed: no heading, a single block, a loose number before the first title, or no bold title is not a dish list', () => {
  const noHeading = `<p><strong>Fictieve soep</strong> 7,50<br><strong>Fictieve salade</strong> 13,50<br><strong>Fictief broodje</strong> 8,50</p>`;
  assert.equal(extractHtmlMenuStructure(noHeading).status, 'unparsed');
  const single = `<h2>Lunch</h2><p><strong>Fictieve soep</strong> 7,50</p><p>Welkom in ons fictieve restaurant sinds 1998.</p>`;
  assert.equal(extractHtmlMenuStructure(single).status, 'unparsed');
  const looseNumber = `<h2>Lunch</h2><p>2025<br><strong>Fictieve soep</strong> 7,50<br><strong>Fictieve salade</strong> 13,50<br><strong>Fictief broodje</strong> 8,50</p>`;
  assert.equal(extractHtmlMenuStructure(looseNumber).status, 'unparsed');
  const noTitle = `<h2>Lunch</h2><p>Fictieve soep 7<br>Fictieve salade 13<br>Fictief broodje 8</p>`;
  assert.equal(extractHtmlMenuStructure(noTitle).status, 'unparsed');
  const quantities = `<h2>Lunch</h2><p><strong>Fictieve bitterballen</strong> 8 stuks<br><strong>Fictieve nachos</strong> 2 personen<br><strong>Fictief bier</strong> 33 cl</p>`;
  assert.equal(extractHtmlMenuStructure(quantities).status, 'unparsed');
});

test('the existing line_break_list keeps precedence for a price in its own inline element', () => {
  const html = `<h2>Koud</h2><p>Fictieve salade <strong>14,50</strong><br>Fictief tartaar <strong>16,50</strong><br>Fictieve carpaccio <strong>13</strong></p>`;
  const result = extractHtmlMenuStructure(html);
  assert.deepEqual(items(result).map((i) => i[5]), ['line_break_list', 'line_break_list', 'line_break_list']);
});

test('the sibling run is strictly contiguous: one block under a heading never borrows blocks from under the next heading', () => {
  const html = `<div>
    <h2>Special</h2>
    <p><strong>Fictieve weekspecial</strong><br>verrassing van de chef<br>24</p>
    <h2>Lunch</h2>
    <p><strong>Fictieve soep</strong><br>pompoen<br>7,50</p>
    <p><strong>Fictieve salade</strong><br>geitenkaas<br>13,50</p>
    <p><strong>Fictief broodje</strong><br>oude kaas<br>8,50</p>
  </div>`;
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.deepEqual(items(result).map((i) => [i[0], i[1]]), [['Lunch', 'Fictieve soep'], ['Lunch', 'Fictieve salade'], ['Lunch', 'Fictief broodje']]);
});

test('a contiguous run of single-block sibling paragraphs under one heading is recognised', () => {
  const html = `<section><h2>Diner</h2>
    <p><strong>Fictieve runderstoof</strong><br>25</p>
    <p><strong>Fictieve zeebaars</strong><br>27,50</p>
    <p><strong>Fictieve risotto</strong><br>19</p></section>`;
  const result = extractHtmlMenuStructure(html);
  assert.deepEqual(items(result).map((i) => [i[1], i[3]]), [['Fictieve runderstoof', 2500], ['Fictieve zeebaars', 2750], ['Fictieve risotto', 1900]]);
});

test('an ordinary paragraph or another element between single blocks ends the run', () => {
  const plainParagraph = `<section><h2>Lunch</h2>
    <p><strong>Fictieve soep</strong><br>7,50</p>
    <p>Alle gerechten worden vers bereid.</p>
    <p><strong>Fictieve salade</strong><br>13,50</p>
    <p>Vraag naar onze dagspecial.</p>
    <p><strong>Fictief broodje</strong><br>8,50</p></section>`;
  assert.equal(extractHtmlMenuStructure(plainParagraph).status, 'unparsed');
  const otherElement = `<section><h2>Lunch</h2>
    <p><strong>Fictieve soep</strong><br>7,50</p>
    <hr>
    <p><strong>Fictieve salade</strong><br>13,50</p>
    <img src="/fictief.png" alt="">
    <p><strong>Fictief broodje</strong><br>8,50</p></section>`;
  assert.equal(extractHtmlMenuStructure(otherElement).status, 'unparsed');
});
