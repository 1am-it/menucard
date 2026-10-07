// Kleurtaal v2 — today's opening status for the public restaurant and menu
// pages, as a pure function of the opening hours and an explicit `now`.
// Deliberately CommonJS, like internalNav.js/statusRoles.js: directly
// testable via `node --test` with a fixed moment, importable from the
// 'use client' views.
//
// Same rule as the existing isCurrentlyOpen()/getOpenStatus() helpers in
// app/restaurants/page.js, src/services/dishSearch.js and
// src/services/restaurantIndex.js — the browser's local time, today's
// "HH:MM-HH:MM" entry, open from the opening minute up to (not including)
// the closing minute, no overnight windows. No new time-zone or planning
// logic. Only `open` is a positive status ("Nu open"); having opening
// hours today is not.

'use strict';

const DAY_KEYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

function toMinutes(str) {
  const [h, m] = String(str).split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * @param {Record<string,string>|undefined|null} openingHours  e.g. { wo: '12:00-23:00' }
 * @param {Date} now
 * @returns {{ state: 'open'|'later'|'closed-now'|'closed-today'|'unknown', hours: string|null, opens: string|null, closes: string|null }}
 *   open         — open at this moment
 *   later        — opens later today
 *   closed-now   — today's opening window has passed
 *   closed-today — no opening hours today
 *   unknown      — today's entry cannot be read as HH:MM-HH:MM
 */
function todayOpening(openingHours, now) {
  const hours = (openingHours && openingHours[DAY_KEYS[now.getDay()]]) || null;
  if (!hours) return { state: 'closed-today', hours: null, opens: null, closes: null };
  const [opens, closes] = hours.split('-');
  if (!opens || !closes || !/^\d{1,2}:\d{2}$/.test(opens.trim()) || !/^\d{1,2}:\d{2}$/.test(closes.trim())) {
    return { state: 'unknown', hours, opens: null, closes: null };
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const o = toMinutes(opens.trim());
  const c = toMinutes(closes.trim());
  let state = 'closed-now';
  if (nowMin >= o && nowMin < c) state = 'open';
  else if (nowMin < o) state = 'later';
  return { state, hours, opens: opens.trim(), closes: closes.trim() };
}

/**
 * Badge for today's opening status. Before the browser's clock is known
 * (server render, first paint) `opening` is null and the badge is a
 * neutral "today's hours" line — never a positive status.
 * @returns {{ role: 'positive'|'neutral', icon: 'check'|'clock', text: string }}
 */
function openingBadge(opening, openingHours, todayKey) {
  if (!opening) {
    const hours = openingHours && openingHours[todayKey];
    return { role: 'neutral', icon: 'clock', text: hours ? `Vandaag ${hours}` : 'Gesloten vandaag' };
  }
  switch (opening.state) {
    case 'open':
      return { role: 'positive', icon: 'check', text: `Nu open · tot ${opening.closes}` };
    case 'later':
      return { role: 'neutral', icon: 'clock', text: `Opent vandaag om ${opening.opens}` };
    case 'closed-now':
      return { role: 'neutral', icon: 'clock', text: `Nu gesloten · vandaag ${opening.hours}` };
    case 'unknown':
      return { role: 'neutral', icon: 'clock', text: `Vandaag ${opening.hours}` };
    default:
      return { role: 'neutral', icon: 'clock', text: 'Gesloten vandaag' };
  }
}

module.exports = { DAY_KEYS, todayOpening, openingBadge };
