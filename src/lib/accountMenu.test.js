'use strict';

// BE-59 (#146) — regressies op de pure beslissingen achter het accountmenu:
// initialen, de menu-items per rol, de stip, en de goedkope sessiecontrole.
// Zelfde conventie als src/lib/internalNav.test.js: node --test op de pure
// CommonJS-module, geen DOM.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  hasSupabaseSessionKey,
  initialsFrom,
  resolveAccountName,
  accountAriaLabel,
  resolveRoleDescription,
  resolveRoleDescriptions,
  shouldShowDot,
  openWorkTotal,
  isInternalPath,
  resolveAccountMenuItems,
} = require('./accountMenu');

function storageWith(keys) {
  return {
    length: keys.length,
    key: (index) => (index >= 0 && index < keys.length ? keys[index] : null),
  };
}

test('initialen uit een naam: eerste letters van de eerste twee woorden', () => {
  assert.equal(initialsFrom('Jan Jansen'), 'JJ');
  assert.equal(initialsFrom('  jan   jansen '), 'JJ');
  assert.equal(initialsFrom('Jan'), 'J');
  assert.equal(initialsFrom('Jan van der Berg'), 'JV');
  assert.equal(initialsFrom('Sanne de Vries'), 'SD');
});

test('initialen uit een e-mailadres: het deel vóór de @, zonder altijd dezelfde letter', () => {
  assert.equal(initialsFrom('jan.jansen@restaurant.nl'), 'JJ');
  assert.equal(initialsFrom('jan_jansen@restaurant.nl'), 'JJ');
  assert.equal(initialsFrom('jan+jansen@restaurant.nl'), 'JJ');
  assert.equal(initialsFrom('info@restaurant.nl'), 'I');
  assert.equal(initialsFrom('Jansen@restaurant.nl'), 'J');
});

test('initialen: accenten en ontbrekende invoer leveren nooit een lege avatar', () => {
  assert.equal(initialsFrom('Renée Çelik'), 'RC');
  assert.equal(initialsFrom(''), '?');
  assert.equal(initialsFrom('   '), '?');
  assert.equal(initialsFrom('@restaurant.nl'), '?');
  assert.equal(initialsFrom(null), '?');
  assert.equal(initialsFrom(undefined), '?');
  assert.equal(initialsFrom(42), '?');
});

test('de naam komt uit de sessiemetadata, met het e-mailadres als terugval', () => {
  assert.equal(resolveAccountName({ user_metadata: { full_name: 'Jan Jansen' }, email: 'jan@x.nl' }), 'Jan Jansen');
  assert.equal(resolveAccountName({ user_metadata: { name: 'Jan' } }), 'Jan');
  assert.equal(resolveAccountName({ user_metadata: {}, email: 'jan@x.nl' }), 'jan@x.nl');
  assert.equal(resolveAccountName(null), 'Account');
});

test('de rol in gewone woorden: Beheerder, Redacteur en Restauranthouder van [naam]', () => {
  assert.equal(resolveRoleDescription([{ role: 'internal', restaurant_id: null }]), 'Beheerder');
  assert.equal(resolveRoleDescription([{ role: 'editor' }]), 'Redacteur');
  assert.equal(
    resolveRoleDescription([{ role: 'owner', restaurant_id: 'r1', restaurant_name: 'Smelt' }]),
    'Restauranthouder van Smelt',
  );
  assert.deepEqual(resolveRoleDescription([]), '');
  assert.deepEqual(resolveRoleDescription([{ role: 'onbekend' }]), '');
  assert.deepEqual(resolveRoleDescription(null), '');
});

test('de rol in gewone woorden: meerdere rollen met " · " ertussen, in vaste volgorde', () => {
  const description = resolveRoleDescription([
    { role: 'owner', restaurant_id: 'r1', restaurant_name: 'Smelt' },
    { role: 'internal' },
    { role: 'editor' },
  ]);
  assert.equal(description, 'Beheerder · Redacteur · Restauranthouder van Smelt');
  assert.deepEqual(resolveRoleDescriptions([{ role: 'internal' }, { role: 'editor' }]), ['Beheerder', 'Redacteur']);
});

test('de rol in gewone woorden: één, twee of meer restaurants', () => {
  const owner = (names) =>
    names.map((name, index) => ({ role: 'owner', restaurant_id: `r${index}`, restaurant_name: name }));

  assert.equal(resolveRoleDescription(owner(['Smelt'])), 'Restauranthouder van Smelt');
  assert.equal(
    resolveRoleDescription(owner(['Smelt', 'De Bruine Boon'])),
    'Restauranthouder van Smelt en De Bruine Boon',
  );
  assert.equal(
    resolveRoleDescription(owner(['Smelt', 'De Bruine Boon', 'Het Zusje'])),
    'Restauranthouder van 3 restaurants',
  );
  assert.equal(
    resolveRoleDescription(owner(['Smelt', 'Smelt'])),
    'Restauranthouder van Smelt',
    'hetzelfde restaurant twee keer is nog steeds één',
  );
  assert.equal(
    resolveRoleDescription([{ role: 'owner', restaurant_id: 'onbekend' }]),
    'Restauranthouder',
    'zonder bekende naam geen verzonnen plaats',
  );
});

test('de rolbeschrijving bevat nooit een technische rolnaam', () => {
  const outputs = [
    resolveRoleDescription([{ role: 'internal' }]),
    resolveRoleDescription([{ role: 'editor' }]),
    resolveRoleDescription([{ role: 'owner', restaurant_id: 'r1', restaurant_name: 'Smelt' }]),
    resolveRoleDescription([{ role: 'internal' }, { role: 'editor' }, { role: 'owner' }]),
  ];
  for (const output of outputs) {
    assert.doesNotMatch(output, /\b(internal|editor|owner|staff_role|restaurant_id)\b/, output);
  }
});

test('de stip: alleen internal of editor, en alleen bij een echt aantal groter dan 0', () => {
  const internal = [{ role: 'internal' }];
  const editor = [{ role: 'editor' }];
  const owner = [{ role: 'owner' }];

  assert.equal(shouldShowDot(internal, 3), true);
  assert.equal(shouldShowDot(editor, 1), true);
  assert.equal(shouldShowDot([{ role: 'internal' }, { role: 'editor' }], 7), true);

  assert.equal(shouldShowDot(internal, 0), false, 'n = 0 is geen stip');
  assert.equal(shouldShowDot(owner, 5), false, 'een houder ziet nooit een stip');
  assert.equal(shouldShowDot(owner, 0), false);
  assert.equal(shouldShowDot(internal, null), false, 'onbekend aantal is geen stip');
  assert.equal(shouldShowDot(internal, undefined), false);
  assert.equal(shouldShowDot(internal, '3'), false);
  assert.equal(shouldShowDot([], 3), false);
});

test('het menu bevat per rol precies wat er bij die rol hoort', () => {
  const ids = (roles, pathname = '/') =>
    resolveAccountMenuItems({ roles, pathname }).map((item) => item.id);

  assert.deepEqual(ids([{ role: 'internal' }]), ['beheer', 'mijn-lijstje', 'uitloggen']);
  assert.deepEqual(ids([{ role: 'editor' }]), ['beheer', 'mijn-lijstje', 'uitloggen']);
  assert.deepEqual(ids([{ role: 'owner' }]), ['mijn-restaurant', 'mijn-lijstje', 'uitloggen']);
  assert.deepEqual(
    ids([{ role: 'internal' }, { role: 'owner' }]),
    ['beheer', 'mijn-restaurant', 'mijn-lijstje', 'uitloggen'],
  );
  assert.deepEqual(ids([]), ['mijn-lijstje', 'uitloggen']);
});

test('"Bekijk de site" staat er alleen op interne pagina\'s', () => {
  const internal = [{ role: 'internal' }];
  const ids = (pathname) => resolveAccountMenuItems({ roles: internal, pathname }).map((item) => item.id);

  assert.deepEqual(ids('/internal/coverage'), ['beheer', 'mijn-lijstje', 'bekijk-de-site', 'uitloggen']);
  assert.deepEqual(ids('/internal'), ['beheer', 'mijn-lijstje', 'bekijk-de-site', 'uitloggen']);
  assert.deepEqual(ids('/'), ['beheer', 'mijn-lijstje', 'uitloggen']);
  assert.deepEqual(ids('/search'), ['beheer', 'mijn-lijstje', 'uitloggen']);
  assert.deepEqual(ids('/mijn-restaurant'), ['beheer', 'mijn-lijstje', 'uitloggen']);
  assert.deepEqual(ids('/internals'), ['beheer', 'mijn-lijstje', 'uitloggen'], 'geen prefix-truc');
});

test('de labels en bestemmingen zijn exact die van het contract', () => {
  const items = resolveAccountMenuItems({ roles: [{ role: 'internal' }, { role: 'owner' }], pathname: '/internal' });
  assert.deepEqual(
    items.map((item) => [item.label, item.href]),
    [
      ['Beheer', '/internal'],
      ['Mijn restaurant', '/mijn-restaurant'],
      ['Mijn lijstje', '/mijn-lijstje'],
      ['Bekijk de site', '/'],
      ['Uitloggen', null],
    ],
  );
});

test('isInternalPath herkent alleen /internal en zijn subpaden', () => {
  assert.equal(isInternalPath('/internal'), true);
  assert.equal(isInternalPath('/internal/coverage'), true);
  assert.equal(isInternalPath('/internals'), false);
  assert.equal(isInternalPath('/'), false);
  assert.equal(isInternalPath(undefined), false);
});

test('de sessiecontrole is goedkoop en gooit nooit', () => {
  assert.equal(hasSupabaseSessionKey(storageWith(['bredaeats_theme', 'sb-abcdefgh-auth-token'])), true);
  assert.equal(hasSupabaseSessionKey(storageWith(['sb-abcdefgh-auth-token.0', 'sb-abcdefgh-auth-token.1'])), true);
  assert.equal(hasSupabaseSessionKey(storageWith(['bredaeats_theme', 'bredaeats_list'])), false);
  assert.equal(hasSupabaseSessionKey(storageWith([])), false);
  assert.equal(hasSupabaseSessionKey(storageWith(['sb--auth-token'])), false, 'geen projectref, geen sessie');
  assert.equal(hasSupabaseSessionKey(storageWith(['auth-token'])), false);
  assert.equal(hasSupabaseSessionKey(null), false);
  assert.equal(hasSupabaseSessionKey(undefined), false);
  assert.equal(hasSupabaseSessionKey({}), false);

  // Opslag die weigert (Safari privé, geblokkeerde cookies): gewoon "geen sessie".
  const throwing = {
    get length() {
      throw new Error('blocked');
    },
    key() {
      throw new Error('blocked');
    },
  };
  assert.equal(hasSupabaseSessionKey(throwing), false);
});

test('het open-werk-totaal: de som van de al rolgefilterde countingen, anders onbekend', () => {
  assert.equal(openWorkTotal({ 'menu-concepts': 2, 'source-triage': 0, 'import-inbox': 3 }), 5);
  assert.equal(openWorkTotal({ moderation: 0 }), 0);
  assert.equal(openWorkTotal({ 'menu-concepts': 1, 'source-triage': null }), null, 'nooit een halve som');
  assert.equal(openWorkTotal({ 'menu-concepts': '1' }), null);
  assert.equal(openWorkTotal({}), null);
  assert.equal(openWorkTotal(null), null);
});

test('het knoplabel voor schermlezers noemt de naam en het aantal open taken', () => {
  assert.equal(accountAriaLabel('Jan Jansen', null), 'Account van Jan Jansen');
  assert.equal(accountAriaLabel('Jan Jansen', 0), 'Account van Jan Jansen');
  assert.equal(accountAriaLabel('Jan Jansen', 1), 'Account van Jan Jansen, 1 openstaande taak');
  assert.equal(accountAriaLabel('Jan Jansen', 4), 'Account van Jan Jansen, 4 openstaande taken');
  assert.equal(accountAriaLabel('', 4), 'Account van Account, 4 openstaande taken');
});
