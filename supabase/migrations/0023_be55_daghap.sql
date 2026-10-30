-- 0023 — BE-55 daghap en seizoensgerecht, stap A (#135, eigenaarsakkoord 30 okt).
--
-- NOT YET APPLIED. Additive only; 0001-0022 are never edited. Three new tables,
-- their indexes, their grants and one cleanup function — no column, function or
-- constraint of an existing object changes.
--
-- Why this is needed: a restaurant holder with an approved claim places a
-- daghap (today only, until closing time) or a seizoensgerecht (until an end
-- date). Guests see that offer on the restaurant page, in the search results
-- (label "Vandaag" and a filter) and on the home page, and it expires by
-- itself. Every placement and every change is kept.
--
-- Four tables:
--   daghap_aanbod          one row per placement: which restaurant, which kind,
--                          name, price in cents, description, labels, status,
--                          the moment it expires and why it is held (if it is);
--   daghap_meldingen       one row per report of a guest. Only the offer and an
--                          anonymous random value from that browser, so a second
--                          report from the same device does not count twice. No
--                          account, no IP address, no user agent, no cookie;
--   daghap_gebeurtenissen   the history: every placement, change, offline
--                          action, filter hit, report, approval and expiry;
--   daghap_plaatsrecht     the holder who may no longer place offer for one
--                          restaurant. A row here is the internal workqueue's
--                          "plaatsrecht ontnemen"; removing it gives the right
--                          back. Nothing else in the schema changes.
--
-- The checks below repeat the contract rules so that no writer can bypass
-- them, whatever the caller sends: name 3-80 characters, price 50-15000 cents
-- (€ 0,50 - € 150), description at most 140 characters, only the three known
-- labels, only known statuses and only known history actions. The one-active-
-- daghap rule is a unique partial index; the maximum of 3 seizoensgerechten and
-- the 10 placements/changes per account per day are counted by the API
-- (src/lib/daghapHandlers.js), which is the only writer.
--
-- Verloopt_op is always an absolute moment (timestamptz). The app computes it
-- in Europe/Amsterdam: end of the day at closing time when known, otherwise
-- 23:59; for a seizoensgerecht the end of the end date, at most 90 days ahead.
-- Expired offer is never shown again: the read routes filter on verloopt_op and
-- the cleanup function below moves it to status 'verlopen'.
--
-- Rights: row level security on, and deliberately NO policy for anon or
-- authenticated, so neither can read or write anything here. Everything goes
-- through the server routes under /api/v1/daghap with the service role.
-- service_role gets select/insert/update/delete on the four tables and execute
-- on the cleanup function, and nothing else. Without the explicit revoke,
-- PostgreSQL would give PUBLIC execute on the new function.
--
-- Retention: history and reports stay linked to their offer (on delete
-- cascade). Nothing is deleted automatically in this step; expired offer keeps
-- its history and is only marked 'verlopen'.
--
-- The application must keep working when this migration has not been applied
-- yet (owner decision 28 October: the file ships with the PR, the owner applies
-- it after the merge via "Apply production database migrations"): every daghap
-- route then answers 503 and the screen shows one neat message. See
-- src/lib/daghapHandlers.js.

create table if not exists daghap_aanbod (
  -- Only for ordering and as a stable handle in the routes and in the history.
  id             bigint generated always as identity primary key,
  restaurant_id  text not null check (char_length(btrim(restaurant_id)) between 1 and 64),
  -- The holder account that placed it. An approved claim is what grants this
  -- account its staff_roles owner row (0003); the API checks that row on every
  -- write. On account deletion the offer goes with it.
  user_id        uuid not null references auth.users (id) on delete cascade,
  soort          text not null check (soort in ('daghap', 'seizoensgerecht')),
  naam           text not null check (char_length(btrim(naam)) between 3 and 80),
  -- In cents, so no rounding ever enters the database: € 0,50 - € 150.
  prijs_cent     integer not null check (prijs_cent between 50 and 15000),
  beschrijving   text check (beschrijving is null or char_length(beschrijving) <= 140),
  -- Only the three labels from the contract. Placed text is never stored as
  -- HTML: the app escapes it on every render and stores plain text only.
  labels         text[] not null default '{}'::text[]
                 check (labels <@ array['vegetarisch', 'veganistisch', 'glutenvrij']::text[]),
  status         text not null default 'online'
                 check (status in ('online', 'in_controle', 'offline', 'verlopen')),
  -- Why the filter held it ("Wordt kort gecontroleerd"), for the internal
  -- voorraad. One short code or phrase, never the guest's data.
  filter_reden   text check (filter_reden is null or char_length(filter_reden) <= 80),
  verloopt_op    timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (verloopt_op > created_at)
);

comment on table daghap_aanbod is
  'BE-55 stap A: één rij per daghap of seizoensgerecht, met status online/in_controle/offline/verlopen en het absolute verloopmoment. Verlopen aanbod wordt nooit meer getoond.';
comment on column daghap_aanbod.prijs_cent is
  'Prijs in centen (50-15000), zodat er nooit een afronding in de opgeslagen prijs sluipt.';
comment on column daghap_aanbod.labels is
  'Alleen vegetarisch, veganistisch en glutenvrij (contract BE-55).';
comment on column daghap_aanbod.filter_reden is
  'Waarom het filter het aanbod tegenhield; zichtbaar voor de houder als "Wordt kort gecontroleerd".';

-- One active daghap per restaurant (contract: maximaal 1 actieve daghap).
-- A held or offline daghap no longer counts, so the holder can try again.
create unique index if not exists daghap_aanbod_een_daghap_per_restaurant
  on daghap_aanbod (restaurant_id)
  where soort = 'daghap' and status in ('online', 'in_controle');

-- The public and owner reads always look at one restaurant and its live offer.
create index if not exists daghap_aanbod_restaurant_idx
  on daghap_aanbod (restaurant_id, status, verloopt_op);

create table if not exists daghap_meldingen (
  melding_id bigint generated always as identity primary key,
  aanbod_id  bigint not null references daghap_aanbod (id) on delete cascade,
  -- An anonymous random value from the reporting browser (localStorage), the
  -- same shape as the kies code. Never the IP address, never an account.
  apparaat   text not null check (apparaat ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at timestamptz not null default now(),
  -- Per device a report counts once: a second tap replaces nothing and adds
  -- nothing, so three reports really are three different devices.
  constraint daghap_meldingen_een_per_apparaat unique (aanbod_id, apparaat)
);

comment on table daghap_meldingen is
  'BE-55: meldingen van gasten zonder account. Alleen het aanbod en een anoniem browserkenmerk per melding; geen IP-adres, user agent of account.';
comment on column daghap_meldingen.apparaat is
  'Willekeurig kenmerk uit de browser van de gast (localStorage), niet het IP-adres. Per aanbod telt elk kenmerk één keer.';

create index if not exists daghap_meldingen_aanbod_idx
  on daghap_meldingen (aanbod_id);

create table if not exists daghap_gebeurtenissen (
  gebeurtenis_id bigint generated always as identity primary key,
  -- Nullable since the internal workqueue acts on a holder's posting right and
  -- not on one offer (0023 step B): that row has a restaurant and an action,
  -- but no offer. A placement, change, report or approval always sets it.
  aanbod_id      bigint references daghap_aanbod (id) on delete cascade,
  -- Repeated here so the history stays readable per restaurant without a join.
  restaurant_id  text not null check (char_length(btrim(restaurant_id)) between 1 and 64),
  actie          text not null check (actie in (
                   'geplaatst', 'gewijzigd', 'offline', 'in_controle',
                   'gemeld', 'goedgekeurd', 'verwijderd', 'verlopen',
                   'recht_afgenomen', 'recht_teruggegeven'
                 )),
  -- The holder account for a placement or change; empty for a guest report and
  -- for the automatic expiry.
  door           uuid,
  -- The anonymous browser value of a report, same shape as in daghap_meldingen.
  apparaat       text check (apparaat is null or apparaat ~ '^[A-Za-z0-9_-]{16,64}$'),
  -- Snapshot of the offer at that moment (name, price, status), so a change
  -- never overwrites what was there before.
  gegevens       jsonb not null default '{}'::jsonb,
  moment         timestamptz not null default now()
);

comment on table daghap_gebeurtenissen is
  'BE-55: geschiedenis van elk aanbod. Elke plaatsing, wijziging, offline-actie, filtertreffer, melding, goedkeuring en het automatisch verlopen staat hier met een momentopname.';
comment on column daghap_gebeurtenissen.gegevens is
  'Momentopname van het aanbod (naam, prijs, status) op het moment van de actie.';

create index if not exists daghap_gebeurtenissen_aanbod_idx
  on daghap_gebeurtenissen (aanbod_id, moment);

-- The daily limit (10 placements/changes per account per day) counts this way.
create index if not exists daghap_gebeurtenissen_dag_idx
  on daghap_gebeurtenissen (door, moment)
  where actie in ('geplaatst', 'gewijzigd');

-- The internal workqueue's "plaatsrecht ontnemen": one row per holder who may no
-- longer place offer for one restaurant. The placing and changing routes read
-- this table and answer 403 while a row exists (src/lib/daghapHandlers.js).
-- Giving the right back deletes the row; nothing is ever hard-deleted from the
-- history, which keeps its own recht_afgenomen / recht_teruggegeven rows.
create table if not exists daghap_plaatsrecht (
  restaurant_id  text not null check (char_length(btrim(restaurant_id)) between 1 and 64),
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- The internal account that took the right; for the trail only.
  door           uuid,
  ingetrokken_op timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

comment on table daghap_plaatsrecht is
  'BE-55: houders die van de interne werkvoorraad geen daghap of seizoensgerecht meer mogen plaatsen. Een rij weghalen geeft het recht terug.';

alter table daghap_aanbod enable row level security;
alter table daghap_meldingen enable row level security;
alter table daghap_gebeurtenissen enable row level security;
alter table daghap_plaatsrecht enable row level security;

revoke all on public.daghap_aanbod from public, anon, authenticated;
revoke all on public.daghap_meldingen from public, anon, authenticated;
revoke all on public.daghap_gebeurtenissen from public, anon, authenticated;
revoke all on public.daghap_plaatsrecht from public, anon, authenticated;

revoke all on public.daghap_aanbod from service_role;
revoke all on public.daghap_meldingen from service_role;
revoke all on public.daghap_gebeurtenissen from service_role;
revoke all on public.daghap_plaatsrecht from service_role;

grant select, insert, update, delete on public.daghap_aanbod to service_role;
grant select, insert, update, delete on public.daghap_meldingen to service_role;
grant select, insert, update, delete on public.daghap_gebeurtenissen to service_role;
grant select, insert, update, delete on public.daghap_plaatsrecht to service_role;

-- The identity columns need their sequences, nothing else.
grant usage, select on sequence public.daghap_aanbod_id_seq to service_role;
grant usage, select on sequence public.daghap_meldingen_melding_id_seq to service_role;
grant usage, select on sequence public.daghap_gebeurtenissen_gebeurtenis_id_seq to service_role;

-- Expiry: everything whose moment has passed goes to 'verlopen' and gets one
-- history row, in one statement, so a run can never half-succeed. One fixed
-- search_path, the same posture as the 0016, 0021 and 0022 functions, so the
-- function cannot be hijacked through a caller's search_path.
create or replace function ruim_verlopen_daghap_op()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aantal integer;
begin
  with verlopen as (
    update daghap_aanbod
       set status = 'verlopen',
           updated_at = now()
     where verloopt_op <= now()
       and status in ('online', 'in_controle')
    returning id, restaurant_id, naam, prijs_cent, status
  )
  insert into daghap_gebeurtenissen (aanbod_id, restaurant_id, actie, gegevens)
  select id,
         restaurant_id,
         'verlopen',
         jsonb_build_object('naam', naam, 'prijs_cent', prijs_cent, 'status', status)
    from verlopen;

  get diagnostics v_aantal = row_count;
  return v_aantal;
end;
$$;

comment on function ruim_verlopen_daghap_op() is
  'BE-55: zet verlopen aanbod op status verlopen en schrijft één geschiedenisregel per aanbod. Alleen service_role mag hem aanroepen.';

-- PostgreSQL grants execute to PUBLIC on every new function; only the cron and
-- owner routes (service role) may call this one. Anon and authenticated get
-- nothing.
revoke all on function public.ruim_verlopen_daghap_op() from public, anon, authenticated;
revoke all on function public.ruim_verlopen_daghap_op() from service_role;
grant execute on function public.ruim_verlopen_daghap_op() to service_role;
