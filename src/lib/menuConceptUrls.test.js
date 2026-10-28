'use strict';

// BE-41 — the URL rule behind "Originele menukaart openen ↗" and
// "PR bekijken ↗": only http(s), and the small line under the button names the
// domain and what the reader gets. Fictional URLs only; no network is touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const { isHttpUrl, menuSourceLink, sourceKind } = require('./menuConceptUrls');

test('a real http(s) URL is the only thing that may be opened', () => {
  for (const url of ['https://bistro-fictief.example/menukaart', 'http://bistro-fictief.example', 'HTTPS://Bistro-Fictief.Example/menu']) {
    assert.equal(isHttpUrl(url), true, url);
    assert.notEqual(menuSourceLink(url), null, url);
  }
});

test('javascript:, data:, a bare path and an empty URL never get a button', () => {
  const refused = [
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,<h1>fictief</h1>',
    'ftp://bistro-fictief.example/menu',
    '//bistro-fictief.example/menu',
    '/internal/menu-concepts',
    'bistro-fictief.example/menu',
    '',
    '   ',
    null,
    undefined,
    42,
  ];
  for (const url of refused) {
    assert.equal(isHttpUrl(url), false, String(url));
    assert.equal(menuSourceLink(url), null, String(url));
  }
});

test('an http(s) URL without a host is refused instead of guessed', () => {
  for (const url of ['https://', 'http://', 'https:///pad']) {
    assert.equal(isHttpUrl(url), false, url);
    assert.equal(menuSourceLink(url), null, url);
  }
});

test('the small line names the domain and what the reader gets: webpagina', () => {
  const link = menuSourceLink('https://www.bistro-fictief.example/menukaart?taal=nl#lunch');
  assert.equal(link.href, 'https://www.bistro-fictief.example/menukaart?taal=nl#lunch');
  assert.equal(link.domain, 'bistro-fictief.example');
  assert.equal(link.kind, 'webpagina');
  assert.equal(link.note, 'Opent in een nieuw tabblad · bistro-fictief.example · webpagina');
});

test('a pdf and an image are named as such, whatever the query string says', () => {
  assert.equal(menuSourceLink('https://bistro-fictief.example/menu/menukaart.pdf').kind, 'pdf');
  assert.equal(menuSourceLink('https://bistro-fictief.example/MENUKAART.PDF?versie=2').kind, 'pdf');
  assert.equal(menuSourceLink('https://bistro-fictief.example/menu/kaart.JPG?w=800').kind, 'afbeelding');
  assert.equal(menuSourceLink('https://bistro-fictief.example/fotos/kaart.webp').kind, 'afbeelding');
  assert.equal(
    menuSourceLink('https://bistro-fictief.example/menu/menukaart.pdf').note,
    'Opent in een nieuw tabblad · bistro-fictief.example · pdf',
  );
  assert.equal(
    menuSourceLink('https://bistro-fictief.example/fotos/kaart.png').note,
    'Opent in een nieuw tabblad · bistro-fictief.example · afbeelding',
  );
});

test('a page whose folder ends in .pdf is still a web page, not a pdf', () => {
  // Only the last path segment counts; otherwise a folder name would decide.
  assert.equal(sourceKind('/menukaart.pdf/lunch'), 'webpagina');
  assert.equal(sourceKind('/menukaart.pdf'), 'pdf');
  assert.equal(sourceKind('/lunch'), 'webpagina');
  assert.equal(sourceKind(''), 'webpagina');
});

test('the note and the domain carry no markup or scheme of their own', () => {
  const link = menuSourceLink('https://www.bistro-fictief.example:8443/menukaart');
  assert.equal(link.domain, 'bistro-fictief.example');
  assert.equal(link.note.startsWith('Opent in een nieuw tabblad · '), true);
  assert.equal(/[<>]/.test(link.note), false);
});
