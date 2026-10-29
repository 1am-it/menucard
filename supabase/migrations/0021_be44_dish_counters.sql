-- 0021 — BE-44 anonieme tellers per gerecht per dag (#105, criterium 5,
-- Delivery Lead review 6485048101).
--
-- NOT YET APPLIED. Additive only; 0001-0020 are never edited. One new table,
-- one new function and their grants — no function, column or constraint of an
-- existing object changes.
--
-- Why this is needed: the owner wants to know, per dish, how often it is
-- shared, saved and how often a reservation link is clicked, without knowing
-- WHO did it. One row is (dish, day) with three counters. Nothing else is
-- stored: no user id, no cookie, no IP address, no user agent, no per-event
-- timestamp and no session. A row is an aggregate of a whole day and cannot be
-- traced back to a person.
--
-- Why a function: the app never writes the table directly. The public server
-- route POST /api/v1/tellers calls increment_dish_counter() with the service
-- role; the function upserts today (UTC) and accepts only the three known
-- events. A new or misspelled event can therefore never create a fourth
-- column or an unknown value.
--
-- Rights: row level security on, and deliberately NO policy for anon or
-- authenticated, so neither can read or write anything here. There are no read
-- rights for the outside world at all: this round only writes (the display of
-- the counters is a later ticket). service_role gets select/insert/update on
-- the table and execute on the function, and nothing else. Without the
-- explicit revoke, PostgreSQL would give PUBLIC execute on the new function.
--
-- The application must keep working when this migration has not been applied
-- yet (owner decision 28 October: the file ships with the PR, the owner applies
-- it after the merge via "Apply production database migrations"): the route
-- then fails safe with 204 and counts nothing. See
-- src/lib/dishCounterHandlers.js.

create table if not exists dish_counters (
  -- The dish id exactly as the deeplink and the anchor know it:
  -- <menu>-<category>-<dish>, e.g. 6-diner-0-0.
  dish_key           text not null check (char_length(dish_key) between 3 and 96),
  -- The UTC day of the event. Not the server's local day: one row per dish per
  -- calendar day in UTC, so the counts of every visitor land in the same row.
  day                date not null,
  shared             integer not null default 0 check (shared >= 0),
  saved              integer not null default 0 check (saved >= 0),
  reservation_clicks integer not null default 0 check (reservation_clicks >= 0),
  primary key (dish_key, day)
);

comment on table dish_counters is
  'BE-44 anonieme tellers: per gerecht per UTC-dag alleen opgetelde getallen. Geen identiteit, geen IP-adres, geen cookie, geen tijdstip per gebeurtenis.';
comment on column dish_counters.dish_key is
  'Gerecht-id zoals de deeplink (BE-12) en het anker (BE-29) hem kennen: <menukaart>-<categorie>-<gerecht>.';

alter table dish_counters enable row level security;

revoke all on public.dish_counters from public, anon, authenticated;
revoke all on public.dish_counters from service_role;

grant select, insert, update on public.dish_counters to service_role;

-- The one write path: +1 on today's row for exactly one of the three events.
create or replace function increment_dish_counter(p_dish_key text, p_event text)
returns void
language plpgsql
security definer
-- A fixed search_path, so the function cannot be hijacked through a caller's
-- search_path. Same posture as the 0016 RPCs.
set search_path = public, pg_temp
as $$
declare
  v_dish_key text := btrim(coalesce(p_dish_key, ''));
  v_day      date := (now() at time zone 'utc')::date;
begin
  if p_event is null or p_event not in ('gedeeld', 'bewaard', 'reserveren') then
    raise exception 'unknown dish counter event: %', p_event
      using errcode = 'P0050';
  end if;

  if char_length(v_dish_key) < 3
     or char_length(v_dish_key) > 96
     or v_dish_key !~ '^[a-z0-9]+(-[a-z0-9]+)*(-[0-9]+){2}$' then
    raise exception 'invalid dish key: %', p_dish_key
      using errcode = 'P0051';
  end if;

  insert into dish_counters as c (dish_key, day, shared, saved, reservation_clicks)
  values (
    v_dish_key,
    v_day,
    case when p_event = 'gedeeld' then 1 else 0 end,
    case when p_event = 'bewaard' then 1 else 0 end,
    case when p_event = 'reserveren' then 1 else 0 end
  )
  on conflict (dish_key, day) do update set
    shared             = c.shared + case when p_event = 'gedeeld' then 1 else 0 end,
    saved              = c.saved + case when p_event = 'bewaard' then 1 else 0 end,
    reservation_clicks = c.reservation_clicks + case when p_event = 'reserveren' then 1 else 0 end;
end;
$$;

-- PostgreSQL grants execute to PUBLIC on every new function; only the server
-- route (service role) may call this one. Anon and authenticated get nothing,
-- so the public API can never write or read the table directly.
revoke all on function public.increment_dish_counter(text, text) from public, anon, authenticated;
revoke all on function public.increment_dish_counter(text, text) from service_role;
grant execute on function public.increment_dish_counter(text, text) to service_role;
