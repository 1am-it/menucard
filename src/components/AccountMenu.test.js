'use strict';

// BE-59 (#146) — surface-/bronregressies voor het accountmenu zelf.
//
// Dezelfde conventie als PrimaryNav.test.js en MobileTabBar.test.js: dit
// project heeft geen rendered-DOM-harnas voor 'use client'-componenten, dus de
// test leest de bron en de CSS. Het echte beeld (licht/donker, 1280/390/320 px)
// hoort bij de browserchecks in deel 2.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const COMPONENT = 'src/components/AccountMenu.js';
const CSS = 'src/components/account-menu.css';

// Overal waar het menu in een kop staat: de publieke pagina's, Mijn restaurant
// en Intern (via de interne navigatie).
const MOUNTED_IN = [
  'app/HomeView.js',
  'app/search/page.js',
  'app/alle-restaurants/page.js',
  'app/restaurant/[id]/RestaurantDetailView.js',
  'app/menu/[id]/MenuView.js',
  'app/mijn-lijstje/MijnLijstjeView.js',
  'app/mijn-restaurant/OwnerDashboard.js',
  'src/components/InternalNav.js',
];

test('het accountmenu is een client component met eigen CSS', () => {
  const source = read(COMPONENT);
  assert.match(source, /^'use client'/);
  assert.match(source, /^import '\.\/account-menu\.css'$/m, 'eigen CSS-bestand naast de component');
  assert.ok(fs.existsSync(path.join(ROOT, CSS)));
});

test('gasten laden geen Supabase-code: pas na de sessiecontrole, en alleen dynamisch', () => {
  const source = read(COMPONENT);
  const importBlock = source.slice(0, source.indexOf("import './account-menu.css'"));
  assert.match(importBlock, /hasSupabaseSessionKey,/);
  assert.match(source, /const \{ getSupabaseBrowser \} = await import\('@\/src\/lib\/supabaseBrowser'\)/);
  assert.doesNotMatch(
    source,
    /^import .*supabaseBrowser/m,
    'de Supabase-client mag alleen met een dynamische import() komen, nooit in de eerste lading',
  );
});

test('de goedkope sessiecontrole staat vóór de dure import en vóór elk verzoek', () => {
  const source = read(COMPONENT);
  const check = source.indexOf('if (!hasSupabaseSessionKey(storage)) return');
  const dynamicImport = source.indexOf("await import('@/src/lib/supabaseBrowser')");
  const meCall = source.indexOf('const res = await fetch(ME_API');
  assert.ok(check > 0 && dynamicImport > check, 'de controle staat vóór de dynamische import');
  assert.ok(meCall > dynamicImport, 'geen rollenverzoek zonder client en sessie');
});

test('de avatar is 44 px, heeft een stip en een schermlezerlabel met de naam', () => {
  const source = read(COMPONENT);
  const css = read(CSS);
  assert.match(css, /\.account-menu-trigger \{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(source, /className="account-menu-avatar"/);
  assert.match(source, /\{initialsFrom\(account\.name\)\}/);
  assert.match(source, /\{dot && <span className="account-menu-dot" aria-hidden="true" \/>\}/);
  assert.match(source, /aria-label=\{accountAriaLabel\(account\.name, dot \? workCount : null\)\}/);
  assert.match(source, /aria-expanded=\{open\}/);
});

test('bovenin het menu staan de rollen in gewone woorden, nooit de technische namen', () => {
  const source = read(COMPONENT);
  assert.match(source, /const roleDescription = resolveRoleDescription\(account\.roles\)/);
  assert.match(source, /roleDescription\.length > 0 && <p className="account-menu-roles">\{roleDescription\}<\/p>/);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /'Intern'|'Editor'|'Houder'/, 'geen korte, technische rolaanduidingen in het menu');
});


test('de stip komt uit de helpers: alleen internal/editor met n > 0, en geen nep-getal', () => {
  const source = read(COMPONENT);
  assert.match(source, /const workCount = hasWorkRoles\(account\.roles\) \? count : null/);
  assert.match(source, /const dot = shouldShowDot\(account\.roles, workCount\)/);
  assert.match(source, /setCount\(res\.ok \? openWorkTotal\(body\.counts\) : null\)/);
  assert.match(source, /cache: 'no-store'/);
});


test('desktop: Escape sluit en zet de focus terug; de pijltoetsen verplaatsen de focus', () => {
  const source = read(COMPONENT);
  assert.match(source, /if \(event\.key !== 'Escape'\) return/);
  assert.match(source, /setOpen\(false\)\s*\n\s*if \(triggerRef\.current\) triggerRef\.current\.focus\(\)/);
  assert.match(source, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]\.includes\(event\.key\)/);
  assert.match(source, /next = index < 0 \? 0 : \(index \+ 1\) % focusable\.length/, 'ArrowDown gaat rond');
  assert.match(source, /next = index <= 0 \? focusable\.length - 1 : index - 1/, 'ArrowUp gaat rond');
});

test('elk menu-item is een tikdoel van 44 px', () => {
  // BE-59 deel 3 (#146): de a11y-audit van de publieke pagina's eist 44 px (of
  // 24 px met genoeg ruimte); de rijen staan 2 px van elkaar, dus 44 px.
  const css = read(CSS);
  assert.match(css, /\.account-menu-item \{[^}]*min-height: 44px;/);
});

test('het paneel van onderen hangt aan het venster, niet aan de kop', () => {
  // BE-59 deel 3 (#146): de kop heeft `backdrop-filter`, en dat maakt de kop het
  // referentiekader voor `position: fixed`. Zonder portal kwam het paneel boven
  // in beeld in plaats van van onderen (gevonden door de browsercheck).
  const source = read(COMPONENT);
  assert.match(source, /import \{ createPortal \} from 'react-dom'/);
  assert.match(source, /narrow && typeof document !== 'undefined' \? createPortal\(sheet, document\.body\) : panel/);
  assert.match(source, /const inPanel = panelRef\.current && panelRef\.current\.contains\(event\.target\)/);
});

test('het paneel van onderen ligt boven de vaste tabbalk, met een dekkende overlay', () => {
  // BE-59 herstel (#146, Lead-review #6537034100): in
  // be59-beheerder-home-390-light-menu.png lag de vaste MobileTabBar over het
  // paneel, waardoor "Uitloggen" niet te zien en niet aan te tikken was.
  // Daarom vergelijkt deze test de echte z-index-waarden uit beide bronnen in
  // plaats van een vaste waarde te herhalen.
  const globals = read('app/globals.css');
  const css = read(CSS);
  const source = read(COMPONENT);

  const tabbar = globals.match(/\.mobile-tabbar \{[^}]*z-index: (\d+);/);
  assert.ok(tabbar, '.mobile-tabbar heeft een z-index in app/globals.css');
  const tabbarZ = Number(tabbar[1]);

  const overlay = css.match(/\.account-menu-overlay \{[^}]*z-index: (\d+);/);
  const sheet = css.match(/\.account-menu-panel--sheet \{[^}]*z-index: (\d+);/);
  assert.ok(overlay, '.account-menu-overlay heeft een eigen z-index');
  assert.ok(sheet, '.account-menu-panel--sheet heeft een eigen z-index');
  const overlayZ = Number(overlay[1]);
  const sheetZ = Number(sheet[1]);

  assert.ok(overlayZ > tabbarZ, `de overlay (${overlayZ}) dekt de tabbalk (${tabbarZ})`);
  assert.ok(sheetZ > overlayZ, `het paneel (${sheetZ}) ligt boven zijn overlay (${overlayZ})`);

  // De overlay dekt het hele venster, zodat er niet door de tabbalk heen te
  // klikken valt, en is puur decoratief voor schermlezers.
  assert.match(css, /\.account-menu-overlay \{[^}]*position: fixed;[^}]*inset: 0;/);
  assert.match(css, /\.account-menu-overlay \{[^}]*background: var\(--shadow-tint-md\);/);
  assert.match(source, /<div className="account-menu-overlay" data-account-menu-overlay="" aria-hidden="true" \/>/);
  // De overlay gaat mee door de portal, anders blijft de kop met zijn
  // backdrop-filter het referentiekader en dekt hij het venster niet.
  assert.match(source, /const sheet = \(\s*<>\s*<div className="account-menu-overlay"[^>]*\/>\s*\{panel\}\s*<\/>\s*\)/);
});

test('mobiel: smaller dan 720 px hetzelfde menu als paneel van onderen, met sluitknop', () => {
  const source = read(COMPONENT);
  const css = read(CSS);
  assert.match(source, /const MOBILE_QUERY = '\(max-width: 719px\)'/);
  assert.match(source, /account-menu-panel--sheet/);
  assert.match(source, /className="account-menu-close"/);
  assert.match(css, /@media \(max-width: 719px\) \{[\s\S]*?\.account-menu-panel--sheet \{[^}]*position: fixed;[^}]*bottom: 0;/);
  assert.match(css, /\.account-menu-panel--sheet \.account-menu-item \{[^}]*min-height: 52px;/);
});

test('opmaak: alleen tokens, geen hardgekleurde waarden, geen CSS-module', () => {
  const css = read(CSS);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/, 'geen hex-waarden; gebruik de tokens');
  assert.doesNotMatch(rules, /\b(rgb|rgba|hsl|hsla)\(/, 'geen rgb()/hsl()-waarden; gebruik de tokens');
  assert.match(css, /background: var\(--button-primary-bg\)/);
  assert.match(css, /background: var\(--accent\)/);
  assert.doesNotMatch(CSS, /\.module\.css/);
});

test('geen nieuwe dependency, geen eigen inloglogica of TOTP', () => {
  const source = read(COMPONENT);
  const importLines = source.match(/^import .+$/gm) || [];
  assert.deepEqual(
    importLines.map((line) => line.trim()),
    [
      "import { useEffect, useRef, useState } from 'react'",
      "import { createPortal } from 'react-dom'",
      "import { usePathname, useRouter } from 'next/navigation'",
      'import {',
      "import './account-menu.css'",
    ],
    'alleen React, react-dom (bestaande dependency, voor het paneel), next/navigation, de pure helpers en de eigen CSS',
  );
  assert.match(source, /\} from '@\/src\/lib\/accountMenu'/);
  assert.doesNotMatch(source, /signInWith|verifyOtp|totp|mfa|enroll/i);
});

test('het menu staat in elke kop waar het contract hem vraagt, via de goedkope voordeur', () => {
  for (const file of MOUNTED_IN) {
    const source = read(file);
    assert.match(source, /import AccountMenuButton from '@\/src\/components\/AccountMenuButton'/, `${file} importeert de voordeur`);
    assert.match(source, /<AccountMenuButton \/>/, `${file} toont het menu`);
    assert.doesNotMatch(source, /import AccountMenu from/, `${file} laadt het menu zelf niet in de eerste lading`);
  }
});

test('de voordeur laadt het menu pas na de sessiecontrole, met een dynamische import', () => {
  const loader = read('src/components/AccountMenuButton.js');
  assert.match(loader, /^'use client'/);
  assert.match(loader, /import \{ hasSupabaseSessionKey \} from '@\/src\/lib\/accountSession'/);
  assert.match(loader, /if \(!hasSupabaseSessionKey\(storage\)\) return undefined/);
  assert.match(loader, /import\('\.\/AccountMenu'\)/);
  const imports = loader.match(/^import .+$/gm) || [];
  assert.deepEqual(
    imports.map((line) => line.trim()),
    [
      "import { useEffect, useState } from 'react'",
      "import { hasSupabaseSessionKey } from '@/src/lib/accountSession'",
    ],
    'de voordeur importeert alleen React en de goedkope sessiecontrole',
  );
  assert.doesNotMatch(loader, /supabaseBrowser|fetch\(/, 'geen client en geen verzoek in de eerste lading');
});

test('de interne navigatie toont "Bekijk de site" via het accountmenu, niet als eigen balk-item', () => {
  const nav = read('src/components/InternalNav.js');
  assert.match(nav, /<AccountMenuButton \/>/);
  const code = nav.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /Bekijk de site/, 'het interne balk-item blijft weg; die link hoort in het menu');
});
