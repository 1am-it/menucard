'use strict';

// Structural safety net for supabase/migrations/0015_be24_source_triage.sql
// (BE-24 Brontriage) — read from the file itself, like the existing
// migration tests. Not a substitute for applying it: the existing
// validate-migrations workflow replays every migration on an empty
// Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SQL = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations/0015_be24_source_triage.sql'), 'utf8');
const code = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('0015 has a unique migration number and is the only BE-24 migration', () => {
  const files = fs.readdirSync(path.join(REPO_ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => f.startsWith('0015')), ['0015_be24_source_triage.sql']);
  assert.equal(files.filter((f) => /be24/.test(f)).length, 1);
});

test('0015 only creates its own two tables and two functions — it never alters, updates or deletes from an existing table', () => {
  const created = [...code.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created, ['source_triage_proposals', 'source_triage_proposal_events']);
  const functions = [...code.matchAll(/create or replace function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(functions, ['create_source_triage_proposal', 'decide_source_triage_proposal']);
  for (const m of code.matchAll(/alter table (\w+)/g)) assert.match(m[1], /^source_triage_/);
  for (const m of code.matchAll(/\bupdate (\w+)\s+set/g)) assert.equal(m[1], 'source_triage_proposals');
  for (const m of code.matchAll(/insert into (\w+)/g)) assert.match(m[1], /^source_triage_/);
  assert.doesNotMatch(code, /\bdelete\b/i);
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /restaurant_source_analysis_jobs|url_intakes|restaurant_profile_drafts|menu_snapshot/);
});

test('0015 keeps proposals proposal-only: statuses, kinds and reasons are closed lists', () => {
  assert.match(code, /status\s+text not null default 'open' check \(status in \('open', 'accepted', 'rejected'\)\)/);
  assert.match(code, /kind\s+text not null check \(kind in \('add_candidate', 'replace_source', 'mark_unusable'\)\)/);
  assert.match(code, /unusable_reason in \('site_offline', 'other_business', 'no_menu_on_source', 'access_blocked', 'other'\)/);
});

test('0015 URL columns use the 0013 canonical shape: http(s), no query, fragment or whitespace, bounded', () => {
  for (const col of ['proposed_url', 'current_url']) {
    const re = new RegExp(`${col} is null\\s+or \\(char_length\\(${col}\\) <= 2048 and ${col} ~\\* '\\^https\\?://' and ${col} !~ '\\[\\?#\\[:space:\\]\\]'\\)`);
    assert.match(code, re, col);
  }
});

test('0015 decision columns are tied to status by independent biconditionals, and a rejection needs a reason', () => {
  assert.match(code, /check \(\(status = 'open'\) = \(decided_by is null\)\)/);
  assert.match(code, /check \(\(status = 'open'\) = \(decided_at is null\)\)/);
  assert.match(code, /check \(status <> 'open' or decision_note is null\)/);
  assert.match(code, /check \(status <> 'rejected' or decision_note is not null\)/);
  assert.match(code, /check \(\(kind in \('add_candidate', 'replace_source'\)\) = \(proposed_url is not null\)\)/);
  assert.match(code, /check \(\(kind = 'mark_unusable'\) = \(unusable_reason is not null\)\)/);
  assert.match(code, /check \(kind = 'add_candidate' or current_url is not null\)/);
  assert.match(code, /check \(unusable_reason is distinct from 'other' or note is not null\)/);
});

test('0015 allows at most one open proposal per restaurant (partial unique index)', () => {
  assert.match(code, /create unique index if not exists \w+\s+on source_triage_proposals \(market_id, restaurant_id\)\s+where status = 'open';/);
});

test('0015 grants: RLS on, nothing for anon/authenticated, column-scoped update, append-only events, no delete', () => {
  assert.match(code, /alter table source_triage_proposals\s+enable row level security;/);
  assert.match(code, /alter table source_triage_proposal_events enable row level security;/);
  assert.match(code, /revoke all on public\.source_triage_proposals\s+from public, anon, authenticated;/);
  assert.match(code, /revoke all on public\.source_triage_proposal_events from public, anon, authenticated;/);
  assert.match(code, /grant update \(status, decided_by, decided_at, decision_note\)\s+on public\.source_triage_proposals to service_role;/);
  const eventGrants = [...code.matchAll(/grant ([a-z, ]+) on public\.source_triage_proposal_events to (\w+)/g)];
  assert.deepEqual(eventGrants.map((m) => [m[1].trim(), m[2]]), [['select, insert', 'service_role']]);
  assert.doesNotMatch(code, /grant[^;]*\b(delete|truncate)\b/i);
  assert.doesNotMatch(code, /grant[^;]*to (anon|authenticated|public)\b/i);
  assert.doesNotMatch(code, /security definer/i);
});

test('0015 RPCs: fixed search_path, service_role execute only, typed errors, an event in the same function as each change', () => {
  const fnCount = (code.match(/set search_path = public/g) || []).length;
  assert.equal(fnCount, 2);
  assert.match(code, /grant execute on function create_source_triage_proposal\([^)]*\) to service_role;/);
  assert.match(code, /grant execute on function decide_source_triage_proposal\([^)]*\) to service_role;/);
  for (const c of ['P0030', 'P0031', 'P0032', 'P0033']) assert.match(code, new RegExp(`errcode = '${c}'`), c);
  const create = code.slice(code.indexOf('create or replace function create_source_triage_proposal'), code.indexOf('create or replace function decide_source_triage_proposal'));
  assert.match(create, /insert into source_triage_proposal_events \(proposal_id, event, actor_user_id, note\)\s+values \(v_result\.id, 'proposed'/);
  const decide = code.slice(code.indexOf('create or replace function decide_source_triage_proposal'));
  assert.match(decide, /where id = p_proposal_id and status = 'open'/);
  assert.match(decide, /insert into source_triage_proposal_events \(proposal_id, event, actor_user_id, note\)\s+values \(v_result\.id, p_decision/);
});

test('0015 error codes do not collide with codes used by earlier migrations', () => {
  const dir = path.join(REPO_ROOT, 'supabase/migrations');
  const earlier = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && f < '0015');
  const used = new Set();
  for (const f of earlier) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/errcode = '(P\d{4})'/g)) used.add(m[1]);
  for (const c of ['P0030', 'P0031', 'P0032', 'P0033']) assert.ok(!used.has(c), c);
});

// ── Exact privilege set (review M1/L1) ──────────────────────────────────
//
// Supabase's default privileges grant rights on new tables, sequences and
// functions in schema public DIRECTLY to anon, authenticated and
// service_role. Every 0015 object must therefore be revoked from all four
// explicitly, and service_role may get back only the exact minimum below.

function statements(kind) {
  return [...code.matchAll(new RegExp(`\\b${kind}\\b[^;]*;`, 'gi'))].map((m) => m[0].replace(/\s+/g, ' ').trim().toLowerCase());
}

const ALL_ROLES = 'from public, anon, authenticated, service_role;';
const CREATE_SIG = 'create_source_triage_proposal(uuid, uuid, text, text, text, text, text, text, uuid)';
const DECIDE_SIG = 'decide_source_triage_proposal(uuid, text, uuid, text)';

test('0015 identity sequence name is derived from the events table, and the migration targets exactly that sequence', () => {
  assert.match(code, /create table if not exists source_triage_proposal_events \(\s+id\s+bigint generated always as identity primary key,/);
  const expected = 'public.source_triage_proposal_events_id_seq';
  const sequences = [...code.matchAll(/on sequence ([\w.]+)/gi)].map((m) => m[1].toLowerCase());
  assert.ok(sequences.length >= 2, 'a revoke and a grant on the sequence');
  for (const s of sequences) assert.equal(s, expected);
});

test('0015 grants are exactly the minimum for service_role — nothing else, no GRANT ALL', () => {
  assert.deepEqual(statements('grant').sort(), [
    'grant execute on function ' + CREATE_SIG.toLowerCase() + ' to service_role;',
    'grant execute on function ' + DECIDE_SIG.toLowerCase() + ' to service_role;',
    'grant select, insert on public.source_triage_proposal_events to service_role;',
    'grant select, insert on public.source_triage_proposals to service_role;',
    'grant update (status, decided_by, decided_at, decision_note) on public.source_triage_proposals to service_role;',
    'grant usage on schema public to service_role;',
    'grant usage on sequence public.source_triage_proposal_events_id_seq to service_role;',
  ].sort());
  assert.doesNotMatch(code, /grant\s+all\b/i);
  assert.doesNotMatch(code, /alter default privileges/i);
});

test('0015 revokes every object from public, anon, authenticated and service_role before granting', () => {
  const revokes = statements('revoke');
  const required = [
    'revoke all on public.source_triage_proposals from public, anon, authenticated;',
    'revoke all on public.source_triage_proposal_events from public, anon, authenticated;',
    'revoke all on public.source_triage_proposals from service_role;',
    'revoke all on public.source_triage_proposal_events from service_role;',
    'revoke all on sequence public.source_triage_proposal_events_id_seq ' + ALL_ROLES,
    'revoke all on function ' + CREATE_SIG.toLowerCase() + ' ' + ALL_ROLES,
    'revoke all on function ' + DECIDE_SIG.toLowerCase() + ' ' + ALL_ROLES,
  ];
  for (const r of required) assert.ok(revokes.includes(r), `missing: ${r}`);
  assert.equal(revokes.length, required.length, 'no unexpected revoke');
  // Each revoke precedes the grant on the same object.
  const flat = code.replace(/\s+/g, ' ').toLowerCase();
  for (const [revoke, grant] of [
    ['revoke all on sequence public.source_triage_proposal_events_id_seq', 'grant usage on sequence public.source_triage_proposal_events_id_seq'],
    ['revoke all on function ' + CREATE_SIG.toLowerCase(), 'grant execute on function ' + CREATE_SIG.toLowerCase()],
    ['revoke all on function ' + DECIDE_SIG.toLowerCase(), 'grant execute on function ' + DECIDE_SIG.toLowerCase()],
    ['revoke all on public.source_triage_proposals from service_role', 'grant select, insert on public.source_triage_proposals'],
    ['revoke all on public.source_triage_proposal_events from service_role', 'grant select, insert on public.source_triage_proposal_events'],
  ]) {
    assert.ok(flat.indexOf(revoke) >= 0 && flat.indexOf(revoke) < flat.indexOf(grant), `${revoke} before ${grant}`);
  }
});

test('0015 functions stay security invoker with a fixed search_path; RLS stays on without policies', () => {
  assert.equal((code.match(/security invoker/g) || []).length, 2);
  assert.doesNotMatch(code, /security definer/i);
  assert.equal((code.match(/set search_path = public/g) || []).length, 2);
  assert.doesNotMatch(code, /create policy/i);
});
