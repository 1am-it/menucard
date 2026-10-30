-- 0022 — BE-46 samen kiezen, stemmen door te swipen (#106, criterium 1,
-- eigenaarsbesluit 30 oktober).
--
-- NOT YET APPLIED. Additive only; 0001-0021 are never edited. Two new tables,
-- one new function and their grants — no function, column or constraint of an
-- existing object changes.
--
-- Why this is needed: someone turns "Mijn lijstje" into a stemlink and shares
-- it with a group. Voters open the link without an account, give a roepnaam and
-- swipe through the dishes (right = lekker, left = liever niet). Everyone sees
-- the outcome. Stored per stemming: which dishes are in it, an optional closing
-- time and when it was made. Stored per vote: the stemming, an anonymous
-- browser id (a random value from that browser, never the IP address), the
-- roepnaam, which dish and lekker/liever-niet. Nothing else: no IP address, no
-- user agent, no account, no session, no cookie.
--
-- Why the code is the primary key: it is the only handle a voter gets. The app
-- generates it from 16 random bytes (crypto.randomBytes, base64url: 128 bits,
-- 22 characters, URL-safe); the check below only accepts that shape, so a
-- short or guessable code can never be stored, whatever the caller sends.
--
-- Why unique (stemming, stemmer, dish_key): a new vote replaces the previous
-- one for that dish. A stemmer therefore never counts twice for one dish, and
-- "vorige stem ongedaan maken" can delete exactly that one row.
--
-- Rights: row level security on, and deliberately NO policy for anon or
-- authenticated, so neither can read or write anything here. Everything goes
-- through the server route with the service role (POST /api/v1/kies and the
-- routes under it). service_role gets select/insert/update/delete on both
-- tables and execute on the cleanup function, and nothing else. Without the
-- explicit revoke, PostgreSQL would give PUBLIC execute on the new function.
--
-- Retention: after seven days everything is removed — the stemming and, through
-- on delete cascade, its votes. The owner runs that once a day through the cron
-- route /api/cron/kies-opruimen (vercel.json).
--
-- The application must keep working when this migration has not been applied
-- yet (owner decision 28 October: the file ships with the PR, the owner applies
-- it after the merge via "Apply production database migrations"): "Samen
-- kiezen" then shows one neat message. See src/lib/kiesHandlers.js.

create table if not exists kies_stemmingen (
  -- The unguessable code from the stemlink (/kies/<code>). 16 random bytes as
  -- base64url: 22 characters, 128 bits, URL-safe. A-Z, a-z, 0-9, - and _ only.
  code       text primary key check (code ~ '^[A-Za-z0-9_-]{22,86}$'),
  -- The dishes a voter swipes through: 1 to 12 dish ids, exactly as the
  -- deeplink (BE-12), the anchor (BE-29) and the list (BE-44) know them
  -- (<menukaart>-<categorie>-<gerecht>).
  dish_keys  text[] not null check (array_length(dish_keys, 1) between 1 and 12),
  -- Optional closing time: no value means the stemming stays open until it is
  -- removed after seven days.
  sluit_om   timestamptz,
  created_at timestamptz not null default now()
);

comment on table kies_stemmingen is
  'BE-46 samen kiezen: één rij per stemlink, met de gekozen gerechten, een optionele sluitingstijd en het moment van maken. Verwijderd na 7 dagen, inclusief de stemmen.';
comment on column kies_stemmingen.code is
  'Niet te raden url-veilige code uit 16 willekeurige bytes (128 bit): de enige sleutel die een stemmer krijgt.';

create table if not exists kies_stemmen (
  -- Only for ordering ("vorige stem ongedaan maken") and for a stable primary
  -- key. It is not an identity: no account, device, IP address or session is
  -- linked to it.
  stem_id       bigint generated always as identity primary key,
  stemming_code text not null references kies_stemmingen (code) on delete cascade,
  -- An anonymous id from the voter's browser (localStorage), never the IP
  -- address: the same shape as the code, a random url-safe value.
  stemmer       text not null check (stemmer ~ '^[A-Za-z0-9_-]{16,64}$'),
  -- The name the voter chose to show; the app trims it and allows at most 24
  -- characters. The check repeats that so no other writer can bypass it.
  roepnaam      text not null check (char_length(btrim(roepnaam)) between 1 and 24),
  dish_key      text not null check (char_length(dish_key) between 3 and 96),
  -- true = lekker, false = liever niet. There is no neutral vote (contract).
  lekker        boolean not null,
  gestemd_op    timestamptz not null default now(),
  -- A new vote replaces the previous one for that dish instead of adding up.
  constraint kies_stemmen_uniek unique (stemming_code, stemmer, dish_key)
);

comment on table kies_stemmen is
  'BE-46: per stemmer per gerecht precies één stem (lekker of liever niet). Alleen een roepnaam, een anoniem browserkenmerk en de stem zelf; geen IP-adres, user agent of account.';
comment on column kies_stemmen.stemmer is
  'Willekeurig kenmerk uit de browser van de stemmer (localStorage), niet het IP-adres. Geen account en geen sessie.';

-- The results always read all votes of one stemming.
create index if not exists kies_stemmen_stemming_idx on kies_stemmen (stemming_code);

alter table kies_stemmingen enable row level security;
alter table kies_stemmen enable row level security;

revoke all on public.kies_stemmingen from public, anon, authenticated;
revoke all on public.kies_stemmen from public, anon, authenticated;
revoke all on public.kies_stemmingen from service_role;
revoke all on public.kies_stemmen from service_role;

grant select, insert, update, delete on public.kies_stemmingen to service_role;
grant select, insert, update, delete on public.kies_stemmen to service_role;
-- The identity column needs its sequence, nothing else.
grant usage, select on sequence public.kies_stemmen_stem_id_seq to service_role;

-- Retention (criterium 1 en 3): everything older than seven days, including the
-- votes through on delete cascade. One fixed search_path, same posture as the
-- 0016 and 0021 functions, so the function cannot be hijacked through a
-- caller's search_path.
create or replace function verwijder_oude_kies_stemmingen(p_dagen integer default 7)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dagen      integer := greatest(coalesce(p_dagen, 7), 1);
  v_verwijderd integer;
begin
  delete from kies_stemmingen
   where created_at < now() - make_interval(days => v_dagen);
  get diagnostics v_verwijderd = row_count;
  return v_verwijderd;
end;
$$;

-- PostgreSQL grants execute to PUBLIC on every new function; only the cron
-- route (service role) may call this one. Anon and authenticated get nothing.
revoke all on function public.verwijder_oude_kies_stemmingen(integer) from public, anon, authenticated;
revoke all on function public.verwijder_oude_kies_stemmingen(integer) from service_role;
grant execute on function public.verwijder_oude_kies_stemmingen(integer) to service_role;
